/**
 * Queue wait-time estimation.
 *
 * Shared by POST /api/queue-book and GET /api/get-queue-overview so both
 * endpoints report the same number. Pure functions - no database access - so
 * the arithmetic can be unit tested directly.
 */

// Users pick 30/45/60 when they start a cycle, so the middle option is used as
// the estimate for machines that are reserved but have not started yet. Once a
// cycle is running we use its real finished_at instead.
const DEFAULT_CYCLE_MIN = 45;
const PICKUP_GRACE_MIN = 15;
const RESERVATION_WINDOW_MIN = 15;

/**
 * When will an occupied machine next be free?
 *
 * Three states, in the order they occur:
 *   1. reserved but not started - the user still has their reservation window,
 *      then a full cycle, then the pickup grace period
 *   2. cycle running            - finishes at finished_at, plus pickup grace
 *   3. cycle done, awaiting pickup - free when the pickup window closes
 */
function computeMachineFreeAt(machine, now, cycleMin = DEFAULT_CYCLE_MIN) {
  const { reserved_end_at, finished_at, pickup_end_at } = machine;
  const graceMs = PICKUP_GRACE_MIN * 60 * 1000;

  if (finished_at === null && pickup_end_at === null) {
    if (!reserved_end_at) return new Date(now);
    return new Date(
      new Date(reserved_end_at).getTime() + cycleMin * 60 * 1000 + graceMs
    );
  }
  if (finished_at && pickup_end_at === null) {
    return new Date(new Date(finished_at).getTime() + graceMs);
  }
  if (pickup_end_at) {
    return new Date(pickup_end_at);
  }
  return new Date(now);
}

/**
 * Minutes until the first of the given machines frees up. 0 if none are busy.
 */
function earliestFreeInMinutes(occupiedMachines, now, cycleMin = DEFAULT_CYCLE_MIN) {
  if (!occupiedMachines || occupiedMachines.length === 0) return 0;

  const waits = occupiedMachines.map((m) => {
    const freeAt = computeMachineFreeAt(m, now, cycleMin);
    return Math.max(0, (freeAt.getTime() - now.getTime()) / 60000);
  });

  return Math.round(Math.min(...waits));
}

/**
 * Estimated minutes until a user joining the queue gets a machine.
 *
 * The previous formula charged one full cycle for every person ahead:
 *
 *     wait = earliestFree + queueAhead * (reservation + cycle + grace)
 *
 * That models a single machine serving the queue one person at a time. With
 * several machines of the same type running in parallel the queue drains far
 * faster: the people ahead are spread across all of them. With 6 washers and
 * 3 people ahead the old formula added 225 minutes to a wait that is really
 * about as long as the next machine takes to free up.
 *
 * Machines are treated as a pool instead. `queueAhead` people are served
 * `machineCount` at a time, so only every full batch of `machineCount` adds
 * another turnaround:
 *
 *     rounds = floor(queueAhead / machineCount)
 *     wait   = earliestFree + rounds * turnaround
 *
 * `machineCount` counts machines that can actually serve the queue, so
 * out-of-service and overdue machines are excluded by the caller.
 */
function estimateWaitMinutes({
  earliestFreeMin = 0,
  queueAhead = 0,
  machineCount = 1,
  cycleMin = DEFAULT_CYCLE_MIN,
} = {}) {
  const usableMachines = Math.max(1, machineCount);
  const turnaround = RESERVATION_WINDOW_MIN + cycleMin + PICKUP_GRACE_MIN;
  const rounds = Math.floor(Math.max(0, queueAhead) / usableMachines);
  return Math.round(earliestFreeMin + rounds * turnaround);
}

module.exports = {
  computeMachineFreeAt,
  earliestFreeInMinutes,
  estimateWaitMinutes,
  DEFAULT_CYCLE_MIN,
  PICKUP_GRACE_MIN,
  RESERVATION_WINDOW_MIN,
};
