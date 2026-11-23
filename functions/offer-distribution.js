"use strict";

const { createHash } = require("node:crypto");

const DEFAULTS = Object.freeze({ enabled: false, couriersPerRound: 3, responseSeconds: 30, maxRounds: 3 });
const ONLINE_WINDOW_MS = 90000;

function settings(state) {
  const stored = state?.config?.offerDistribution || {};
  const integer = (value, fallback, min, max) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
  return {
    enabled: stored.enabled === true,
    couriersPerRound: integer(stored.couriersPerRound, DEFAULTS.couriersPerRound, 1, 3),
    responseSeconds: integer(stored.responseSeconds, DEFAULTS.responseSeconds, 15, 120),
    maxRounds: integer(stored.maxRounds, DEFAULTS.maxRounds, 1, 3)
  };
}

function put(state, path, value) {
  const parts = path.split("/");
  const leaf = parts.pop();
  let node = state;
  for (const part of parts) node = node[part] ||= {};
  if (value === null) delete node[leaf]; else node[leaf] = value;
}

function online(state, uid, now) {
  return Object.values(state.courierConnections?.[uid] || {}).some(session => {
    const lastSeen = Number(session?.lastSeen || 0);
    return lastSeen > 0 && lastSeen <= now + 60000 && now - lastSeen < ONLINE_WINDOW_MS;
  });
}

function pendingOffer(state, uid, exceptId, now) {
  return Object.entries(state.courierOffers?.[uid] || {}).some(([id, offer]) =>
    id !== exceptId && offer?.offerStatus === "pending" && Number(offer.offerExpiresAt) > now);
}

function clearOrder(state, orderId) {
  for (const uid of Object.keys(state.courierOffers || {})) put(state, `courierOffers/${uid}/${orderId}`, null);
  put(state, `offerRounds/${orderId}`, null);
  for (const [key, job] of Object.entries(state.offerJobs || {})) if (job.orderId === orderId) put(state, `offerJobs/${key}`, null);
}

function candidateIds(state, orderId, order, now, seen, canTakeOrder) {
  const canTake = canTakeOrder || require("./domain").canTakeOrder;
  return Object.keys(state.profiles?.couriers || {})
    .filter(uid => {
      const profile = state.profiles.couriers[uid];
      return profile && (!profile.accessStatus || profile.accessStatus === "approved") &&
        !seen[uid] && online(state, uid, now) &&
        state.courierPresence?.[uid]?.availableForWork === true &&
        !pendingOffer(state, uid, orderId, now) &&
        (!order.assignedCourierId || order.assignedCourierId === uid) &&
        canTake(state, uid, order, orderId);
    })
    .sort((a, b) => {
      const left = createHash("sha256").update(`${orderId}:${order.offerGeneration}:${a}`).digest("hex");
      const right = createHash("sha256").update(`${orderId}:${order.offerGeneration}:${b}`).digest("hex");
      return left.localeCompare(right);
    });
}

function startRound(state, orderId, order, now, round, publicOrder, canTakeOrder) {
  const config = settings(state);
  const queue = state.offerRounds?.[orderId] || { generation: Number(order.offerGeneration || 0), seen: {} };
  if (queue.round) put(state, `offerJobs/${orderId}_${queue.generation}_${queue.round}`, null);
  if (!config.enabled || round > config.maxRounds) {
    queue.completedAt = now;
    queue.pendingCourierIds = [];
    put(state, `offerRounds/${orderId}`, queue);
    return [];
  }
  const candidates = candidateIds(state, orderId, order, now, queue.seen || {}, canTakeOrder).slice(0, config.couriersPerRound);
  const expiresAt = now + config.responseSeconds * 1000;
  Object.assign(queue, {
    generation: Number(order.offerGeneration || 0),
    round,
    startedAt: now,
    expiresAt,
    pendingCourierIds: candidates,
    seen: { ...(queue.seen || {}) }
  });
  const offer = { ...publicOrder(order), offerStatus: "pending", offerRound: round, offerExpiresAt: expiresAt };
  for (const uid of candidates) {
    queue.seen[uid] = true;
    put(state, `courierOffers/${uid}/${orderId}`, { ...offer, offeredAt: now });
  }
  put(state, `offerRounds/${orderId}`, queue);
  const jobId = `${orderId}_${queue.generation}_${round}`;
  put(state, `offerJobs/${jobId}`, { orderId, generation: queue.generation, round, expiresAt });
  return candidates;
}

function syncOrder(state, orderId, order, previous, now, publicOrder, canTakeOrder) {
  const config = settings(state);
  const open = ["open", "route_open"].includes(order.status) && !order.assignedCourierId;
  if (config.enabled && open) {
    const queue = state.offerRounds?.[orderId];
    if (!queue || queue.generation !== Number(order.offerGeneration || 0)) {
      clearOrder(state, orderId);
      startRound(state, orderId, order, now, 1, publicOrder, canTakeOrder);
    }
    return true;
  }

  if (order.status === "return_priority") {
    clearOrder(state, orderId);
    for (const uid of Object.keys(state.courierOffers || {})) {
      if (uid === order.priorityCourierId) continue;
      put(state, `courierOffers/${uid}/${orderId}`, null);
    }
    if (order.priorityCourierId) put(state, `courierOffers/${order.priorityCourierId}/${orderId}`, {
      ...publicOrder(order), isPriorityOffer: true, offerStatus: "pending", offerRound: 0,
      offerExpiresAt: Number(order.priorityUntil || now + 30000)
    });
    return config.enabled;
  }

  clearOrder(state, orderId);
  return false;
}

function hasPendingOffer(state, uid, exceptId, now) {
  return pendingOffer(state, uid, exceptId, now);
}

function isCurrentOffer(state, uid, orderId, order, now) {
  const queue = state.offerRounds?.[orderId];
  const offer = state.courierOffers?.[uid]?.[orderId];
  if (order.status === "return_priority") return offer?.isPriorityOffer === true && offer.offerStatus === "pending" && Number(offer.offerExpiresAt) > now;
  return !!queue && queue.generation === Number(order.offerGeneration || 0) && queue.round === offer?.offerRound &&
    queue.pendingCourierIds?.includes(uid) && offer.offerStatus === "pending" && Number(offer.offerExpiresAt) > now;
}

function advanceRound(state, job, now, publicOrder, canTakeOrder) {
  const order = state.orders?.[job?.orderId];
  const queue = state.offerRounds?.[job?.orderId];
  const config = settings(state);
  if (!config.enabled || !order || !queue || !["open", "route_open"].includes(order.status) ||
      queue.generation !== job.generation || Number(order.offerGeneration || 0) !== job.generation ||
      queue.round !== job.round || queue.expiresAt > now) return { advanced: false, courierIds: [] };
  for (const uid of queue.pendingCourierIds || []) {
    const offer = state.courierOffers?.[uid]?.[job.orderId];
    if (offer?.offerStatus === "pending" && offer.offerRound === job.round) {
      offer.offerStatus = "expired";
      offer.expiredAt = now;
    }
  }
  if (job.round >= config.maxRounds) {
    queue.completedAt = now;
    queue.pendingCourierIds = [];
    put(state, `offerJobs/${job.orderId}_${job.generation}_${job.round}`, null);
    return { advanced: true, courierIds: [] };
  }
  const courierIds = startRound(state, job.orderId, order, now, job.round + 1, publicOrder, canTakeOrder);
  return { advanced: true, courierIds };
}

function respond(state, uid, orderId, input, now, publicOrder, canTakeOrder) {
  const order = state.orders?.[orderId];
  const queue = state.offerRounds?.[orderId];
  const offer = state.courierOffers?.[uid]?.[orderId];
  if (!order || !isCurrentOffer(state, uid, orderId, order, now)) throw new Error("Esta oferta não está pendente ou já expirou.");
  if (input.response !== "decline") throw new Error("Resposta da oferta inválida.");
  const reason = String(input.reason || "").trim();
  if (reason.length > 200) throw new Error("O motivo pode ter até 200 caracteres.");
  offer.offerStatus = "declined";
  offer.respondedAt = now;
  if (reason) offer.declineReason = reason;
  if (order.status === "return_priority") {
    order.status = "open";
    delete order.priorityCourierId;
    delete order.priorityUntil;
    order.priorityReleasedAt = now;
    order.priorityReleaseReason = "declined";
    order.offerGeneration = Number(order.offerGeneration || 0) + 1;
    put(state, `offerRounds/${orderId}`, { generation: order.offerGeneration, round: 0, seen: { [uid]: true }, pendingCourierIds: [] });
    return startRound(state, orderId, order, now, 1, publicOrder, canTakeOrder);
  }
  if (!queue) throw new Error("Esta oferta não está pendente ou já expirou.");
  queue.pendingCourierIds = (queue.pendingCourierIds || []).filter(id => id !== uid);
  const allResponded = queue.pendingCourierIds.every(id => state.courierOffers?.[id]?.[orderId]?.offerStatus !== "pending");
  if (allResponded && queue.round < settings(state).maxRounds) {
    return startRound(state, orderId, order, now, queue.round + 1, publicOrder, canTakeOrder);
  }
  if (allResponded) queue.completedAt = now;
  return [];
}

function normalizeInput(input) {
  const valid = input && typeof input === "object" && typeof input.enabled === "boolean" &&
    Number.isInteger(input.couriersPerRound) && input.couriersPerRound >= 1 && input.couriersPerRound <= 3 &&
    Number.isInteger(input.responseSeconds) && input.responseSeconds >= 15 && input.responseSeconds <= 120 &&
    Number.isInteger(input.maxRounds) && input.maxRounds >= 1 && input.maxRounds <= 3;
  return valid ? { enabled: input.enabled, couriersPerRound: input.couriersPerRound, responseSeconds: input.responseSeconds, maxRounds: input.maxRounds } : null;
}

module.exports = { DEFAULTS, ONLINE_WINDOW_MS, settings, normalizeInput, syncOrder, hasPendingOffer, isCurrentOffer, advanceRound, respond };
