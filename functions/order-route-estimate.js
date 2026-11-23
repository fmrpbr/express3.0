"use strict";
const { DomainError, accessAllowed, eligibleOrder, offerAllowed } = require("./domain");

function createRouteEstimate(db, loadKey, request = fetch, clock = Date.now) {
  return async function routeEstimate(auth, input) {
    const uid = auth?.uid;
    if (!uid) throw new DomainError("unauthenticated", "Entre na sua conta.");
    const { orderId, latitude, longitude } = input || {};
    if (typeof orderId !== "string" || !/^[\w-]{1,128}$/.test(orderId) ||
        !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      throw new DomainError("invalid-argument", "Pedido ou localização inválidos.");
    }
    const apiKey = loadKey();
    if (!apiKey) throw new DomainError("failed-precondition", "Cálculo de trajetos indisponível neste ambiente.");
    const read = async path => (await db.ref(path).get()).val();
    const [profile, order, offer, available, configuration] = await Promise.all([
      read("profiles/couriers/" + uid), read("orders/" + orderId),
      read("courierOffers/" + uid + "/" + orderId), read("availableOrders/" + orderId),
      read("config/offerDistribution")
    ]);
    const now = clock();
    const privateOffer = offer?.offerStatus === "pending" && Number(offer.offerExpiresAt) > now;
    if (!accessAllowed(profile) || !eligibleOrder(order, now) || order.kind === "route" ||
        !offerAllowed(order, uid, now) || (order.assignedCourierId && order.assignedCourierId !== uid) ||
        (!privateOffer && (!available || configuration?.enabled === true))) {
      throw new DomainError("permission-denied", "A oferta não está disponível para este motoboy.");
    }
    const startsAtClient = order.serviceType === "collection" || order.serviceType === "roundtrip";
    const firstPoint = startsAtClient
      ? [order.clientStreet, order.clientNumber, order.clientNeighborhood].filter(Boolean).join(", ")
      : order.storeAddress;
    if (!firstPoint || !order.city) return null;

    const limit = await db.ref("routeEstimateLimits/" + uid).transaction(previous =>
      Number(previous || 0) > now - 60000 ? undefined : now);
    if (!limit.committed) throw new DomainError("resource-exhausted", "Aguarde um minuto para atualizar o trajeto.");
    const response = await request("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude, longitude } } },
        destination: { address: firstPoint + ", " + order.city + ", Brasil" },
        travelMode: "TWO_WHEELER",
        regionCode: "BR",
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new DomainError("unavailable", "O serviço de trajetos está indisponível.");
    const route = (await response.json()).routes?.[0];
    const seconds = /^\d+(?:\.\d+)?s$/.test(route?.duration || "") ? Number.parseFloat(route.duration) : NaN;
    return Number.isFinite(seconds) && Number.isInteger(route.distanceMeters) && route.distanceMeters >= 0
      ? { meters: route.distanceMeters, seconds } : null;
  };
}

module.exports = { createRouteEstimate };
