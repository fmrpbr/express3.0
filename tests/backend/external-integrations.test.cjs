'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyCommand } = require('../../functions/domain');
const Integrations = require('../../functions/external-integrations');

let sequence = 0;
const now = Date.parse('2026-11-22T15:00:00Z');
const fixture = () => ({ profiles: { stores: { shop: { name: 'LOJA', accessStatus: 'approved' } } } });
function run(state, uid, action, input = {}, { admin = false } = {}) {
  const command = { action, input, requestId: `external_req_${++sequence}` };
  return applyCommand(state, { uid, token: admin ? { admin: true } : {} }, command, { now, newId: `external_${sequence}`, token: 'a'.repeat(64), fingerprint: JSON.stringify(command) });
}

test('provedores externos começam indisponíveis, sem credenciais simuladas', () => {
  const state = fixture();
  for (const id of Object.keys(Integrations.PROVIDERS)) {
    assert.equal(Integrations.readiness(state.config?.externalIntegrations, id).status, 'adapter_pending');
    assert.throws(() => run(state, 'shop', 'setExternalAutoDispatch', { provider: id, enabled: true }), /permanece pausada/);
  }
});

test('lojista consegue manter chamada automática pausada sem afetar suas entregas', () => {
  const state = run(fixture(), 'shop', 'setExternalAutoDispatch', { provider: 'ifood', enabled: false }).state;
  assert.equal(state.profiles.stores.shop.externalAutoCall, undefined);
  assert.equal(Object.values(state.storeEvents.shop)[0].provider, 'ifood');
});

test('ledger reserva uma única corrida por provedor, loja e pedido de origem', () => {
  const state = fixture();
  const first = Integrations.reserveExternalOrder(state, 'ifood', 'shop', 'order-123', now, 'internal_1');
  const second = Integrations.reserveExternalOrder(state, 'ifood', 'shop', 'order-123', now + 1, 'internal_2');
  const otherStore = { ...state, profiles: { stores: { another: { accessStatus: 'approved', externalAutoCall: { ifood: true } } } } };
  const third = Integrations.reserveExternalOrder(otherStore, 'ifood', 'another', 'order-123', now + 2, 'internal_3');
  assert.equal(first.duplicate, false);assert.equal(second.duplicate, true);assert.equal(second.orderId, 'internal_1');assert.equal(third.duplicate, false);
  state.config = { externalIntegrations: { ifood: { status: 'ready', adapterVersion: 1, verifiedAt: now } } };
  assert.throws(() => Integrations.claimInboundOrder(state, { provider: 'ifood', storeUid: 'shop', externalOrderId: 'order-123' }, now, 'internal_4'), /adapter validado/);
});
