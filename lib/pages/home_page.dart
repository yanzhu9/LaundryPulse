import 'package:flutter/material.dart';

class HomePage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('LaundryPulse'),
      ),
      body: Center(
        child: Text(
          'Welcome to LaundryPulse!',
          style: TextStyle(fontSize: 20),
        ),
      ),
    );
  }
}