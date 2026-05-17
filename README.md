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
- **Frontend**

The user interface is built with **Flutter**, Google's open-source UI framework using the Dart programming language. Flutter enables the development of a single codebase that runs natively on both iOS and Android devices, delivering a smooth and responsive experience across platforms. Flutter's widget-based architecture allows for efficient rendering of real-time machine status updates and dynamic queue information.
- **Backend**

The server-side logic is handled by **Node.js**, managing RESTful API endpoints for queue operations, user authentication, notification triggers, and machine status updates. Business logic such as FIFO queue management, grace period timers, and auto dryer transfer are all processed at this layer.
- **Database**

Supabase serves as the primary database and backend-as-a-service platform, running PostgreSQL under the hood. It handles structured data storage for users, machines, queues, and usage records. Supabase's built-in real-time subscriptions enable instant status updates to be pushed to all connected clients without polling.
- **Notifications**

Push notifications are delivered via **Firebase Cloud Messaging (FCM)**, which is for sending push notifications to both iOS and Android devices in Flutter applications.
- **Version Control & Collaboration**

The team uses **Git and GitHub** for source control, with a branching strategy and pull request workflow to ensure code quality and collaborative development.
- **Deployment**

The Flutter app is packaged and distributed as an **APK (Android)** and **IPA (iOS)** file for testing during development, with future plans to publish on the Google Play Store and Apple App Store.
