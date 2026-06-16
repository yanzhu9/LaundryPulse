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
import 'package:intl/intl.dart';

enum MachineStatus {
  available,
  occupied,
  //gracePeriod,
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

// 后台 / app 关闭时收到 FCM 消息的处理器
// 必须是顶层函数并加 @pragma('vm:entry-point')，否则 release 模式会被裁剪
// Android 后台收到带 notification 字段的消息会自动在通知栏显示横幅，这里只记录日志
@pragma('vm:entry-point')
Future<void> _firebaseBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  print('[FCM] Background message: ${message.notification?.title}');
}

// 全局 key：用于在 FCM 回调（无 BuildContext）中显示横幅 / 执行导航
final GlobalKey<ScaffoldMessengerState> rootScaffoldMessengerKey =
    GlobalKey<ScaffoldMessengerState>();
final GlobalKey<NavigatorState> rootNavigatorKey =
    GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  // 注册后台消息处理器（必须在 runApp 之前）
  FirebaseMessaging.onBackgroundMessage(_firebaseBackgroundHandler);
  runApp(const MyApp());
}

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  @override
  void initState() {
    super.initState();
    _setupFcmListeners();
  }

  void _setupFcmListeners() {
    // 1. 前台收到通知：Android 前台不会自动弹通知栏，改用顶部横幅（SnackBar）提示
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      final n = message.notification;
      if (n != null) {
        rootScaffoldMessengerKey.currentState?.showSnackBar(
          SnackBar(
            content: Text('${n.title ?? ''}\n${n.body ?? ''}'.trim()),
            duration: const Duration(seconds: 4),
          ),
        );
      }
    });

    // 2. app 在后台时，用户点击通知栏横幅打开 app → 跳转处理
    FirebaseMessaging.onMessageOpenedApp.listen(_handleNotificationTap);

    // 3. app 完全关闭时，用户点击通知启动 app → 取出启动消息处理
    FirebaseMessaging.instance.getInitialMessage().then((message) {
      if (message != null) _handleNotificationTap(message);
    });
  }

  // 点击通知后的跳转：回到主页，用户可在此看到机器状态 / 评价弹窗
  void _handleNotificationTap(RemoteMessage message) {
    rootNavigatorKey.currentState?.pushNamedAndRemoveUntil('/home', (r) => false);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'LaundryPulse',
      navigatorKey: rootNavigatorKey,                    // 供 FCM 回调导航
      scaffoldMessengerKey: rootScaffoldMessengerKey,    // 供 FCM 回调显示横幅
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
  final res = await http.get(Uri.parse("https://laundrypulse-gf1v.onrender.com/machines"));
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
          //case "grace-period":
           // st = MachineStatus.gracePeriod;
            //break;
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
      //case MachineStatus.gracePeriod:
        //return Colors.orange.shade100;
      case MachineStatus.overdue:
        return Colors.red.shade100;
      case MachineStatus.outOfService:
        return Colors.grey.shade100;
    }
  }

   void _onMachineTap(LaundryMachine machine) async{
    if (machine.status == MachineStatus.occupied ) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (context) => RealTimeWaitTimePage(machineId: machine.id),
        ),
      );
    } else if (machine.status == MachineStatus.overdue) {
      final response = await http.get(Uri.parse('https://laundrypulse-gf1v.onrender.com/api/check-active-assistance?machine_id=${machine.id}'));
      final data = json.decode(response.body);
      if (data['has_active_assist']) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("This machine is already being assisted")),
        );
        return;
      }
      // if not being assisted, navigate to the overdue handling page to prompt user action
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
              //Row(
                //children: [
                  //Container(width:8, height:8, color: Colors.orange.shade100),
                  //SizedBox(width: 4,),
                  //Text("Grace Period"),
                //],
              //),
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

  String url = "https://laundrypulse-gf1v.onrender.com/api/queue-book";

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

  String url = "https://laundrypulse-gf1v.onrender.com/api/queue-book";

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
  String? email;
  int? creditScore;
  bool isLoading = true;
  int pendingReviewCount = 0;
  final String baseUrl = "https://laundrypulse-gf1v.onrender.com";

  @override
  void initState() {
    super.initState();
    fetchAllData();
  }

  // Fetch user profile and pending review count
  Future<void> fetchAllData() async {
    if (current_user_id == null || current_user_id!.isEmpty) {
      if (mounted) setState(() => isLoading = false);
      return;
    }

    try {
      // Get user profile info
      final profileRes = await http.get(
        Uri.parse("$baseUrl/api/user/${current_user_id}"),
      );
      final profileMap = jsonDecode(profileRes.body);

      // Get pending review records count
      final reviewRes = await http.get(
        Uri.parse("$baseUrl/api/get-pending-review-list?overdue_user_id=${current_user_id}"),
      );
      final reviewMap = jsonDecode(reviewRes.body);

      if (mounted) {
        setState(() {
          email = profileMap["email"];
          creditScore = profileMap["credit_score"];
          pendingReviewCount = reviewMap["success"] ? reviewMap["pending_list"].length : 0;
          isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => isLoading = false);
    }
  }

  Color _creditColor(int score) {
    if (score >= 15) return Colors.green;
    if (score >= 10) return Colors.orange;
    return Colors.red;
  }

  // New clickable entry for pending reviews, placed at bottom
  Widget buildReviewEntry() {
    return InkWell(
      onTap: () async {
        if (current_user_id == null) return;
        final res = await http.get(
          Uri.parse("$baseUrl/api/get-pending-review-list?overdue_user_id=${current_user_id}"),
        );
        final data = jsonDecode(res.body);
        if (data["success"] && mounted) {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => 
            PendingReviewPage(
              onReviewSubmitted: () => fetchAllData(),
            ),
        ),
      );
        }
      },
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 14),
        margin: const EdgeInsets.only(top: 24),
        decoration: BoxDecoration(
          color: Colors.grey.shade100,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              "Pending Assistance Records to Review",
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
            ),
            pendingReviewCount > 0
                ? Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: Colors.red,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      "$pendingReviewCount",
                      style: const TextStyle(color: Colors.white, fontSize: 12),
                    ),
                  )
                : const SizedBox.shrink(),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      child: isLoading
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(24),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    // Reduced top height to move content upward
                    const SizedBox(height: 20),
                    const CircleAvatar(
                      radius: 40,
                      backgroundColor: Color.fromARGB(255, 215, 230, 243),
                      child: Icon(Icons.person, size: 48, color: Colors.blueGrey),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      email ?? "Unknown",
                      style: const TextStyle(fontSize: 16, color: Colors.grey),
                    ),
                    const SizedBox(height: 32),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade50,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.grey.shade200),
                      ),
                      child: Column(
                        children: [
                          const Text("Credit Score", style: TextStyle(fontSize: 14, color: Colors.grey)),
                          const SizedBox(height: 8),
                          Text(
                            "${creditScore ?? 0}",
                            style: TextStyle(
                              fontSize: 48,
                              fontWeight: FontWeight.bold,
                              color: _creditColor(creditScore ?? 0),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            (creditScore ?? 0) >= 15
                                ? "✓ Eligible to join queue"
                                : "✗ Below threshold — cannot join queue",
                            style: TextStyle(
                              fontSize: 13,
                              color: (creditScore ?? 0) >= 15 ? Colors.green : Colors.red,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: Colors.blue.shade50,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text(
                        "💡 Help others by placing overdue clothes in lockers to earn +5 credits.\n"
                        "⚠️ Declining to help deducts -5 credits.",
                        style: TextStyle(fontSize: 13, color: Colors.blueGrey),
                      ),
                    ),
                    // New review entry at the bottom of original UI
                    buildReviewEntry(),
                  ],
                ),
              ),
            ),
    );
  }
}

const String baseUrl = "https://laundrypulse-gf1v.onrender.com";

class PendingReviewPage extends StatefulWidget {
  final VoidCallback onReviewSubmitted;
  const PendingReviewPage({
    super.key,
    required this.onReviewSubmitted,
  });

  @override
  State<PendingReviewPage> createState() => _PendingReviewPageState();
}

class _PendingReviewPageState extends State<PendingReviewPage> {
  bool isLoading = true;
  List<dynamic> pendingList = [];

  @override
  void initState() {
    super.initState();
    fetchPendingReviews();
  }

  // Fetch unreviewed records (assistance_status = unreview)
  Future<void> fetchPendingReviews() async {
    if (current_user_id == null || current_user_id!.isEmpty) {
      setState(() => isLoading = false);
      return;
    }
    try {
      final res = await http.get(
        Uri.parse("$baseUrl/api/get-pending-review-list?overdue_user_id=$current_user_id"),
      );
      final data = jsonDecode(res.body);
      if (data["success"] == true && mounted) {
        setState(() {
          pendingList = data["pending_list"];
          isLoading = false;
        });
      } else {
        setState(() => isLoading = false);
      }
    } catch (e) {
      debugPrint("Fetch pending list error: $e");
      if (mounted) setState(() => isLoading = false);
    }
  }

  // Format UTC time to local readable time
  String formatTime(String? rawTime) {
    if (rawTime == null || rawTime.isEmpty) return "Unknown Time";
    try {
      final dateTime = DateTime.parse(rawTime).toLocal();
      return DateFormat("yyyy-MM-dd HH:mm").format(dateTime);
    } catch (_) {
      return rawTime;
    }
  }

  // Show review dialog (Yes left, No right)
  void showReviewDialog(String recordId) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("Confirm Assistance Review"),
        content: const Text("Did the helper place items in the correct locker with complete belongings?"),
        actions: [
          ElevatedButton(
            onPressed: () => submitReview(recordId, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
            child: const Text("Yes (+5 Credits)"),
          ),
          TextButton(
            onPressed: () => submitReview(recordId, false),
            child: const Text("No (-5 Credits)", style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
  }

  Future<void> submitReview(String recordId, bool isPositive) async {
    if (mounted) Navigator.pop(context);

    try {
      final res = await http.post(
        Uri.parse("$baseUrl/api/submit-assistance-review"),
        headers: {"Content-Type": "application/json"},
        body: jsonEncode({
          "record_id": recordId,
          "overdue_user_id": current_user_id,
          "review_result": isPositive, 
        }),
      );
      final data = jsonDecode(res.body);

      if (data["success"] == true && mounted) {
        await fetchPendingReviews();    
        widget.onReviewSubmitted();     
      }
    } catch (e) {
      debugPrint("Submit review error: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Pending Reviews")),
      body: isLoading
          ? const Center(child: CircularProgressIndicator())
          : pendingList.isEmpty
              ? const Center(child: Text("No pending review records"))
              : ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: pendingList.length,
                  itemBuilder: (context, index) {
                    final record = pendingList[index];
                    final String formattedTime = formatTime(record["created_at"]);
                    final String machineId = record["machine_id"] ?? "Unknown Machine";

                    return Card(
                      elevation: 2,
                      margin: const EdgeInsets.only(bottom: 10),
                      child: ListTile(
                        onTap: () => showReviewDialog(record["record_id"]),
                        title: Text(
                          formattedTime,
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w500),
                        ),
                        subtitle: Text(
                          "Machine: $machineId",
                          style: const TextStyle(fontSize: 14, color: Colors.grey),
                        ),
                        trailing: const Icon(Icons.rate_review),
                      ),
                    );
                  },
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

  final String baseUrl = "https://laundrypulse-gf1v.onrender.com";

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
  // Triggered by the "Start Washing" button. For washers, first ask whether the user
  // wants a dryer auto-reserved after the wash finishes (optional auto dryer queue transfer);
  // dryers start directly without the prompt.
  Future<void> _onStartPressed() async {
    final bool isWasher = widget.machineId.startsWith('W');
    if (!isWasher) {
      await startWashing();
      return;
    }

    final bool? wantDryer = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text("Need a dryer after washing?"),
        content: const Text(
          "If you choose Yes, we will automatically reserve a dryer for you (or add you to the dryer queue) once your wash is done.",
        ),
        actions: [
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text("Yes, reserve a dryer"),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text("No, just wash"),
          ),
        ],
      ),
    );

    // User dismissed the dialog without choosing → do not start
    if (wantDryer == null) return;

    await startWashing(needsDryer: wantDryer);
  }

  Future<void> startWashing({bool needsDryer = false}) async {
    setState(() => isLoading = true);
    try {
      final res = await http.post(
        Uri.parse("$baseUrl/api/machines/${widget.machineId}/start"),
        headers: {"Content-Type": "application/json"},
        body: jsonEncode({"needs_dryer": needsDryer}),
      );
      final map = jsonDecode(res.body);
      if (map["success"] == true) {
        await fetchMachineInfo();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text("${widget.machineId.startsWith('W') ? 'Washing' : 'Drying'} started! Timer is running."), backgroundColor: Colors.green),
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
    final bool isWasher = widget.machineId.startsWith('W');
    final String actionVerb = isWasher ? "Wash" : "Dry";
    final String actionGerund = isWasher ? "Washing" : "Drying";
    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color.fromARGB(255, 147, 187, 243),
        centerTitle: true,
        title: Text('Machine ${widget.machineId}'),
        leading: IconButton(
        icon: const Icon(Icons.arrow_back),
        onPressed: () {
          Navigator.pushAndRemoveUntil(
            context,
            MaterialPageRoute(builder: (context) => const MyHomePage()),
            (route) => false,
          );
        },
      ),  
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
                  Text(
                    "Ready to ${actionVerb.toLowerCase()}?",
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "Press Start $actionGerund when you load your clothes.",
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 15, color: Colors.grey),
                  ),
                  const SizedBox(height: 32),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: isLoading ? null : _onStartPressed,
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 18),
                        backgroundColor: Colors.blue,
                      ),
                      child: isLoading
                          ? const CircularProgressIndicator(color: Colors.white, strokeWidth: 2)
                          : Text("Start $actionGerund", style: const TextStyle(fontSize: 18, color: Colors.white)),
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

class OverdueHandlingPage extends StatefulWidget {
  // Use camelCase for Dart naming convention to avoid linter warnings
  final String machineId;
  const OverdueHandlingPage({super.key, required this.machineId});

  @override
  State<OverdueHandlingPage> createState() => _OverdueHandlingPageState();
}

class _OverdueHandlingPageState extends State<OverdueHandlingPage> {
  final String baseUrl = "https://laundrypulse-gf1v.onrender.com";

  /// Navigate back to home page and remove all previous routes
  void _onNoPressed() {
    if (mounted) {
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (context) => const MyHomePage()),
        (route) => false,
      );
    }
  }

  /// Start the assistance process: check locker, get user info, create assist record
  Future<void> _onYesPressed() async {
    // Convert camelCase to snake_case for database/API field name
    final String machineIdForApi = widget.machineId;
    final String helperUserId = current_user_id ?? ""; // Use current_user_id directly, default to empty string if null

    if (helperUserId.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("User not logged in")),
        );
      }
      return;
    }

    try {
      // Step 1: Check available locker
      final lockerResponse = await http.get(Uri.parse("$baseUrl/get-available-locker"));
      final lockerData = json.decode(lockerResponse.body);

      // No available locker, return to home
      if (!lockerData['success']) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Locker is full, thank you for your kindness")),
          );
          Navigator.pushAndRemoveUntil(
            context,
            MaterialPageRoute(builder: (context) => const MyHomePage()),
            (route) => false,
          );
        }
        return;
      }
      final int lockerId = lockerData['locker_id'];

      // Step 2: Get overdue user id from machine info
      final machineResponse = await http.get(Uri.parse("$baseUrl/getMachineInfo?mid=$machineIdForApi"));
      final machineData = json.decode(machineResponse.body);
      final String overdueUserId = machineData["current_user_id"];

      // Step 3: Send request to start assistance timer
      final assistResponse = await http.post(
        Uri.parse("$baseUrl/api/start-assist-timer"),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          "overdue_user_id": overdueUserId,
          "helper_user_id": helperUserId,
          "machine_id": machineIdForApi
        })
      );
        
      final assistData = json.decode(assistResponse.body);
      if (assistData['success'] && mounted) {
        final String recordId = assistData['record_id'];
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => HelpToCollectPage(
              machineId: machineIdForApi,
              recordId: recordId,
              lockerId: lockerId,
            ),
          ),
        );
      }
    } catch (e) {
      debugPrint("Error in assistance flow: $e");
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Network error, please try again")),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: const Color.fromARGB(255, 147, 187, 243),
        centerTitle: true,
        title: Text('Overdue Handling for ${widget.machineId}'),
      ),
      body: Stack(
        children: [
          const SizedBox.expand(),
          SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 60),
            child: Container(
              width: double.infinity,
              constraints: const BoxConstraints(maxWidth: 480),
              margin: const EdgeInsets.only(top: 40),
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black12,
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    "You can help users who haven't picked up their laundry by placing it in the correct locker.",
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    "After placing the clothes in the assigned locker, you can continue using the machine.",
                    style: TextStyle(fontSize: 14, color: Colors.grey),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      "Operation Instructions:",
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    "1. The system will show you the machine number to collect laundry from.\n"
                    "2. Please put the clothes into the specific locker.",
                    style: TextStyle(fontSize: 13, color: Colors.grey),
                  ),
                  const SizedBox(height: 16),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      "Credit Score Rules:",
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Row(
                    children: [
                      Icon(Icons.check, color: Colors.green, size: 16),
                      SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          "If confirmed correct, +5 points",
                          style: TextStyle(fontSize: 13, color: Colors.grey),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  const Row(
                    children: [
                      Icon(Icons.close, color: Colors.red, size: 16),
                      SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          "If reported wrong or missing, -5 points",
                          style: TextStyle(fontSize: 13, color: Colors.grey),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  Row(
                    children: [
                      Expanded(
                        child: ElevatedButton(
                          onPressed: _onYesPressed,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.blue,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                          child: const Text("Yes"),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: _onNoPressed,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.grey.shade300,
                            foregroundColor: Colors.black,
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                          child: const Text("No"),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// Page for helper to confirm collection and reserve machine
class HelpToCollectPage extends StatefulWidget {
  // Use camelCase for Dart naming convention
  final String machineId;
  final String recordId;
  final int lockerId;

  const HelpToCollectPage({
    super.key,
    required this.machineId,
    required this.recordId,
    required this.lockerId,
  });

  @override
  State<HelpToCollectPage> createState() => _HelpToCollectPageState();
}

class _HelpToCollectPageState extends State<HelpToCollectPage> {
  final String baseUrl = "https://laundrypulse-gf1v.onrender.com";

  /// Submit helper's final choice to backend
  Future<void> _submitChoice(String choice) async {
    final String helperUserId = current_user_id ?? "";
    try {
      await http.post(
        Uri.parse("$baseUrl/api/submit-collect-choice"),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          "record_id": widget.recordId,
          "machine_id": widget.machineId,
          "choice": choice,
          "helper_user_id": helperUserId
        })
      );
    } catch (e) {
      debugPrint("Submit choice error: $e");
    }
  }

  /// Show confirmation dialog before submitting choice
  void _onHelpCollect() {
  showDialog(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text("Would you continue to use this machine?"),
      content: Text("Choosing Yes will reserve this machine. Please put clothes from ${widget.machineId}"),
      actions: [
        TextButton(
          onPressed: () async {
            Navigator.pop(dialogContext);

            await _submitChoice("yes");

            if (mounted) {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (context) => RealTimeWaitTimePage(machineId: widget.machineId)),
              );
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text("${widget.machineId} is now occupied, countdown started.")),
              );
            }
          },
          child: const Text("Yes"),
        ),
        TextButton(
          onPressed: () async {
            // 1. first close the dialog using its own context to ensure the dialog is dismissed before any state changes or navigation occurs, preventing potential issues with trying to update state or navigate while the dialog is still open
            Navigator.pop(dialogContext);

            // 2. then submit the choice to the backend to update the assistance record and machine status accordingly; this asynchronous operation will ensure that the helper's decision is recorded and the machine is set back to available for others to use
            await _submitChoice("no");

            // 3. finally, check if the page is still mounted before attempting to navigate back to the home page and show a snackbar; this is crucial to prevent trying to update state or navigate on a widget that has already been disposed, which could lead to errors; if the widget is still mounted, it will navigate back to the home page and show a confirmation message that the machine will be set to available again
            if (mounted) {
              Navigator.pushAndRemoveUntil(
                context,
                MaterialPageRoute(builder: (context) => const MyHomePage()),
                (route) => false,
              );
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text("Machine will be set to available")),
              );
            }
          },
          child: const Text("No"),
        ),
      ],
    ),
  );
}

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9FC),
      appBar: AppBar(
        backgroundColor: const Color(0xFF5A7D9A),
        centerTitle: true,
        title: const Text("Help to Collect", style: TextStyle(color: Colors.white)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 120),
        child: Container(
          width: double.infinity,
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.start,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text(
                "Put clothes from ${widget.machineId}\ninto Locker ${widget.lockerId}",
                style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600, color: Color(0xFF2C3E50)),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 50),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _onHelpCollect,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF4A90E2),
                    padding: const EdgeInsets.symmetric(vertical: 18),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text(
                    "Help To Collect",
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w500, color: Colors.white),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
