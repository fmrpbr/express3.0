'use strict';

const { createHash } = require('node:crypto');

const PROVIDERS = Object.freeze({
  ifood: { id: 'ifood', name: 'iFood', requirements: ['Contrato e credenciais oficiais', 'Webhook/API habilitado pelo parceiro', 'Mapeamento de loja e eventos de pedido'] },
  aiboo: { id: 'aiboo', name: 'Aiboo', requirements: ['Credenciais e documentação do parceiro', 'Webhook/API habilitado pelo parceiro', 'Mapeamento de loja e eventos de pedido'] },
  pedeai: { id: 'pedeai', name: 'pede.ai', requirements: ['Credenciais e documentação do parceiro', 'Webhook/API habilitado pelo parceiro', 'Mapeamento de loja e eventos de pedido'] }
});
// No provider-specific API adapter has been found or validated in this repository.
const ADAPTERS = Object.freeze({});

function providerId(value) {
  const id = String(value || '').toLowerCase();
  if (!Object.hasOwn(PROVIDERS, id)) throw Error('Plataforma de pedidos inválida.');
  return id;
}

function readiness(registry, provider) {
  const id = providerId(provider);
  const connection = registry?.[id];
  const ready = !!ADAPTERS[id] && connection?.status === 'ready' && connection.adapterVersion === 1 && Number(connection.verifiedAt) > 0;
  const status = !ADAPTERS[id] ? 'adapter_pending' : ready ? 'ready' : connection ? 'pending_validation' : 'not_configured';
  return { ...PROVIDERS[id], status, ready, adapterImplemented: !!ADAPTERS[id] };
}

function idempotencyKey(provider, storeUid, externalOrderId) {
  const id = providerId(provider);
  const store = String(storeUid || '').trim();
  const externalId = String(externalOrderId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(store) || !externalId || externalId.length > 180) throw Error('Identificador externo inválido.');
  return createHash('sha256').update(`${id}\0${store}\0${externalId}`).digest('hex');
}

function reserveExternalOrder(state, provider, storeUid, externalOrderId, now, newOrderId) {
  const id = providerId(provider);
  const profile = state.profiles?.stores?.[storeUid];
  if (!profile || profile.accessStatus && profile.accessStatus !== 'approved') throw Error('Loja não encontrada ou sem aprovação.');
  const key = idempotencyKey(id, storeUid, externalOrderId);
  const existing = state.externalOrderLedger?.[key];
  if (existing) return { duplicate: true, orderId: existing.orderId, idempotencyKey: key };
  if (typeof newOrderId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(newOrderId)) throw Error('Identificador interno inválido.');
  state.externalOrderLedger ||= {};
  state.externalOrderLedger[key] = { provider: id, storeUid, orderId: newOrderId, receivedAt: now, state: 'claimed' };
  return { duplicate: false, orderId: newOrderId, idempotencyKey: key };
}

function claimInboundOrder(state, input, now, newOrderId) {
  const id = providerId(input?.provider), storeUid = String(input?.storeUid || '').trim();
  const profile = state.profiles?.stores?.[storeUid];
  if (!profile || profile.accessStatus && profile.accessStatus !== 'approved') throw Error('Loja não encontrada ou sem aprovação.');
  if (!readiness(state.config?.externalIntegrations, id).ready) throw Error(`A conexão com ${PROVIDERS[id].name} ainda não tem adapter validado neste ambiente.`);
  if (profile.externalAutoCall?.[id] !== true) return { accepted: false, reason: 'manual', idempotencyKey: idempotencyKey(id, storeUid, input.externalOrderId) };
  return { accepted: true, ...reserveExternalOrder(state, id, storeUid, input.externalOrderId, now, newOrderId) };
}

function dispatch(state, uid, who, action, input, context, api) {
  const { fail, put } = api;
  fail(who?.role === 'store', 'Somente lojistas podem alterar a chamada automática.', 'permission-denied');
  const provider = providerId(input?.provider);
  fail(typeof input.enabled === 'boolean', 'Informe se a chamada automática deve ficar ativa.', 'invalid-argument');
  const storePath = `profiles/stores/${uid}`;
  const autoCall = { ...(state.profiles?.stores?.[uid]?.externalAutoCall || {}) };
  if (input.enabled) {
    const status = readiness(state.config?.externalIntegrations, provider);
    fail(status.ready, `A chamada automática do ${PROVIDERS[provider].name} permanece pausada até configurar credenciais, ativar o adapter e validar a conexão real.`, 'failed-precondition');
    autoCall[provider] = true;
  } else {
    delete autoCall[provider];
  }
  put(state, `${storePath}/externalAutoCall`, Object.keys(autoCall).length ? autoCall : null);
  put(state, `storeEvents/${uid}/${context.requestId}`, { action, actorUid: uid, provider, enabled: input.enabled, at: context.now });
  return { ok: true, provider, enabled: input.enabled };
}

module.exports = { PROVIDERS, readiness, idempotencyKey, reserveExternalOrder, claimInboundOrder, handles: action => action === 'setExternalAutoDispatch', dispatch };
