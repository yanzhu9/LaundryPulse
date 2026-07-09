require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const admin = require('firebase-admin');

let adminInitialized = false;
try {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!rawJson) throw new Error("FIREBASE_SERVICE_ACCOUNT env variable empty");
  const serviceAccount = JSON.parse(rawJson);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  adminInitialized = true;
  console.log('[FCM] Firebase Admin initialized successfully');
} catch (e) {
  console.warn('[FCM] serviceAccount load failed, push notifications disabled. Reason:', e.message);
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
      .insert([{ email, password, credit_score: 15, role: "user"}]);

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
      .select('user_id, email, password, role')
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
      user_id: user.user_id,
      role: user.role
    });

  } catch (err) {
    return res.json({
      success: false,
      msg: "Login failed. Please try again later."
    });
  }
});

// Reset a user's password directly by email.
// Note: this does not verify identity (no email code) — acceptable for the
// current project scope; see the reset-password plan for the secure upgrade.
app.post('/reset-password', async (req, res) => {
  const { email: rawEmail, newPassword } = req.body;
  const email = rawEmail?.toLowerCase().trim();

  try {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!email || !emailRegex.test(email)) {
      return res.json({
        success: false,
        msg: "Invalid email format. Please enter a valid email address."
      });
    }

    // Same password rules as register/login.
    if (!newPassword || newPassword.length < 6) {
      return res.json({
        success: false,
        msg: "Password must be at least 6 characters long."
      });
    }
    const hasLetter = /[a-zA-Z]/.test(newPassword);
    const hasNumber = /\d/.test(newPassword);
    if (!hasLetter || !hasNumber) {
      return res.json({
        success: false,
        msg: "Password must contain both letters and numbers."
      });
    }

    // Only reset if the email actually exists.
    const { data: users, error: findError } = await supabase
      .from('User_Table')
      .select('user_id')
      .eq('email', email)
      .limit(1);

    if (findError || !users || users.length === 0) {
      return res.json({
        success: false,
        msg: "Email not found. Please check your email address."
      });
    }

    const { error: updateError } = await supabase
      .from('User_Table')
      .update({ password: newPassword })
      .eq('email', email);

    if (updateError) throw updateError;

    return res.json({
      success: true,
      msg: "Password reset successful! Please log in with your new password."
    });

  } catch (err) {
    return res.json({
      success: false,
      msg: "Password reset failed. Please try again later."
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

app.get('/api/admin/lockers', async (req, res) => {
  const { data, error } = await supabase
    .from('Locker_Table')
    .select('locker_id, locker_status')
    .order('locker_id', { ascending: true });

  if (error) {
    console.error('Failed to fetch locker data:', error);
    return res.status(500).json({ success: false, msg: 'Failed to fetch locker data' });
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

    // Check if all machines of this type are overdue. If so, reject the booking request and inform the user that they can only use machines by helping others collect clothes.
    const { data: allTypeMachines } = await supabase
      .from("Machine_Table")
      .select("machine_status")
      .eq("machine_type", type);

    // If all machines of this type are overdue, the user cannot join the queue and must help others collect clothes instead.
    const allMachineOverdue = allTypeMachines.every(m => m.machine_status === "overdue");

    if (allMachineOverdue) {
      return res.json({
        success: false,
        message: "All machines of this type are overdue. You can only use machines by helping others collect clothes."
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

app.get("/api/get-queue-overview", async (req, res) => {
  try {
    const { user_id, type } = req.query;
    const WASHER_CYCLE = 45;
    const DRYER_CYCLE = 45;
    const PICKUP_GRACE = 15;
    const cycleBase = type === "washer" ? WASHER_CYCLE : DRYER_CYCLE;
    const now = new Date();

    // 1. Query all waiting queue records for this machine type (booking_status = "waiting", machine_id = null) → get the number of people in the queue
    const { data: waitingList } = await supabase
      .from("Booking_Table")
      .select("user_id, created_at")
      .eq("machine_type", type)
      .eq("booking_status", "waiting")
      .is("machine_id", null)
      .order("created_at", { ascending: true });

    let peopleInQueue = waitingList.length;

    // 2. Query all occupied machines of this type (machine_status = "occupied") → calculate the earliest time any machine will be free, then calculate the base wait time in minutes
    let machineBaseWaitMin = 0;
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

        if (finished_at === null && pickup_end_at === null) {
          const reserveEnd = new Date(reserved_end_at);
          machineFreeAt = new Date(reserveEnd.getTime() + (cycleBase + PICKUP_GRACE) * 60 * 1000);
        } else if (finished_at && pickup_end_at === null) {
          const finishTime = new Date(finished_at);
          machineFreeAt = new Date(finishTime.getTime() + PICKUP_GRACE * 60 * 1000);
        } else if (pickup_end_at) {
          machineFreeAt = new Date(pickup_end_at);
        } else {
          machineFreeAt = now;
        }
        const baseWait = Math.max(0, (machineFreeAt - now) / 1000 / 60);
        waitList.push(baseWait);
      }
      machineBaseWaitMin = Math.round(Math.min(...waitList));
    }

    // 3. Check if the user is already in the queue and how many people are ahead of them
    let isUserInQueue = false;
    let peopleAhead = 0;
    for (let i = 0; i < waitingList.length; i++) {
      if (waitingList[i].user_id === user_id) {
        isUserInQueue = true;
        peopleAhead = i;
        break;
      }
    }

    // 4. If there are any available machines of this type, reset the queue count and base wait time to 0 since the user can be allocated immediately
    const { data: availableMachines } = await supabase
      .from("Machine_Table")
      .select("*")
      .eq("machine_type", type)
      .eq("machine_status", "available");

    if (availableMachines.length > 0) {
      return res.json({
      peopleInQueue: 0,
      earliestReadyMin: 0,
      isUserInQueue: false,
      peopleAhead: 0,
      isInWasher: false,
      isInDryer: false
    });
    }

    // 5. Query all waiting queue records for this user
    const { data: userWaitingRecords } = await supabase
      .from("Booking_Table")
      .select("machine_type")
      .eq("user_id", user_id)
      .eq("booking_status", "waiting")
      .is("machine_id", null);

    let isInWasher = false;
    let isInDryer = false;
    userWaitingRecords.forEach(item => {
      if (item.machine_type === "washer") isInWasher = true;
      if (item.machine_type === "dryer") isInDryer = true;
    });

    res.json({
      peopleInQueue: peopleInQueue,
      earliestReadyMin: machineBaseWaitMin,
      isUserInQueue: isUserInQueue,
      peopleAhead: peopleAhead,
      isInWasher: isInWasher,
      isInDryer: isInDryer
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

    // Log this usage for analytics (one row per start = one usage session).
    // weekday: 0=Mon ... 6=Sun ; hour: 0-23 (local)
    const now = new Date();
    await supabase.from("Usage_Log_Table").insert([
      {
        user_id: machine.current_user_id,
        machine_id: machine_id,
        machine_type: isWasher ? "washer" : "dryer",
        mode_min: addMin,
        weekday: (now.getDay() + 6) % 7, // JS: 0=Sun → convert to 0=Mon
        hour: now.getHours()
      }
    ]);

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
    .select("machine_id, pickup_end_at, current_user_id, machine_type")
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

     // Query all waiting users in the queue for this machine type (booking_status = "waiting", machine_id = null) → send them a notification that this machine is overdue and they may help collect clothes to unlock it
    const { data: waitingUserList } = await supabase
      .from("Booking_Table")
      .select("user_id")
      .eq("machine_type", m.machine_type)
      .eq("booking_status", "waiting")
      .is("machine_id", null);

    if (waitingUserList.length === 0) continue;

    // Send notification to all waiting users that this machine is overdue and they may help collect clothes to unlock it
    const notifyTitle = "Waiting Time Updated";
    const notifyBody = `Machine ${m.machine_id} is overdue. You may help collect clothes to unlock this machine.`;

    for (const item of waitingUserList) {
      await sendNotification(item.user_id, notifyTitle, notifyBody);
    }
    console.log(`Sent overdue alert to ${waitingUserList.length} queued users for ${m.machine_type}`);

    // Check if all machines of this type are overdue → if so, notify all waiting users that the queue is expired and they need to re-queue
    const { data: allTypeMachines } = await supabase
      .from("Machine_Table")
      .select("machine_status")
      .eq("machine_type", m.machine_type);

    const allMachineOverdue = allTypeMachines.every(item => item.machine_status === "overdue");

    if (allMachineOverdue) {
      // 1、 Query all waiting users in the queue for this machine type (booking_status = "waiting", machine_id = null) → send them a notification that the queue is expired and they need to re-queue
      const { data: waitingUserList } = await supabase
        .from("Booking_Table")
        .select("user_id")
        .eq("machine_type", m.machine_type)
        .eq("booking_status", "waiting")
        .is("machine_id", null);

      // 2、 Send notification to all waiting users that the queue is expired and they need to re-queue
      const notifyTitle = "Queue Cancelled";
      const notifyBody = "All machines are overdue. Your queue position has expired. Help collect clothes and you can continue to use the machine.";

      for (const userItem of waitingUserList) {
        try {
          await sendNotification(userItem.user_id, notifyTitle, notifyBody);
        } catch (pushErr) {
          console.log(`Queue user ${userItem.user_id} push skipped`);
        }
      }

      // 3、 Update all waiting queue records for this machine type (booking_status = "waiting", machine_id = null) → set booking_status = "expired" to clear the queue
      await supabase
        .from("Booking_Table")
        .update({ booking_status: "expired" })
        .eq("machine_type", m.machine_type)
        .eq("booking_status", "waiting")
        .is("machine_id", null);

      console.log(`All ${m.machine_type} machines overdue, queue expired for all waiting users`);
    }
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

// 1. cache for heatmap stats, to avoid recalculating every request
let heatmapCache = {
  data: null,
  refreshDeadline: null,
  statEndSundayStr: ""
};

/**
 * Get the last Sunday 23:59:59.999 as the cutoff time for weekly stats
 */
function getLastSundayDeadline() {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 (Sunday) to 6 (Saturday)
    const diffDays = dayOfWeek === 0 ? 7 : dayOfWeek;
    const lastSunday = new Date(now);
    lastSunday.setDate(now.getDate() - diffDays);
    lastSunday.setHours(23, 59, 59, 999);
    return {
      cutoffTimeObj: lastSunday,
      cutoffDateStr: lastSunday.toISOString().split("T")[0]
    };
  } catch (err) {
    // If any error occurs, fallback to a fixed date (e.g., 2026-06-14)
    return {
      cutoffTimeObj: new Date("2026-06-14T23:59:59.999Z"),
      cutoffDateStr: "2026-06-14"
    };
  }
}

/**
 * Get the next Monday at 00:00:00.000 as the refresh deadline for heatmap stats
 */
function getNextMondayMidnight() {
  try {
    const now = new Date();
    const day = now.getDay();
    const addDays = day === 0 ? 1 : 8 - day;
    const nextMon = new Date(now);
    nextMon.setDate(now.getDate() + addDays);
    nextMon.setHours(0, 0, 0, 0);
    return nextMon;
  } catch (err) {
    // If any error occurs, fallback to 7 days from now
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 7);
    return fallback;
  }
}

/**
 * Get the next Monday at 00:00:00.000 as the refresh deadline for heatmap stats
 */
function getNextMondayMidnight() {
  try {
    const now = new Date();
    const day = now.getDay();
    const addDays = day === 0 ? 1 : 8 - day;
    const nextMon = new Date(now);
    nextMon.setDate(now.getDate() + addDays);
    nextMon.setHours(0, 0, 0, 0);
    return nextMon;
  } catch (err) {
    // If any error occurs, fallback to 7 days from now
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 7);
    return fallback;
  }
}

/**
 * Get the weekday name from a Date object, e.g., "Monday", "Tuesday", etc.
 */
function getWeekdayName(dateObj) {
  const weekList = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return weekList[dateObj.getDay()];
}

/**
 * Get a two-hour time slot string from an even start hour
 * Only accept 0,2,4...22 to avoid overlapping
 */
function getTwoHourSlot(startHour) {
  const start = startHour.toString().padStart(2, "0");
  const endHour = startHour + 2;
  const end = endHour === 24 ? "00" : endHour.toString().padStart(2, "0");
  return `${start}:00-${end}:00`;
}

// Fixed 12 non-overlapping 2-hour slots covering full 24h
const fullTwoHourSlots = [
  "00:00-02:00",
  "02:00-04:00",
  "04:00-06:00",
  "06:00-08:00",
  "08:00-10:00",
  "10:00-12:00",
  "12:00-14:00",
  "14:00-16:00",
  "16:00-18:00",
  "18:00-20:00",
  "20:00-22:00",
  "22:00-00:00"
];

/**
 * Compute the hostel-wide usage heatmap from Booking_Table.
 * Returns { updateCutoffDate, dailyStats, twoHourSlotStats } where
 * twoHourSlotStats always contains the full 12 slots (missing ones => avgLoad 0).
 * Shared by /api/usage-heatmap-stats and /api/off-peak-recommendation.
 */
async function computeHeatmapStats() {
  const sundayInfo = getLastSundayDeadline();
  const cutoffTime = sundayInfo.cutoffTimeObj;
  const cutoffDateStr = sundayInfo.cutoffDateStr;

  // Query the database for all booking records up to the cutoff time
  const { data: allHistoryRecords, error: dbErr } = await supabase
    .from("Booking_Table")
    .select("created_at")
    .lte("created_at", cutoffTime.toISOString());

  if (dbErr) throw new Error("DB error: " + dbErr.message);

  // Process the records to calculate daily and two-hour slot statistics
  let dailyStatsResult = [];
  let slotStatsResult = [];
  try {
    const allTimeList = allHistoryRecords.map(item => new Date(item.created_at));
    const uniqueDaySet = new Set();

    const weekdayCountMap = {};
    const slotCountMap = {};

    allTimeList.forEach(singleTime => {
      // Count weekday
      const wd = getWeekdayName(singleTime);
      weekdayCountMap[wd] = (weekdayCountMap[wd] || 0) + 1;

      // Align hour to EVEN start (0,2,4...22), eliminate overlapping slots
      const rawHour = singleTime.getHours();
      const slotStartHour = Math.floor(rawHour / 2) * 2;
      const slotText = getTwoHourSlot(slotStartHour);
      slotCountMap[slotText] = (slotCountMap[slotText] || 0) + 1;

      // Count unique days
      const dayKey = singleTime.toISOString().split("T")[0];
      uniqueDaySet.add(dayKey);
    });

    const totalStatDays = uniqueDaySet.size || 1;
    const minCreateDate = allTimeList.length ? new Date(Math.min(...allTimeList)) : new Date();
    const maxCreateDate = allTimeList.length ? new Date(Math.max(...allTimeList)) : new Date();
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const totalCoverWeeks = Math.max(1, (maxCreateDate - minCreateDate) / msPerWeek);

    // Daily average calculation
    dailyStatsResult = Object.entries(weekdayCountMap).map(([weekDay, totalCount]) => ({
      weekDay,
      avgLoad: Number((totalCount / totalCoverWeeks).toFixed(2))
    }));

    // Force fill all 12 slots, missing ones set count = 0
    slotStatsResult = fullTwoHourSlots.map(timeRange => {
      const totalCount = slotCountMap[timeRange] ?? 0;
      return {
        timeRange,
        avgLoad: Number((totalCount / totalStatDays).toFixed(2))
      };
    });
  } catch (calcErr) {
    console.warn("Failed to calculate statistics", calcErr);
    dailyStatsResult = [];
    // Still return full 12 slots even when calculation fails
    slotStatsResult = fullTwoHourSlots.map(timeRange => ({
      timeRange,
      avgLoad: 0
    }));
  }

  let machineUtilStatsResult = [
    { machineType: "washer", utilRate: 0 },
    { machineType: "dryer", utilRate: 0 }
  ];
  try {
    // Query Usage_Log_Table for all records up to the cutoff time
    const { data: usageLogRecords, error: usageLogErr } = await supabase
      .from("Usage_Log_Table")
      .select("machine_type, mode_min")
      .lte("created_at", cutoffTime.toISOString());

    if (usageLogErr) throw new Error("Usage_Log_Table query fail: " + usageLogErr.message);

    let totalWasherMins = 0;
    let totalDryerMins = 0;
    // Sum the total minutes for each machine type
    usageLogRecords.forEach(logItem => {
      const singleMin = Number(logItem.mod_min ?? 0);
      if (logItem.machine_type === "washer") {
        totalWasherMins += singleMin;
      } else if (logItem.machine_type === "dryer") {
        totalDryerMins += singleMin;
      }
    });

    // Calculate utilization percentages
    const totalAllMins = totalWasherMins + totalDryerMins;
    let washerPercent = 0;
    let dryerPercent = 0;
    if (totalAllMins > 0) {
      washerPercent = Number(((totalWasherMins / totalAllMins) * 100).toFixed(1));
      dryerPercent = Number(((totalDryerMins / totalAllMins) * 100).toFixed(1));
    }
    machineUtilStatsResult = [
      { machineType: "washer", utilRate: washerPercent },
      { machineType: "dryer", utilRate: dryerPercent }
    ];
  } catch (usageErr) {
    console.error("Machine usage minute calculate error: ", usageErr);
    machineUtilStatsResult = [
      { machineType: "washer", utilRate: 0 },
      { machineType: "dryer", utilRate: 0 }
    ];
  }
  
  return {
    updateCutoffDate: cutoffDateStr,
    dailyStats: dailyStatsResult,
    twoHourSlotStats: slotStatsResult,
    machineUtilStats: machineUtilStatsResult
  };
}

/**
 * Return heatmap stats, honouring the weekly cache (refreshed every Monday 00:00).
 * Recomputes and repopulates the cache when it is empty or expired.
 */
async function getCachedHeatmapStats() {
  const currentTime = new Date();
  if (heatmapCache.data && heatmapCache.refreshDeadline && currentTime < new Date(heatmapCache.refreshDeadline)) {
    return heatmapCache.data;
  }
  const finalResponse = await computeHeatmapStats();
  heatmapCache = {
    data: finalResponse,
    refreshDeadline: getNextMondayMidnight(),
    statEndSundayStr: finalResponse.updateCutoffDate
  };
  return finalResponse;
}

app.get("/api/usage-heatmap-stats", async (req, res) => {
  try {
    const finalResponse = await getCachedHeatmapStats();
    return res.status(200).json(finalResponse);
  } catch (serverErr) {
    console.error("Failed to process request:", serverErr);
    const fallbackDate = getLastSundayDeadline().cutoffDateStr;
    // Return full 12 slots on server error
    return res.status(200).json({
      updateCutoffDate: fallbackDate,
      dailyStats: [],
      twoHourSlotStats: fullTwoHourSlots.map(timeRange => ({
        timeRange,
        avgLoad: 0
      })),
      machineUtilStats: [
        { machineType: "washer", utilRate: 0 },
        { machineType: "dryer", utilRate: 0 }
      ]
    });
  }
});

// GET /api/analytics/personal?user_id=xxx
// Aggregates a user's usage history into habits & frequency stats.
app.get('/api/analytics/personal', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.json({ success: false, message: "Missing user_id" });

    // Fetch all usage logs in chronological order (oldest first)
    const { data: logs, error } = await supabase
      .from("Usage_Log_Table")
      .select("machine_type, mode_min, weekday, hour, used_at")
      .eq("user_id", user_id)
      .order("used_at", { ascending: true });

    if (error) return res.json({ success: false, error: error.message });

    if (!logs || logs.length === 0) {
      return res.json({ success: true, has_data: false });
    }

    // "Preferred" = most frequent value; ties broken by most recent use.
    // We pass logs in chronological order, so a later occurrence wins ties.
    const pickPreferred = (keyFn) => {
      const count = {}, lastIdx = {};
      logs.forEach((l, i) => {
        const k = keyFn(l);
        if (k === null || k === undefined) return;
        count[k] = (count[k] || 0) + 1;
        lastIdx[k] = i;
      });
      let best = null;
      for (const k of Object.keys(count)) {
        if (best === null ||
            count[k] > count[best] ||
            (count[k] === count[best] && lastIdx[k] > lastIdx[best])) {
          best = k;
        }
      }
      return best;
    };

    const washerLogs = logs.filter(l => l.machine_type === "washer");
    const dryerLogs  = logs.filter(l => l.machine_type === "dryer");

    // Distributions
    const modeDist = {};
    const hourDist = Array(24).fill(0);
    const weekdayDist = Array(7).fill(0);
    for (const l of logs) {
      modeDist[l.mode_min] = (modeDist[l.mode_min] || 0) + 1;
      if (l.hour != null) hourDist[l.hour]++;
      if (l.weekday != null) weekdayDist[l.weekday]++;
    }

    // Frequency: total ÷ span in months / years (min 1 to avoid divide-by-zero)
    const firstDate = new Date(logs[0].used_at);
    const nowDate = new Date();
    const monthsSpan = Math.max(1,
      (nowDate.getFullYear() - firstDate.getFullYear()) * 12 +
      (nowDate.getMonth() - firstDate.getMonth()) + 1);
    const yearsSpan = Math.max(1, nowDate.getFullYear() - firstDate.getFullYear() + 1);

    const round1 = (n) => Math.round(n * 10) / 10;
    const weekdayNames = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

    return res.json({
      success: true,
      has_data: true,
      total_count: logs.length,
      washer_count: washerLogs.length,
      dryer_count: dryerLogs.length,
      mode_distribution: modeDist,
      hour_distribution: hourDist,
      weekday_distribution: weekdayDist,
      preferred_mode: Number(pickPreferred(l => l.mode_min)),
      preferred_hour: Number(pickPreferred(l => l.hour)),
      preferred_weekday: weekdayNames[Number(pickPreferred(l => l.weekday))],
      washer_per_month: round1(washerLogs.length / monthsSpan),
      dryer_per_month: round1(dryerLogs.length / monthsSpan),
      washer_per_year: round1(washerLogs.length / yearsSpan),
      dryer_per_year: round1(dryerLogs.length / yearsSpan)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/user-preference?user_id=xxx&type=washer
// Returns the user's most-used mode for a given machine type,
// used by the "use your preferred mode?" prompt before starting.
app.get('/api/user-preference', async (req, res) => {
  try {
    const { user_id, type } = req.query;
    if (!user_id || !type) {
      return res.json({ success: false, has_preference: false });
    }

    const { data: logs, error } = await supabase
      .from("Usage_Log_Table")
      .select("mode_min, used_at")
      .eq("user_id", user_id)
      .eq("machine_type", type)
      .order("used_at", { ascending: true });

    if (error || !logs || logs.length === 0) {
      return res.json({ success: true, has_preference: false });
    }

    // Most frequent mode; ties broken by most recent use
    const count = {}, lastIdx = {};
    logs.forEach((l, i) => {
      count[l.mode_min] = (count[l.mode_min] || 0) + 1;
      lastIdx[l.mode_min] = i;
    });
    let best = null;
    for (const k of Object.keys(count)) {
      if (best === null ||
          count[k] > count[best] ||
          (count[k] === count[best] && lastIdx[k] > lastIdx[best])) {
        best = k;
      }
    }

    return res.json({
      success: true,
      has_preference: true,
      preferred_mode: Number(best)
    });
  } catch (err) {
    res.status(500).json({ success: false, has_preference: false, error: err.message });
  }
});

// GET /api/off-peak-recommendation?user_id=xxx
// Recommends low-occupancy 2-hour slots for doing laundry.
// Blends the hostel-wide heatmap (global load) with the user's own past
// laundry hours (personal schedule) so the picks are both quiet and realistic.
const OFFPEAK_LOAD_WEIGHT = 0.7;  // how much "how empty the slot is" matters
const OFFPEAK_PREF_WEIGHT = 0.3;  // how much "matches the user's usual hours" matters
const OFFPEAK_TOP_N = 3;

app.get('/api/off-peak-recommendation', async (req, res) => {
  try {
    const { user_id } = req.query;

    // 1. Global load per 2-hour slot (reuses the weekly-cached heatmap).
    const heatmap = await getCachedHeatmapStats();
    const slots = heatmap.twoHourSlotStats; // [{ timeRange, avgLoad }], always 12 entries

    const totalLoad = slots.reduce((sum, s) => sum + s.avgLoad, 0);
    if (totalLoad <= 0) {
      // No booking data yet -> nothing meaningful to recommend.
      return res.json({
        success: true,
        personalized: false,
        updateCutoffDate: heatmap.updateCutoffDate,
        nextOffPeak: null,
        recommendations: []
      });
    }

    const maxLoad = Math.max(...slots.map(s => s.avgLoad)) || 1;
    const normLoad = slots.map(s => s.avgLoad / maxLoad); // 0..1, higher = busier

    // 2. Personal schedule: fold the user's 24-hour usage into the 12 slots.
    let personalized = false;
    let prefMatch = slots.map(() => 0);
    if (user_id) {
      const { data: logs, error } = await supabase
        .from("Usage_Log_Table")
        .select("hour")
        .eq("user_id", user_id);

      if (!error && logs && logs.length > 0) {
        const slotPref = slots.map(() => 0);
        logs.forEach(l => {
          if (l.hour == null) return;
          const k = Math.floor(l.hour / 2); // 0..11, aligns with fullTwoHourSlots
          if (k >= 0 && k < slotPref.length) slotPref[k]++;
        });
        const maxPref = Math.max(...slotPref) || 1;
        prefMatch = slotPref.map(v => v / maxPref); // 0..1, higher = more usual for user
        personalized = true;
      }
    }

    // 3. Score each slot: prefer empty slots, break ties toward the user's habits.
    const scored = slots.map((s, i) => ({
      timeRange: s.timeRange,
      avgLoad: s.avgLoad,
      score: Number((
        OFFPEAK_LOAD_WEIGHT * (1 - normLoad[i]) +
        OFFPEAK_PREF_WEIGHT * prefMatch[i]
      ).toFixed(4))
    }));

    // 4. Top-N recommendations by score (ties: quieter slot first).
    const recommendations = [...scored]
      .sort((a, b) => b.score - a.score || a.avgLoad - b.avgLoad)
      .slice(0, OFFPEAK_TOP_N);

    // 5. "Next off-peak": first recommended slot starting at/after the current
    //    hour today; wrap to the earliest recommended slot if none remain today.
    const recSet = new Set(recommendations.map(r => r.timeRange));
    const currentHour = new Date().getHours();
    const currentSlotStart = Math.floor(currentHour / 2) * 2;
    const upcoming = slots.filter(s =>
      recSet.has(s.timeRange) &&
      parseInt(s.timeRange.slice(0, 2), 10) >= currentSlotStart
    );
    const orderedRecs = [...recommendations].sort(
      (a, b) => parseInt(a.timeRange.slice(0, 2), 10) - parseInt(b.timeRange.slice(0, 2), 10)
    );
    const nextOffPeak = (upcoming.length ? upcoming[0] : orderedRecs[0]) || null;

    return res.json({
      success: true,
      personalized,
      updateCutoffDate: heatmap.updateCutoffDate,
      nextOffPeak: nextOffPeak
        ? { timeRange: nextOffPeak.timeRange, avgLoad: nextOffPeak.avgLoad }
        : null,
      recommendations
    });
  } catch (err) {
    console.error("off-peak recommendation failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/create-fault-report
app.post("/api/create-fault-report", async (req, res) => {
  try {
    const { facilityType, facilityNumber, faultDesc, submitUserId } = req.body;

    // 1. Validate required fields
    if (!facilityType || !facilityNumber || !faultDesc || !submitUserId) {
      return res.json({
        success: false,
        msg: "All facility and fault fields cannot be empty"
      });
    }

    // 2. First step: Insert fault report into Fault_Report_Table
    const { error: insertErr } = await supabase
      .from("Fault_Report_Table")
      .insert({
        reporter_user_id: submitUserId,
        facility_type: facilityType,
        facility_number: facilityNumber,
        fault_description: faultDesc,
        report_status: "pending",
        reported_at: new Date()
      });
    if (insertErr) throw new Error("Insert report failed: " + insertErr.message);

    // 3. Update the facility's status to "outOfService" in the corresponding table
    let updateErr = null;
    if (facilityType === "washer" || facilityType === "dryer") {
      const { error } = await supabase
        .from("Machine_Table")
        .update({ machine_status: "outOfService" })
        .eq("machine_id", facilityNumber);
      updateErr = error;
    } else if (facilityType === "locker") {
      const { error } = await supabase
        .from("Locker_Table")
        .update({ locker_status: "outOfService" })
        .eq("locker_id", facilityNumber);
      updateErr = error;
    } else {
      throw new Error("Only Washer, Dryer, Locker are supported");
    }

    if (updateErr) throw new Error("Update device status failed: " + updateErr.message);

    // 4. Push admin FCM notifications 
    const { data: adminList, error: adminErr } = await supabase
      .from("User_Table")
      .select("fcm_token")
      .eq("role", "admin")
      .not("fcm_token", "is", null);
    if (adminErr) throw new Error(adminErr.message);
    const adminTokens = adminList.map(item => item.fcm_token);

    if (adminInitialized && adminTokens.length > 0) {
    for (const token of adminTokens) {
    await admin.messaging().send({
      token: token,
      notification: {
        title: "Equipment Fault Alert",
        body: `[${facilityType} ${facilityNumber}] Fault: ${faultDesc.slice(0,70)}`
      },
      data: {
        targetPage: "adminFaultList",
        facilityNumber: facilityNumber
      },
      android: {
        priority: "high"
      }
    });
  }
}

    return res.json({
      success: true,
      msg: "Fault report created, machine marked out of service"
    });
  } catch (err) {
    return res.json({
      success: false,
      msg: err.message
    });
  }
});

// GET /api/get-all-fault-list
app.get("/api/get-all-fault-list", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("Fault_Report_Table")
      .select("record_id, facility_type, facility_number, fault_description, reported_at, report_status")
      .eq("report_status", "pending")
      .order("reported_at", { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      fault_list: data
    });
  } catch (err) {
    console.error("Get fault list error: ", err);
    return res.status(200).json({
      success: false,
      fault_list: []
    });
  }
});

// POST /api/send-all-user-notification
async function sendAllUserNotification(title, body) {
  if (!adminInitialized) return;
  try {
    const { data: userList, error } = await supabase
      .from("User_Table")
      .select("fcm_token")
      .not("fcm_token", "is", null)
      .eq("role", "user");

    if (error || !userList || userList.length === 0) {
      console.log("[FCM] No valid user list for broadcast");
      return;
    }

    for (const user of userList) {
      const token = user.fcm_token;
      try {
        await admin.messaging().send({
          token: token,
          notification: { title, body }
        });
        console.log(`[FCM Broadcast] Sent to token ${token.slice(0,20)}...`);
      } catch (err) {
        console.warn(`[FCM Broadcast Fail] token ${token.slice(0,20)}...`, err.message);
      }
    }
  } catch (globalErr) {
    console.error("[FCM Broadcast global error]", globalErr.message);
  }
}

// POST /api/mark-fault-fixed
app.post("/api/mark-fault-fixed", async (req, res) => {
  try {
    const { record_id, facility_type, facility_number } = req.body;
    if (!record_id || !facility_type || !facility_number) {
      return res.status(200).json({ success: false, msg: "Missing required params" });
    }

    // Step 1: Update the fault report status to "fixed"
    const { error: updateFaultErr } = await supabase
      .from("Fault_Report_Table")
      .update({ report_status: "fixed" })
      .eq("record_id", record_id);
    if (updateFaultErr) throw updateFaultErr;

    // Step 2: Update the facility status to "available" in the corresponding table
    if (facility_type === "washer" || facility_type === "dryer") {
      const { error: machineErr } = await supabase
        .from("Machine_Table")
        .update({ machine_status: "available" })
        .eq("machine_id", facility_number)
        .eq("machine_type", facility_type);
      if (machineErr) throw machineErr;
    } else if (facility_type === "locker") {
      const { error: lockerErr } = await supabase
        .from("Locker_Table")
        .update({ locker_status: "available" })
        .eq("locker_id", facility_number);
      if (lockerErr) throw lockerErr;
    }

    // Step 3: Get all user FCM tokens and send multicast notifications
    const runFcmPush = async () => {
      const pushTitle = "Facility Fixed";
      const pushBody = `The ${facility_type} No.${facility_number} fault has been fixed, you can use it normally now.`;
      await sendAllUserNotification(pushTitle, pushBody);
    };
    runFcmPush();
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Mark fixed fault error: ", err);
    return res.status(200).json({ success: false, msg: String(err) });
  }
});

app.post("/admin/machine/manualSetOutOfService", async (req, res) => {
  try {
    const machineId = req.body.machineId;

    if (!machineId || typeof machineId !== "string") {
      return res.status(400).json({ message: "Invalid machineId format, example: W-01 / D-01" });
    }

    const { data: targetMachine, error: machineQueryErr } = await supabase
      .from("Machine_Table")
      .select("machine_id, machine_status")
      .eq("machine_id", machineId)
      .single();

    if (machineQueryErr || !targetMachine) {
      return res.status(404).json({ message: "Target machine not found" });
    }

    if (targetMachine.machine_status === "outOfService") {
      return res.status(400).json({ message: "This machine is already outOfService" });
    }

    const { error: updateMachineErr } = await supabase
      .from("Machine_Table")
      .update({ machine_status: "outOfService" })
      .eq("machine_id", machineId);

    if (updateMachineErr) {
      console.error("Update machine status failed: ", updateMachineErr);
      return res.status(500).json({ message: "Failed to update machine status" });
    }

    const { data: userList, error: userQueryErr } = await supabase
      .from("User_Table")
      .select("fcm_token")
      .not("fcm_token", "is", null)
      .eq("role", "user");

    if (userQueryErr) {
      console.error("Fetch user fcm token error: ", userQueryErr);
      return res.status(500).json({ message: "Machine shutdown succeeded, but notification send failed" });
    }

    const tokenArr = userList.map(item => item.fcm_token);
    const pushPayload = {
      notification: {
        title: "Device Temporary Shutdown Notice",
        body: `Machine ${machineId} is detected faulty by admin, temporarily unavailable. Please select other devices.`
      },
      data: {
        type: "machineFaultNotice",
        machineId: machineId
      }
    };

    for (const singleToken of tokenArr) {
      try {
        await admin.messaging().send({
          token: singleToken,
          ...pushPayload
        });
      } catch (singlePushErr) {
        console.warn(`Push failed for token ${singleToken}: `, singlePushErr.message);
      }
    }

    return res.status(200).json({ success: true, message: "Machine marked outOfService, all user notifications sent" });
  } catch (globalErr) {
    console.error("Manual shutdown api global error: ", globalErr);
    return res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/admin/locker/manualSetOutOfService", async (req, res) => {
  try {
    const lockerId = req.body.lockerId;

    if (!lockerId || typeof lockerId !== "number") {
      return res.status(400).json({ message: "lockerId must be pure number like 1,2,3..." });
    }

    const { data: targetLocker, error: lockerQueryErr } = await supabase
      .from("Locker_Table")
      .select("locker_id, locker_status")
      .eq("locker_id", lockerId)
      .single();

    if (lockerQueryErr || !targetLocker) {
      return res.status(404).json({ message: "Target locker not found" });
    }

    if (targetLocker.locker_status === "outOfService") {
      return res.status(400).json({ message: "This locker is already outOfService" });
    }

    const { error: updateLockerErr } = await supabase
      .from("Locker_Table")
      .update({ locker_status: "outOfService" })
      .eq("locker_id", lockerId);

    if (updateLockerErr) {
      console.error("Update locker status error: ", updateLockerErr);
      return res.status(500).json({ message: "Failed to update locker status" });
    }

    const { data: userList, error: userQueryErr } = await supabase
      .from("User_Table")
      .select("fcm_token")
      .not("fcm_token", "is", null)
      .eq("role", "user");

    if (userQueryErr) {
      console.error("Fetch user fcm token error: ", userQueryErr);
      return res.status(500).json({ message: "Locker shutdown succeeded, but notification send failed" });
    }

    const tokenArr = userList.map(item => item.fcm_token);
    const pushPayload = {
      notification: {
        title: "Locker Temporary Shutdown Notice",
        body: `Locker ${lockerId} is detected faulty by admin, temporarily unavailable. Please select other lockers.`
      },
      data: {
        type: "lockerFaultNotice",
        lockerId: lockerId.toString()
      }
    };

    for (const singleToken of tokenArr) {
      try {
        await admin.messaging().send({
          token: singleToken,
          ...pushPayload
        });
      } catch (singlePushErr) {
        console.warn(`Push failed for token ${singleToken}: `, singlePushErr.message);
      }
    }

    return res.status(200).json({ success: true, message: "Locker marked outOfService, all user notifications sent" });
  } catch (globalErr) {
    console.error("Locker shutdown api global error: ", globalErr);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// POST /admin/machine/manualRestoreToAvailable
app.post("/admin/machine/manualRestoreToAvailable", async (req, res) => {
  try {
    const machineId = req.body.machineId;

    if (!machineId || typeof machineId !== "string") {
      return res.status(400).json({ message: "machineId must be valid string like W‑01" });
    }

    const { data: targetMachine, error: machineQueryErr } = await supabase
      .from("Machine_Table")
      .select("machine_id, machine_status")
      .eq("machine_id", machineId)
      .single();

    if (machineQueryErr || !targetMachine) {
      return res.status(404).json({ message: "Target machine not found" });
    }

    if (targetMachine.machine_status === "available") {
      return res.status(400).json({ message: "This machine is already available" });
    }

    const { data: userList, error: userQueryErr } = await supabase
      .from("User_Table")
      .select("fcm_token")
      .eq("role", "user")
      .not("fcm_token", "is", null);

    if (userQueryErr) {
      console.error("Fetch user fcm token error: ", userQueryErr);
      return res.status(500).json({ message: "Machine restore succeeded, but notification send failed" });
    }

    const { error: updateMachineErr } = await supabase
      .from("Machine_Table")
      .update({ machine_status: "available" })
      .eq("machine_id", machineId);

    if (updateMachineErr) {
      console.error("Update machine status error: ", updateMachineErr);
      return res.status(500).json({ message: "Failed to update machine status" });
    }

    const tokenArr = userList.map(item => item.fcm_token);
    const pushPayload = {
      notification: {
        title: "Device Restored Notice",
        body: `Machine ${machineId} has been repaired, now available for use.`
      },
      data: {
        type: "machineRestoreNotice",
        machineId: machineId
      }
    };

    for (const singleToken of tokenArr) {
      try {
        await admin.messaging().send({
          token: singleToken,
          ...pushPayload
        });
      } catch (singlePushErr) {
        console.warn(`Push failed for token ${singleToken}: `, singlePushErr.message);
      }
    }

    return res.status(200).json({ success: true, message: "Machine restored to available, all user notifications sent" });
  } catch (globalErr) {
    console.error("Machine restore api global error: ", globalErr);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// POST /admin/locker/manualRestoreToAvailable
app.post("/admin/locker/manualRestoreToAvailable", async (req, res) => {
  try {
    const lockerId = req.body.lockerId;

    if (!lockerId || typeof lockerId !== "number") {
      return res.status(400).json({ message: "lockerId must be pure number like 1,2,3..." });
    }

    const { data: targetLocker, error: lockerQueryErr } = await supabase
      .from("Locker_Table")
      .select("locker_id, locker_status")
      .eq("locker_id", lockerId)
      .single();

    if (lockerQueryErr || !targetLocker) {
      return res.status(404).json({ message: "Target locker not found" });
    }

    if (targetLocker.locker_status === "available") {
      return res.status(400).json({ message: "This locker is already available" });
    }

    const { data: userList, error: userQueryErr } = await supabase
      .from("User_Table")
      .select("fcm_token")
      .eq("role", "user")
      .not("fcm_token", "is", null);

    if (userQueryErr) {
      console.error("Fetch user fcm token error: ", userQueryErr);
      return res.status(500).json({ message: "Locker restore succeeded, but notification send failed" });
    }

    const { error: updateLockerErr } = await supabase
      .from("Locker_Table")
      .update({ locker_status: "available" })
      .eq("locker_id", lockerId);

    if (updateLockerErr) {
      console.error("Update locker status error: ", updateLockerErr);
      return res.status(500).json({ message: "Failed to update locker status" });
    }

    const tokenArr = userList.map(item => item.fcm_token);
    const pushPayload = {
      notification: {
        title: "Locker Restored Notice",
        body: `Locker ${lockerId} has been repaired, now available for use.`
      },
      data: {
        type: "lockerRestoreNotice",
        lockerId: lockerId.toString()
      }
    };

    for (const singleToken of tokenArr) {
      try {
        await admin.messaging().send({
          token: singleToken,
          ...pushPayload
        });
      } catch (singlePushErr) {
        console.warn(`Push failed for token ${singleToken}: `, singlePushErr.message);
      }
    }

    return res.status(200).json({ success: true, message: "Locker restored to available, all user notifications sent" });
  } catch (globalErr) {
    console.error("Locker restore api global error: ", globalErr);
    return res.status(500).json({ message: "Internal server error" });
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
