/**
 * Unit tests for the wash-finish checker and its auto dryer transfer.
 *
 * Regression context: the transfer used to be skipped entirely because the
 * washer booking was moved to "finished" *before* the code read the
 * needs_dryer flag off that same booking. The lookup filters on
 * booking_status = "using", so it always came back empty and no dryer was ever
 * reserved. The ordering test below is what pins that down.
 */

const {
  runWashFinishChecker,
  shouldTransferToDryer,
} = require('../../logic/washFinish');

/**
 * Minimal fake of the Supabase query builder.
 *
 * Every call is appended to `calls` so tests can assert both what happened and
 * in which order. Responses are keyed by table so each test can describe just
 * the rows it cares about.
 */
function makeFakeSupabase({ machines = [], bookings = [], freeDryers = [] } = {}) {
  const calls = [];

  function builder(table) {
    const state = { table, op: null, filters: {} };

    const chain = {
      select(cols) {
        state.op = 'select';
        state.cols = cols;
        return chain;
      },
      update(values) {
        state.op = 'update';
        state.values = values;
        calls.push({ table, op: 'update', values });
        return chain;
      },
      insert(rows) {
        calls.push({ table, op: 'insert', rows });
        return Promise.resolve({ data: rows, error: null });
      },
      eq(col, val) {
        state.filters[col] = val;
        return chain;
      },
      is(col, val) {
        state.filters[col] = val;
        return chain;
      },
      not() {
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      single() {
        return resolveSelect(true);
      },
      then(onFulfilled, onRejected) {
        return resolveSelect(false).then(onFulfilled, onRejected);
      },
    };

    function resolveSelect(single) {
      if (state.op === 'select') {
        calls.push({ table, op: 'select', filters: { ...state.filters } });

        if (table === 'Machine_Table') {
          // The dryer lookup asks for available dryers; everything else is the
          // "which machines just finished" query.
          const data =
            state.filters.machine_type === 'dryer' ? freeDryers : machines;
          return Promise.resolve({ data, error: null });
        }

        if (table === 'Booking_Table') {
          const match = bookings.find(
            (b) => b.booking_status === state.filters.booking_status
          );
          return Promise.resolve({
            data: single ? match || null : match ? [match] : [],
            error: null,
          });
        }
      }
      return Promise.resolve({ data: null, error: null });
    }

    return chain;
  }

  return { from: (table) => builder(table), calls };
}

const finishedWasher = {
  machine_id: 'W-01',
  finished_at: new Date(Date.now() - 60_000).toISOString(), // already done
  pickup_end_at: null,
  current_user_id: 'user-1',
};

const silentLogger = { log() {}, error() {} };

describe('shouldTransferToDryer', () => {
  test('transfers a washer whose booking opted in', () => {
    expect(
      shouldTransferToDryer('W-01', { needs_dryer: true, dryer_transferred: false })
    ).toBe(true);
  });

  test('does not transfer when the user did not opt in', () => {
    expect(
      shouldTransferToDryer('W-01', { needs_dryer: false, dryer_transferred: false })
    ).toBe(false);
  });

  test('does not transfer twice', () => {
    expect(
      shouldTransferToDryer('W-01', { needs_dryer: true, dryer_transferred: true })
    ).toBe(false);
  });

  test('dryers never transfer again', () => {
    expect(
      shouldTransferToDryer('D-01', { needs_dryer: true, dryer_transferred: false })
    ).toBe(false);
  });

  test('handles a missing booking', () => {
    expect(shouldTransferToDryer('W-01', null)).toBe(false);
  });
});

describe('runWashFinishChecker - auto dryer transfer', () => {
  test('reserves the lowest-numbered free dryer and notifies the user', async () => {
    const supabase = makeFakeSupabase({
      machines: [finishedWasher],
      bookings: [
        {
          booking_id: 'b-1',
          booking_status: 'using',
          needs_dryer: true,
          dryer_transferred: false,
        },
      ],
      freeDryers: [{ machine_id: 'D-02' }, { machine_id: 'D-05' }],
    });
    const notifications = [];
    const sendNotification = (userId, title, body) =>
      notifications.push({ userId, title, body });

    await runWashFinishChecker({ supabase, sendNotification, logger: silentLogger });

    const dryerReserved = supabase.calls.find(
      (c) => c.op === 'update' && c.values.machine_status === 'occupied'
    );
    expect(dryerReserved).toBeDefined();
    expect(dryerReserved.values.current_user_id).toBe('user-1');

    expect(notifications.map((n) => n.title)).toContain('Dryer Reserved');
    expect(notifications.find((n) => n.title === 'Dryer Reserved').body).toContain('D-02');
  });

  test('reads the dryer preference before the booking is closed', async () => {
    // This is the regression guard. Closing the booking first makes the
    // booking_status = "using" lookup return nothing, silently disabling the
    // whole feature.
    const supabase = makeFakeSupabase({
      machines: [finishedWasher],
      bookings: [
        {
          booking_id: 'b-1',
          booking_status: 'using',
          needs_dryer: true,
          dryer_transferred: false,
        },
      ],
      freeDryers: [{ machine_id: 'D-02' }],
    });

    await runWashFinishChecker({
      supabase,
      sendNotification: () => {},
      logger: silentLogger,
    });

    const bookingRead = supabase.calls.findIndex(
      (c) => c.table === 'Booking_Table' && c.op === 'select'
    );
    const bookingClosed = supabase.calls.findIndex(
      (c) =>
        c.table === 'Booking_Table' &&
        c.op === 'update' &&
        c.values.booking_status === 'finished'
    );

    expect(bookingRead).toBeGreaterThanOrEqual(0);
    expect(bookingClosed).toBeGreaterThanOrEqual(0);
    expect(bookingRead).toBeLessThan(bookingClosed);
  });

  test('queues the user when no dryer is free, tagging the booking with machine_type', async () => {
    const supabase = makeFakeSupabase({
      machines: [finishedWasher],
      bookings: [
        {
          booking_id: 'b-1',
          booking_status: 'using',
          needs_dryer: true,
          dryer_transferred: false,
        },
      ],
      freeDryers: [],
    });
    const notifications = [];

    await runWashFinishChecker({
      supabase,
      sendNotification: (userId, title) => notifications.push(title),
      logger: silentLogger,
    });

    const queued = supabase.calls.find(
      (c) => c.table === 'Booking_Table' && c.op === 'insert'
    );
    expect(queued).toBeDefined();
    expect(queued.rows[0]).toMatchObject({
      user_id: 'user-1',
      machine_type: 'dryer',
      booking_status: 'waiting',
    });
    expect(notifications).toContain('Added to Dryer Queue');
  });

  test('the reserved-dryer booking also carries machine_type', async () => {
    // Without machine_type the row is invisible to queries that filter by it.
    const supabase = makeFakeSupabase({
      machines: [finishedWasher],
      bookings: [
        {
          booking_id: 'b-1',
          booking_status: 'using',
          needs_dryer: true,
          dryer_transferred: false,
        },
      ],
      freeDryers: [{ machine_id: 'D-02' }],
    });

    await runWashFinishChecker({
      supabase,
      sendNotification: () => {},
      logger: silentLogger,
    });

    const inserted = supabase.calls.find(
      (c) => c.table === 'Booking_Table' && c.op === 'insert'
    );
    expect(inserted.rows[0].machine_type).toBe('dryer');
  });

  test('opens the pickup window and notifies even without a dryer transfer', async () => {
    const supabase = makeFakeSupabase({
      machines: [finishedWasher],
      bookings: [
        {
          booking_id: 'b-1',
          booking_status: 'using',
          needs_dryer: false,
          dryer_transferred: false,
        },
      ],
    });
    const notifications = [];

    await runWashFinishChecker({
      supabase,
      sendNotification: (userId, title) => notifications.push(title),
      logger: silentLogger,
    });

    const pickupOpened = supabase.calls.find(
      (c) => c.op === 'update' && c.values.pickup_end_at
    );
    expect(pickupOpened).toBeDefined();
    expect(notifications).toContain('Laundry Done');

    // No dryer should have been touched.
    expect(
      supabase.calls.some((c) => c.table === 'Booking_Table' && c.op === 'insert')
    ).toBe(false);
  });

  test('skips machines whose cycle has not finished yet', async () => {
    const supabase = makeFakeSupabase({
      machines: [
        {
          ...finishedWasher,
          finished_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      ],
      bookings: [],
    });

    await runWashFinishChecker({
      supabase,
      sendNotification: () => {},
      logger: silentLogger,
    });

    expect(supabase.calls.some((c) => c.op === 'update')).toBe(false);
  });
});
