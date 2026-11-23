'use strict';

const actions = new Set(['saveDeliveryProof', 'reportOccurrence', 'resolveOccurrence', 'submitDeliveryRating']);
const OCCURRENCE_TYPES = new Set(['delay', 'address', 'recipient', 'item', 'vehicle', 'safety', 'payment', 'other']);

function dispatch(state, uid, who, action, orderId, input, context, api) {
  const { fail, key, put } = api;
  const order = state.orders?.[orderId];
  fail(order, 'Pedido não encontrado.', 'not-found');
  const previous = structuredClone(order);
  const isStore = who?.role === 'store' && (order.storeId === uid || order.routeStoreIds?.[uid] === true);
  const isCourier = who?.role === 'courier' && order.courierId === uid;
  const participant = () => fail(isStore || isCourier, 'Somente os participantes desta entrega podem registrar esta informação.', 'permission-denied');
  const finish = (result, extraRecipients = []) => {
    order.revision = Number(order.revision || 0) + 1;
    order.updatedAt = context.now;
    order.lastActorUid = uid;
    api.projectOrder(state, orderId, order, previous, context.now);
    put(state, `orderEvents/${orderId}/${uid}_${context.requestId}`, { action, actorUid: uid, at: context.now, revision: order.revision });
    const route = order.routeId ? state.orders?.[order.routeId] : order;
    const recipients = [...new Set([order.storeId, ...Object.keys(route?.routeStoreIds || {}), order.courierId, ...extraRecipients].filter(id => id && id !== uid))];
    if (recipients.length) put(state, `pushUpdates/${orderId}_${order.revision}`, { orderId, action, status: order.status, recipients, createdAt: context.now });
    return result;
  };

  if (action === 'saveDeliveryProof') {
    fail(isCourier, 'Somente o motoboy responsável pode registrar o comprovante.', 'permission-denied');
    fail(order.kind !== 'route' && (order.status === 'done' || order.status === 'run' && order.picked), 'Confirme a retirada antes de registrar a entrega.');
    fail(!state.deliveryProofs?.[orderId], 'Esta entrega já tem comprovante.');
    const recipientName = String(input.recipientName || '').trim().slice(0, 100);
    const signature = input.signature;
    const notes = String(input.notes || '').trim().slice(0, 240);
    fail(recipientName.length > 0, 'Informe quem recebeu a entrega.', 'invalid-argument');
    fail(typeof signature === 'string' && signature.length <= 8000 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(signature), 'Registre a assinatura digital antes de salvar.', 'invalid-argument');
    const proof = { version: 1, orderId, recipientName, signature, notes, courierId: uid, createdAt: context.now };
    put(state, `deliveryProofs/${orderId}`, proof);
    order.deliveryProofAt = context.now;
    order.deliveryProofRecipient = recipientName;
    return finish({ ok: true, orderId, createdAt: proof.createdAt });
  }

  if (action === 'reportOccurrence') {
    participant();
    fail(['run', 'done', 'cancelled', 'route_cancelled', 'route_done'].includes(order.status), 'Registre ocorrências durante ou após a operação.');
    const kind = String(input.kind || 'other');
    fail(OCCURRENCE_TYPES.has(kind), 'Tipo de ocorrência inválido.', 'invalid-argument');
    const description = String(input.description || '').trim().slice(0, 500);
    fail(description.length > 0, 'Descreva a ocorrência.', 'invalid-argument');
    const occurrenceId = key(context.newId, 'Ocorrência');
    const record = { id: occurrenceId, orderId, kind, description, status: 'open', reporterUid: uid, reporterRole: who.role, createdAt: context.now };
    put(state, `orderOccurrences/${orderId}/${occurrenceId}`, record);
    order.occurrenceCount = Number(order.occurrenceCount || 0) + 1;
    order.openOccurrenceCount = Number(order.openOccurrenceCount || 0) + 1;
    order.lastOccurrenceAt = context.now;
    const admins = Object.entries(state.notificationAccounts || {}).filter(([, account]) => account.role === 'admin').map(([id]) => id);
    return finish({ ok: true, orderId, occurrenceId }, admins);
  }

  if (action === 'resolveOccurrence') {
    fail(context.isAdmin === true, 'Acesso administrativo necessário.', 'permission-denied');
    const occurrenceId = key(input.occurrenceId, 'Ocorrência');
    const record = state.orderOccurrences?.[orderId]?.[occurrenceId];
    fail(record, 'Ocorrência não encontrada.', 'not-found');
    fail(record.status === 'open', 'Esta ocorrência já foi tratada.');
    const status = input.status === 'dismissed' ? 'dismissed' : 'resolved';
    record.status = status;
    record.resolution = String(input.resolution || '').trim().slice(0, 500);
    record.resolvedAt = context.now;
    record.resolvedBy = uid;
    order.openOccurrenceCount = Math.max(0, Number(order.openOccurrenceCount || 1) - 1);
    return finish({ ok: true, orderId, occurrenceId, status });
  }

  if (action === 'submitDeliveryRating') {
    participant();
    fail(order.status === 'done' && order.kind !== 'route', 'Avalie depois que esta entrega for concluída.');
    fail(isStore ? !!order.courierId : !!order.storeId, 'Não foi possível identificar quem será avaliado.');
    const score = Number(input.score);
    fail(Number.isInteger(score) && score >= 1 && score <= 5, 'Escolha uma nota de 1 a 5.', 'invalid-argument');
    const note = String(input.note || '').trim().slice(0, 240);
    const raterRole = who.role;
    const targetRole = raterRole === 'store' ? 'courier' : 'store';
    const targetId = targetRole === 'courier' ? order.courierId : order.storeId;
    const ratingPath = `orderRatings/${orderId}/${raterRole}`;
    fail(!state.orderRatings?.[orderId]?.[raterRole], 'Você já avaliou esta entrega.');
    put(state, ratingPath, { orderId, raterUid: uid, raterRole, targetId, targetRole, score, note, createdAt: context.now });
    const status = order.ratingStatus || {};
    status[raterRole === 'store' ? 'storeSubmitted' : 'courierSubmitted'] = true;
    order.ratingStatus = status;
    const current = state.ratingSummaries?.[targetRole]?.[targetId] || { count: 0, total: 0 };
    const count = Number(current.count || 0) + 1;
    const total = Number(current.total || 0) + score;
    put(state, `ratingSummaries/${targetRole}/${targetId}`, { count, total, average: Math.round(total / count * 100) / 100, updatedAt: context.now });
    return finish({ ok: true, orderId, targetRole, count });
  }

  fail(false, 'Ação de registro desconhecida.', 'invalid-argument');
}

module.exports = { actions, handles: action => actions.has(action), dispatch, OCCURRENCE_TYPES };
