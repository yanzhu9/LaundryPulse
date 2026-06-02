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
  const { email, password } = req.body;

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
  const { email, password } = req.body;

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

      await supabase.from("Booking_Table").insert([
        {
          user_id: user_id,
          machine_id: targetMachine.machine_id,
          machine_type: type,
          booking_status: "using"
        }
      ]);

      await supabase
        .from("Machine_Table")
        .update({ machine_status: "occupied" })
        .eq("machine_id", targetMachine.machine_id);

      return res.json({
        success: true,
        message: `Allocated available machine successfully, your machine ID is ${targetMachine.machine_id}`,
        machine: targetMachine
      });

    } else {
      // no available machine, add to queue
      await supabase.from("Booking_Table").insert([
        {
          user_id: user_id,
          machine_type: type,
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

// periodically check every 5 seconds, if there is any machine that has been in occupied state for more than 15 minutes, update its status to overdue
setInterval(async () => {
  const now = new Date();
  const limit = 900000;// 15 minutes in milliseconds

  const { data: list } = await supabase
    .from("Machine_Table")
    .select("*")
    .eq("machine_status", "occupied")
    .not("finished_at", "is", null);

  if (!list) return;

  for (let m of list) {
    const start = new Date(m.finished_at);
    const passMin = now - start;

    if (passMin >= limit) {
      await supabase
        .from("Machine_Table")
        .update({ machine_status: "overdue" })
        .eq("machine_id", m.machine_id);
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

const fetch = require('node-fetch');

app.get('/getMachineInfo', async (req, res) => {
  try {
    const mid = req.query.mid;
    const { data: machData } = await supabase
      .from('Machine_Table')
      .select('remaining_time')
      .eq('machine_id', mid)
      .single();

    const { count: waitCnt } = await supabase
      .from('Booking_Table')
      .select('id', { count: 'exact', head: true })
      .eq('machine_id', mid)
      .eq('booking_status', 'waiting');

    res.json({
      remain_seconds: machData?.remaining_time ?? 0,
      ahead_count: waitCnt ?? 0
    })
  } catch (err) {
    res.json({ remain_seconds: 0, ahead_count: 0 })
  }
})

app.post('/updateRemainSec', async (req, res) => {
  const { mid, sec } = req.body;
  await supabase
    .from('Machine_Table')
    .update({ remaining_time: Number(sec) })
    .eq('machine_id', mid);
  res.send('ok');
})

app.post('/finishCycle', async (req, res) => {
  const { mid } = req.body;
  await fetch(`http://localhost:${PORT}/api/finish-wash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine_id: mid })
  })
  res.end();
})

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
