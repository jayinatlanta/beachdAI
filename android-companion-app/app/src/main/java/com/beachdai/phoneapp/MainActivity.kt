package com.beachdai.phoneapp

import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // The MainActivity's only job is to start our robust, background-capable service.
        // The service itself will handle the web server and all communication with the watch.
        val serviceIntent = Intent(this, WearableBridgeService::class.java).apply {
            action = WearableBridgeService.ACTION_START_SERVICE
        }

        // Use the correct method to start the service based on the Android version.
        // This ensures compatibility with older devices.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }
    }
}

