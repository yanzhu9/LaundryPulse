/**
 * Unit tests for queue wait-time estimation.
 *
 * Regression context: the estimate used to charge one full turnaround for every
 * person ahead in the queue, which models a single machine serving people one
 * at a time. The laundry room runs 6 washers and 6 dryers in parallel, so with
 * 3 people ahead the old formula reported roughly 4 extra hours of waiting that
 * did not exist.
 */

const {
  computeMachineFreeAt,
  earliestFreeInMinutes,
  estimateWaitMinutes,
  DEFAULT_CYCLE_MIN,
  PICKUP_GRACE_MIN,
  RESERVATION_WINDOW_MIN,
} = require('../../logic/queueEstimate');

const NOW = new Date('2026-07-20T10:00:00Z');
const minutesFromNow = (min) => new Date(NOW.getTime() + min * 60_000).toISOString();

describe('computeMachineFreeAt', () => {
  test('reserved but not started: reservation window, then cycle, then pickup grace', () => {
    const machine = {
      reserved_end_at: minutesFromNow(10),
      finished_at: null,
      pickup_end_at: null,
    };
    const freeAt = computeMachineFreeAt(machine, NOW, 45);
    // 10 min of reservation left + 45 cycle + 15 grace
    expect((freeAt - NOW) / 60_000).toBe(70);
  });

  test('cycle running: finishes, then pickup grace', () => {
    const machine = {
      reserved_end_at: minutesFromNow(-5),
      finished_at: minutesFromNow(20),
      pickup_end_at: null,
    };
    const freeAt = computeMachineFreeAt(machine, NOW, 45);
    expect((freeAt - NOW) / 60_000).toBe(20 + PICKUP_GRACE_MIN);
  });

  test('awaiting pickup: free when the pickup window closes', () => {
    const machine = {
      reserved_end_at: null,
      finished_at: null,
      pickup_end_at: minutesFromNow(8),
    };
    const freeAt = computeMachineFreeAt(machine, NOW, 45);
    expect((freeAt - NOW) / 60_000).toBe(8);
  });

  test('honours the cycle length it is given', () => {
    const machine = {
      reserved_end_at: minutesFromNow(0),
      finished_at: null,
      pickup_end_at: null,
    };
    expect((computeMachineFreeAt(machine, NOW, 30) - NOW) / 60_000).toBe(45);
    expect((computeMachineFreeAt(machine, NOW, 60) - NOW) / 60_000).toBe(75);
  });

  test('falls back to now when a reserved machine has no reservation time', () => {
    const machine = { reserved_end_at: null, finished_at: null, pickup_end_at: null };
    expect(computeMachineFreeAt(machine, NOW, 45).getTime()).toBe(NOW.getTime());
  });
});

describe('earliestFreeInMinutes', () => {
  test('returns 0 when nothing is occupied', () => {
    expect(earliestFreeInMinutes([], NOW)).toBe(0);
    expect(earliestFreeInMinutes(null, NOW)).toBe(0);
  });

  test('picks the soonest machine, not the average or the last', () => {
    const machines = [
      { reserved_end_at: null, finished_at: minutesFromNow(40), pickup_end_at: null }, // 55
      { reserved_end_at: null, finished_at: null, pickup_end_at: minutesFromNow(5) },  // 5
      { reserved_end_at: null, finished_at: minutesFromNow(10), pickup_end_at: null }, // 25
    ];
    expect(earliestFreeInMinutes(machines, NOW, 45)).toBe(5);
  });

  test('never reports negative time for an overrun machine', () => {
    const machines = [
      { reserved_end_at: null, finished_at: null, pickup_end_at: minutesFromNow(-30) },
    ];
    expect(earliestFreeInMinutes(machines, NOW, 45)).toBe(0);
  });
});

describe('estimateWaitMinutes', () => {
  const turnaround = RESERVATION_WINDOW_MIN + DEFAULT_CYCLE_MIN + PICKUP_GRACE_MIN; // 75

  test('no queue means you only wait for the next machine', () => {
    expect(
      estimateWaitMinutes({ earliestFreeMin: 12, queueAhead: 0, machineCount: 6 })
    ).toBe(12);
  });

  test('machines are treated as a parallel pool', () => {
    // 3 people ahead across 6 washers all get served in the first round, so the
    // wait is still just the next machine freeing up. The old formula returned
    // 12 + 3 * 75 = 237.
    expect(
      estimateWaitMinutes({ earliestFreeMin: 12, queueAhead: 3, machineCount: 6 })
    ).toBe(12);
  });

  test('a full batch of people ahead adds one more turnaround', () => {
    expect(
      estimateWaitMinutes({ earliestFreeMin: 10, queueAhead: 6, machineCount: 6 })
    ).toBe(10 + turnaround);

    expect(
      estimateWaitMinutes({ earliestFreeMin: 10, queueAhead: 13, machineCount: 6 })
    ).toBe(10 + 2 * turnaround);
  });

  test('a single machine degrades to one turnaround per person', () => {
    expect(
      estimateWaitMinutes({ earliestFreeMin: 5, queueAhead: 3, machineCount: 1 })
    ).toBe(5 + 3 * turnaround);
  });

  test('scales the turnaround with the cycle length', () => {
    expect(
      estimateWaitMinutes({
        earliestFreeMin: 0,
        queueAhead: 2,
        machineCount: 1,
        cycleMin: 30,
      })
    ).toBe(2 * (RESERVATION_WINDOW_MIN + 30 + PICKUP_GRACE_MIN));
  });

  test('never divides by zero when no machine can serve the queue', () => {
    const result = estimateWaitMinutes({
      earliestFreeMin: 0,
      queueAhead: 4,
      machineCount: 0,
    });
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(4 * turnaround);
  });

  test('is defensive about missing or negative input', () => {
    expect(estimateWaitMinutes()).toBe(0);
    expect(
      estimateWaitMinutes({ earliestFreeMin: 7, queueAhead: -3, machineCount: 6 })
    ).toBe(7);
  });

  test('the estimate never goes backwards as the queue grows', () => {
    let previous = -1;
    for (let ahead = 0; ahead <= 20; ahead++) {
      const value = estimateWaitMinutes({
        earliestFreeMin: 9,
        queueAhead: ahead,
        machineCount: 6,
      });
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});
