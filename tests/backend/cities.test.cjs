'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyCommand } = require('../../functions/domain');

let sequence = 0;
const now = Date.parse('2026-11-22T15:00:00Z');
const fixture = () => ({ profiles: { stores: { shop: { name: 'LOJA', address: 'RUA DA LOJA' } }, couriers: { rider: { name: 'MOTOBOY' } } } });
function run(state, uid, action, input = {}, { orderId, admin = false, at = now, newId = `city_${++sequence}` } = {}) {
  const command = { action, input, requestId: `city_req_${++sequence}`, ...(orderId ? { orderId } : {}) };
  return applyCommand(state, { uid, token: admin ? { admin: true } : {} }, command, { now: at, newId, token: 'a'.repeat(64), fingerprint: JSON.stringify(command) });
}
const orderInput = extra => ({ serviceType: 'delivery', serviceDate: '2026-11-23', city: 'Vila Velha', clientNeighborhood: 'Centro', client: 'Cliente', phone: '27999999999', clientStreet: 'Rua Um', clientNumber: '10', paymentMethod: 'money', ...extra });

test('admin cadastra cidade com tarifa própria; pedido grava cidade canônica e não herda tarifas da sede', () => {
  let state = fixture();
  assert.throws(() => run(state, 'shop', 'saveCityConfig', { name: 'Vila Velha', baseFee: 23 }), /administrativo/);
  state = run(state, 'admin', 'saveCityConfig', { name: 'Vila Velha', baseFee: 23, nightFee: 31, timezone: 'America/Sao_Paulo', zoneRates: { 'Praia da Costa': 27.5 } }, { admin: true }).state;
  assert.equal(state.config.cities['vila-velha'].enabled, true);
  state = run(state, 'shop', 'saveOrder', orderInput(), { orderId: undefined, newId: 'order_vv' }).state;
  assert.equal(state.orders.order_vv.cityId, 'vila-velha');
  assert.equal(state.orders.order_vv.city, 'VILA VELHA');
  assert.equal(state.orders.order_vv.fee, 23);
  assert.equal(state.orders.order_vv.priceSnapshot.tariffPlanId, 'city-vila-velha');
  state = run(state, 'shop', 'saveOrder', orderInput({ selectedZone: 'Praia da Costa' }), { newId: 'order_praia' }).state;
  assert.equal(state.orders.order_praia.fee, 27.5);
  state = run(state, 'admin', 'saveCityConfig', { name: 'Manaus', baseFee: 19, nightFee: 29, timezone: 'America/Manaus' }, { admin: true }).state;
  state = run(state, 'shop', 'saveOrder', orderInput({ city: 'Manaus', selectedZone: 'Sede e Bairros (Padrão)' }), { at: Date.parse('2026-11-23T00:00:00Z'), newId: 'order_manaus' }).state;
  assert.equal(state.orders.order_manaus.fee, 29);
});

test('cidade não cadastrada ou pausada não aceita novo pedido e pedido já existente continua editável', () => {
  let state = run(fixture(), 'admin', 'saveCityConfig', { name: 'Vila Velha', baseFee: 23 }, { admin: true }).state;
  assert.throws(() => run(state, 'shop', 'saveOrder', orderInput({ city: 'Serra' }), { newId: 'unknown' }), /não cadastrada/);
  state = run(state, 'shop', 'saveOrder', orderInput(), { newId: 'existing' }).state;
  state = run(state, 'admin', 'setCityEnabled', { cityId: 'vila-velha', enabled: false }, { admin: true }).state;
  assert.throws(() => run(state, 'shop', 'saveOrder', orderInput(), { newId: 'paused' }), /pausada/);
  state = run(state, 'shop', 'saveOrder', orderInput(), { orderId: 'existing' }).state;
  assert.equal(state.orders.existing.status, 'open');
});

test('Aracruz mantém compatibilidade com a tarifa V2 e cidade inválida não altera parâmetros', () => {
  const state = fixture();
  const result = run(state, 'shop', 'saveOrder', orderInput({ city: 'Aracruz' }), { newId: 'aracruz' }).state;
  assert.equal(result.orders.aracruz.cityId, 'aracruz');
  assert.equal(result.orders.aracruz.fee, 7);
  assert.throws(() => run(state, 'admin', 'saveCityConfig', { name: 'Cidade/Inválida', baseFee: 10 }, { admin: true }), /válido/);
});
