package com.beachdai.watchapp.presentation

import android.content.Context
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.text.HtmlCompat
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.rememberScalingLazyListState
import com.beachdai.watchapp.presentation.theme.BeachdAIWatchAppTheme
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.gson.Gson

class MainActivity : ComponentActivity() {

    private lateinit var dataClient: DataClient
    private val gson = Gson()
    private val TAG = "MainActivityWatch"

    private val dataListener = DataClient.OnDataChangedListener { dataEvents: DataEventBuffer ->
        Log.d(TAG, "Data changed event received")
        dataEvents.forEach { event ->
            if (event.type == DataEvent.TYPE_CHANGED) {
                val dataItem = event.dataItem
                if (dataItem.uri.path == "/beachdai_task_update") {
                    val dataMap = DataMapItem.fromDataItem(dataItem).dataMap
                    val jsonState = dataMap.getString("state_json")
                    if (jsonState != null) {
                        Log.d(TAG, "Received new state JSON: $jsonState")
                        try {
                            val newState = gson.fromJson(jsonState, AgentTaskState::class.java)

                            // Trigger vibration only if the status has actually changed
                            if (newState.status != taskState.value.status) {
                                triggerVibration()
                            }
                            taskState.value = newState

                        } catch (e: Exception) {
                            Log.e(TAG, "Error parsing JSON in MainActivity", e)
                            taskState.value = AgentTaskState(status = "ERROR", goal = "Invalid data from phone")
                        }
                    }
                }
            }
        }
        dataEvents.release()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        dataClient = Wearable.getDataClient(this)

        setContent {
            BeachdAIWatchAppTheme {
                // Add the listener when the Composable is first laid out
                DisposableEffect(Unit) {
                    Log.d(TAG, "Adding DataClient listener")
                    dataClient.addListener(dataListener)
                    // Remove the listener when the Composable is disposed
                    onDispose {
                        Log.d(TAG, "Removing DataClient listener")
                        dataClient.removeListener(dataListener)
                    }
                }
                AgentStatusScreen(task = taskState.value)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Actively fetch the latest data when the app becomes visible
        fetchLatestData()
    }

    private fun fetchLatestData() {
        val uri = com.google.android.gms.wearable.PutDataRequest.create("/beachdai_task_update").uri
        dataClient.getDataItem(uri).addOnSuccessListener { dataItem ->
            if (dataItem != null) {
                val dataMap = DataMapItem.fromDataItem(dataItem).dataMap
                val jsonState = dataMap.getString("state_json")
                if(jsonState != null) {
                    val newState = gson.fromJson(jsonState, AgentTaskState::class.java)
                    taskState.value = newState
                    Log.d(TAG, "Successfully fetched latest data on resume.")
                }
            } else {
                Log.d(TAG, "No existing data item found on resume.")
            }
        }
    }

    private fun triggerVibration() {
        val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        val vibrationEffect = VibrationEffect.createOneShot(150, VibrationEffect.DEFAULT_AMPLITUDE)
        vibrator.vibrate(vibrationEffect)
        Log.d(TAG, "Vibration triggered for status change.")
    }
}


@Composable
fun HtmlAsAnnotatedString(html: String): AnnotatedString {
    // --- FIX: Sanitize the HTML to remove unsupported tags like <style> ---
    // This regex finds and removes any <style> block and its content.
    val sanitizedHtml = html.replace(Regex("<style[^>]*>[\\s\\S]*?<\\/style>"), "")

    // Now, parse the cleaned HTML.
    val spanned = HtmlCompat.fromHtml(sanitizedHtml, HtmlCompat.FROM_HTML_MODE_LEGACY)
    return buildAnnotatedString {
        append(spanned.toString())
        spanned.getSpans(0, spanned.length, Any::class.java).forEach { span ->
            val start = spanned.getSpanStart(span)
            val end = spanned.getSpanEnd(span)
            when (span) {
                is StyleSpan -> when (span.style) {
                    android.graphics.Typeface.BOLD -> addStyle(SpanStyle(fontWeight = FontWeight.Bold), start, end)
                    android.graphics.Typeface.ITALIC -> addStyle(SpanStyle(fontStyle = FontStyle.Italic), start, end)
                    android.graphics.Typeface.BOLD_ITALIC -> addStyle(SpanStyle(fontWeight = FontWeight.Bold, fontStyle = FontStyle.Italic), start, end)
                }
                is UnderlineSpan -> addStyle(SpanStyle(textDecoration = TextDecoration.Underline), start, end)
            }
        }
    }
}

@Composable
fun AgentStatusScreen(task: AgentTaskState) {
    val listState = rememberScalingLazyListState()
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = listState,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "BeachdAI Agent Status",
                    fontSize = 16.sp,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = task.status,
                    fontSize = 18.sp,
                    color = if (task.status == "DISCONNECTED") MaterialTheme.colors.error else MaterialTheme.colors.primary,
                    textAlign = TextAlign.Center,
                    maxLines = 1
                )
                Spacer(modifier = Modifier.height(12.dp))

                if (!task.answer.isNullOrBlank()) {
                    Text(
                        text = "Final Answer:",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = HtmlAsAnnotatedString(html = task.answer),
                        fontSize = 14.sp,
                        textAlign = TextAlign.Left,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Original Goal: ${task.goal}",
                        fontSize = 10.sp,
                        color = Color.Gray,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )

                } else {
                    Text(
                        text = "Goal: ${task.goal}",
                        fontSize = 12.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        }
    }
}

