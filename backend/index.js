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
      .insert([{ email, password }]);

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

    const { data: user, error: findError } = await supabase
      .from('User_Table')
      .select('user_id, email, password')
      .eq('email', email)
      .single();

    if (findError || !user) {
      return res.json({
        success: false,
        msg: "Email not found. Please check your email address."
      });
    }

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

    //find whether there is an available machine
    const { data: availableMachines } = await supabase
      .from("Machine_Table")
      .select("*")
      .eq("machine_type", type)
      .eq("machine_status", "available")
      .order("machine_id", { ascending: true });

    // if there is an available machine
    if (availableMachines.length > 0) {
      const targetMachine = availableMachines[0];

      // Set 15-minute reservation window
      const reservationEnd = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      await supabase.from("Booking_Table").insert([
        {
          user_id: user_id,
          machine_id: targetMachine.machine_id,
          booking_status: "reserved"
        }
      ]);

      await supabase
        .from("Machine_Table")
        .update({
          machine_status: "occupied",
          finished_at: reservationEnd   // reservation expires in 15 min
        })
        .eq("machine_id", targetMachine.machine_id);

      // FCM: notify user of successful booking
      //await sendNotification(user_id, "Booking Confirmed",
        //`Machine ${targetMachine.machine_id} is reserved for you. Please come down within 15 minutes.`);
      //return res.json({
        //success: true,
        //message: `Allocated available machine successfully, your machine ID is ${targetMachine.machine_id}`,
        //machine: targetMachine
      //});

    } else {
      // no available machine, add to queue
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
      .select('finished_at, machine_status')
      .eq('machine_id', mid)
      .single();

    const { count: waitCnt } = await supabase
      .from('Booking_Table')
      .select('booking_id', { count: 'exact', head: true })
      .eq('machine_id', mid)
      .eq('booking_status', 'waiting');

    let remainSec = 0;
    if (machData?.finished_at) {
      const nowMs = Date.now();
      const endMs = new Date(machData.finished_at).getTime();
      remainSec = Math.round((endMs - nowMs) / 1000);
      if (remainSec < 0) remainSec = 0;
    }

    res.json({
      remain_seconds: remainSec,
      ahead_count: waitCnt ?? 0,
      machine_status: machData?.machine_status ?? 'occupied'
    });
  } catch (err) {
    res.json({ remain_seconds: 0, ahead_count: 0, machine_status: 'occupied' });
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

    // Washer (W-xx): 34 minutes, Dryer (D-xx): 30 minutes
    const addMin = machine_id.startsWith('W') ? 34 : 30;
    const finishedAt = new Date(Date.now() + addMin * 60 * 1000).toISOString();

    // Update machine wash end time
    await supabase
      .from('Machine_Table')
      .update({ finished_at: finishedAt })
      .eq('machine_id', machine_id);

    // Update booking status from reserved → using
    await supabase
      .from('Booking_Table')
      .update({ booking_status: 'using' })
      .eq('machine_id', machine_id)
      .eq('booking_status', 'reserved');

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

// POST /api/machines/:id/finish
// Mark wash cycle as finished → set status to grace-period, start 15-minute countdown
app.post("/api/machines/:id/finish", async (req, res) => {
  try {
    const machine_id = req.params.id;

    const { data: machine, error: getError } = await supabase
      .from("Machine_Table")
      .select("*")
      .eq("machine_id", machine_id)
      .single();

    if (getError || !machine) {
      return res.status(404).json({ success: false, message: "Machine not found" });
    }

    if (machine.machine_status !== "occupied") {
      return res.status(400).json({ success: false, message: "Machine is not in occupied state" });
    }

    // Set grace_end_time = now + 15 minutes, stored in finished_at
    const graceEndTime = new Date(Date.now() + 15 * 60 * 1000);

    await supabase
      .from("Machine_Table")
      .update({
        machine_status: "grace-period",
        finished_at: graceEndTime.toISOString()
      })
      .eq("machine_id", machine_id);

    // TODO: Send FCM push notification to user
    // "Your laundry is done, please collect within 15 minutes"

    return res.json({
      success: true,
      message: `Machine ${machine_id} wash cycle finished. 15-minute grace period started.`,
      machine_id: machine_id,
      grace_end_time: graceEndTime
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/machines/:id/collect
// User confirms clothes collected → set status back to available
app.post("/api/machines/:id/collect", async (req, res) => {
  try {
    const machine_id = req.params.id;

    const { data: machine, error: getError } = await supabase
      .from("Machine_Table")
      .select("*")
      .eq("machine_id", machine_id)
      .single();

    if (getError || !machine) {
      return res.status(404).json({ success: false, message: "Machine not found" });
    }

    if (machine.machine_status !== "grace-period" && machine.machine_status !== "overdue") {
      return res.status(400).json({ success: false, message: "Machine is not in grace-period or overdue state" });
    }

    await supabase
      .from("Machine_Table")
      .update({
        machine_status: "available",
        finished_at: null
      })
      .eq("machine_id", machine_id);

    // TODO: Send FCM push notification "Clothes collected successfully"

    return res.json({
      success: true,
      message: `Machine ${machine_id} is now available.`,
      machine_id: machine_id
    });

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
setInterval(async () => {
  const now = new Date();

  // Find occupied machines where booking is still 'reserved' and reservation has expired
  const { data: expiredReservations } = await supabase
    .from('Booking_Table')
    .select('machine_id, user_id')
    .eq('booking_status', 'reserved');

  if (!expiredReservations) return;

  for (const booking of expiredReservations) {
    const { data: machine } = await supabase
      .from('Machine_Table')
      .select('finished_at, machine_status')
      .eq('machine_id', booking.machine_id)
      .single();

    if (!machine || machine.machine_status !== 'occupied') continue;
    if (!machine.finished_at) continue;

    const reservationEnd = new Date(machine.finished_at);
    if (now < reservationEnd) continue; // still within reservation window

    // Reservation expired → release machine
    await supabase
      .from('Machine_Table')
      .update({ machine_status: 'available', finished_at: null })
      .eq('machine_id', booking.machine_id);

    await supabase
      .from('Booking_Table')
      .update({ booking_status: 'expired' })
      .eq('machine_id', booking.machine_id)
      .eq('booking_status', 'reserved');

    // FCM: notify user reservation expired
    await sendNotification(booking.user_id, "Reservation Expired",
      `Your reservation for Machine ${booking.machine_id} has expired. The machine has been released.`);

    console.log(`Machine ${booking.machine_id} reservation expired → available`);

    // Check if there's a waiting user → assign them
    const { data: nextUser } = await supabase
      .from('Booking_Table')
      .select('booking_id, user_id')
      .eq('booking_status', 'waiting')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (nextUser) {
      const newReservationEnd = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      await supabase
        .from('Machine_Table')
        .update({ machine_status: 'occupied', finished_at: newReservationEnd })
        .eq('machine_id', booking.machine_id);

      await supabase
        .from('Booking_Table')
        .update({ booking_status: 'reserved', machine_id: booking.machine_id })
        .eq('booking_id', nextUser.booking_id);

      // FCM: notify next user it's their turn
      //await sendNotification(nextUser.user_id, "It's Your Turn",
        //`Machine ${booking.machine_id} is now reserved for you. Please come down within 15 minutes.`);

      console.log(`Machine ${booking.machine_id} assigned to next user ${nextUser.user_id}`);
    }
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
