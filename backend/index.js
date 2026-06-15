require('dotenv').config();

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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

    // 1. Check user's credit score
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

    // 2. Try to find an available machine of the requested type
    const { data: availableMachines } = await supabase
      .from("Machine_Table")
      .select("*")
      .eq("machine_type", type)
      .eq("machine_status", "available")
      .order("machine_id", { ascending: true });

    // 3. If there's an available machine, reserve it immediately for the user
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

    const now = new Date();
    const WASHER_CYCLE = 34;
    const DRYER_CYCLE = 30;
    const PICKUP_GRACE = 15;
    const cycleBase = type === "washer" ? WASHER_CYCLE : DRYER_CYCLE;

    const { data: occupiedMachines } = await supabase
      .from("Machine_Table")
      .select("machine_id, reserved_end_at, finished_at, pickup_end_at")
      .eq("machine_type", type)
      .eq("machine_status", "occupied");

    if (occupiedMachines.length === 0) {
      return res.json({ success: false, message: "No machines available to queue" });
    }

    // 4. For each occupied machine, calculate when it will be free and how many people are waiting for it, then estimate total wait time
    const machineWaitList = [];
    for (const machine of occupiedMachines) {
      let machineFreeAt;
      const { reserved_end_at, finished_at, pickup_end_at } = machine;

      // Condition 1: Cycle hasn't started, still in reservation period
      if (finished_at === null && pickup_end_at === null) {
        const reserveEnd = new Date(reserved_end_at);
        machineFreeAt = new Date(reserveEnd.getTime() + (cycleBase + PICKUP_GRACE) * 60 * 1000);
      }
      // Condition 2: Cycle has started but not finished, in washing/drying period
      else if (finished_at && pickup_end_at === null) {
        const finishTime = new Date(finished_at);
        machineFreeAt = new Date(finishTime.getTime() + PICKUP_GRACE * 60 * 1000);
      }
      // Condition 3: Pickup grace period
      else if (pickup_end_at) {
        machineFreeAt = new Date(pickup_end_at);
      } else {
        // Fallback: treat as if it will be free after a full cycle from now
        machineFreeAt = now;
      }

      // Base wait time (to machine availability)
      const baseWaitMin = Math.max(0, (machineFreeAt - now) / 1000 / 60);

      // Query the number of people waiting for this machine
      const { count: waitingCount } = await supabase
        .from("Booking_Table")
        .select("*", { count: "exact", head: true })
        .eq("machine_id", machine.machine_id)
        .eq("booking_status", "waiting");

      // Total wait time = base wait time + (number of people waiting * cycle time)
      const totalWaitMin = baseWaitMin + waitingCount * cycleBase;

      machineWaitList.push({
        machine_id: machine.machine_id,
        totalWaitMin: Math.round(totalWaitMin)
      });
    }

    // 5. Find the machine with the shortest estimated wait time and add the user to that machine's queue
    machineWaitList.sort((a, b) => a.totalWaitMin - b.totalWaitMin);
    const bestMachine = machineWaitList[0];

    // Insert queue record, bind the optimal machine
    await supabase.from("Booking_Table").insert([
      {
        user_id: user_id,
        machine_id: bestMachine.machine_id,
        booking_status: "waiting",
        end_time: new Date(now.getTime() + bestMachine.totalWaitMin * 60 * 1000).toISOString()
      }
    ]);

    return res.json({
      success: true,
      message: `No available machine, added to optimal queue for machine ${bestMachine.machine_id}, estimated wait: ${bestMachine.totalWaitMin} mins`,
      estimated_wait: bestMachine.totalWaitMin
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

    // Assume wash duration is 30 min for dryers and 34 min for washers (including drying time)
    const addMin = machine_id.startsWith('W') ? 34 : 30;
    const finishedAt = new Date(Date.now() + addMin * 60 * 1000).toISOString();

    await supabase
      .from('Machine_Table')
      .update({
        finished_at: finishedAt,
        reserved_end_at: null // clear reservation end time since cycle has started
      })
      .eq('machine_id', machine_id);

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

// POST /api/machines/:id/collect
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

      // TODO: Send FCM push notification "Please collect your laundry immediately"
      //await sendNotification(m.user_id, "Laundry Done",
        //`Your laundry in Machine ${m.machine_id} is done. Please collect it immediately.`);
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
      .update({ booking_status: 'finish' })
      .eq('machine_id', machine.machine_id)
      .eq('booking_status', 'using');

    console.log(`Machine ${machine.machine_id} reservation expired → available`);
  }
}, 5000);

// Check every 5 seconds: if a machine's finished_at has passed but pickup_end_at is not set → set pickup_end_at = now + 15 minutes and mark as waiting for pickup
setInterval(async () => {
  const now = new Date();
  const { data: washingEndList } = await supabase
    .from("Machine_Table")
    .select("machine_id, finished_at, pickup_end_at")
    .eq("machine_status", "occupied")
    .not("finished_at", "is", null)
    .is("pickup_end_at", null);

  if (!washingEndList) return;
  for (const m of washingEndList) {
    const finishTime = new Date(m.finished_at);
    if (now < finishTime) continue;

    const pickupEnd = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await supabase
      .from("Machine_Table")
      .update({
        pickup_end_at: pickupEnd,
        finished_at: null // clear finished_at since washing is done, now it's in pickup waiting state
      })
      .eq("machine_id", m.machine_id);

    console.log(`Machine ${m.machine_id} wash finished, 15-min pickup window started`);
  }
}, 5000);

// if pickup_end_at has passed but user hasn't confirmed pickup → mark as overdue and send notification
setInterval(async () => {
  const now = new Date();
  const { data: pickupExpireList } = await supabase
    .from("Machine_Table")
    .select("machine_id, pickup_end_at")
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

// POST /api/submit-collect-choice（
app.post("/api/submit-collect-choice", async (req, res) => {
  const { record_id, machine_id, choice } = req.body;
  if (!record_id || !machine_id || !choice) {
    return res.json({ success: false, message: "Missing parameters" });
  }

  try {
    await supabase
      .from("Assistance_Record_Table")
      .update({ is_assisted_active: false })
      .eq("record_id", record_id);

    const newStatus = choice === "yes" ? "occupied" : "available";
    await supabase
      .from("Machine_Table")
      .update({ machine_status: newStatus })
      .eq("machine_id", machine_id);

    return res.json({ success: true, new_status: newStatus });
  } catch (err) {
    console.error(err);
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
  const { error: scoreErr } = await supabase
    .from("User_Table")
    .update({ credit_score: supabase.raw(`credit_score + ${scoreDelta}`) })
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
