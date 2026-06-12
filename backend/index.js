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

    if (findError || !users || user.length === 0) {
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

    const { data: userData, error: userErr } = await supabase
      .from("User_Table")
      .select("credit_score")
      .eq("user_id", user_id)
      .single();

    if (userErr || !userData) {
      return res.json({
        success: false,
        message: "User not found"
      });
    }

    // Set a minimum credit score threshold of 15 to join the queue, users with credit score below 15 will be blocked from joining the queue and receive a message prompting them to improve their credit score
    if (userData.credit_score < 15) {
      return res.json({
        success: false,
        message: "Your credit score is below 15, you cannot join the online queue."
      });
    }

    const { data: availableMachines } = await supabase
      .from("Machine_Table")
      .select("*")
      .eq("machine_type", type)
      .eq("machine_status", "available")
      .order("machine_id", { ascending: true });

    if (availableMachines.length > 0) {
      const targetMachine = availableMachines[0];
      // Set reservation end time = now + 15 minutes, stored in reserved_end_at
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
          finished_at: null, // Set finished_at to null, will be updated when washing is finished
          pickup_end_at: null
        })
        .eq("machine_id", targetMachine.machine_id);

      return res.json({
        success: true,
        message: `Allocated available machine successfully, your machine ID is ${targetMachine.machine_id}. Please come down within 15 minutes.`,
        machine: targetMachine
      });
    } else {
      await supabase.from("Booking_Table").insert([
        {
          user_id: user_id,
          booking_status: "waiting"
        }
      ]);
      return res.json({
        success: true,
        message: "No available machine, added to queue"
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//manually trigger when user finishes washing, update finished_at and start 15-minute countdown
app.post("/api/finish-wash", async (req, res) => {
  try {
    const { machine_id } = req.body;

    const { data: machine, error: getError } = await supabase
      .from("Machine_Table")
      .select("*")
      .eq("machine_id", machine_id)
      .single();

    if (getError || !machine) {
      return res.status(404).json({ message: "Machine not found" });
    }

    //check whether machine is in occupied state 
    if (machine.machine_status !== "occupied") {
      return res.status(400).json({ message: "Machine is not in occupied state" });
    }

    //update finished_at and start 15-minute countdown
    await supabase
      .from("Machine_Table")
      .update({ finished_at: new Date() })
      .eq("machine_id", machine_id);

    res.json({
      success: true,
      message: `Washing finished for machine ${machine_id}. 15-minute countdown started.`,
      machine_id: machine_id,
      finished_at: new Date()
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//manually trigger when user releases machine, update machine_status to available and reset finished_at
app.post("/api/release-machine", async (req, res) => {
  try {
    const { machine_id } = req.body;

    const { data: machine, error: getError } = await supabase
      .from("Machine_Table")
      .select("*")
      .eq("machine_id", machine_id)
      .single();

    if (getError || !machine) {
      return res.status(404).json({ message: "Machine not found" });
    }

    if (machine.machine_status !== "occupied") {
      return res.status(400).json({ message: "Machine is not in occupied state" });
    }

    await supabase
      .from("Machine_Table")
      .update({
        machine_status: "available",
        finished_at: null
      })
      .eq("machine_id", machine_id);

    res.json({
      success: true,
      message: `Machine ${machine_id} released and is now available.`,
      machine_id: machine_id,
      new_status: "available"
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
      .select('finished_at, reserved_end_at, pickup_end_at, machine_status')
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
      machine_status: machData?.machine_status ?? 'occupied'
    });
  } catch (err) {
    res.json({ remain_seconds: 0, reserved_remain_seconds: 0, pickup_remain_seconds: 0, ahead_count: 0, machine_status: 'occupied' });
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

// POST /finishCycle
// Called by frontend when countdown reaches 0 → trigger finish-wash
app.post('/finishCycle', async (req, res) => {
  try {
    const { mid } = req.body;
    const machine_id = mid;

    const { data: machine } = await supabase
      .from('Machine_Table')
      .select('*')
      .eq('machine_id', machine_id)
      .single();

    if (!machine) {
      return res.status(404).json({ success: false, message: 'Machine not found' });
    }

    // Set grace_end_time = now + 15 minutes
    const graceEndTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await supabase
      .from('Machine_Table')
      .update({
        machine_status: 'grace-period',
        finished_at: graceEndTime
      })
      .eq('machine_id', machine_id);

    // TODO: Send FCM push notification "Your laundry is done, please collect within 15 minutes"

    return res.json({
      success: true,
      message: `Machine ${machine_id} cycle finished. 15-minute grace period started.`
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
        finished_at: null
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
        reserved_end_at: null
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
