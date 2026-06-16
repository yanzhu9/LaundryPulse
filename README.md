# LaundryPulse
A mobile-based smart laundry management system

## Features
- Live status dashboard
- Smart push reminders
- Online queue system
- Optional auto dryer queue transfer
- Usage analytics & heatmap
- Crowdsourced fault reporter
- Real-time wait time estimate
- Admin maintenance dashboard
- Auto post-wash idle handling
- Usage-based off-peak recommendations

## Technologies
LaundryPulse is built on a modern full-stack web architecture designed for real-time performance and scalability.
- **Frontend**: Flutter (Dart)
- **Backend**: Node.js
- **Database**: Supabase (PostgreSQL)
- **Notifications**: Firebase Cloud Messaging (FCM)
- **Version Control & Collaboration**: Git & GitHub
- **Deployment**: Android APK & iOS IPA

## How It Works

### Machine Status Updates
Machine statuses (available, occupied, grace-period, overdue) are updated through **user actions in the app**, not automated IoT signals. For example:
- A user presses **"Start Washing"** in the app to mark a machine as in use and start the countdown timer.
- When the timer ends, the user receives a prompt to collect their laundry.
- If the user presses **"Collected"**, the machine is marked as available again.
- If no action is taken within 15 minutes, the backend automatically marks the machine as **overdue**.

> Note: In a real-world deployment, IoT sensors on the machines could replace these user-triggered actions. For the scope of this project, user actions are used to simulate machine signals.

### Push Notifications
Notifications (e.g. booking confirmed, wash cycle done, overdue reminder) are triggered by **backend events** based on user actions, not by physical signals from the machines. FCM is used to deliver these notifications to the user's device.

### Locker System
Locker availability is also managed through user actions:
- When a machine is overdue, another user can offer to help place the clothes into an available locker.
- The helper selects a locker in the app and marks it as occupied after placing the clothes.
- The original user is notified of the locker number and marks it as available after collecting.

### Online Queue
When requesting to queue for a washer or dryer, the system first verifies your credit score. Queuing is only permitted if **your credit score is 15 or higher**.
If eligible to queue:
- If idle machines of the selected type exist, the system assigns the machine with the smallest ID to you, along with **a 15-minute reservation window** to start your laundry session.
- If no idle machines are available, you are added to a global waiting queue. **Separate independent queues are maintained for washers and dryers**. Whenever a machine of your queued type becomes free, it will be allocated to the first user in the matching queue **in FIFO order**. An FCM push notification will be sent once you are assigned a machine, and you will still receive a 15-minute reservation window after allocation.

### Auto post-wash idle handling
If no one picks up laundry within 15 minutes after a wash or dry cycle finishes, the machine’s status changes to overdue and triggers our Auto post-Wash idle handling process.
- Every overdue machine is clickable on the user’s screen. If someone has already helped with that machine, tapping it will show a pop-up message at the bottom to inform users, and no page switch will happen. If no one has helped with the machine yet, tapping the overdue entry will open the Overdue Handling Page.
- This Overdue Handling Page explains how to properly collect and store the previous user’s laundry, along with all relevant credit score rules. Two buttons labeled Yes and No are placed at the bottom. Tapping No returns users to the main page directly. Tapping Yes navigates to the next page that simulates the laundry collection process.
- After tapping Yes on the Overdue Handling Page, a new assistance record is created and a 15-minute countdown starts. Users will be redirected to a simulation page with a Help to Collect button, which simulates the real action of picking up the previous user’s laundry:
1. If users tap Help to Collect within the 15-minute window: This assistance record stays active and enters the pending review list for the original user to rate later.Then, a pop-up window then appears to ask whether you want to use this machine. If tap No: return directly to the main page, and the machine’s status changes to available. If tap Yes: you reserve this machine and get a standard 15-minute reservation window, following the original normal laundry queue workflow.

2. If users do not tap the button within 15 minutes: The page redirects back to the main screen automatically. The machine stays in overdue status, and the generated assistance record will be marked inactive without creating a pending review entry.


> Note: All laundry collection and assistance workflows in this project are simulated via manual button clicks inside the app instead of physical IoT sensors. For real-world deployment, sensors installed on machines can automate all these status updates.

### Credit Score
- Every new user starts with an initial credit score of **15**.
- Users **gain 5 credit points** if their laundry retrieval assistance receives positive feedback (clothes placed correctly with no missing items). They **lose 5 points** if rated negatively for misplacing laundry or missing belongings. No credit adjustment occurs if the user declines to help.


> Note: We set each new user’s starting credit score to 15, so everyone can use the online queue right away. Users cannot join the queue if their score falls below 15. We made this credit rule to **stop people from moving others’ laundry around randomly**. First, any overdue machine will be locked automatically. Second, if you choose to help take out laundry but put it in the wrong spot, you will lose 5 credit points. Both rules work together to prevent misplaced clothes.

## Setup Instructions

### Prerequisites
- [Flutter SDK](https://flutter.dev/docs/get-started/install) (version 3.x or above)
- Android Studio (for Android emulator) or a physical Android device

### Run the Frontend
```bash
git clone https://github.com/yanzhu9/LaundryPulse.git
cd LaundryPulse/frontend
flutter pub get
flutter run
```

Option A - Android Emulator:
- Open Android Studio → Virtual Device Manager → Start emulator
- Run: flutter run

Option B - Web browser (for quick preview):
- Run: flutter run -d chrome

### Run the Backend Locally
```bash
cd LaundryPulse/backend
npm install
# Create a .env file with SUPABASE_URL and SUPABASE_KEY
node index.js
```

### Test Accounts
You can register a new account directly in the app.

## Detailed Documentation
https://docs.google.com/document/d/175kjmmRuYUmbN_oSS4-8tmmQPB3934JSugVYI59AyYw/edit?usp=sharing
