import 'package:flutter/material.dart';
import 'pages/login_page.dart';
import 'pages/register_page.dart';
import 'pages/welcome_page.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:async';
import 'pages/globals.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

enum MachineStatus {
  available,
  occupied,
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

Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
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

    fetchRealMachineData(); // Fetch real machine data from backend
    
    timer = Timer.periodic(const Duration(seconds: 5), (timer) {
      fetchRealMachineData();// Set up periodic timer to fetch real machine data every 5 seconds
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
  
  setState(() {
    machines = rawList.map((item){

      String statusStr = item["machine_status"];

      MachineStatus st;
      switch(statusStr){
        case "available":
          st = MachineStatus.available;
          break;
        case "occupied":
          st = MachineStatus.occupied;
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

      return LaundryMachine(
        id: item["machine_id"],
        status: st
      );

    }).toList();
  });
}

  Color _getStatusColor(MachineStatus status) {
    switch (status) {
      case MachineStatus.available:
        return Colors.green.shade100;
      case MachineStatus.occupied:
        return Colors.blue.shade100; 
      case MachineStatus.overdue:
        return Colors.red.shade100;   
      case MachineStatus.outOfService:
        return Colors.grey.shade100;
    }
  }

   void _onMachineTap(LaundryMachine machine) {
    if (machine.status == MachineStatus.occupied) {
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

  if(result["success"] == true){
    ScaffoldMessenger.of(context).showSnackBar(
       SnackBar(content: Text(result["message"]))
    );
  }
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

class RealTimeWaitTimePage extends StatelessWidget {
  final String machineId;

  const RealTimeWaitTimePage({super.key, required this.machineId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color.fromARGB(255, 147, 187, 243),
        centerTitle: true,
        title: Text('Wait Time for $machineId'),
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
