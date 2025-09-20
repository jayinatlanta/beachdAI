package com.beachdai.watchapp.presentation

import androidx.compose.runtime.mutableStateOf

// The default state is now "DISCONNECTED", which is what the user sees first.
// NEW: Added a nullable 'answer' field to hold the final result of a task.
data class AgentTaskState(
    val goal: String = "Is the companion app open? Did you request a task?",
    val status: String = "DISCONNECTED",
    val answer: String? = null
)

// This global variable holds the current state for the UI to observe.
val taskState = mutableStateOf(AgentTaskState())
