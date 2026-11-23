const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyCommand, publicOrder, canTakeOrder } = require('../../functions/domain');
const Offers = require('../../functions/offer-distribution');

const now = Date.parse('2026-11-22T15:00:00Z');
let sequence = 0;
const auth = (uid, admin = false) => ({ uid, token: { email: uid + '@example.test', ...(admin ? { admin: true } : {}) } });
function fixture(count = 6) {
  const couriers = {}, courierPresence = {}, courierConnections = {};
  for (let index = 1; index <= count; index++) {
    const uid = `courier${index}`;
    couriers[uid] = { name: `MOTO ${index}`, accessStatus: 'approved' };
    courierPresence[uid] = { availableForWork: index !== 2, busy: false };
    if (index !== 3) courierConnections[uid] = { browser: { lastSeen: now } };
  }
  return {
    config: { offerDistribution: { enabled: true, couriersPerRound: 3, responseSeconds: 30, maxRounds: 3 } },
    profiles: { stores: { storeA: { name: 'LOJA A', address: 'RUA DA LOJA' } }, couriers },
    courierPresence, courierConnections
  };
}
function run(state, uid, action, orderId = null, input = {}, admin = false) {
  const command = { requestId: `offer_${++sequence}`, action, ...(orderId ? { orderId } : {}), input };
  return applyCommand(state, auth(uid, admin), command, {
    now, newId: 'offerOrder', token: 'a'.repeat(64), fingerprint: JSON.stringify(command)
  });
}
function create(state = fixture(), id = 'offerOrder') {
  return run(state, 'storeA', 'saveOrder', null, {
    serviceType: 'delivery', serviceDate: '2026-11-22', city: 'ARACRUZ', clientNeighborhood: 'CENTRO',
    client: 'CLIENTE', phone: '27999999999', clientStreet: 'RUA CLIENTE', clientNumber: '1', selectedZone: '', paymentMethod: 'money'
  }).state;
}

test('distribui até três convites somente a motoboys online e disponíveis', () => {
  const state = create();
  const ids = Object.keys(state.courierOffers || {});
  assert.equal(state.config.offerDistribution.responseSeconds, 30);
  assert.equal(state.offerRounds.offerOrder.round, 1);
  assert.equal(ids.length, 3);
  assert.ok(ids.every(uid => ['courier1', 'courier4', 'courier5', 'courier6'].includes(uid)));
  assert.equal(state.availableOrders?.offerOrder, undefined);
  assert.equal(Object.keys(state.offerJobs).length, 1);
  assert.equal(Object.values(state.courierOffers).every(offers => offers.offerOrder.offerStatus === 'pending'), true);
});

test('bloqueia aceite sem convite e impede aceitar outra corrida com oferta pendente', () => {
  let state = create();
  const invited = state.offerRounds.offerOrder.pendingCourierIds[0];
  assert.throws(() => run(state, 'courier2', 'accept', 'offerOrder'), /não foi enviada/);
  state.courierOffers[invited].otherOrder = { offerStatus: 'pending', offerExpiresAt: now + 60000 };
  assert.throws(() => run(state, invited, 'accept', 'offerOrder'), /Aceite ou recuse/);
  delete state.courierOffers[invited].otherOrder;
  state = run(state, invited, 'accept', 'offerOrder').state;
  assert.equal(state.orders.offerOrder.status, 'run');
  assert.equal(state.orders.offerOrder.courierId, invited);
  assert.equal(state.availableOrders?.offerOrder, undefined);
  assert.equal(state.offerRounds?.offerOrder, undefined);
});

test('recusa aceita motivo opcional, não pune e abre a rodada seguinte após todas as respostas', () => {
  let state = create();
  const firstRound = [...state.offerRounds.offerOrder.pendingCourierIds];
  state = run(state, firstRound[0], 'decline-offer', 'offerOrder', { reason: 'Sem disponibilidade agora' }).state;
  assert.equal(state.courierOffers[firstRound[0]].offerOrder.offerStatus, 'declined');
  assert.equal(state.courierOffers[firstRound[0]].offerOrder.declineReason, 'Sem disponibilidade agora');
  assert.equal(state.courierPresence[firstRound[0]].availableForWork, true);
  assert.equal(state.courierPresence[firstRound[0]].penalty, undefined);
  state = run(state, firstRound[1], 'decline-offer', 'offerOrder', {}).state;
  state = run(state, firstRound[2], 'decline-offer', 'offerOrder', { reason: '' }).state;
  assert.equal(state.offerRounds.offerOrder.round, 2);
  assert.equal(state.offerRounds.offerOrder.pendingCourierIds.length, 1);
  assert.ok(state.offerRounds.offerOrder.pendingCourierIds.every(uid => !firstRound.includes(uid)));
});

test('expira até três rodadas sem reofertar aos mesmos motoboys', () => {
  let state = create();
  const seen = new Set();
  for (let round = 1; round <= 3; round++) {
    const queue = state.offerRounds.offerOrder;
    for (const uid of queue.pendingCourierIds) {
      assert.equal(seen.has(uid), false);
      seen.add(uid);
    }
    const result = Offers.advanceRound(state, { orderId: 'offerOrder', generation: 1, round }, queue.expiresAt, publicOrder, canTakeOrder);
    assert.equal(result.advanced, true);
  }
  assert.ok(state.offerRounds.offerOrder.completedAt);
  assert.deepEqual(state.offerRounds.offerOrder.pendingCourierIds, []);
  assert.equal(state.availableOrders?.offerOrder, undefined);
});

test('parâmetros administrativos ficam limitados a três motoboys e três rodadas', () => {
  const state = fixture();
  const saved = run(state, 'admin', 'setOfferDistribution', null, {
    enabled: true, couriersPerRound: 2, responseSeconds: 45, maxRounds: 2
  }, true).state;
  assert.deepEqual(Offers.settings(saved), { enabled: true, couriersPerRound: 2, responseSeconds: 45, maxRounds: 2 });
  assert.throws(() => run(saved, 'admin', 'setOfferDistribution', null, {
    enabled: true, couriersPerRound: 4, responseSeconds: 30, maxRounds: 3
  }, true), /Use 1 a 3 motoboys/);
  assert.throws(() => run(saved, 'storeA', 'setOfferDistribution', null, {
    enabled: true, couriersPerRound: 3, responseSeconds: 30, maxRounds: 3
  }), /Acesso administrativo/);
});
