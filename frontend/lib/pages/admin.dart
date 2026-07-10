import 'package:flutter/material.dart';
import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

enum MachineStatus {
  available,
  occupied,
  overdue,
  outOfService,
}

enum LockerStatus {
  available,
  occupied,
  outOfService,
}

class Machine {
  final String machineId;
  final MachineStatus status;
  Machine({required this.machineId, required this.status});
}

class Locker {
  final int lockerId;
  final LockerStatus status;
  Locker({required this.lockerId, required this.status});
}

class Admin extends StatefulWidget {
  const Admin({super.key});

  @override
  State<Admin> createState() => _AdminState();
}

class _AdminState extends State<Admin> {
  int currentTabIndex = 0;

  final List<Widget> tabPages = const [
    _MachineTabView(),
    _LockerTabView(),
    _FaultReportTabView(),
    _UsageTabView(),
  ];

  final List<String> tabTitles = ["Machine", "Locker", "Fault Report", "Usage"];

  // navigate to the Setting page when the settings icon is pressed
  void openSettingPage() {
    Navigator.pushNamed(context, "/admin-setting");
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        centerTitle: true,
        title: Text(tabTitles[currentTabIndex]),
        // only show the settings icon when the current tab is Machine (index 0)
        actions: currentTabIndex == 3
            ? [
                IconButton(
                  icon: const Icon(Icons.settings_outlined),
                  onPressed: openSettingPage,
                )
              ]
            : null,
        // AppBar bottom line, color and height same as your HomePage
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(1),
          child: Divider(height: 1, color: Color.fromARGB(255, 223, 222, 222)),
        ),
      ),
      body: tabPages[currentTabIndex],
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: currentTabIndex,
        onTap: (idx) => setState(() => currentTabIndex = idx),
        type: BottomNavigationBarType.fixed,
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.local_laundry_service), label: "Machine"),
          BottomNavigationBarItem(icon: Icon(Icons.storage), label: "Locker"),
          BottomNavigationBarItem(icon: Icon(Icons.report), label: "Fault Report"),
          BottomNavigationBarItem(icon: Icon(Icons.bar_chart), label: "Usage"),
        ],
      ),
    );
  }
}

// Machine Tab
class _MachineTabView extends StatefulWidget {
  const _MachineTabView();

  @override
  State<_MachineTabView> createState() => __MachineTabViewState();
}

class __MachineTabViewState extends State<_MachineTabView> {
  List<Machine> machineList = [];
  Timer? refreshTimer;
  static const String machineApi = "https://laundrypulse-gf1v.onrender.com/machines";

  Color getMachineBg(MachineStatus status) {
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

  Widget buildStatusLegend() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        Row(
          children: [
            Container(width: 8, height: 8, color: Colors.green.shade100),
            const SizedBox(width: 4),
            const Text("Available"),
          ],
        ),
        Row(
          children: [
            Container(width: 8, height: 8, color: Colors.blue.shade100),
            const SizedBox(width: 4),
            const Text("Occupied"),
          ],
        ),
        Row(
          children: [
            Container(width: 8, height: 8, color: Colors.red.shade100),
            const SizedBox(width: 4),
            const Text("Overdue"),
          ],
        ),
        Row(
          children: [
            Container(width: 8, height: 8, color: Colors.grey.shade100),
            const SizedBox(width: 4),
            const Text("Out of Service"),
          ],
        ),
      ],
    );
  }

  Widget buildMachineCard(Machine m) {
  final bool isOutOfService = m.status == MachineStatus.outOfService;
  return GestureDetector(
    onTap: () async {
      // if the machine is out of service, show a restore confirmation dialog
      if (isOutOfService) {
        final bool? confirm = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text("Restore Machine"),
            content: Text("Confirm to restore machine ${m.machineId} to available."),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text("Confirm Restore"),
              ),
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text("Cancel"),
              ),
            ],
          ),
        );
        if (confirm == true) {
          try {
            await callManualMachineRestoreApi(m.machineId);
            await fetchMachineData();
          } catch (err) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(err.toString())),
              );
            }
          }
        }
      }
      // if the machine is not out of service, show a shutdown confirmation dialog
      else {
        final bool? confirm = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text("Device Shutdown"),
            content: Text("Confirm to mark machine ${m.machineId} as outOfService. All users will receive push notifications."),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text("Confirm Shutdown"),
              ),
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text("Cancel"),
              ),
            ],
          ),
        );
        if (confirm == true) {
          try {
            await callManualMachineStopApi(m.machineId);
            await fetchMachineData();
          } catch (err) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(err.toString())),
              );
            }
          }
        }
      }
    },
    child: Container(
      decoration: BoxDecoration(
        color: getMachineBg(m.status),
        borderRadius: BorderRadius.circular(12),
        border: m.status == MachineStatus.overdue
            ? Border.all(color: Colors.red, width: 2)
            : null,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            m.machineId,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    ),
  );
}

Future<void> callManualMachineStopApi(String machineId) async {
  try {
    final response = await http.post(
      Uri.parse("https://laundrypulse.onrender.com/admin/machine/manualSetOutOfService"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({"machineId": machineId}),
    );
    final resBody = jsonDecode(response.body);
    if (response.statusCode != 200) {
      throw Exception(resBody["message"]);
    }
  } catch (e) {
    rethrow; 
  }
}

Future<void> callManualMachineRestoreApi(String machineId) async {
  final response = await http.post(
    Uri.parse("https://laundrypulse.onrender.com/admin/machine/manualRestoreToAvailable"),
    headers: {"Content-Type": "application/json"},
    body: jsonEncode({"machineId": machineId}),
  );
  final resBody = jsonDecode(response.body);
  if (response.statusCode != 200) {
    throw Exception(resBody["message"]);
  }
}

  Future<void> fetchMachineData() async {
    try {
      final res = await http.get(Uri.parse(machineApi));
      if (res.statusCode == 200) {
        List raw = jsonDecode(res.body);
        raw.sort((a, b) => a["machine_id"].compareTo(b["machine_id"]));
        List<Machine> temp = raw.map((item) {
          MachineStatus st;
          switch (item["machine_status"]) {
            case "available":
              st = MachineStatus.available;
              break;
            case "occupied":
              st = MachineStatus.occupied;
              break;
            case "overdue":
              st = MachineStatus.overdue;
              break;
            default:
              st = MachineStatus.outOfService;
          }
          return Machine(machineId: item["machine_id"], status: st);
        }).toList();
        if (mounted) setState(() => machineList = temp);
      }
    } catch (e) {
      debugPrint("Machine fetch error: $e");
    }
  }

  @override
  void initState() {
    super.initState();
    fetchMachineData();
    refreshTimer = Timer.periodic(const Duration(seconds: 5), (_) => fetchMachineData());
  }

  @override
  void dispose() {
    refreshTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            buildStatusLegend(),
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
              itemCount: machineList.length,
              itemBuilder: (context, index) {
                final machine = machineList[index];
                return buildMachineCard(machine);
              },
            ),
          ],
        ),
      ),
    );
  }
}

// Locker Tab
class _LockerTabView extends StatefulWidget {
  const _LockerTabView();

  @override
  State<_LockerTabView> createState() => __LockerTabViewState();
}

class __LockerTabViewState extends State<_LockerTabView> {
  List<Locker> lockerList = [];
  Timer? refreshTimer;
  static const String lockerApi = "https://laundrypulse-gf1v.onrender.com/api/admin/lockers";

  Color getLockerBg(LockerStatus status) {
    switch (status) {
      case LockerStatus.available:
        return Colors.green.shade100;
      case LockerStatus.occupied:
        return Colors.blue.shade100;
      case LockerStatus.outOfService:
        return Colors.grey.shade100;
    }
  }

  Widget buildStatusLegend() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        Row(
          children: [
            Container(width: 8, height: 8, color: Colors.green.shade100),
            const SizedBox(width: 4),
            const Text("Available"),
          ],
        ),
        Row(
          children: [
            Container(width: 8, height: 8, color: Colors.blue.shade100),
            const SizedBox(width: 4),
            const Text("Occupied"),
          ],
        ),
        Row(
          children: [
            Container(width: 8, height: 8, color: Colors.grey.shade100),
            const SizedBox(width: 4),
            const Text("Out of Service"),
          ],
        ),
      ],
    );
  }

  Widget buildLockerCard(Locker l) {
  final bool isOutOfService = l.status == LockerStatus.outOfService;
  return GestureDetector(
    onTap: () async {
      // if the locker is out of service, show a restore confirmation dialog
      if (isOutOfService) {
        final bool? confirm = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text("Restore Locker"),
            content: Text("Confirm to restore locker ${l.lockerId} to available."),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text("Confirm Restore"),
              ),
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text("Cancel"),
              ),
            ],
          ),
        );
        if (confirm == true) {
          try {
            await callManualLockerRestoreApi(l.lockerId);
            await fetchLockerData();
          } catch (err) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(err.toString())),
              );
            }
          }
        }
      }
      // if the locker is not out of service, show a shutdown confirmation dialog
      else {
        final bool? confirm = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text("Locker Shutdown"),
            content: Text("Confirm to mark locker ${l.lockerId} as outOfService. All users will receive push notifications."),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text("Confirm Shutdown"),
              ),
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text("Cancel"),
              ),
            ],
          ),
        );
        if (confirm == true) {
          try {
            await callManualLockerStopApi(l.lockerId);
            await fetchLockerData();
          } catch (err) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(err.toString())),
              );
            }
          }
        }
      }
    },
    child: Container(
      decoration: BoxDecoration(
        color: getLockerBg(l.status),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            l.lockerId.toString(),
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    ),
  );
}

  Future<void> callManualLockerStopApi(int lockerId) async {
  try {
    final response = await http.post(
      Uri.parse("https://laundrypulse.onrender.com/admin/locker/manualSetOutOfService"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({"lockerId": lockerId}),
    );
    final resBody = jsonDecode(response.body);
    if (response.statusCode != 200) {
      throw Exception(resBody["message"]);
    }
  } catch (e) {
    rethrow;
  }
  }

  Future<void> callManualLockerRestoreApi(int lockerId) async {
  final response = await http.post(
    Uri.parse("https://laundrypulse.onrender.com/admin/locker/manualRestoreToAvailable"),
    headers: {"Content-Type": "application/json"},
    body: jsonEncode({"lockerId": lockerId}),
  );
  final resBody = jsonDecode(response.body);
  if (response.statusCode != 200) {
    throw Exception(resBody["message"]);
  }
}

  Future<void> fetchLockerData() async {
    try {
      final res = await http.get(Uri.parse(lockerApi));
      if (res.statusCode == 200) {
        List raw = jsonDecode(res.body);
        raw.sort((a, b) => a["locker_id"].compareTo(b["locker_id"]));
        List<Locker> temp = raw.map((item) {
          LockerStatus st;
          switch (item["locker_status"]) {
            case "available":
              st = LockerStatus.available;
              break;
            case "occupied":
              st = LockerStatus.occupied;
              break;
            default:
              st = LockerStatus.outOfService;
          }
          return Locker(lockerId: item["locker_id"], status: st);
        }).toList();
        if (mounted) setState(() => lockerList = temp);
      }
    } catch (e) {
      debugPrint("Locker fetch error: $e");
    }
  }


  @override
  void initState() {
    super.initState();
    fetchLockerData();
    refreshTimer = Timer.periodic(const Duration(seconds: 5), (_) => fetchLockerData());
  }

  @override
  void dispose() {
    refreshTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            buildStatusLegend(),
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
              itemCount: lockerList.length,
              itemBuilder: (context, index) {
                final locker = lockerList[index];
                return buildLockerCard(locker);
              },
            ),
          ],
        ),
      ),
    );
  }
}

class FaultRecordItem {
  final String recordId;
  final String facilityType;
  final String facilityNumber;
  final String faultDescription;
  final String reportedAt;
  final String reportStatus;

  FaultRecordItem({
    required this.recordId,
    required this.facilityType,
    required this.facilityNumber,
    required this.faultDescription,
    required this.reportedAt,
    required this.reportStatus,
  });

  factory FaultRecordItem.fromJson(Map<String, dynamic> json) {
    return FaultRecordItem(
      recordId: json["record_id"] ?? "",
      facilityType: json["facility_type"] ?? "",
      facilityNumber: json["facility_number"] ?? "",
      faultDescription: json["fault_description"] ?? "No fault description",
      reportedAt: json["reported_at"] ?? "",
      reportStatus: json["report_status"] ?? "pending",
    );
  }
}

// Fault Report Tab 
class _FaultReportTabView extends StatefulWidget {
  const _FaultReportTabView();

  @override
  State<_FaultReportTabView> createState() => __FaultReportTabViewState();
}

class __FaultReportTabViewState extends State<_FaultReportTabView> {
  bool isLoading = true;
  bool isSubmitting = false;
  List<FaultRecordItem> faultList = [];

  @override
  void initState() {
    super.initState();
    fetchAllFaultRecords();
  }

  // 获取待修复故障列表
  Future<void> fetchAllFaultRecords() async {
    try {
      final res = await http
          .get(Uri.parse("https://laundrypulse.onrender.com/api/get-all-fault-list"))
          .timeout(const Duration(seconds: 8));
      final data = jsonDecode(res.body);

      if (data["success"] == true && mounted) {
        final List rawList = data["fault_list"] ?? [];
        setState(() {
          faultList = rawList.map((item) => FaultRecordItem.fromJson(item)).toList();
          isLoading = false;
        });
      } else {
        setState(() => isLoading = false);
      }
    } catch (e) {
      debugPrint("Fetch fault list error: $e");
      if (mounted) setState(() => isLoading = false);
    }
  }

  // open dialog to show fault details and allow marking as fixed
  void openFaultDetailDialog(FaultRecordItem faultItem) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (dialogCtx) => AlertDialog(
        title: Text("${faultItem.facilityType.toUpperCase()} ${faultItem.facilityNumber}"),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                "Fault Description:",
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
              ),
              const SizedBox(height: 6),
              Text(faultItem.faultDescription),
            ],
          ),
        ),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
            onPressed: isSubmitting ? null : () => markFaultAsFixed(faultItem, dialogCtx),
            child: const Text("Mark Fixed"),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogCtx),
            child: const Text("Unfixed", style: TextStyle(color: Colors.grey)),
          ),
        ],
      ),
    );
  }

  // mark a fault as fixed by sending a POST request to the backend
  Future<void> markFaultAsFixed(FaultRecordItem fault, BuildContext dialogContext) async {
    if (isSubmitting || !mounted) return;
    setState(() => isSubmitting = true);
    Navigator.pop(dialogContext);

    try {
      final res = await http
          .post(
            Uri.parse("https://laundrypulse.onrender.com/api/mark-fault-fixed"),
            headers: {"Content-Type": "application/json"},
            body: jsonEncode({
              "record_id": fault.recordId,
              "facility_type": fault.facilityType,
              "facility_number": fault.facilityNumber,
            }),
          )
          .timeout(const Duration(seconds: 10));

      final respData = jsonDecode(res.body);
      if (respData["success"] == true && mounted) {
        setState(() {
          faultList.removeWhere((item) => item.recordId == fault.recordId);
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Marked as fixed successfully")),
        );
      } else {
        throw Exception(respData["msg"] ?? "Request failed");
      }
    } catch (e) {
      debugPrint("Mark fixed error: $e");
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Failed to mark facility as fixed")),
        );
      }
    } finally {
      if (mounted) setState(() => isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: isLoading
          ? const Center(child: CircularProgressIndicator())
          : faultList.isEmpty
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text("No pending fault records"),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: faultList.length,
                  itemBuilder: (ctx, index) {
                    final FaultRecordItem fault = faultList[index];
                    return Card(
                      elevation: 2,
                      margin: const EdgeInsets.only(bottom: 10),
                      child: ListTile(
                        onTap: () => openFaultDetailDialog(fault),
                        title: Text(
                          "${fault.facilityType.toUpperCase()}  ${fault.facilityNumber}",
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w500),
                        ),
                        trailing: const Icon(Icons.arrow_forward_ios, size: 16, color: Colors.grey),
                      ),
                    );
                  },
                ),
    );
  }
}

class DailyLoadItem {
  final String weekDay;
  final double avgLoad;
  DailyLoadItem({required this.weekDay, required this.avgLoad});
}

class TimeSlotItem {
  final String timeRange;
  final double avgLoad;
  TimeSlotItem({required this.timeRange, required this.avgLoad});
}

class MachineUtilItem {
  final String machineType;
  final double utilRate; 
  MachineUtilItem({required this.machineType, required this.utilRate});

  String get displayName => machineType == "washer" ? "Washing Machine" : "Dryer";
}

// Usage Tab
class _UsageTabView extends StatefulWidget {
  const _UsageTabView();

  @override
  State<_UsageTabView> createState() => __UsageTabViewState();
}

class __UsageTabViewState extends State<_UsageTabView> {
  bool dailyExpanded = false;
  bool slotExpanded = false;
  bool _loading = false;
  bool _hasLoadedBackendData = false;

  List<DailyLoadItem> dailyData = [];
  List<TimeSlotItem> slotData = [];
  List<MachineUtilItem> machineUtilData = [];
  String dataUpdateDate = "Loading stats...";

  late List<DailyLoadItem> sortedDaily = [];
  late List<TimeSlotItem> sortedSlot = [];

  DailyLoadItem? get peakDaily => dailyData.isEmpty
      ? null
      : dailyData.reduce((a, b) => a.avgLoad > b.avgLoad ? a : b);

  TimeSlotItem? get peakSlot => slotData.isEmpty
      ? null
      : slotData.reduce((a, b) => a.avgLoad > b.avgLoad ? a : b);

  MachineUtilItem? get peakMachine => machineUtilData.isEmpty
      ? null
      : machineUtilData.reduce((a, b) => a.utilRate > b.utilRate ? a : b);

  Color getBarColor(double ratio) {
    double alpha = 0.2 + ratio * 0.8;
    return const Color(0xFF1976D2).withOpacity(alpha);
  }

  static const Color washerLightBlue = Color(0xFF64B5F6);
  static const Color dryerDarkBlue = Color(0xFF0D47A1);

  Widget buildDailyBar(DailyLoadItem item, double maxValue) {
    final double loadRatio = item.avgLoad / maxValue;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Expanded(
            child: SizedBox(
              width: double.infinity,
              child: FractionallySizedBox(
                alignment: Alignment.centerLeft,
                widthFactor: loadRatio,
                child: Container(
                  height: 26,
                  clipBehavior: Clip.none,
                  decoration: BoxDecoration(
                    color: getBarColor(loadRatio),
                    borderRadius: BorderRadius.circular(5),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.only(left: 10),
                    child: Text(
                      item.weekDay,
                      softWrap: false,
                      style: const TextStyle(
                        color: Colors.black87,
                        fontWeight: FontWeight.w500,
                        fontSize: 13,
                        overflow: TextOverflow.visible,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
        ],
      ),
    );
  }

  Widget buildSlotBar(TimeSlotItem item, double maxValue) {
    final double loadRatio = item.avgLoad / maxValue;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Expanded(
            child: SizedBox(
              width: double.infinity,
              child: FractionallySizedBox(
                alignment: Alignment.centerLeft,
                widthFactor: loadRatio,
                child: Container(
                  height: 26,
                  clipBehavior: Clip.none,
                  decoration: BoxDecoration(
                    color: getBarColor(loadRatio),
                    borderRadius: BorderRadius.circular(5),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.only(left: 10),
                    child: Text(
                      item.timeRange,
                      softWrap: false,
                      style: const TextStyle(
                        color: Colors.black87,
                        fontWeight: FontWeight.w500,
                        fontSize: 13,
                        overflow: TextOverflow.visible,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
        ],
      ),
    );
  }

  Widget buildMachineUtilCompareBar() {
  final washer = machineUtilData.firstWhere(
    (m) => m.machineType == "washer",
    orElse: () => MachineUtilItem(machineType: "washer", utilRate: 0),
  );
  final dryer = machineUtilData.firstWhere(
    (m) => m.machineType == "dryer",
    orElse: () => MachineUtilItem(machineType: "dryer", utilRate: 0),
  );

  final double washerPct = washer.utilRate;
  final double dryerPct = dryer.utilRate;

  return Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: SizedBox(
      height: 26,
      width: double.infinity, 
      child: Row(
        children: [
          Container(
            width: MediaQuery.of(context).size.width * (washerPct / 100),
            height: 26,
            decoration: const BoxDecoration(
              color: washerLightBlue,
              borderRadius: BorderRadius.horizontal(left: Radius.circular(5)),
            ),
            child: Center(
              child: Text(
                "Washer $washerPct%",
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w500,
                  fontSize: 12,
                ),
              ),
            ),
          ),
          Expanded(
            child: Container(
              height: 26,
              decoration: const BoxDecoration(
                color: dryerDarkBlue,
                borderRadius: BorderRadius.horizontal(right: Radius.circular(5)),
              ),
              child: Center(
                child: Text(
                  "Dryer $dryerPct%",
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w500,
                    fontSize: 12,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

  Future<void> fetchHeatmapData() async {
    if (_loading) return;
    _loading = true;
    try {
      final uri = Uri.parse("https://laundrypulse-gf1v.onrender.com/api/usage-heatmap-stats");
      final res = await http.get(uri);

      if (res.statusCode != 200) throw Exception("API Code: ${res.statusCode}");

      final rawJson = jsonDecode(res.body);
      final String refreshDate = rawJson["updateCutoffDate"] ?? DateTime.now().toString().split(" ")[0];
      final List<dynamic> rawDaily = rawJson["dailyStats"] ?? [];
      final List<dynamic> rawSlot = rawJson["twoHourSlotStats"] ?? [];
      final List<dynamic> rawMachineUtil = rawJson["machineUtilStats"] ?? [];

      if (!mounted) return;
      setState(() {
        dataUpdateDate = refreshDate;
        dailyData = rawDaily
            .map((e) => DailyLoadItem(weekDay: e["weekDay"] ?? "", avgLoad: (e["avgLoad"] ?? 0).toDouble()))
            .toList();
        slotData = rawSlot
            .map((e) => TimeSlotItem(timeRange: e["timeRange"] ?? "", avgLoad: (e["avgLoad"] ?? 0).toDouble()))
            .toList();
        machineUtilData = rawMachineUtil
            .map((e) => MachineUtilItem(machineType: e["machineType"] ?? "", utilRate: (e["utilRate"] ?? 0).toDouble()))
            .toList();

        sortedDaily = List.from(dailyData)..sort((a, b) => b.avgLoad.compareTo(a.avgLoad));
        sortedSlot = List.from(slotData)..sort((a, b) => b.avgLoad.compareTo(a.avgLoad));
        _hasLoadedBackendData = true;
      });
    } catch (err) {
      debugPrint("Fetch stats error: $err");
      if (!mounted) return;
      if (_hasLoadedBackendData) return;

      setState(() {
        dataUpdateDate = "Offline Preview (Weekly stats unavailable)";
        dailyData = [
          DailyLoadItem(weekDay: "Monday", avgLoad: 4.2),
          DailyLoadItem(weekDay: "Tuesday", avgLoad: 3.1),
          DailyLoadItem(weekDay: "Wednesday", avgLoad: 5.0),
          DailyLoadItem(weekDay: "Thursday", avgLoad: 2.8),
          DailyLoadItem(weekDay: "Friday", avgLoad: 6.7),
          DailyLoadItem(weekDay: "Saturday", avgLoad: 3.5),
          DailyLoadItem(weekDay: "Sunday", avgLoad: 2.2),
        ];
        slotData = [
          TimeSlotItem(timeRange: "00:00-02:00", avgLoad: 1.1),
          TimeSlotItem(timeRange: "02:00-04:00", avgLoad: 0.4),
          TimeSlotItem(timeRange: "04:00-06:00", avgLoad: 0.3),
          TimeSlotItem(timeRange: "06:00-08:00", avgLoad: 2.1),
          TimeSlotItem(timeRange: "08:00-10:00", avgLoad: 4.8),
          TimeSlotItem(timeRange: "10:00-12:00", avgLoad: 3.2),
          TimeSlotItem(timeRange: "12:00-14:00", avgLoad: 2.3),
          TimeSlotItem(timeRange: "14:00-16:00", avgLoad: 2.7),
          TimeSlotItem(timeRange: "16:00-18:00", avgLoad: 4.1),
          TimeSlotItem(timeRange: "18:00-20:00", avgLoad: 6.2),
          TimeSlotItem(timeRange: "20:00-22:00", avgLoad: 3.6),
          TimeSlotItem(timeRange: "22:00-00:00", avgLoad: 1.5),
        ];
        machineUtilData = [
          MachineUtilItem(machineType: "washer", utilRate: 62.4),
          MachineUtilItem(machineType: "dryer", utilRate: 37.6),
        ];

        sortedDaily = List.from(dailyData)..sort((a, b) => b.avgLoad.compareTo(a.avgLoad));
        sortedSlot = List.from(slotData)..sort((a, b) => b.avgLoad.compareTo(a.avgLoad));
      });
    } finally {
      _loading = false;
    }
  }

  @override
  void initState() {
    super.initState();
    fetchHeatmapData();
  }

  @override
  Widget build(BuildContext context) {
    final List<DailyLoadItem> displayDaily = dailyExpanded ? sortedDaily : sortedDaily.take(3).toList();
    final List<TimeSlotItem> displaySlot = slotExpanded ? sortedSlot : sortedSlot.take(4).toList();

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            "Data updated weekly, statistics up to $dataUpdateDate",
            style: TextStyle(color: Colors.grey[600], fontSize: 13),
          ),
          const SizedBox(height: 28),

          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              border: Border.all(color: Colors.grey.shade300),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text("Average Daily Loads", style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                    if (peakDaily != null)
                      Text("Peak: ${peakDaily!.weekDay}", style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF1565C0))),
                  ],
                ),
                const SizedBox(height: 14),
                dailyData.isEmpty
                    ? const Center(child: Text("No booking records before last Sunday"))
                    : Column(
                        children: [
                          ...displayDaily.map((item) => buildDailyBar(item, sortedDaily.first.avgLoad)),
                          const SizedBox(height: 10),
                          InkWell(
                            onTap: () => setState(() => dailyExpanded = !dailyExpanded),
                            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                              Text(dailyExpanded ? "Show Less" : "Show More"),
                              Icon(dailyExpanded ? Icons.arrow_drop_up : Icons.arrow_drop_down)
                            ]),
                          )
                        ],
                      )
              ],
            ),
          ),

          const SizedBox(height: 22),

          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              border: Border.all(color: Colors.grey.shade300),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text("Average Loads per 2-hour Slot", style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                    if (peakSlot != null)
                      Text("Peak: ${peakSlot!.timeRange}", style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF1565C0))),
                  ],
                ),
                const SizedBox(height: 14),
                slotData.isEmpty
                    ? const Center(child: Text("No booking records before last Sunday"))
                    : Column(
                        children: [
                          ...displaySlot.map((item) => buildSlotBar(item, sortedSlot.first.avgLoad)),
                          const SizedBox(height: 10),
                          InkWell(
                            onTap: () => setState(() => slotExpanded = !slotExpanded),
                            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                              Text(slotExpanded ? "Show Less" : "Show More"),
                              Icon(slotExpanded ? Icons.arrow_drop_up : Icons.arrow_drop_down)
                            ]),
                          )
                        ],
                      )
              ],
            ),
          ),

          const SizedBox(height: 22),

          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              border: Border.all(color: Colors.grey.shade300),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text("Washer & Dryer Usage", style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                    if (peakMachine != null)
                      Text("Higher Usage: ${peakMachine!.displayName}", style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF1565C0))),
                  ],
                ),
                const SizedBox(height: 14),
                machineUtilData.isEmpty
                    ? const Center(child: Text("No machine usage minute records available"))
                    : buildMachineUtilCompareBar()
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// Admin Setting Page
class AdminSettingPage extends StatefulWidget {
  const AdminSettingPage({super.key});

  @override
  State<AdminSettingPage> createState() => _AdminSettingPageState();
}

class PeakTimeSlotItem {
  final String title;
  final int start;
  final int end;
  PeakTimeSlotItem(this.title, this.start, this.end);
}

class _AdminSettingPageState extends State<AdminSettingPage> {
  final List<String> weekList = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  final List<PeakTimeSlotItem> timeSlotList = [
    PeakTimeSlotItem("00:00-02:00", 0, 2),
    PeakTimeSlotItem("02:00-04:00", 2, 4),
    PeakTimeSlotItem("04:00-06:00", 4, 6),
    PeakTimeSlotItem("06:00-08:00", 6, 8),
    PeakTimeSlotItem("08:00-10:00", 8, 10),
    PeakTimeSlotItem("10:00-12:00", 10, 12),
    PeakTimeSlotItem("12:00-14:00", 12, 14),
    PeakTimeSlotItem("14:00-16:00", 14, 16),
    PeakTimeSlotItem("16:00-18:00", 16, 18),
    PeakTimeSlotItem("18:00-20:00", 18, 20),
    PeakTimeSlotItem("20:00-22:00", 20, 22),
    PeakTimeSlotItem("22:00-24:00", 22, 24),
  ];

  int selectedWeekIndex = -1;
  int selectedTimeIndex = -1;

  final TextEditingController washerMaxCtrl = TextEditingController();
  final TextEditingController dryerMaxCtrl = TextEditingController();

  @override
  void dispose() {
    washerMaxCtrl.dispose();
    dryerMaxCtrl.dispose();
    super.dispose();
  }

  Future<void> handleSubmit() async {
    // 1.check if both dropdowns have selections
    if (selectedWeekIndex == -1 || selectedTimeIndex == -1) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Please complete all selections.")));
      }
      return;
    }
    // 2.check if both input fields are filled
    if (washerMaxCtrl.text.isEmpty || dryerMaxCtrl.text.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Please fill in queue limit numbers.")));
      }
      return;
    }
    // 3.check if both input fields are positive integers
    final int washerMax = int.parse(washerMaxCtrl.text);
    final int dryerMax = int.parse(dryerMaxCtrl.text);
    if (washerMax <= 0 || dryerMax <= 0) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Queue limit cannot be zero or negative.")));
      }
      return;
    }

    final weekDay = selectedWeekIndex + 1;
    final startHour = timeSlotList[selectedTimeIndex].start;
    final endHour = timeSlotList[selectedTimeIndex].end;

    String url = "https://laundrypulse-gf1v.onrender.com/api/admin/peak-setting";
    final res = await http.post(
      Uri.parse(url),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({
        "week_day": weekDay,
        "start_hour": startHour,
        "end_hour": endHour,
        "washer_max": washerMax,
        "dryer_max": dryerMax,
      }),
    );
    var result = jsonDecode(res.body);
    if (!mounted) return;

    // Case 1: New time slot, show confirmation dialog before inserting
    if (result["action"] == "insert") {
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text("Confirm Peak-Hour Rules"),
          content: const Text(
            "After enabling peak-hour restrictions:\n\n1. Users cannot queue again until their ongoing laundry is finished.\n2. Queue will stop accepting new users once reaching the maximum number.",
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(ctx);
                washerMaxCtrl.clear();
                dryerMaxCtrl.clear();
                setState(() {
                  selectedWeekIndex = -1;
                  selectedTimeIndex = -1;
                });
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text("Peak-hour setting saved successfully."),
                  ),
                );
              },
              child: const Text("Yes"),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text("No"),
            ),
          ],
        ),
      );
    }
    // Case 2: Time slot already exists, limits are the same, show confirmation
    else if (result["action"] == "same") {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(result["message"])));
    }
    // Case 3: Time slot already exists, limits are different, show update confirmation dialog
    else if (result["action"] == "update") {
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text("Update Peak-Hour Limit"),
          content: Text(
            "This time slot already exists.\n\n"
            "Original Washer limit: ${result["oldWasher"]}\n"
            "Original Dryer limit: ${result["oldDryer"]}\n\n"
            "Confirm to update to new limits?"
          ),
          actions: [
            TextButton(
              onPressed: () async {
                Navigator.pop(ctx);
                await updatePeakLimit(weekDay, startHour, washerMax, dryerMax);
              },
              child: const Text("Confirm Update"),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text("Cancel"),
            ),
          ],
        ),
      );
    }
  }

  // Update existing peak-hour rule
  Future<void> updatePeakLimit(int weekDay, int startHour, int washerMax, int dryerMax) async {
    final updateRes = await http.post(
      Uri.parse("https://laundrypulse-gf1v.onrender.com/api/admin/update-peak-limit"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({
        "week_day": weekDay,
        "start_hour": startHour,
        "washer_max": washerMax,
        "dryer_max": dryerMax,
      }),
    );
    var updateResult = jsonDecode(updateRes.body);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(updateResult["message"])));
      washerMaxCtrl.clear();
      dryerMaxCtrl.clear();
      setState(() {
        selectedWeekIndex = -1;
        selectedTimeIndex = -1;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        centerTitle: true,
        title: const Text("Setting"),
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(1),
          child: Divider(height: 1, color: Color.fromARGB(255, 223, 222, 222)),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              "Peak-Hour Management",
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 24),

            const Text("Select Weekday"),
            const SizedBox(height: 8),
            DropdownButtonFormField<int>(
              value: selectedWeekIndex == -1 ? null : selectedWeekIndex,
              hint: const Text("Please select weekday", style: TextStyle(color: Colors.grey)),
              items: List.generate(weekList.length, (index) {
                return DropdownMenuItem(value: index, child: Text(weekList[index]));
              }),
              onChanged: (v) {
                setState(() {
                  selectedWeekIndex = v!;
                });
              },
              decoration: const InputDecoration(border: OutlineInputBorder()),
            ),

            const SizedBox(height: 18),

            const Text("Select 2-hour time slot"),
            const SizedBox(height: 8),
            DropdownButtonFormField<int>(
              value: selectedTimeIndex == -1 ? null : selectedTimeIndex,
              hint: const Text("Please select 2-hour time slot", style: TextStyle(color: Colors.grey)),
              items: List.generate(timeSlotList.length, (index) {
                return DropdownMenuItem(value: index, child: Text(timeSlotList[index].title));
              }),
              onChanged: (v) {
                setState(() {
                  selectedTimeIndex = v!;
                });
              },
              decoration: const InputDecoration(border: OutlineInputBorder()),
            ),

            const SizedBox(height: 18),

            const Text("Washer Maximum Queue Size"),
            const SizedBox(height: 8),
            TextField(
              controller: washerMaxCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(hintText: "Enter number", border: OutlineInputBorder()),
            ),

            const SizedBox(height: 18),

            const Text("Dryer Maximum Queue Size"),
            const SizedBox(height: 8),
            TextField(
              controller: dryerMaxCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(hintText: "Enter number", border: OutlineInputBorder()),
            ),

            const SizedBox(height: 32),

            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: handleSubmit,
                child: const Text("Enable Peak-Hour Rule"),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
