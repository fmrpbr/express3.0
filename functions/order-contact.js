"use strict";
const { DomainError, accessAllowed } = require("./domain");

function createOrderContact(db) {
  return async function orderContact(request) {
    const uid = request.auth?.uid;
    if (!uid) throw new DomainError("unauthenticated", "Entre na sua conta.");
    const { orderId, target } = request.data || {};
    if (typeof orderId !== "string" || !/^[\w-]{1,128}$/.test(orderId) ||
        !["store", "courier", "customer"].includes(target)) {
      throw new DomainError("invalid-argument", "Contato inválido.");
    }
    const order = (await db.ref("orders/" + orderId).get()).val();
    const callerRole = target === "courier" ? "stores" : "couriers";
    const callerId = target === "courier" ? order?.storeId : order?.courierId;
    if (!order || order.status !== "run" || order.kind === "route" || callerId !== uid) {
      throw new DomainError("permission-denied", "Contato disponível apenas aos participantes durante a corrida.");
    }
    const caller = (await db.ref("profiles/" + callerRole + "/" + uid).get()).val();
    if (!accessAllowed(caller)) throw new DomainError("permission-denied", "Acesso indisponível.");
    let phone = order.phone;
    if (target !== "customer") {
      const collection = target === "store" ? "stores" : "couriers";
      const contactId = target === "store" ? order.storeId : order.courierId;
      if (contactId) phone = (await db.ref("profiles/" + collection + "/" + contactId + "/phone").get()).val();
      else phone = null;
    }
    const digits = String(phone || "").replace(/\D/g, "");
    const local = /^[1-9]\d[2-9]\d{7,8}$/;
    const international = local.test(digits) ? "55" + digits : digits;
    return { phone: international.startsWith("55") && local.test(international.slice(2)) ? international : null };
  };
}

module.exports = { createOrderContact };
