'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyCommand } = require('../../functions/domain');

let sequence = 0;
const base = () => ({
  profiles: { stores: { shop: { name: 'LOJA' } }, couriers: { rider: { name: 'MOTOBOY' } } },
  notificationAccounts: { admin: { role: 'admin' } },
  orders: { delivery: { orderCode: 'EXP-123', storeId: 'shop', courierId: 'rider', courierName: 'MOTOBOY', status: 'run', picked: 100, fee: 12, created: 1, revision: 1 } }
});
function run(state, uid, action, input = {}, options = {}) {
  const requestId = options.requestId || `records_${++sequence}`;
  const command = { action, orderId: options.orderId || 'delivery', input, requestId };
  const auth = { uid, token: options.admin ? { admin: true } : {} };
  const result = applyCommand(state, auth, command, {
    now: options.now || 200,
    newId: options.newId || `generated_${sequence}`,
    token: 'f'.repeat(64),
    fingerprint: JSON.stringify(command)
  });
  return result;
}

test('comprovante digital fica privado, exige assinatura e não substitui a confirmação de retirada', () => {
  const signature = 'data:image/png;base64,' + Buffer.from('assinatura teste').toString('base64');
  let state = base();
  assert.throws(() => run(state, 'shop', 'saveDeliveryProof', { recipientName: 'CLIENTE', signature }), /motoboy responsável/);
  assert.throws(() => run(state, 'rider', 'saveDeliveryProof', { recipientName: 'CLIENTE', signature: 'invalida' }), /assinatura digital/);
  const command = { recipientName: 'CLIENTE TESTE', signature, notes: 'Recebido na portaria' };
  state = run(state, 'rider', 'saveDeliveryProof', command, { requestId: 'proof_1' }).state;
  assert.equal(state.deliveryProofs.delivery.recipientName, 'CLIENTE TESTE');
  assert.equal(state.orders.delivery.deliveryProofAt, 200);
  assert.equal(state.orders.delivery.deliveryProofRecipient, 'CLIENTE TESTE');
  assert.equal(state.orders.delivery.picked, 100);
  assert.equal(state.publicTracking, undefined);
  assert.throws(() => run(state, 'rider', 'saveDeliveryProof', command), /já tem comprovante/);
});

test('ocorrência mantém autoria e trilha de resolução administrativa com notificação', () => {
  let state = base();
  const report = run(state, 'shop', 'reportOccurrence', { kind: 'address', description: 'Número do imóvel divergente' }, { newId: 'issue_1' });
  state = report.state;
  assert.equal(state.orderOccurrences.delivery.issue_1.reporterRole, 'store');
  assert.equal(state.orders.delivery.openOccurrenceCount, 1);
  assert.ok(Object.values(state.pushUpdates).some(event => event.action === 'reportOccurrence' && event.recipients.includes('admin')));
  assert.throws(() => run(state, 'outsider', 'reportOccurrence', { description: 'Não autorizado' }), /Perfil/);
  state = run(state, 'admin', 'resolveOccurrence', { occurrenceId: 'issue_1', status: 'resolved', resolution: 'Endereço corrigido' }, { admin: true }).state;
  assert.equal(state.orderOccurrences.delivery.issue_1.status, 'resolved');
  assert.equal(state.orderOccurrences.delivery.issue_1.resolution, 'Endereço corrigido');
  assert.equal(state.orders.delivery.openOccurrenceCount, 0);
});

test('avaliação exige entrega concluída, é uma por perfil e alimenta médias agregadas', () => {
  let state = base();
  assert.throws(() => run(state, 'shop', 'submitDeliveryRating', { score: 5 }), /concluída/);
  state.orders.delivery.status = 'done';
  state = run(state, 'shop', 'submitDeliveryRating', { score: 5, note: 'Entrega cuidadosa' }).state;
  assert.equal(state.orderRatings.delivery.store.score, 5);
  assert.deepEqual(state.ratingSummaries.courier.rider, { count: 1, total: 5, average: 5, updatedAt: 200 });
  assert.equal(state.orders.delivery.ratingStatus.storeSubmitted, true);
  assert.throws(() => run(state, 'shop', 'submitDeliveryRating', { score: 4 }), /já avaliou/);
  state = run(state, 'rider', 'submitDeliveryRating', { score: 4 }).state;
  assert.equal(state.orderRatings.delivery.courier.score, 4);
  assert.deepEqual(state.ratingSummaries.store.shop, { count: 1, total: 4, average: 4, updatedAt: 200 });
  assert.equal(state.orders.delivery.ratingStatus.courierSubmitted, true);
});
