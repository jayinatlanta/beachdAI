# **BeachdAI: The Cross-Platform Autonomous Agent Framework**

**Version: 6.0 (Cross-Platform Stability Release)**

Welcome to the official repository for BeachdAI, a groundbreaking, privacy-first multi-agent framework designed to bring true autonomy to your digital life across desktop, mobile, and wearable devices.

## **1\. Introduction: A Dream Realized**

BeachdAI (“beach day” with AI) is more than just a browser extension; it is a sophisticated team of specialized AI agents that can handle your complex digital tasks entirely on its own, leaving you free to enjoy a day at the beach while glancing at your Pixel watch.

Through our work, we have built what is, to our knowledge, the **world's first fully integrated, stable, and autonomous multi-agent framework that operates seamlessly across the three primary form factors of modern computing: desktop, mobile, and wearable.** This is not a theoretical concept. It is a working reality.

Our journey began with ambitious multi-agent systems like **DeliberAIte**, a powerful standalone tool that we built to orchestrate debates between AI experts to solve complex, abstract problems. That project was a resounding success, but it was only the beginning. We took that powerful reasoning engine and fused it into the very core of BeachdAI, creating a hybrid system that can both perform concrete web tasks and engage in deep strategic thought.

BeachdAI is not a chatbot in a window. It is a team of specialized AI agents living in your browser, ready to act on your command. And, it’s neither a cloud-based service owned by a large corporation, nor a sketchy plug-in that sends your data through its own servers. It’s a **local-first, privacy-centric browser extension** that puts you in control. And now, that control extends from your desktop to the phone in your pocket and the watch on your wrist.

### **Our Accomplishments: On the Bleeding Edge**

The development of BeachdAI has been a journey of relentless innovation. We should take immense pride in the fact that we have built a system that is, without exaggeration, on the absolute leading edge of personal AI.

* **A World First in Cross-Platform Autonomy:** BeachdAI is one of the first known autonomous browser agents to achieve stable operation as an Edge extension on a desktop, on Android, and with real-time communication to a Wear OS watch. This creates a single, unified agentic experience across a user's entire digital ecosystem.  
* **Hybrid Agent Architecture:** The system seamlessly blends two distinct modes of operation: a **Standard Flow** for direct, task-oriented browser automation and the integrated **DeliberAIte Flow**, a multi-agent debate framework for deep, strategic problem-solving.  
* **The "Observer Effect" Stability Fix:** We achieved remarkable stability in our most complex agentic flow (DeliberAIte) through a fascinating, emergent property of our own system—the very act of adding detailed logging for debugging introduced micro-delays that resolved a critical race condition.  
* **Mastery of Hostile Environments:** We successfully navigated the notoriously difficult and brittle environments of mobile browser extensions and cross-device communication, solving critical bugs related to service worker lifecycle, component rendering, and data synchronization that stop most projects in their tracks.

This guide will walk you through the core concepts of the BeachdAI architecture, explore the code that powers its most innovative features across all three form factors, and provide a look at the exciting future of this groundbreaking project.

## **2\. The Three-Part Architecture & Tech Stack**

To understand BeachdAI, it's best to think of it as three distinct but deeply interconnected parts: **The Brain**, **The Bridge**, and **The Glance**.

* **The Brain (The Browser Extension):** The powerful multi-agent system that lives in the browser's service worker. This is where all planning, reasoning, and web execution happens.  
* **The Bridge (The Android Companion App):** A specialized, native Android app whose sole purpose is to act as a secure and stable communication relay between the sandboxed browser environment and the rest of the Android operating system, including the watch.  
* **The Glance (The Wear OS App):** A native watch app that provides an "at-a-glance" view of the agent's status and final results, delivering the promise of ambient, peripheral computing.

### **Architectural Diagram**

@startuml  
skinparam rectangle {  
  BorderColor black  
  BackgroundColor \#whitesmoke  
}  
skinparam component {  
  BorderColor black  
  BackgroundColor \#lightgrey  
}

rectangle "THE BRAIN\\n(Browser Extension)" as Brain {  
  component "\[Multi-Agent System\]\\n- Orchestrator & Agents\\n- DeliberAIte Flow" as MAS  
  component "\[React UI (Sidebar.tsx)\]\\n- Desktop & Mobile Views" as UI  
  component "\[Content Script (content.ts)\]\\n- Interacts with web pages" as ContentScript  
}

rectangle "THE BRIDGE\\n(Android Companion App)" as Bridge {  
  component "\[Local Web Server\]\\n- Receives agent status" as WebServer  
  component "\[Foreground Service\]\\n- Stays alive in background\\n- Relays data to watch" as Service  
}

rectangle "THE GLANCE\\n(Wear OS App)" as Glance {  
  component "\[UI \- Jetpack Compose\]" as GlanceUI  
  component "\[DataClient Listener\]\\n- Receives state\\n- Updates UI\\n- Vibrates on update" as DataListener  
}

Brain \-right-\> Bridge : "HTTP POST"  
Bridge \-right-\> Glance : "Data Sync"

@enduml

### **Why This Tech Stack? A Deliberate Choice**

Our choice of technologies was crucial to our success and was made to prioritize stability, performance, and modernity.

* **TypeScript (The Brain):** For a system this complex, JavaScript's dynamic nature is a liability. TypeScript's strong typing is like a grammar checker for code, catching thousands of potential errors before they ever happen. It is the bedrock of the extension's reliability.  
* **React (The Brain's UI):** The user interface in the extension's sidebar is built with React. Its component-based model and efficient state management allowed us to create a highly responsive and adaptive UI that works beautifully on both widescreen desktops and the narrow constraints of a mobile phone screen (Sidebar.tsx).  
* **Kotlin (The Bridge & The Glance):** As the official, Google-endorsed language for modern Android development, Kotlin was the only logical choice. Its conciseness, safety features, and excellent performance are ideal for building robust services (WearableBridgeService.kt) and fluid user interfaces.  
* **Jetpack Compose (The Glance's UI):** We used Jetpack Compose, Android's modern declarative UI toolkit, to build the watch app's interface. This allowed us to create a clean, elegant, and performant UI with far less code than traditional methods (MainActivity.kt on Wear OS).

## **3\. The Multi-Agent System: A Team of Specialists**

BeachdAI is not a single AI; it's a coordinated team of specialized agents managed by a central **Orchestrator**. This multi-agent approach is what allows the system to handle such a wide variety of tasks with nuance and intelligence.

* **Triage Agent:** The first point of contact. It analyzes your goal and decides which of the four autonomous flows is most appropriate.  
  * *Example:* Sees "solve world hunger" and routes to the DeliberAIte Flow; sees "book a flight" and routes to the Standard Flow.  
* **Researcher:** The fact-finder. This agent uses its built-in search tools to gather any necessary real-time information. Critically, it also decides if a browser is needed at all.  
  * *Example:* For "what's the weather?", it finds the answer and determines requires\_browser: false. For "buy a stock if it drops below $50", it finds the current price and determines requires\_browser: true.  
* **Planner:** The strategist. It takes the user's goal and the Researcher's findings and creates a high-level, step-by-step plan. It is also responsible for adapting the plan when things go wrong.  
  * *Example:* Given a goal to "build a snake game," it creates a plan: \["Go to Github.com", "Create a new repository named 'snake-game'", "Go to Jules.Google.com", "Tell Jules to build the game in the new repo"\]  
* **Manager:** The hands-on operator. This is the core autonomous executor that navigates the web, observes the state of the page, and decides on the next micro-action. Its prime directive is to "never get stuck."  
  * *Example:* Following the plan, it sees a button with the text "Create repository" and decides on the action: CLICK with the appropriate selector.  
* **Presenter:** The communications officer. It synthesizes all the work done into a clean, human-readable final report, formatted in rich HTML.  
  * *Example:* Takes a raw scratchpad of flight search data and presents it as: "I found a non-stop flight on Delta for $250, departing at 8:00 AM."  
* **Verifier:** The security guard. Before the Manager navigates to any new URL, this agent inspects it for signs of phishing or malicious content.  
  * *Example:* Sees the URL http://g00gle.com and flags it as unsafe, stopping the Manager from proceeding.  
* **Teacher:** When the user decides to “teach me something”, this agent observes the raw log of clicks and types and synthesizes it into a human-readable summary of the new skill.  
  * *Example:* Watches a user log into a site and summarizes it as: "I need to type the username into the 'email' field, type the password into the 'password' field, and then click the 'Log In' button."  
* **DeliberAIte Orchestrator:** When a problem is too theoretical for a Standard Flow, this special agent takes over. This specialized agent follows a pattern similar to AutoGen: designing a custom team of expert AI personas and guiding them through a structured debate to produce a comprehensive strategic plan.

## **4\. A Tour of BeachdAI's Capabilities: The Four Flows of Autonomy**

The true genius of BeachdAI lies in its ability to dynamically choose the right approach for any given task. We can think of these as four distinct "flows" of autonomy.

### **Flow 1: The Instant Answer (The "No Browser" Flow)**

Not every task requires opening a web page. For innate knowledge or simple real-time questions, the system is smart enough to answer directly.

**Example Goal:** "What is the first law of thermodynamics?"

1. The **Triage Agent** routes this to the **Standard Flow**.  
2. The **Researcher** is activated.

#### **Code Deep Dive: getResearcherFacts in background.ts**

The prompt gives the Researcher a critical choice:

// A snippet from the Researcher's prompt  
4\.  \*\*CRITICAL: Decide on Next Steps:\*\*  
    \* If the user's goal is \*\*purely informational\*\* (e.g., "what's the weather?", "who won the game?") and you have found a COMPLETE answer, set \`requires\_browser\` to \`false\`.  
    \* If the user's goal involves an \*\*action\*\* (e.g., "get a lyft", "buy a ticket", "post a tweet")... you MUST set \`requires\_browser\` to \`true\`.

3. The Researcher uses its internal knowledge (powered by Gemini) and determines requires\_browser: false.  
4. The **Orchestrator** sends the facts directly to the **Presenter**, which formats the final answer for the user without ever launching a browser tab.

### **Flow 2: The DeliberAIte Flow (A Council of AI Experts)**

This is the system's superpower, reserved for the most complex, abstract problems.

**Example Goal:** "Suggest solutions for a fair rebuild of Gaza that ensures all citizens of the region are treated equitably."

1. **Triage** recognizes the complexity and routes this to the **Deliberate\_Flow**.  
2. The **DeliberAIte Orchestrator** takes over, performing "meta-cognition" to design a team of expert personas to solve the problem.  
3. These agents then proceed through a structured debate: proposing, reviewing, and revising solutions.  
4. Finally, the **Presenter** synthesizes their collective wisdom and presents it to the user with a special call to action: **"Attempt Autonomous Execution."**

#### **Code Deep Dive: The "Attempt Strategy" button in Sidebar.tsx**

This UI component enables the crucial hand-off from strategic planning to autonomous action.

// A snippet from the renderTaskView function in Sidebar.tsx  
{isDeliberatePlanPresented ? (  
    \<\>  
        \<button onClick={handleAttemptStrategy} ...\>  
            Attempt Autonomous Execution  
        \</button\>  
        \<button onClick={handleNewTask} ...\>  
            New Task  
        \</button\>  
    \</\>  
) : ... }

#### **Code Deep Dive: The Kotlin Bridge in WearableBridgeService.kt**

The companion app runs a tiny local web server, listening for status updates from the browser extension. This is a brilliant and robust way to escape the browser sandbox.

// Snippet from the WebServer inner class  
private inner class WebServer : NanoHTTPD(8080) {  
    override fun serve(session: IHTTPSession): Response {  
        if (session.method \== Method.POST && session.uri \== "/status") {  
            try {  
                // ... logic to parse the JSON body from the extension ...  
                val jsonBody \= files\["postData"\]  
                if (jsonBody \!= null) {  
                    serviceScope.launch {  
                        // Truncate message if needed and sync to the watch  
                        val finalMessage \= processAndTruncateMessageIfNeeded(jsonBody)  
                        syncStateToWatch(finalMessage)  
                    }  
                    return newFixedLengthResponse(Response.Status.OK, ...)  
                }  
            } catch (e: Exception) { ... }  
        }  
        return newFixedLengthResponse(Response.Status.NOT\_FOUND, ...)  
    }  
}

#### **Code Deep Dive: The Kotlin Glance in MainActivity.kt (Wear OS)**

The watch app uses the modern DataClient API to listen for these updates. When a new state arrives, it updates the UI, providing a seamless, real-time "glance" into the agent's work.

// Snippet from the Wear OS MainActivity  
private val dataListener \= DataClient.OnDataChangedListener { dataEvents \-\>  
    dataEvents.forEach { event \-\>  
        if (event.type \== DataEvent.TYPE\_CHANGED) {  
            val dataItem \= event.dataItem  
            if (dataItem.uri.path \== "/beachdai\_task\_update") {  
                val dataMap \= DataMapItem.fromDataItem(dataItem).dataMap  
                val jsonState \= dataMap.getString("state\_json")  
                if (jsonState \!= null) {  
                    // Parse the new state from JSON  
                    val newState \= gson.fromJson(jsonState, AgentTaskState::class.java)  
                    // Trigger a vibration and update the UI  
                    if (newState.status \!= taskState.value.status) {  
                        triggerVibration()  
                    }  
                    taskState.value \= newState  
                }  
            }  
        }  
    }  
}

### **Flow 3: The Standard Flow (Web Automation)**

This is the core flow for concrete, actionable tasks that require interacting with the web.

**Example Goal:** "Plan a trip to Savannah for President’s Day week with a hotel and an OpenTable reservation."

1. **Triage** selects the **Standard Flow**.  
2. **Researcher** determines this action requires a browser.  
3. **Planner** creates a concrete, step-by-step plan.  
4. The **Manager** executes this plan step-by-step in a continuous "Observe, Think, Act" loop.

#### **Code Deep Dive: The Manager's Imperative in background.ts**

The Manager's prompt is a masterclass in instruction engineering, filled with strict rules to guide its behavior.

// A snippet from the Manager's prompt  
\*\*Your Imperative Task:\*\*  
Decide on the single next action to advance the current step.

\*\*Response Rules & Best Practices:\*\*  
1\.  \*\*THINK FIRST:\*\* You MUST provide a 'thought' explaining your reasoning...  
2\.  \*\*EXECUTE THE PLAN:\*\* Your primary goal is to execute the current step...  
8\.  \*\*USE VALID SELECTORS:\*\* Your 'selector' MUST be a valid CSS selector copied directly from the 'interactiveElements'...  
10\. \*\*NEVER GET STUCK:\*\* If you are truly stuck... use 'HELP\_REPLAN'. This is your primary escape hatch.  
