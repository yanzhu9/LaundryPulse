/**
 * Wash-finish checker.
 *
 * Runs on an interval. For every occupied machine whose cycle has finished but
 * whose pickup window has not opened yet, it opens the 15-minute pickup window,
 * notifies the owner, closes the booking, and - for washers only - performs the
 * optional auto dryer transfer.
 *
 * Extracted from index.js so the logic can be exercised directly by tests
 * instead of waiting on setInterval.
 *
 * Dependencies are injected so tests can supply fakes.
 */

const PICKUP_WINDOW_MS = 15 * 60 * 1000;

/**
 * Decide whether a finished washer should trigger the auto dryer transfer.
 * Dryers never transfer again, and a booking is only transferred once.
 */
function shouldTransferToDryer(machineId, booking) {
  if (!machineId || !machineId.startsWith('W')) return false;
  if (!booking) return false;
  return booking.needs_dryer === true && booking.dryer_transferred !== true;
}

async function runWashFinishChecker({ supabase, sendNotification, logger = console }) {
  const now = new Date();

  const { data: washingEndList } = await supabase
    .from('Machine_Table')
    .select('machine_id, finished_at, pickup_end_at, current_user_id')
    .eq('machine_status', 'occupied')
    .not('finished_at', 'is', null)
    .is('pickup_end_at', null);

  if (!washingEndList) return;

  for (const m of washingEndList) {
    const finishTime = new Date(m.finished_at);
    if (now < finishTime) continue;

    const pickupEnd = new Date(Date.now() + PICKUP_WINDOW_MS).toISOString();

    await supabase
      .from('Machine_Table')
      .update({
        pickup_end_at: pickupEnd,
        finished_at: null, // washing is done; the machine now waits for pickup
      })
      .eq('machine_id', m.machine_id);

    await sendNotification(
      m.current_user_id,
      'Laundry Done',
      `Your laundry in Machine ${m.machine_id} is done. Please collect it within 15 minutes.`
    );
    logger.log(`Machine ${m.machine_id} wash finished, 15-minute pickup window started`);

    // Optional auto dryer queue transfer.
    //
    // This MUST happen before the booking is moved off "using": the dryer
    // preference lives on that booking row, so closing it first would make the
    // lookup below return nothing and silently skip every transfer.
    if (m.machine_id.startsWith('W')) {
      const { data: washBooking } = await supabase
        .from('Booking_Table')
        .select('booking_id, needs_dryer, dryer_transferred')
        .eq('machine_id', m.machine_id)
        .eq('booking_status', 'using')
        .limit(1)
        .single();

      if (shouldTransferToDryer(m.machine_id, washBooking)) {
        const { data: freeDryers } = await supabase
          .from('Machine_Table')
          .select('machine_id')
          .eq('machine_type', 'dryer')
          .eq('machine_status', 'available')
          .order('machine_id', { ascending: true });

        if (freeDryers && freeDryers.length > 0) {
          const dryerId = freeDryers[0].machine_id;

          // Reserve the dryer for the same window as the washer pickup, so the
          // user moves clothes from washer to dryer in a single trip.
          await supabase
            .from('Machine_Table')
            .update({
              machine_status: 'occupied',
              reserved_end_at: pickupEnd,
              finished_at: null,
              pickup_end_at: null,
              current_user_id: m.current_user_id,
            })
            .eq('machine_id', dryerId);

          await supabase.from('Booking_Table').insert([
            {
              user_id: m.current_user_id,
              machine_id: dryerId,
              machine_type: 'dryer',
              booking_status: 'using',
            },
          ]);

          await sendNotification(
            m.current_user_id,
            'Dryer Reserved',
            `Dryer ${dryerId} has been reserved for you. Please move your laundry there within 15 minutes.`
          );
          logger.log(`Auto-transfer: dryer ${dryerId} reserved for user ${m.current_user_id}`);
        } else {
          // No dryer free -> join the dryer queue. machine_type must be set so
          // allocateWaitingQueueToMachine() picks this booking up later.
          await supabase.from('Booking_Table').insert([
            {
              user_id: m.current_user_id,
              machine_type: 'dryer',
              booking_status: 'waiting',
              needs_dryer: true,
            },
          ]);

          await sendNotification(
            m.current_user_id,
            'Added to Dryer Queue',
            'No dryer is available right now. You have been added to the dryer queue and will be notified when one is ready.'
          );
          logger.log(`Auto-transfer: user ${m.current_user_id} added to dryer queue`);
        }

        await supabase
          .from('Booking_Table')
          .update({ dryer_transferred: true })
          .eq('booking_id', washBooking.booking_id);
      }
    }

    // Close the washer booking last, once the dryer preference has been read.
    await supabase
      .from('Booking_Table')
      .update({ booking_status: 'finished' })
      .eq('machine_id', m.machine_id)
      .eq('booking_status', 'using');
  }
}

module.exports = { runWashFinishChecker, shouldTransferToDryer, PICKUP_WINDOW_MS };
