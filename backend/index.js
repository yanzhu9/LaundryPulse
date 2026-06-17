require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const admin = require('firebase-admin');

let adminInitialized = false;
try {
  const serviceAccount = require('/etc/secrets/serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  adminInitialized = true;
  console.log('[FCM] Firebase Admin initialized successfully');
} catch (e) {
  console.warn('[FCM] serviceAccountKey.json not found, push notifications disabled');
}

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Selectable cycle durations (minutes) for washers and dryers.
// The user picks one of these when starting a machine.
const WASH_MODES = [30, 45, 60];
const DRY_MODES = [30, 45, 60];
const DEFAULT_MODE_MIN = 45; // fallback when no/invalid mode is provided

// 根据 user_id 查出该用户的 fcm_token，再通过 Firebase Admin SDK 发送推送
// fcm_token 是用户登录时由 Flutter 端获取并上传到 User_Table 的设备标识符
async function sendNotification(userId, title, body) {
  // Firebase 未初始化（本地没有 serviceAccountKey.json）时跳过，不影响主流程
  if (!adminInitialized) return;
  try {
    const { data: user, error } = await supabase
      .from('User_Table')
      .select('fcm_token')
      .eq('user_id', userId)
      .single();

    if (error || !user?.fcm_token) {
      console.log(`[FCM] No token for user ${userId}, skipping`);
      return;
    }

    await admin.messaging().send({
      token: user.fcm_token,
      notification: { title, body }
    });
    console.log(`[FCM] Sent to user ${userId}: "${title}"`);
  } catch (err) {
    // 推送失败（token 过期、设备离线等）不应影响主业务，只记日志
    console.error(`[FCM] Failed for user ${userId}:`, err.message);
  }
}

app.post('/register', async (req, res) => {
  const { email: rawEmail, password } = req.body;
  const email = rawEmail?.toLowerCase().trim();

  try {
    // check whether email is valid
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.json({
        success: false,
        msg: "Invalid email format. Please enter a valid email address."
      });
    }

    if (password.length < 6) {
      return res.json({
        success: false,
        msg: "Password must be at least 6 characters long."
      });
    }

    // check whether password contains both letters and numbers
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    if (!hasLetter || !hasNumber) {
      return res.json({
        success: false,
        msg: "Password must contain both letters and numbers."
      });
    }

    // check whether email is already registered
    const { data: existingUser } = await supabase
      .from('User_Table')
      .select('user_id')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.json({
        success: false,
        msg: "This email is already registered. Please use another email."
      });
    }

    await supabase
      .from('User_Table')
      .insert([{ email, password, credit_score: 15}]);

    return res.json({
      success: true,
      msg: "Registration successful! Please log in."
    });

  } catch (err) {
    return res.json({
      success: false,
      msg: "Registration failed. Please try again later."
    });
  }
});

app.post('/login', async (req, res) => {
  const { email: rawEmail, password } = req.body;
  const email = rawEmail?.toLowerCase().trim();

  try {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.json({
        success: false,
        msg: "Invalid email format. Please enter a valid email address."
      });
    }

    // check whether password is empty 
    if (!password || password.trim() === "") {
      return res.json({
        success: false,
        msg: "Password cannot be empty."
      });
    }

    if (password.length < 6) {
      return res.json({
        success: false,
        msg: "Password must be at least 6 characters long."
      });
    }

    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    if (!hasLetter || !hasNumber) {
      return res.json({
        success: false,
        msg: "Password must contain both letters and numbers."
      });
    }

    const { data: users, error: findError } = await supabase
      .from('User_Table')
      .select('user_id, email, password')
      .eq('email', email)
      .limit(1);

    if (findError || !users || users.length === 0) {
      return res.json({
        success: false,
        msg: "Email not found. Please check your email address."
      });
    }

    const user = users[0];
    // '!==' is used for strict comparison to avoid type coercion issues
    if (user.password !== password) {
      return res.json({
        success: false,
        msg: "Incorrect password. Please try again."
      });
    }

    return res.json({
      success: true,
      msg: "Login successful! Redirecting...",
      user_id: user.user_id
    });

  } catch (err) {
    return res.json({
      success: false,
      msg: "Login failed. Please try again later."
    });
  }
});

app.get('/machines', async (req, res) => {
  const { data, error } = await supabase
    .from('Machine_Table')
    .select('*')
    .order('machine_id', { ascending: true }); // order by machine_id in ascending order

  if (error) {
    console.error('Failed to fetch machine data:', error);
    return res.status(500).json({ success: false, msg: 'Failed to fetch machine data' });
  }
  res.send(data);
});

app.post("/api/queue-book", async (req, res) => {
  try {
    const { user_id, type } = req.body;
    // Mode (30/45/60) isn't chosen until the user starts the machine, so use the
    // middle option (45 min) as the estimate for queue wait-time calculations.
    const WASHER_CYCLE = 45;
    const DRYER_CYCLE = 45;
    const PICKUP_GRACE = 15;
    const cycleBase = type === "washer" ? WASHER_CYCLE : DRYER_CYCLE;
    // Estimated total time for one machine cycle including pickup grace, used for calculating queue wait time when no machines are currently available
    const fullMachineDuration = type === "washer" 
      ? (15 + WASHER_CYCLE + PICKUP_GRACE) 
      : (15 + DRYER_CYCLE + PICKUP_GRACE);

    // 1. Credit score check: if user's credit_score < 15 → reject booking request, no queuing allowed
    const { data: userData, error: userErr } = await supabase
      .from("User_Table")
      .select("credit_score")
      .eq("user_id", user_id)
      .single();

    if (userErr || !userData) {
      return res.json({ success: false, message: "User not found" });
    }

    if (userData.credit_score < 15) {
      return res.json({
        success: false,
        message: "Your credit score is below 15, you cannot join the online queue."
      });
    }

    // 2. Try to find an available machine of the requested type. If found, allocate it immediately and set reserved_end_at = now + 15 min
    const { data: availableMachines } = await supabase
      .from("Machine_Table")
      .select("*")
      .eq("machine_type", type)
      .eq("machine_status", "available")
      .order("machine_id", { ascending: true });

    if (availableMachines.length > 0) {
      const targetMachine = availableMachines[0];
      const reservedEnd = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      await supabase.from("Booking_Table").insert([
        {
          user_id: user_id,
          machine_id: targetMachine.machine_id,
          booking_status: "using"
        }
      ]);

      await supabase
        .from("Machine_Table")
        .update({
          machine_status: "occupied",
          reserved_end_at: reservedEnd,
          finished_at: null,
          pickup_end_at: null,
          current_user_id: user_id
        })
        .eq("machine_id", targetMachine.machine_id);

      return res.json({
        success: true,
        message: `Allocated available machine successfully, your machine ID is ${targetMachine.machine_id}. Please come down within 15 minutes.`,
        machine: targetMachine
      });
    }

    // 3. No available machine, calculate estimated wait time based on currently occupied machines of the same type, return it in response (not stored in DB)
    const now = new Date();
    let machineBaseWaitMin = 0;

    // Only consider occupied machines of the same type, ignore those in grace-period or overdue (since they are technically still occupied but won't block the queue)
    const { data: occupiedMachines } = await supabase
      .from("Machine_Table")
      .select("machine_id, reserved_end_at, finished_at, pickup_end_at")
      .eq("machine_type", type)
      .eq("machine_status", "occupied");

    if (occupiedMachines.length > 0) {
      const waitList = [];
      for (const machine of occupiedMachines) {
        let machineFreeAt;
        const { reserved_end_at, finished_at, pickup_end_at } = machine;

        // Condition 1: Just reserved but cycle hasn't started (reserved_end_at in the future, finished_at and pickup_end_at are null) → free time = reserved_end_at + cycle duration + pickup grace
        if (finished_at === null && pickup_end_at === null) {
          const reserveEnd = new Date(reserved_end_at);
          machineFreeAt = new Date(reserveEnd.getTime() + (cycleBase + PICKUP_GRACE) * 60 * 1000);
        }
        // Condition 2: Cycle has started (finished_at in the future, pickup_end_at is null) → free time = finished_at + pickup grace
        else if (finished_at && pickup_end_at === null) {
          const finishTime = new Date(finished_at);
          machineFreeAt = new Date(finishTime.getTime() + PICKUP_GRACE * 60 * 1000);
        }
        // Condition 3: Cycle finished but still in pickup grace (finished_at is null, pickup_end_at in the future) → free time = pickup_end_at
        else if (pickup_end_at) {
          machineFreeAt = new Date(pickup_end_at);
        } else {
          machineFreeAt = now;
        }

        const baseWait = Math.max(0, (machineFreeAt - now) / 1000 / 60);
        waitList.push(baseWait);
      }
      machineBaseWaitMin = Math.round(Math.min(...waitList));
    }

    // Calculate how many people are currently waiting in the queue for this machine type (booking_status = "waiting", machine_id = null) → each person ahead adds one full cycle duration to the wait time
    const { count: queuePeopleCount } = await supabase
      .from("Booking_Table")
      .select("*", { count: "exact", head: true })
      .eq("machine_type", type)
      .eq("booking_status", "waiting")
      .is("machine_id", null);
    // Total estimated wait time = base wait time from occupied machines + (number of people ahead in queue * full machine cycle duration)
    const queueExtraWait = queuePeopleCount * fullMachineDuration;
    const estimatedWaitMin = Math.round(machineBaseWaitMin + queueExtraWait);

    // 4. Insert a new booking record with machine_id = null and booking_status = "waiting", which means the user is in the global waiting queue for that machine type (washer or dryer)
    await supabase.from("Booking_Table").insert([
      {
        user_id: user_id,
        machine_id: null,
        machine_type: type,
        booking_status: "waiting"
      }
    ]);

    return res.json({
      success: true,
      message: `No available machine, added to global ${type} queue. Estimated wait time: ${estimatedWaitMin} min (${queuePeopleCount} people ahead of you)`,
      estimated_wait_min: estimatedWaitMin,
      queue_ahead_count: queuePeopleCount 
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper function to get machine type by machine ID, used in queue allocation to ensure users are allocated to the correct machine type (washer/dryer)
async function getMachineType(machineId) {
  try {
    const { data, error } = await supabase
      .from("Machine_Table")
      .select("machine_type")
      .eq("machine_id", machineId)
      .single();

    if (error || !data) {
      console.log(`[getMachineType] Machine ${machineId} not found or error`);
      return null;
    }
    return data.machine_type;
  } catch (err) {
    console.error("[getMachineType] Error:", err.message);
    return null;
  }
}

// When a machine is released (either by user pick-up or reservation timeout), this function is called to allocate the next waiting user in the queue to this machine. 
async function allocateWaitingQueueToMachine(machineId) {
  try {
    // First get the machine type (washer/dryer) to ensure we allocate from the correct queue
    const targetType = await getMachineType(machineId);
    if (!targetType) return;

    // Find the earliest waiting user in the queue for this machine type (booking_status = "waiting", ordered by created_at) → get their booking_id and user_id
    const { data: waitingUsers, error: queueErr } = await supabase
      .from("Booking_Table")
      .select("booking_id, user_id")
      .eq("machine_type", targetType)
      .eq("booking_status", "waiting")
      .order("created_at", { ascending: true })
      .limit(1);

    // If no waiting user, simply return and keep the machine available for future bookings
    if (queueErr || waitingUsers.length === 0) {
      console.log(`[Queue Allocate] No waiting users for ${targetType} queue, skip`);
      return;
    }

    const firstWaitUser = waitingUsers[0];
    const reservedEnd = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Update the booking record of this user: set machine_id = the released machine, booking_status = "using"
    await supabase
      .from("Booking_Table")
      .update({
        machine_id: machineId,
        booking_status: "using"
      })
      .eq("booking_id", firstWaitUser.booking_id);

    // Update the machine record: set machine_status = "occupied", reserved_end_at = now + 15 min, current_user_id = this user_id (to track who is currently using the machine for sending notifications later), clear finished_at and pickup_end_at
    await supabase
      .from("Machine_Table")
      .update({
        machine_status: "occupied",
        reserved_end_at: reservedEnd,
        finished_at: null,
        pickup_end_at: null,
        current_user_id: firstWaitUser.user_id
      })
      .eq("machine_id", machineId);

    // Notify the user that it's their turn and which machine they are allocated to, so they can come down within 15 minutes to use it. The notification is sent via FCM using the sendNotification helper function, which looks up the user's fcm_token in the User_Table and sends a push notification through Firebase Admin SDK.
    await sendNotification(
      firstWaitUser.user_id,
      "Your Turn Has Come! 🎉",
      `Machine ${machineId} is available for you. Please arrive within 15 minutes.`
    );

    console.log(`[Queue Allocate] Allocated machine ${machineId} to user ${firstWaitUser.user_id}`);
  } catch (err) {
    console.error("[Queue Allocate] Error:", err.message);
  }
}

// GET /getMachineInfo?mid=:id
// Returns remaining wash seconds and number of people waiting ahead
app.get('/getMachineInfo', async (req, res) => {
  try {
    const mid = req.query.mid;

    const { data: machData } = await supabase
      .from('Machine_Table')
      .select('finished_at, reserved_end_at, pickup_end_at, machine_status, current_user_id')
      .eq('machine_id', mid)
      .single();

    const { count: waitCnt } = await supabase
      .from('Booking_Table')
      .select('booking_id', { count: 'exact', head: true })
      .eq('machine_id', mid)
      .eq('booking_status', 'waiting');

    let remainSec = 0;
    let reservedRemainSec = 0;
    let pickupRemainSec = 0;
    const nowMs = Date.now();

    if (machData?.finished_at) {
      remainSec = Math.round((new Date(machData.finished_at).getTime() - nowMs) / 1000);
      if (remainSec < 0) remainSec = 0;
    }
    if (machData?.reserved_end_at) {
      reservedRemainSec = Math.round((new Date(machData.reserved_end_at).getTime() - nowMs) / 1000);
      if (reservedRemainSec < 0) reservedRemainSec = 0;
    }
    if (machData?.pickup_end_at) {
      pickupRemainSec = Math.round((new Date(machData.pickup_end_at).getTime() - nowMs) / 1000);
      if (pickupRemainSec < 0) pickupRemainSec = 0;
    }

    res.json({
      remain_seconds: remainSec,
      reserved_remain_seconds: reservedRemainSec,
      pickup_remain_seconds: pickupRemainSec,
      ahead_count: waitCnt ?? 0,
      machine_status: machData?.machine_status ?? 'occupied',
      current_user_id: machData?.current_user_id ?? ''
    });

  } catch (err) {
    res.json({ remain_seconds: 0, reserved_remain_seconds: 0, pickup_remain_seconds: 0, ahead_count: 0, machine_status: 'occupied', current_user_id: '' });
  }
});

app.get('/api/user/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const { data, error } = await supabase
      .from('User_Table')
      .select('email, credit_score')
      .eq('user_id', userId)
      .single();

    if (error) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(data);

  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/machines/:id/start
// User presses "Start Washing" → set finished_at = now + wash duration
app.post('/api/machines/:id/start', async (req, res) => {
  try {
    const machine_id = req.params.id;
    // needs_dryer: whether the user wants a dryer auto-reserved after washing finishes
    // mode: selected cycle duration in minutes (30/45/60)
    const { needs_dryer, mode } = req.body;

    const { data: machine, error: getError } = await supabase
      .from('Machine_Table')
      .select('*')
      .eq('machine_id', machine_id)
      .single();

    if (getError || !machine) {
      return res.status(404).json({ success: false, message: 'Machine not found' });
    }

    if (machine.machine_status !== 'occupied') {
      return res.status(400).json({ success: false, message: 'Machine is not in occupied state' });
    }

    // Use the user-selected mode (30/45/60 min); fall back to default if missing/invalid
    const isWasher = machine_id.startsWith('W');
    const validModes = isWasher ? WASH_MODES : DRY_MODES;
    const addMin = validModes.includes(mode) ? mode : DEFAULT_MODE_MIN;
    const finishedAt = new Date(Date.now() + addMin * 60 * 1000).toISOString();

    await supabase
      .from('Machine_Table')
      .update({
        finished_at: finishedAt,
        reserved_end_at: null // clear reservation end time since cycle has started
      })
      .eq('machine_id', machine_id);

    // Record the user's dryer preference on the active booking for this machine,
    // so the post-wash timer can auto-transfer them to a dryer or dryer queue
    await supabase
      .from('Booking_Table')
      .update({ needs_dryer: needs_dryer === true })
      .eq('machine_id', machine_id)
      .eq('booking_status', 'using');

    return res.json({
      success: true,
      message: `Washing started for machine ${machine_id}. Estimated finish in ${addMin} minutes.`,
      machine_id: machine_id,
      finished_at: finishedAt
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/machines/:id/pickup
// User confirms clothes collected → set status back to available
app.post("/api/machines/:id/pickup", async (req, res) => {
  try {
    const machine_id = req.params.id;

    const { data: machine, error: getError } = await supabase
      .from("Machine_Table")
      .select("*")
      .eq("machine_id", machine_id)
      .single();

    if (getError || !machine || machine.machine_status !== "occupied") {
      return res.status(400).json({ success: false, message: "Invalid pick-up state" });
    }

    // 1. Update booking status to "finished"
    await supabase
      .from("Booking_Table")
      .update({ booking_status: "finished" })
      .eq("machine_id", machine_id)
      .eq("booking_status", "using");

    // 2. Set machine status to "available" and clear timestamps
    await supabase
      .from("Machine_Table")
      .update({
        machine_status: "available",
        pickup_end_at: null,
        finished_at: null,
        current_user_id: null
      })
      .eq("machine_id", machine_id);

    await allocateWaitingQueueToMachine(machine_id);

    return res.json({ success: true, message: "Pick-up completed, machine released" });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Periodically check every 5 seconds:
// If a machine is in grace-period and finished_at has passed → mark as overdue
setInterval(async () => {
  const now = new Date();
  const { data: list } = await supabase
    .from("Machine_Table")
    .select("*")
    .eq("machine_status", "grace-period")
    .not("finished_at", "is", null);

  if (!list) return;

  for (let m of list) {
    const graceEnd = new Date(m.finished_at);
    if (now >= graceEnd) {
      await supabase
        .from("Machine_Table")
        .update({ machine_status: "overdue" })
        .eq("machine_id", m.machine_id);

      // Grace period 已到期，机器进入 overdue，催促用户立刻取件
      // select("*") 已包含 current_user_id，可直接使用
      await sendNotification(
        m.current_user_id,
        'Laundry Overdue ⚠️',
        `Your 15-minute window for Machine ${m.machine_id} has expired. Please collect your laundry immediately.`
      );
      console.log(`Machine ${m.machine_id} grace period expired → overdue`);
    }
  }
}, 5000);

// Check every 5 seconds: if a reserved machine is not claimed within 15 min → release it
// if reserved_end_at has passed but cycle hasn't started → mark as available and update booking status to "cancelled"
setInterval(async () => {
  const now = new Date();
  const { data: expiredReservations } = await supabase
    .from('Machine_Table')
    .select('machine_id, reserved_end_at')
    .eq('machine_status', 'occupied')
    .not('reserved_end_at', 'is', null);

  if (!expiredReservations) return;

  for (const machine of expiredReservations) {
    const reservedEnd = new Date(machine.reserved_end_at);
    if (now < reservedEnd) continue;

    await supabase
      .from('Machine_Table')
      .update({
        machine_status: 'available',
        reserved_end_at: null,
        current_user_id: null
      })
      .eq('machine_id', machine.machine_id);

    await supabase
      .from('Booking_Table')
      .update({ booking_status: 'expired' })
      .eq('machine_id', machine.machine_id)
      .eq('booking_status', 'using');

    console.log(`Machine ${machine.machine_id} reservation expired → available`);

    await allocateWaitingQueueToMachine(machine.machine_id);
  }
}, 5000);

// Check every 5 seconds: if a machine's finished_at has passed but pickup_end_at is not set → set pickup_end_at = now + 15 minutes and mark as waiting for pickup
setInterval(async () => {
  const now = new Date();
  // 补充 current_user_id，用于发送"洗完了请取件"通知
  const { data: washingEndList } = await supabase
    .from("Machine_Table")
    .select("machine_id, finished_at, pickup_end_at, current_user_id")
    .eq("machine_status", "occupied")
    .not("finished_at", "is", null)
    .is("pickup_end_at", null);

  if (!washingEndList) return;

  for (const m of washingEndList) {
    const finishTime = new Date(m.finished_at);
    if (now < finishTime) continue;

    const pickupEndDate = new Date(Date.now() + 15 * 60 * 1000);
    const pickupEnd = pickupEndDate.toISOString();
    await supabase
      .from("Machine_Table")
      .update({
        pickup_end_at: pickupEnd,
        finished_at: null // clear finished_at since washing is done, now it's in pickup waiting state
      })
      .eq("machine_id", m.machine_id);

    // 洗涤结束，通知用户在 15 分钟内来取衣服
    await sendNotification(
      m.current_user_id,
      'Laundry Done',
      `Your laundry in Machine ${m.machine_id} is done. Please collect it within 15 minutes.`
    );
    console.log(`Machine ${m.machine_id} wash finished, 15-minute pickup window started`);

    // Optional auto dryer queue transfer:
    // If the user opted in for a dryer when starting this washer cycle, automatically
    // reserve a dryer (or queue them) the moment the wash finishes, so they only make one trip.
    // Only washers trigger this; dryers do not transfer again.
    if (m.machine_id.startsWith('W')) {
      // Find the active booking for this washer to read the dryer preference
      const { data: washBooking } = await supabase
        .from("Booking_Table")
        .select("booking_id, needs_dryer, dryer_transferred")
        .eq("machine_id", m.machine_id)
        .eq("booking_status", "using")
        .limit(1)
        .single();

      if (washBooking?.needs_dryer && !washBooking.dryer_transferred) {
        // Look for an available dryer
        const { data: freeDryers } = await supabase
          .from("Machine_Table")
          .select("machine_id")
          .eq("machine_type", "dryer")
          .eq("machine_status", "available")
          .order("machine_id", { ascending: true });

        if (freeDryers && freeDryers.length > 0) {
          const dryerId = freeDryers[0].machine_id;
          // Reserve the dryer using the same 15-min window as the washer pickup,
          // so the user moves clothes from washer to dryer in a single trip
          await supabase
            .from("Machine_Table")
            .update({
              machine_status: "occupied",
              reserved_end_at: pickupEnd,
              finished_at: null,
              pickup_end_at: null,
              current_user_id: m.current_user_id
            })
            .eq("machine_id", dryerId);

          // Create a booking record for the reserved dryer
          await supabase.from("Booking_Table").insert([
            {
              user_id: m.current_user_id,
              machine_id: dryerId,
              booking_status: "using"
            }
          ]);

          await sendNotification(
            m.current_user_id,
            'Dryer Reserved',
            `Dryer ${dryerId} has been reserved for you. Please move your laundry there within 15 minutes.`
          );
          console.log(`Auto-transfer: dryer ${dryerId} reserved for user ${m.current_user_id}`);
        } else {
          // No dryer free → add the user to the dryer waiting queue.
          // machine_type must be set so allocateWaitingQueueToMachine() picks them up
          // when a dryer is later released.
          await supabase.from("Booking_Table").insert([
            {
              user_id: m.current_user_id,
              machine_type: "dryer",
              booking_status: "waiting",
              needs_dryer: true
            }
          ]);

          await sendNotification(
            m.current_user_id,
            'Added to Dryer Queue',
            'No dryer is available right now. You have been added to the dryer queue and will be notified when one is ready.'
          );
          console.log(`Auto-transfer: user ${m.current_user_id} added to dryer queue`);
        }

        // Mark transfer as done so this timer does not process it again
        await supabase
          .from("Booking_Table")
          .update({ dryer_transferred: true })
          .eq("booking_id", washBooking.booking_id);
      }
    }
  }
}, 5000);

// if pickup_end_at has passed but user hasn't confirmed pickup → mark as overdue and send notification
setInterval(async () => {
  const now = new Date();
  // 补充 current_user_id，用于发送 overdue 通知
  const { data: pickupExpireList } = await supabase
    .from("Machine_Table")
    .select("machine_id, pickup_end_at, current_user_id")
    .eq("machine_status", "occupied")
    .not("pickup_end_at", "is", null);

  if (!pickupExpireList) return;

  for (const m of pickupExpireList) {
    const pickupEnd = new Date(m.pickup_end_at);
    if (now < pickupEnd) continue;

    await supabase
      .from("Machine_Table")
      .update({
        machine_status: "overdue",
        pickup_end_at: null
      })
      .eq("machine_id", m.machine_id);

    // 取件窗口超时，机器进入 overdue，提醒用户立即取件
    await sendNotification(
      m.current_user_id,
      'Pick-up Time Expired ⚠️',
      `You didn't collect from Machine ${m.machine_id} in time. Others may now assist in moving your laundry.`
    );
    console.log(`Machine ${m.machine_id} pickup expired → overdue`);
  }
}, 5000);

app.post('/update-fcm-token', async (req, res) => {
  try {
    const { user_id, fcm_token } = req.body;
    console.log("[FCM] Received request:", { user_id, fcm_token });

    // 1. Parameter validation
    if (!user_id || !fcm_token) {
      return res.status(400).json({
        success: false,
        message: "user_id and fcm_token are required"
      });
    }

    // 2. Update the user's fcm_token using the Supabase SDK
    const { data, error } = await supabase
      .from("User_Table")
      .update({ fcm_token: fcm_token })
      .eq('user_id', user_id)
      .select('*'); // Return the updated user ID for debugging

    // 3. Handle Supabase errors
    if (error) {
      console.error("[FCM] Supabase error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update FCM token",
        error: error.message
      });
    }

    // 4. Check if any user was updated
    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found (invalid UUID)"
      });
    }

    // 5. Return a success response
    return res.json({
      success: true,
      message: "FCM token updated successfully",
      data: data
    });

  } catch (err) {
    // Catch other unexpected errors
    console.error("[FCM] Server error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error, please try again later",
      error: err.message
    });
  }
});

// GET /api/check-active-assistance?machine_id=xxx
app.get("/api/check-active-assistance", async (req, res) => {
  const machine_id = req.query.machine_id;
  if (!machine_id) {
    return res.json({ success: false, has_active_assist: false });
  }

  try {
    const { data, error } = await supabase
      .from("Assistance_Record_Table")
      .select("record_id")
      .eq("machine_id", machine_id)
      .eq("is_assisted_active", true)
      .eq("assistance_status", "unreview");

    if (error) throw error;
    return res.json({
      success: true,
      has_active_assist: data.length > 0
    });

  } catch (err) {
    console.error(err);
    return res.json({ success: false, has_active_assist: false });
  }
});

// POST /api/start-assist-timer
app.post("/api/start-assist-timer", async (req, res) => {
  const { overdue_user_id, helper_user_id, machine_id } = req.body;
  if (!overdue_user_id || !helper_user_id || !machine_id) {
    return res.json({ success: false, message: "Missing parameters" });
  }

  try {
    const checkRes = await supabase
      .from("Assistance_Record_Table")
      .select("record_id")
      .eq("machine_id", machine_id)
      .eq("is_assisted_active", true)
      .eq("assistance_status", "unreview");

    if (checkRes.data.length > 0) {
      return res.json({ success: false, message: "This machine is already being assisted" });
    }

    const { data: assistRecords, error: insertErr } = await supabase
      .from("Assistance_Record_Table")
      .insert({
        overdue_user_id,
        helper_user_id,
        machine_id,
        assistance_status: "unreview",
        is_assisted_active: true
      })
      .select("record_id");

    if (insertErr) return res.json({ success: false, error: insertErr.message });
    const recordId = assistRecords[0].record_id;

    await sendNotification(
      overdue_user_id,
      'Someone is Helping You 🤝',
      `A neighbor is helping collect your laundry from Machine ${machine_id}. Please rate them in the app.`
    );

    setTimeout(async () => {
      try {
        const { data } = await supabase
          .from("Assistance_Record_Table")
          .select("is_assisted_active")
          .eq("record_id", recordId)
          .single();

        if (data?.is_assisted_active) {
          await supabase
            .from("Machine_Table")
            .update({ machine_status: "overdue" })
            .eq("machine_id", machine_id);

          await supabase
            .from("Assistance_Record_Table")
            .update({ is_assisted_active: false })
            .eq("record_id", recordId);
        }
      } catch (e) {
        console.error("Timeout error", e);
      }
    }, 900000);

    return res.json({ success: true, record_id: recordId });

  } catch (err) {
    console.error(err);
    return res.json({ success: false, error: err.message });
  }
});

app.post("/api/submit-collect-choice", async (req, res) => {
  const { record_id, machine_id, choice } = req.body;
  if (!record_id || !machine_id || !choice) {
    return res.json({ success: false, message: "Missing parameters" });
  }

  try {
    // 1. 结束本次assistance_record
    await supabase
      .from("Assistance_Record_Table")
      .update({ is_assisted_active: false })
      .eq("record_id", record_id);

    const newStatus = choice === "yes" ? "occupied" : "available";

    if (choice === "yes") {
      // 从 Assistance_Record_Table 取出 helper_user_id
      // 后续洗涤完成/超时等 FCM 通知需要通过 current_user_id 找到 helper
      const { data: record } = await supabase
        .from("Assistance_Record_Table")
        .select("helper_user_id")
        .eq("record_id", record_id)
        .single();

      const reservedEndAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await supabase
        .from("Machine_Table")
        .update({
          machine_status: newStatus,
          reserved_end_at: reservedEndAt,
          finished_at: null,
          current_user_id: record?.helper_user_id  // 机器使用者更新为 helper，后续 FCM 通知发给他
        })
        .eq("machine_id", machine_id);

    } else {
      // No：恢复可用，清空预约、结束时间
      await supabase
        .from("Machine_Table")
        .update({
          machine_status: newStatus,
          reserved_end_at: null,
          finished_at: null
        })
        .eq("machine_id", machine_id);

      await allocateWaitingQueueToMachine(machine_id);
    }

    return res.json({ success: true, new_status: newStatus });

  } catch (err) {
    console.error("submit-collect-choice error:", err);
    return res.json({ success: false, message: "Database error" });
  }
});

// POST /api/submit-assistance-review
app.post("/api/submit-assistance-review", async (req, res) => {
  const { record_id, overdue_user_id, review_result } = req.body;
  if (!record_id || !overdue_user_id || review_result === undefined) {
    return res.json({ success: false, message: "Missing parameters" });
  }

  // 1. Fetch the assistance record, check if it's valid and get helper_user_id and current assistance_status
  const { data: record, error: fetchErr } = await supabase
    .from("Assistance_Record_Table")
    .select("helper_user_id, assistance_status, overdue_user_id")
    .eq("record_id", record_id)
    .single();

  if (fetchErr || !record) return res.json({ success: false, error: "Record not found" });
  if (record.assistance_status !== "unreview") return res.json({ success: false, error: "Already reviewed" });
  if (record.overdue_user_id !== overdue_user_id) return res.json({ success: false, error: "No permission" });

  const helperId = record.helper_user_id;
  const scoreDelta = review_result ? 5 : -5;

  // 2. Update helper's credit score
  const { data: helperData, error: helperFetchErr } = await supabase
    .from("User_Table")
    .select("credit_score")
    .eq("user_id", helperId)
    .single();

  if (helperFetchErr) return res.json({ success: false, error: helperFetchErr.message });

  const { error: scoreErr } = await supabase
    .from("User_Table")
    .update({ credit_score: helperData.credit_score + scoreDelta })
    .eq("user_id", helperId);

  if (scoreErr) return res.json({ success: false, error: scoreErr.message });

  // 3. Mark as review
  const { error: updateErr } = await supabase
    .from("Assistance_Record_Table")
    .update({ assistance_status: "review" })
    .eq("record_id", record_id);

  if (updateErr) return res.json({ success: false, error: updateErr.message });

  return res.json({
    success: true,
    score_delta: scoreDelta,
    message: review_result ? "+5 points" : "-5 points"
  });
});

// GET /api/get-pending-review-list?overdue_user_id=xxx
app.get("/api/get-pending-review-list", async (req, res) => {
  const { overdue_user_id } = req.query;
  if (!overdue_user_id) return res.json({ success: false, message: "Missing overdue_user_id" });

  const { data, error } = await supabase
    .from("Assistance_Record_Table")
    // 补上 created_at, machine_id
    .select("record_id, helper_user_id, assistance_status, created_at, machine_id")
    .eq("overdue_user_id", overdue_user_id)
    .eq("assistance_status", "unreview");

  if (error) return res.json({ success: false, error: error.message });
  return res.json({ success: true, pending_list: data });
});

// GET /api/get-available-locker
app.get('/get-available-locker', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('Locker_Table')
      .select('locker_id')
      .eq('locker_status', 'available')
      .order('locker_id', { ascending: true })
      .limit(1);

    if (error) throw error;

    if (data && data.length > 0) {
      const lockerId = data[0].locker_id;
      await supabase
        .from('Locker_Table')
        .update({ locker_status: 'occupied' })
        .eq('locker_id', lockerId);

      return res.json({
        success: true,
        locker_id: lockerId
      });

    } else {
      return res.json({
        success: false,
        message: 'No available lockers'
      });
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// test endpoint to verify backend and database connection
app.get('/', (req, res) => {
  res.send('Backend deployed successfully! Connected to Supabase database.');
});

app.get('/test-db', async (req, res) => {
  try {
    const { data, error } = await supabase.from('User_Table').select().limit(1);
    if (error) throw error;
    res.json({
      message: '✅ Backend and database connection successful',
      data: data
    });
  } catch (e) {
    res.json({
      message: '❌ Database connection failed',
      error: e.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
