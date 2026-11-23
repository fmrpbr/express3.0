const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createOrderContact } = require("../../functions/order-contact");
const { publicOrder } = require("../../functions/domain");
const { createRouteEstimate } = require("../../functions/order-route-estimate");

test("contatos da corrida são restritos aos participantes autorizados durante a execução", async () => {
  const order = {
    status: "run", storeId: "store", courierId: "courier", phone: "(27) 99999-9999"
  };
  const values = {
    "orders/order": order,
    "profiles/stores/store": { accessStatus: "approved" },
    "profiles/couriers/courier": { accessStatus: "approved" },
    "profiles/couriers/courier/phone": "+55 (27) 98888-8888",
    "profiles/stores/store/phone": "(27) 3333-3333"
  };
  const contact = createOrderContact({
    ref(path) { return { async get() { return { val: () => values[path] }; } }; }
  });
  const call = (uid, target) => contact({ auth: { uid }, data: { orderId: "order", target } });
  assert.deepEqual(await call("store", "courier"), { phone: "5527988888888" });
  assert.deepEqual(await call("courier", "store"), { phone: "552733333333" });
  assert.deepEqual(await call("courier", "customer"), { phone: "5527999999999" });
  await assert.rejects(call("otherCourier", "customer"), { code: "permission-denied" });
  await assert.rejects(call("store", "customer"), { code: "permission-denied" });
  values["profiles/couriers/courier"].accessStatus = "blocked";
  await assert.rejects(call("courier", "store"), { code: "permission-denied" });
  delete values["profiles/couriers/courier/phone"];
  assert.deepEqual(await call("store", "courier"), { phone: null });
  order.status = "done";
  await assert.rejects(call("store", "courier"), { code: "permission-denied" });
});

test("oferta mostra a identificação da loja e os bairros sem incluir endereços ou telefones", () => {
  const offer = publicOrder({
    storeName: "Comércio Exemplo", storeNeighborhood: "Centro", clientNeighborhood: "Segatto",
    storeAddress: "Rua A, 10", clientStreet: "Rua B", phone: "27999999999", storeId: "store",
  });
  assert.deepEqual(offer, {
    storeName: "Comércio Exemplo", storeNeighborhood: "Centro", clientNeighborhood: "Segatto",
  });
});

test("estimativa de moto usa o primeiro ponto e respeita a oferta e o intervalo de atualização", async () => {
  const values = {
    "profiles/couriers/courier": { accessStatus: "approved" },
    "config/offerDistribution": { enabled: true },
    "orders/order": {
      status: "open", serviceType: "collection", storeAddress: "Rua da loja, 5",
      clientStreet: "Rua do cliente", clientNumber: "12", clientNeighborhood: "Centro", city: "Aracruz"
    },
    "courierOffers/courier/order": { offerStatus: "pending", offerExpiresAt: 200000 }
  };
  const db = {
    ref(path) {
      return {
        async get() { return { val: () => values[path] }; },
        async transaction(update) {
          const value = update(values[path]);
          if (value !== undefined) values[path] = value;
          return { committed: value !== undefined };
        }
      };
    }
  };
  const calls = [];
  const route = createRouteEstimate(db, () => "test-secret", async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ routes: [{ distanceMeters: 1800, duration: "295s" }] }) };
  }, () => 150000);
  const request = { orderId: "order", latitude: -19.8, longitude: -40.3 };
  assert.deepEqual(await route({ uid: "courier" }, request), { meters: 1800, seconds: 295 });
  assert.deepEqual(calls[0].destination, { address: "Rua do cliente, 12, Centro, Aracruz, Brasil" });
  assert.equal(calls[0].travelMode, "TWO_WHEELER");
  await assert.rejects(route({ uid: "courier" }, request), { code: "resource-exhausted" });
  delete values["courierOffers/courier/order"];
  values["availableOrders/order"] = { status: "open" };
  await assert.rejects(route({ uid: "courier" }, request), { code: "permission-denied" });
  assert.equal(calls.length, 1);
});
