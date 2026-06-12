import 'package:flutter/material.dart';
import 'pages/login_page.dart';
import 'pages/register_page.dart';
import 'pages/welcome_page.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:async';
import 'pages/globals.dart';

enum MachineStatus {
  available,
  occupied,
  gracePeriod,
  overdue,
  outOfService,
}

class LaundryMachine {
  final String id;
  final MachineStatus status;

  LaundryMachine({
    required this.id,
    required this.status,
  });
}

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'LaundryPulse',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color.fromARGB(255, 209, 220, 243)),
      ),
      initialRoute: '/login',
      routes: {
        '/login':    (context) => const LoginPage(),
        '/register': (context) => const RegisterPage(),
        '/welcome':  (context) => const WelcomePage(),
        '/home':     (context) => const MyHomePage(),
      },
    );
  }
}

class MyHomePage extends StatefulWidget {
  const MyHomePage({super.key});

  @override
  State<MyHomePage> createState() => _MyHomePageState();
}

class _MyHomePageState extends State<MyHomePage> {
  int currentIndex = 0;

  final List<Widget> pageBody = [
    HomePage(),
    QueuePage(),
    HeatMapPage(),
    ProfilePage(),
  ];

  final List<String> pageTitles = [
    "LaundryPulse",
    "Queue",
    "HeatMap",
    "Profile",
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // For the head part of the app
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(
            //Icons.build,
            Icons.report,
            color: Colors.grey,
          ),
          onPressed: () { 
            Navigator.push(
            context,
            MaterialPageRoute(builder: (context) => const FaultReportPage()),
            );
          },
        ),
        
        backgroundColor: const Color.fromARGB(255, 215, 230, 243),
        centerTitle: true,
        title: Text(pageTitles[currentIndex]),
        
        actions: [IconButton(
          icon: const Icon(
            Icons.settings,
            color: Colors.grey,
          ),
          onPressed: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (context) => const SettingPage()),
            );
          },
        ),
      ],
      ),
      
      body: pageBody[currentIndex],
      
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: currentIndex,
        onTap: (index) {
          setState(() {
            currentIndex = index;
          });
        },
        type: BottomNavigationBarType.fixed,
        items: const<BottomNavigationBarItem>[
        BottomNavigationBarItem(
          icon: Icon(Icons.home),
          label: "Home",
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.people_alt),
          label: "Queue",
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.grid_view),
          label: "HeatMap",
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.person),
          label: "Profile",
        ),
      ],
        ),
    );
  }
}

class FaultReportPage extends StatelessWidget {
  const FaultReportPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor:  const Color.fromARGB(255, 215, 230, 243),
        centerTitle: true,
        title: const Text('Fault Report'),
      ),
    );
  }
}

class SettingPage extends StatelessWidget {
  const SettingPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor:  const Color.fromARGB(255, 215, 230, 243),
        centerTitle: true,
        title: const Text('Settings'),
      ),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  List<LaundryMachine> machines = [];
  Timer? timer;

@override
void initState() {
  super.initState();
  () async {
    await fetchRealMachineData();
  }();

  timer = Timer.periodic(const Duration(seconds: 5), (timer) async {
    await fetchRealMachineData();
  });
}

//close the timer if leaving the page
@override
void dispose() {
  timer?.cancel(); 
  super.dispose();
}

  Future<void> fetchRealMachineData() async {
  final res = await http.get(Uri.parse("https://laundrypulse.onrender.com/machines"));
  List<dynamic> rawList = jsonDecode(res.body);
  rawList.sort((a, b) => a["machine_id"].compareTo(b["machine_id"]));

  if (mounted) {
    setState(() {
      machines = rawList.map((item) {
        String statusStr = item["machine_status"];
        MachineStatus st;
        switch (statusStr) {
          case "available":
            st = MachineStatus.available;
            break;
          case "occupied":
            st = MachineStatus.occupied;
            break;
          case "grace-period":
            st = MachineStatus.gracePeriod;
            break;
          case "overdue":
            st = MachineStatus.overdue;
            break;
          case "outOfService":
            st = MachineStatus.outOfService;
            break;
          default:
            st = MachineStatus.available;
        }
        return LaundryMachine(id: item["machine_id"], status: st);
      }).toList();
    });
  }
}

  Color _getStatusColor(MachineStatus status) {
    switch (status) {
      case MachineStatus.available:
        return Colors.green.shade100;
      case MachineStatus.occupied:
        return Colors.blue.shade100;
      case MachineStatus.gracePeriod:
        return Colors.orange.shade100;
      case MachineStatus.overdue:
        return Colors.red.shade100;
      case MachineStatus.outOfService:
        return Colors.grey.shade100;
    }
  }

   void _onMachineTap(LaundryMachine machine) {
    if (machine.status == MachineStatus.occupied ||
        machine.status == MachineStatus.gracePeriod) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (context) => RealTimeWaitTimePage(machineId: machine.id),
        ),
      );
    } else if (machine.status == MachineStatus.overdue) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (context) => OverdueHandlingPage(machineId: machine.id),
        ),
      );
    }
  }

  Widget _buildMachineCard(LaundryMachine machine) {
    final isClickable = machine.status == MachineStatus.occupied ||
        machine.status == MachineStatus.gracePeriod ||
        machine.status == MachineStatus.overdue;

    return GestureDetector(
      onTap: isClickable ? () => _onMachineTap(machine) : null,
      child: Container(
        decoration: BoxDecoration(
          color: _getStatusColor(machine.status),
          borderRadius: BorderRadius.circular(12),
          border: machine.status == MachineStatus.overdue
              ? Border.all(color: Colors.red, width: 2) //overdue state has a red border
              : null,
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              machine.id,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              Row(
                children: [
                  Container(width:8, height:8, color: Colors.green.shade100),
                  SizedBox(width: 4,),
                  Text("Available"),
                ],
              ),
              Row(
                children: [
                  Container(width:8, height:8, color:  Colors.blue.shade100),
                  SizedBox(width: 4,),
                  Text("Occupied"),
                ],
              ),
              Row(
                children: [
                  Container(width:8, height:8, color: Colors.orange.shade100),
                  SizedBox(width: 4,),
                  Text("Grace Period"),
                ],
              ),
              Row(
                children: [
                  Container(width:8, height:8, color: Colors.red.shade100),
                  SizedBox(width: 4,),
                  Text("Overdue"),
                ],
              ),
              Row(
                children: [
                  Container(width:8, height:8, color: Colors.grey.shade100),
                  SizedBox(width: 4,),
                  Text("Out of Service"),
                ],
              ),
            ],
          ),
          
          const SizedBox(height: 24),

          GridView.builder(
                shrinkWrap: true, 
                physics: const NeverScrollableScrollPhysics(), 
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 3, 
                  crossAxisSpacing: 16,
                  mainAxisSpacing: 16,
                  childAspectRatio: 1.1, 
                ),
                itemCount: machines.length,
                itemBuilder: (context, index) {
                  final machine = machines[index];
                  return _buildMachineCard(machine);
                },
              ),
        ],
      ),
    );
  }
}

class QueuePage extends StatefulWidget {
  const QueuePage({super.key});

  @override
  State<QueuePage> createState() => _QueuePageState();
}

class _QueuePageState extends State<QueuePage> {
  bool autoTransfer = false;

  Future<void> queueWasher() async {

  String url = "https://laundrypulse.onrender.com/api/queue-book";

  final res = await http.post(
    Uri.parse(url),
    headers: {"Content-Type":"application/json"},
    body: jsonEncode({
      "user_id": current_user_id,
      "type": "washer"
    })
  );

  var result = jsonDecode(res.body);

    ScaffoldMessenger.of(context).showSnackBar(
       SnackBar(content: Text(result["message"]))
      );
    }

Future<void> queueDryer() async {

  String url = "https://laundrypulse.onrender.com/api/queue-book";

  final res = await http.post(
    Uri.parse(url),
    headers: {"Content-Type":"application/json"},
    body: jsonEncode({
      "user_id": current_user_id,
      "type": "dryer"
    })
  );

  var result = jsonDecode(res.body);

    ScaffoldMessenger.of(context).showSnackBar(
       SnackBar(content: Text(result["message"]))
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
  padding: const EdgeInsets.all(24.0),
  child: Column(
    mainAxisAlignment: MainAxisAlignment.start,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const SizedBox(height: 40),

      ElevatedButton(
        onPressed: () {
          queueWasher();
        },
        style: ElevatedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 22),
        ),
        child: const Text("Queue for Washer", style: TextStyle(fontSize: 17)),
      ),

      const SizedBox(height: 25),

      ElevatedButton(
        onPressed: () {
          queueDryer();
        },
        style: ElevatedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 22),
        ),
        child: const Text("Queue for Dryer", style: TextStyle(fontSize: 17)),
      ),

      const SizedBox(height: 40),

      // Auto Transfer Switch
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Text(
            "Auto transfer to dryer queue",
            style: TextStyle(fontSize: 16),
          ),
          Switch(
            value: autoTransfer,
            trackColor: WidgetStateColor.resolveWith((states) {
              if (states.contains(WidgetState.selected)) {
                return Colors.green; // Active state color
              }
              return Colors.grey.shade400; // Inactive state color
            }),
            onChanged: (val) {
              setState(() {
                autoTransfer = val;
              });
            },
          )
        ],
      )
    ],
  ),
);
  }
}

class HeatMapPage extends StatefulWidget {
  const HeatMapPage({super.key});

  @override
  State<HeatMapPage> createState() => _HeatMapPageState();
}

class _HeatMapPageState extends State<HeatMapPage> {
  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      child: const Center(
        child: Text("HeatMap Page"),
      ),
    );
  }
}

class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      child: const Center(
        child: Text("Profile Page"),
      ),
    );
  }
}

// Real-time Wait Time Page for Occupied Machines (Stateful Widget)
class RealTimeWaitTimePage extends StatefulWidget {
  final String machineId;
  const RealTimeWaitTimePage({super.key, required this.machineId});

  @override
  State<RealTimeWaitTimePage> createState() => _RealTimeWaitTimePageState();
}

class _RealTimeWaitTimePageState extends State<RealTimeWaitTimePage> {
  int remainTotalSec = 0;
  int reservedSec = 0;
  int pickupSec = 0;
  int aheadPeople = 0;
  bool washingStarted = false;
  bool isPickupWindow = false;
  bool isLoading = false;
  String machineStatus = "occupied";

  // backend polling timer
  Timer? _refreshTimer;
  // frontend local countdown timer (only active during washing)
  Timer? _localCountdownTimer;

  final String baseUrl = "https://laundrypulse.onrender.com";

  @override
  void initState() {
    super.initState();
    // when page loads, immediately fetch machine info to initialize all states and decide UI rendering logic
    fetchMachineInfo();
    // set up a timer to poll backend every 5 seconds for the latest machine info, ensuring data freshness and state accuracy (especially for overdue detection)
    _refreshTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted) fetchMachineInfo();
    });
  }

  @override
  void dispose() {
    // when leaving the page, cancel all timers to prevent memory leaks and unintended state updates
    _refreshTimer?.cancel();
    _stopLocalCountdown();
    super.dispose();
  }

  // get machine info from backend, update all relevant states, and handle key logic for local countdown and overdue detection
  Future<void> fetchMachineInfo() async {
    try {
      final res = await http.get(Uri.parse("$baseUrl/getMachineInfo?mid=${widget.machineId}"));
      final map = jsonDecode(res.body);
      setState(() {
        remainTotalSec = map["remain_seconds"] ?? 0;
        reservedSec = map["reserved_remain_seconds"] ?? 0;
        pickupSec = map["pickup_remain_seconds"] ?? 0;
        aheadPeople = map["ahead_count"] ?? 0;
        machineStatus = map["machine_status"] ?? "occupied";
        washingStarted = remainTotalSec > 0;
        isPickupWindow = pickupSec > 0;
      });

      // if washing has started, kick off the local countdown timer to achieve smooth second-by-second decrement in the UI without waiting for backend polling; if washing hasn't started, ensure any existing local countdown is stopped to prevent stale timers
      if (washingStarted) {
        _startLocalCountdown();
      } else {
        _stopLocalCountdown();
      }

      // if machine is detected as overdue, immediately navigate to the overdue handling page to prompt user action, ensuring this critical state is addressed without delay
      if (machineStatus == "overdue" && mounted) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(builder: (context) => OverdueHandlingPage(machineId: widget.machineId)),
        );
      }
    } catch (e) {
      debugPrint("Failed to fetch machine info: $e");
    }
  }

  void _startLocalCountdown() {
    // ensure any existing local countdown timer is stopped before starting a new one, preventing multiple timers from running simultaneously which could cause state inconsistencies and memory leaks
    _stopLocalCountdown();
    // start a new timer that ticks every second, decrementing the remaining seconds and updating the UI accordingly; if the timer detects that the remaining seconds have reached zero, it stops itself and triggers a fresh fetch from the backend to confirm the machine's status and update the UI (especially important for transitioning to the pick-up window or detecting overdue state)
    _localCountdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        _stopLocalCountdown();
        return;
      }
      setState(() {
        if (remainTotalSec > 0) {
          remainTotalSec--;
        } else {
          // when local countdown reaches zero, stop the timer and fetch latest machine info from backend to confirm status (e.g., transition to pick-up window or detect overdue)
          _stopLocalCountdown();
          fetchMachineInfo();
        }
      });
    });
  }

  // a helper function to stop and nullify the local countdown timer, ensuring that we don't have multiple timers running simultaneously which could lead to memory leaks and inconsistent state updates; this function is called both when washing starts (to reset any existing timer) and when washing ends (to clean up the timer)
  void _stopLocalCountdown() {
    _localCountdownTimer?.cancel();
    _localCountdownTimer = null;
  }

  // clicking the "Start Washing" button will trigger this function, which sends a request to the backend to start the washing process; upon successful response, it fetches the latest machine info to update the UI (e.g., show the countdown timer); if there's an error during the request, it shows a snackbar with an error message; throughout the process, it manages a loading state to disable the button and show a loading indicator while the request is in progress
  Future<void> startWashing() async {
    setState(() => isLoading = true);
    try {
      final res = await http.post(
        Uri.parse("$baseUrl/api/machines/${widget.machineId}/start"),
        headers: {"Content-Type": "application/json"},
      );
      final map = jsonDecode(res.body);
      if (map["success"] == true) {
        await fetchMachineInfo();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Washing started! Timer is running."), backgroundColor: Colors.green),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Failed to start. Please try again."), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => isLoading = false);
    }
  }

  // clicking the "Collect Clothes" button will trigger this function, which sends a request to the backend to collect the laundry; upon successful response, it shows a snackbar and navigates back to the previous page; if there's an error during the request, it shows a snackbar with an error message; throughout the process, it manages a loading state to disable the button and show a loading indicator while the request is in progress
  Future<void> pickUpLaundry() async {
    setState(() => isLoading = true);
    try {
      final res = await http.post(
        Uri.parse("$baseUrl/api/machines/${widget.machineId}/pickup"),
        headers: {"Content-Type": "application/json"},
      );
      final map = jsonDecode(res.body);
      if (map["success"] == true && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Clothes collected! Machine is now available."), backgroundColor: Colors.green),
        );
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Failed. Please try again."), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => isLoading = false);
    }
  }

  String formatMMSS(int totalSec) {
    int min = totalSec ~/ 60;
    int sec = totalSec % 60;
    return "${min.toString().padLeft(2, '0')}:${sec.toString().padLeft(2, '0')}";
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color.fromARGB(255, 147, 187, 243),
        centerTitle: true,
        title: Text('Machine ${widget.machineId}'),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => Navigator.pop(context)),
      ),
      body: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const SizedBox(height: 60),

            // 1. pick-up window stage: show a prominent message with a call-to-action button to collect clothes, and disable the button while the pick-up request is in progress to prevent duplicate requests; this stage only appears when the backend indicates that the machine is in the pick-up window (i.e., washing has ended but clothes haven't been collected yet)
            if (isPickupWindow)
              Column(
                children: [
                  const Icon(Icons.check_circle_outline, size: 80, color: Colors.orange),
                  const SizedBox(height: 16),
                  const Text(
                    "Washing Done!",
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    "Please collect your clothes within 15 minutes.",
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 15, color: Colors.grey),
                  ),
                  const SizedBox(height: 32),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: isLoading ? null : pickUpLaundry,
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 18),
                        backgroundColor: Colors.green,
                      ),
                      child: isLoading
                          ? const CircularProgressIndicator(color: Colors.white, strokeWidth: 2)
                          : const Text("Pick Up ✓", style: TextStyle(fontSize: 18, color: Colors.white)),
                    ),
                  ),
                ],
              )

            // 2. washing in progress stage: show a large circular timer with the remaining time, and display the number of people ahead in the queue; this stage is only shown when the backend indicates that washing has started (i.e., remainTotalSec > 0), and it relies on both backend polling and local countdown to keep the timer accurate and responsive
            else if (washingStarted)
              Column(
                children: [
                  Transform.translate(
                    offset: const Offset(0, -60),
                    child: Align(
                      alignment: const Alignment(0, 0),
                      child: Container(
                        width: 270,
                        height: 270,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.blue, width: 7),
                      ),
                      child: Center(
                        child: Text(
                          formatMMSS(remainTotalSec),
                          style: const TextStyle(fontSize: 52, fontWeight: FontWeight.bold, color: Colors.black),
                        ),
                      ),
                    ),
                  )
                  ),
                  const SizedBox(height: 16),
                  Text(
                    "Waiting Ahead: $aheadPeople",
                    style: const TextStyle(fontSize: 19),
                  ),
                ],
              )

            // 3. reserved but not started stage: show a prompt to start washing, and disable the button while the start request is in progress to prevent duplicate requests; this stage appears when the backend indicates that the user has reserved the machine (i.e., reservedSec > 0) but washing hasn't started yet (i.e., remainTotalSec == 0), guiding the user to take action and ensuring a smooth transition to the washing stage once they hit start
            else if (reservedSec > 0)
              Column(
                children: [
                  const Icon(Icons.local_laundry_service, size: 100, color: Colors.blue),
                  const SizedBox(height: 24),
                  const Text(
                    "Ready to wash?",
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    "Press Start Washing when you load your clothes.",
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 15, color: Colors.grey),
                  ),
                  const SizedBox(height: 32),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: isLoading ? null : startWashing,
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 18),
                        backgroundColor: Colors.blue,
                      ),
                      child: isLoading
                          ? const CircularProgressIndicator(color: Colors.white, strokeWidth: 2)
                          : const Text("Start Washing", style: TextStyle(fontSize: 18, color: Colors.white)),
                    ),
                  ),
                ],
              ),
            const SizedBox(height: 40),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.grey.shade100,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Text(
                "Note: A 15-min pick-up window opens after each cycle ends. Please arrange your time properly.",
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class OverdueHandlingPage extends StatelessWidget {
  final String machineId;

  const OverdueHandlingPage({super.key, required this.machineId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color.fromARGB(255, 147, 187, 243),
        centerTitle: true,
        title: Text('Overdue Handling for $machineId'),
      ),
    );
  }
}
