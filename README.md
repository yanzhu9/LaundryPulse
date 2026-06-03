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

### Run the Backend Locally
```bash
cd LaundryPulse/backend
npm install
# Create a .env file with SUPABASE_URL and SUPABASE_KEY
node index.js
```

## Detailed Documentation
https://docs.google.com/document/d/175kjmmRuYUmbN_oSS4-8tmmQPB3934JSugVYI59AyYw/edit?usp=sharing
