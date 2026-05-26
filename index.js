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
  const {email,password} = req.body;
  const {data} = await supabase
    .from('users')
    .insert([{email,password}]);
  res.send(data);
});

app.post('/login', async (req, res) => {
  const {email,password} = req.body;
  const {data} = await supabase
    .from('users')
    .select()
    .eq('email',email)
    .eq('password',password);
  res.send(data);
});

app.get('/machines', async (req, res) => {
  const {data} = await supabase.from('machines').select();
  res.send(data);
});

app.post("/api/queue-book", async (req, res) => {
  try {
    const { user_id, type } = req.body;

    // 1.backend find whether there are available machines for the required type
    const { data: availableMachines } = await supabase
      .from("machines")
      .select("*")
      .eq("type", type)
      .eq("status", "available")
      .order("id", { ascending: true });

    if (availableMachines.length > 0) {
      //choose the first available machine
      const targetMachine = availableMachines[0];

      // form the queue info
      await supabase.from("bookings").insert([
        {
          user_id: user_id,
          machine_id: targetMachine.id,
          book_time: new Date(),
          status: "occupied"
        }
      ]);

      // update the machine status
      await supabase
        .from("machines")
        .update({ status: "occupied" })
        .eq("id", targetMachine.id);

      return res.json({
        success: true,
        message: "Allocated available machine successfully, your machine ID is ${targetMachine.id}",
        machine: targetMachine
      });

    } else {
      // no available machine
      await supabase.from("queue").insert([
        {
          user_id: user_id,
          machine_type: type,
          queue_time: new Date()
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

// manually mark the laundry cycle as finished then start the 15 minutes countdown
app.post("/api/finish-wash", async (req, res) => {
  try {
    const { machine_id } = req.body;

    // 1.check whether the machine is occupied
    const { data: machine, error: getError } = await supabase
      .from("Machine Table")
      .select("*")
      .eq("machine_id", machine_id)
      .single();

    if (getError || !machine) {
      return res.status(404).json({ message: "Machine not found" });
    }
    if (machine.status !== "occupied") {
      return res.status(400).json({ message: "Machine is not in occupied state" });
    }

    // 2. record the finished time
    const { error: updateError } = await supabase
      .from("Machine Table")
      .update({ finished_at: new Date() })
      .eq("machine_id", machine_id);

    if (updateError) {
      return res.status(500).json({ message: "Failed to mark wash as finished" });
    }

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

// manually mark the machine as the clothes has been collected within 15 minutes 
app.post("/api/release-machine", async (req, res) => {
  try {
    const { machine_id } = req.body;

    // 1. check whether the machine is in occupied state
    const { data: machine, error: getError } = await supabase
      .from("Machine Table")
      .select("*")
      .eq("machine_id", machine_id)
      .single();

    if (getError || !machine) {
      return res.status(404).json({ message: "Machine not found" });
    }
    if (machine.status !== "occupied") {
      return res.status(400).json({ message: "Machine is not in occupied state" });
    }

    // 2. change machine status to available and clear finished_at
    const { error: updateError } = await supabase
      .from("Machine Table")
      .update({
        status: "available",
        finished_at: null
      })
      .eq("machine_id", machine_id);

    if (updateError) {
      return res.status(500).json({ message: "Failed to release machine" });
    }

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

setInterval(async () => {
  const now = new Date();
  const limit = 900000; //15 minutes

  // monitor the machine that is occupied and has finished_at
  const { data: list } = await supabase
    .from("Machine Table")
    .select("*")
    .eq("status", "occupied")
    .not("finished_at", "is", null);

  if (!list) return;

  for (let m of list) {
    const start = new Date(m.finished_at);
       const passMin = now - start;

    //if over 15 minutes change the machine status to occupied
    if (passMin >= limit) {
      await supabase
        .from("Machine Table")
        .update({ status: "overdue" })
        .eq("machine_id", m.machine_id);
    }
  }

}, 5000);

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Backend deployed successfully! Connected to Supabase database.');
});

// Database connection test endpoint
app.get('/test-db', async (req, res) => {
  try {
    const { data, error } = await supabase.from('User Table').select().limit(1);
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
