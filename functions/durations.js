'use strict';

function completionDurations(order, completedAt) {
  const created = Number(order.created);
  const accepted = Number(order.accepted);
  const hasCreated = Number.isFinite(created) && typeof order.created === 'number';
  const hasAccepted = Number.isFinite(accepted) && typeof order.accepted === 'number';
  const executionMs = hasAccepted ? Math.max(0, completedAt - accepted) : 0;
  return {
    ...(hasCreated && hasAccepted ? { queueDurationMs: Math.max(0, accepted - created) } : {}),
    durationMs: executionMs,
    totalDurationMs: hasCreated ? Math.max(0, completedAt - created) : executionMs
  };
}

module.exports = { completionDurations };
