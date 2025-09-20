package com.beachdai.phoneapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import fi.iki.elonen.NanoHTTPD
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.io.IOException
import java.util.Date

class WearableBridgeService : Service() {

    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)
    private val TAG = "WearableBridgeService"
    private var webServer: WebServer? = null
    private var initialPingJob: Job? = null
    private var isWatchConnected = false
    private val MAX_ANSWER_LENGTH = 80000 // 80KB to be safe with 100KB limit

    private inner class WebServer : NanoHTTPD(8080) {
        override fun serve(session: IHTTPSession): Response {
            if (session.method == Method.POST && session.uri == "/status") {
                try {
                    val files = mutableMapOf<String, String?>()
                    session.parseBody(files)
                    val jsonBody = files["postData"]

                    if (jsonBody != null) {
                        Log.d(TAG, "Received POST request with body: $jsonBody")
                        serviceScope.launch {
                            val finalMessage = processAndTruncateMessageIfNeeded(jsonBody)
                            // --- USE THE NEW DATACLIENT METHOD ---
                            val success = syncStateToWatch(finalMessage)
                            if (success) {
                                confirmConnectionAndStopPinging()
                            }
                        }
                        return newFixedLengthResponse(
                            Response.Status.OK,
                            "application/json",
                            "{\"status\": \"OK\", \"detail\": \"State received and synced.\"}"
                        )
                    } else {
                        return newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "Error: No data in POST request.")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error processing POST request", e)
                    return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "Internal Server Error: ${e.message}")
                }
            }
            return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not Found")
        }
    }

    private fun processAndTruncateMessageIfNeeded(jsonMessage: String): String {
        try {
            val jsonObject = JSONObject(jsonMessage)
            if (jsonObject.has("answer")) {
                val answer = jsonObject.optString("answer", null)
                if (answer != null && answer.length > MAX_ANSWER_LENGTH) {
                    Log.i(TAG, "Answer length (${answer.length}) exceeds max size. Truncating.")
                    val truncatedAnswer = truncate(answer, MAX_ANSWER_LENGTH)
                    jsonObject.put("answer", truncatedAnswer)
                    return jsonObject.toString()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing JSON for truncation. Sending original message.", e)
        }
        return jsonMessage
    }

    private fun truncate(text: String, maxLength: Int): String {
        if (text.length <= maxLength) return text
        val end = text.lastIndexOf(' ', maxLength - 25)
        val effectiveEnd = if (end != -1) end else maxLength - 25
        return text.substring(0, effectiveEnd) + "... (continued on phone)"
    }

    companion object {
        const val ACTION_START_SERVICE = "ACTION_START_SERVICE"
        const val ACTION_STOP_SERVICE = "ACTION_STOP_SERVICE"
        private const val NOTIFICATION_CHANNEL_ID = "beachdai_service_channel"
        private const val NOTIFICATION_ID = 1
        // --- NEW: Define constants for the DataClient ---
        const val DATA_PATH = "/beachdai_task_update"
        const val STATE_KEY = "state_json"
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startWebServer()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        Log.d(TAG, "onStartCommand received with action: $action")

        when (action) {
            ACTION_START_SERVICE -> {
                startForegroundService()
                if (initialPingJob == null || initialPingJob?.isActive == false) {
                    startInitialPingLoop()
                }
            }
            ACTION_STOP_SERVICE -> stopService()
        }
        return START_STICKY
    }

    private fun startWebServer() {
        if (webServer == null) {
            try {
                webServer = WebServer()
                webServer?.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
                Log.i(TAG, "Web server started on http://localhost:8080")
            } catch (e: IOException) {
                Log.e(TAG, "Could not start web server", e)
            }
        }
    }

    private fun startForegroundService() {
        val notification = createNotification("Service is active. Searching for watch...")
        startForeground(NOTIFICATION_ID, notification)
    }

    private fun stopService() {
        Log.d(TAG, "Stopping service.")
        initialPingJob?.cancel()
        webServer?.stop()
        Log.i(TAG, "Web server stopped.")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startInitialPingLoop() {
        initialPingJob = serviceScope.launch {
            val idleState = JSONObject().apply {
                put("goal", "Ready for new task.")
                put("status", "IDLE")
                put("answer", null as String?)
            }.toString()

            Log.i(TAG, "Starting persistent ping loop to find watch...")
            while (!isWatchConnected) {
                val success = syncStateToWatch(idleState, isInitialPing = true)
                if (success) {
                    confirmConnectionAndStopPinging()
                    break
                } else {
                    Log.d(TAG, "Watch not found yet. Retrying in 15 seconds...")
                    delay(15000)
                }
            }
            Log.i(TAG, "Initial ping loop finished.")
        }
    }

    private fun confirmConnectionAndStopPinging() {
        if (!isWatchConnected) {
            Log.i(TAG, "Connection to watch confirmed! Stopping ping loop.")
            isWatchConnected = true
            initialPingJob?.cancel()
            updateNotification("Service is active. Ready for agent tasks.")
        }
    }

    // --- REWRITTEN: Use DataClient for robust state synchronization ---
    private suspend fun syncStateToWatch(message: String, isInitialPing: Boolean = false): Boolean {
        if (!isInitialPing) {
            try {
                val statusObject = JSONObject(message)
                val statusText = statusObject.optString("status", "...")
                val goalText = statusObject.optString("goal", "...")
                updateNotification("Status: $statusText | Goal: $goalText")
            } catch (e: Exception) {
                Log.w(TAG, "Could not parse JSON for notification update, using raw message.", e)
                updateNotification(message)
            }
        }

        try {
            val nodes = Wearable.getNodeClient(this).connectedNodes.await()
            if (nodes.isEmpty()) {
                if (!isInitialPing) Log.w(TAG, "No connected Wear OS nodes found.")
                return false
            }

            val putDataMapRequest = PutDataMapRequest.create(DATA_PATH).apply {
                dataMap.putString(STATE_KEY, message)
                dataMap.putLong("timestamp", Date().time)
            }
            val request = putDataMapRequest.asPutDataRequest().setUrgent()

            Wearable.getDataClient(this).putDataItem(request).await()
            Log.i(TAG, "Successfully synced state to watch.")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to sync state to watch.", e)
            return false
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "BeachdAI Agent Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Notification channel for the active BeachdAI agent."
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(text: String): Notification {
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("BeachdAI Agent")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val notification = createNotification(text)
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, notification)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        serviceJob.cancel()
        webServer?.stop()
        Log.d(TAG, "Service destroyed.")
    }
}

