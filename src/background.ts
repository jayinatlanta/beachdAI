// src/background.ts

/**
 * @file This is the service worker for the BeachdAI extension.
 * @version 6.3 - DeliberAIte Flow Debug Logging
 * NOTE TO DEVS: Remember to increment the version number with each significant update.
 * - Added detailed console logging to the DeliberAIte flow to debug hanging issues.
 */

import { unlockVault, isVaultUnlocked, encryptAndSaveCredential, getDecryptedCredential } from './vault';
import { AgentState, AgentEvent, TaskStatus, ManagerDecision, ResearchData, ResearcherDecision, CompletedTask, HistoricalTask } from './types';

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(self.navigator.userAgent);


console.log("BeachdAI Service Worker Loaded (v6.3). Mobile:", isMobile);


// --- NEW: Wear OS Communication Bridge (Endpoint Architecture) ---

// This variable will act as a circuit breaker. If we fail to connect once,
// we can wait a bit before trying again to avoid spamming failed requests.
let isCompanionAppConnected = true;
let lastConnectionAttempt = 0;
const CONNECTION_RETRY_DELAY = 5000; // 5 seconds

/**
 * Sends the current agent state to the companion app's localhost endpoint.
 */
async function sendStateToWearable() {
    if (!isMobile || !currentTask) {
        return;
    }

    const now = Date.now();
    if (!isCompanionAppConnected && (now - lastConnectionAttempt < CONNECTION_RETRY_DELAY)) {
        // If we recently failed, don't try again immediately.
        return;
    }

    lastConnectionAttempt = now;

    const watchState = {
        goal: currentTask.originalGoal,
        status: currentTask.status,
        answer: currentTask.finalAnswer || null
    };

    console.log(`Attempting to POST state to companion app endpoint:`, watchState);

    try {
        const response = await fetch('http://localhost:8080/status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(watchState),
        });

        if (!response.ok) {
            throw new Error(`Companion app returned an error: ${response.status} ${response.statusText}`);
        }

        const responseData = await response.json();
        if (responseData.status !== 'OK') {
             throw new Error(`Companion app reported an issue: ${responseData.detail}`);
        }

        // If the request succeeds, we know the app is connected.
        if (!isCompanionAppConnected) {
             console.log("Successfully re-established connection with the companion app.");
             isCompanionAppConnected = true;
        }

    } catch (error) {
        if (isCompanionAppConnected) {
            // Only log the error on the first failure to avoid spam.
            console.error("Failed to send state to companion app. Is it running?", error);
            isCompanionAppConnected = false;
        }
    }
}


// --- Types and State Management ---

/**
 * Wraps a promise with a timeout.
 * @param promise The promise to execute.
 * @param ms The timeout duration in milliseconds.
 * @param timeoutError The error to throw on timeout.
 * @returns The result of the promise.
 * @throws {Error} Throws the specified error if the promise times out.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError = new Error('Promise timed out')): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(timeoutError);
        }, ms);

        promise
            .then(value => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch(err => {
                clearTimeout(timer);
                reject(err);
            });
    });
}


const embeddingCache = new Map<number, { chunks: string[], embeddings: any[] }>();

// This will temporarily hold the sensitive value while we wait for the user to name it.
let pendingCredentialValue: string | null = null;

// FIX: Implement a robust singleton pattern for model loading
let pipelineInstance: any = null;
let modelPromise: Promise<any> | null = null;

async function getPipeline() {
    if (pipelineInstance) {
        return pipelineInstance;
    }

    if (modelPromise) {
        return modelPromise;
    }

    modelPromise = new Promise(async (resolve, reject) => {
        try {
            console.log("Dynamically importing @xenova/transformers for the first time...");
            // @ts-ignore
            const { pipeline } = await import('@xenova/transformers');
            console.log("Transformers library loaded. Initializing feature-extraction pipeline...");
            const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
            console.log("Feature-extraction pipeline ready.");
            pipelineInstance = extractor;
            resolve(pipelineInstance);
        } catch (error) {
            console.error("Failed to load or initialize the transformers pipeline:", error);
            modelPromise = null; // Reset promise on failure to allow retry
            reject(error);
        }
    });

    return modelPromise;
}


let transformers: { cos_sim: any } | null = null;
async function getCosSim() {
    if (transformers && transformers.cos_sim) {
        return transformers.cos_sim;
    }
    console.log("Dynamically importing cos_sim from @xenova/transformers...");
    // @ts-ignore
    const module = await import('@xenova/transformers');
    transformers = { cos_sim: module.cos_sim };
    return transformers.cos_sim;
}


interface PlannerDecision {
    thought: string;
    plan: string[];
}

interface EnrichedContext {
    originalGoal: string;
    researchData?: ResearchData[];
}

interface VerifierDecision {
    is_safe: boolean;
    reason: string;
}

interface LearnedTools {
    [hostname: string]: {
        [taskDescription: string]: any[];
    }
}

interface PresenterDecision {
    summary: string;
    call_to_action: string | null;
}

interface TriageDecision {
    flow: 'Standard_Flow' | 'Deliberate_Flow';
}

interface TeacherSummaryDecision {
    summary: string;
}

interface ExpertPersona {
    name: string;
    title: string;
    persona: string;
    model: string;
}


let currentTask: AgentState | null = null;
const GEMINI_PRO_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const GEMINI_FLASH_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";


async function generateEmbeddings(text: string): Promise<{ chunks: string[], embeddings: any[] }> {
    const extractor = await getPipeline();
    const sentences = text.split(/(?<=[.?!])\s+/);
    const chunks: string[] = [];
    for (let i = 0; i < sentences.length; i++) {
        const chunk = sentences.slice(i, i + 3).join(' ').trim();
        if (chunk) chunks.push(chunk);
    }
    const embeddings = await extractor(chunks, { pooling: 'mean', normalize: true });
    // @ts-ignore
    return { chunks, embeddings: embeddings.tolist() };
}

async function searchPage(query: string, tabId: number): Promise<string[]> {
    try {
        let cached = embeddingCache.get(tabId);
        if (!cached) {
            console.log(`No embeddings cached for tab ${tabId}. Fetching text and generating.`);
            const response = await chrome.tabs.sendMessage(tabId, { action: 'GET_PAGE_TEXT' });
            if (!response || !response.text) {
                throw new Error("Could not get page text from content script.");
            }
            cached = await generateEmbeddings(response.text);
            embeddingCache.set(tabId, cached);
        }

        const extractor = await getPipeline();
        const cos_sim = await getCosSim();
        const queryEmbedding = await extractor(query, { pooling: 'mean', normalize: true });

        const scores = cached.embeddings.map((embedding, i) => ({
            // @ts-ignore
            score: cos_sim(Array.from(queryEmbedding.data), embedding),
            text: cached.chunks[i]
        }));

        scores.sort((a, b) => b.score - a.score);
        return scores.slice(0, 5).map(item => item.text);
    } catch (error) {
        console.error("Semantic search failed:", error);
        console.warn("Falling back to full text extraction due to semantic search error.");
        const response = await chrome.tabs.sendMessage(tabId, { action: 'GET_PAGE_TEXT' });
        if (!response || !response.text) {
            throw new Error("Could not get page text from content script for fallback.");
        }
        return [response.text.substring(0, 8000)];
    }
}


chrome.runtime.onStartup.addListener(() => {
    console.log("Browser startup detected, clearing any stale task.");
    currentTask = null;
});
currentTask = null;

chrome.runtime.onInstalled.addListener(() => {
  if (!isMobile) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error(error));
  } else {
    // On mobile, where side panels are not supported, explicitly set the popup.
    chrome.action.setPopup({ popup: 'sidebar.html' });
  }
});

chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  if (message.type === 'GET_TASK_STATUS') {
    sendResponse({ task: currentTask });
    return false;
  }

  if (message.type === 'GET_HISTORICAL_TASKS') {
    chrome.storage.local.get('historicalTasks').then(result => {
        sendResponse({ tasks: result.historicalTasks || [] });
    });
    return true; // Indicates async response
  }

  const event = message.type as AgentEvent;
  const payload = message.payload;

  agentOrchestrator(event, payload);

  sendResponse({ status: `Event '${event}' received and passed to orchestrator.` });

  return true;
});

// --- Core Agent Logic & State Machine ---

async function agentOrchestrator(event: AgentEvent, payload?: any) {
    console.log(`Orchestrator Event: ${event}`, { status: currentTask?.status, payload });

    if (event === 'STOP_TASK') {
        await handleStopTask();
        return;
    }

    switch (event) {
        case 'START_TASK':
            await handleStartTask(payload.goal);
            return;
        // --- FIX: Add a new case to handle the explicit reset from the UI ---
        case 'RESET_TASK_SESSION':
            await handleResetTaskSession();
            return;
        case 'ATTEMPT_STRATEGY':
            if (currentTask) {
                currentTask.isDeliberatePlan = true;
                currentTask.initialStrategy = currentTask.finalAnswer || null;
                currentTask.finalAnswer = undefined; // Clear the final answer before execution
                currentTask.plan = payload.plan;
                updateTaskStatus('PLANNING');
                await agentOrchestrator('PLAN_COMPLETE', { plan: payload.plan, thought: "Executing deliberate strategy." });
            }
            return;
        case 'TAKE_OVER':
            await handleTakeOver();
            return;
        case 'GO_AUTONOMOUS':
            await handleGoAutonomous();
            return;
        case 'RECORDED_ACTION':
            handleRecordedAction(payload);
            return;
        case 'START_TEACHING':
            await handleStartTeaching(payload.goal);
            return;
        case 'STOP_TEACHING':
            await handleStopTeaching();
            return;
        case 'UNLOCK_VAULT':
            await handleUnlockVault(payload.passphrase);
            return;
        case 'DELETE_HISTORICAL_TASK':
            await handleDeleteHistoricalTask(payload);
            return;
        case 'SAVE_CREDENTIAL':
            await handleSaveCredential(payload.name);
            return;
    }

    if (!currentTask) return;

    switch (currentTask.status) {
        case 'AWAITING_PASSPHRASE':
        case 'AWAITING_CREDENTIAL_NAME':
            break; // Pause execution, wait for user event
        case 'RESEARCHING':
            if (event === 'RESEARCH_COMPLETE' && payload) {
                const researcherDecision = payload.decision as ResearcherDecision;
                currentTask.researchData = researcherDecision.facts;
                currentTask.researcherDecision = researcherDecision;
                addToScratchpad(`Research complete. Facts learned: ${JSON.stringify(researcherDecision.facts)}`);

                const vaultIsLocked = !(await isVaultUnlocked());
                if (researcherDecision.requires_vault && vaultIsLocked) {
                    addToScratchpad("Task requires vault access, but vault is locked. Awaiting passphrase.");
                    updateTaskStatus('AWAITING_PASSPHRASE');
                    return;
                }

                if (researcherDecision.requires_browser) {
                    updateTaskStatus('PLANNING');
                    const enrichedContext: EnrichedContext = {
                        originalGoal: currentTask.originalGoal,
                        researchData: currentTask.researchData,
                    };
                    const planDecision = await getPlannerDecision(enrichedContext);
                    if (planDecision && planDecision.plan) {
                        await agentOrchestrator('PLAN_COMPLETE', planDecision);
                    } else {
                        await agentOrchestrator('PLAN_FAILED');
                    }
                } else {
                            const presenterReason = "The Researcher answered the question directly without needing to use the browser.";
                            const presenterDecision = await getPresenterDecision('ANSWER', presenterReason);
                            if (presenterDecision) {
                                currentTask.finalAnswer = presenterDecision.summary;
                                updateTaskStatus('COMPLETED');
                                saveCompletedTask();
                            } else {
                                const finalAnswer = researcherDecision.facts.map(f => f.answer).join('\n');
                                currentTask.finalAnswer = finalAnswer;
                                updateTaskStatus('COMPLETED');
                                saveCompletedTask();
                            }
                        }

            } else if (event === 'RESEARCH_FAILED') {
                updateTaskStatus('FAILED', 'Researcher failed to gather necessary facts.');
            }
            break;

        case 'PLANNING':
            if (event === 'PLAN_COMPLETE' && payload) {
                currentTask.plan = payload.plan;
                addToScratchpad(`Planner thought: ${payload.thought}`);
                updateUI();
                await agentOrchestrator('RUN_NEXT_TURN');
            } else if (event === 'PLAN_FAILED') {
                updateTaskStatus('FAILED', 'Planner failed to create a plan.');
            }
            break;

        case 'THINKING':
            if (event === 'ACTION_COMPLETE' && payload) {
                await handleAction(payload as ManagerDecision);
            } else if (event === 'ACTION_FAILED') {
                updateTaskStatus('FAILED', 'Manager (Gemini) failed to make a decision.');
            }
            break;

        case 'VERIFYING':
             console.log(`Orchestrator in 'VERIFYING' state. Waiting for verification to complete in handleAction.`);
             break;

        case 'EXECUTING':
             if (event === 'ACTION_COMPLETE') {
                currentTask.lastFailedAction = null;
                currentTask.stepFailureCount = 0; // Reset on success
                if (currentTask.currentStep < currentTask.plan.length - 1) {
                    currentTask.currentStep++;
                }
                await agentOrchestrator('RUN_NEXT_TURN');
            } else if (event === 'TEXT_EXTRACTED' && payload) {
                addToScratchpad(`Extracted Text: ${payload.text.substring(0, 200)}...`);
                await agentOrchestrator('RUN_NEXT_TURN');
            } else if (event === 'ACTION_FAILED' && payload) {
                    const { decision } = payload;

                    const activeTab = await chrome.tabs.get(currentTask.tabs[currentTask.activeTabName]).catch(() => null);
                    if (activeTab && activeTab.url) {
                        const hostname = new URL(activeTab.url).hostname;
                        currentTask.websiteFailures[hostname] = (currentTask.websiteFailures[hostname] || 0) + 1;
                        addToScratchpad(`System Alert: Incrementing failure count for ${hostname} to ${currentTask.websiteFailures[hostname]}.`);
                    }

                    // FIX: Use the more robust stepFailureCount.
                    currentTask.stepFailureCount++;
                    currentTask.lastFailedAction = decision;

                    if (currentTask.stepFailureCount >= 3) {
                        addToScratchpad(`System Alert: The agent has failed ${currentTask.stepFailureCount} times on this step. The current page may be problematic. Triggering a replan.`);
                        await handleStuckState();
                    } else {
                        await agentOrchestrator('RUN_NEXT_TURN');
                    }
                }
                break;

        case 'REPLANNING':
            if (event === 'REPLAN_COMPLETE' && payload) {
                currentTask.plan = payload.plan;
                currentTask.currentStep = 0;
                addToScratchpad(`Replanning successful. New Plan: ${payload.thought}`);
                currentTask.stepFailureCount = 0;
                currentTask.lastFailedAction = null;
                updateUI();
                await agentOrchestrator('RUN_NEXT_TURN');
            } else if (event === 'REPLAN_FAILED') {
                 updateTaskStatus('FAILED', 'Replanning failed. The agent is unable to find a new path forward.');
            }
            break;

        case 'TEACHING':
        case 'WAITING':
            // FIX: The agent was getting stuck because it didn't know what to do after a LONG_WAIT.
            // This adds the logic to handle the completion of the wait and move to the next step.
            if (event === 'ACTION_COMPLETE') {
                currentTask.lastFailedAction = null;
                currentTask.stepFailureCount = 0;
                if (currentTask.currentStep < currentTask.plan.length - 1) {
                    currentTask.currentStep++;
                }
                await agentOrchestrator('RUN_NEXT_TURN');
            } else {
                console.log(`Orchestrator is in ${currentTask.status} mode. Awaiting user actions or timeout.`);
            }
            break;

        case 'USER_INPUT_PENDING':
        case 'COMPLETED':
        case 'FAILED':
        case 'STOPPED':
             console.log(`Orchestrator in a terminal state '${currentTask.status}'. No action taken.`);
            break;
    }

    if (event === 'RUN_NEXT_TURN') {
        await runNextTurn();
    }
}

async function handleStartTeaching(goal: string) {
    const taskId = `task-${Date.now()}`;
    currentTask = {
        id: taskId,
        originalGoal: goal,
        status: 'TEACHING',
        plan: [],
        currentStep: 0,
        turn: 0,
        scratchpad: [`Teaching session started for: "${goal}"`],
        createdAt: Date.now(),
        researchData: [],
        researcherDecision: null,
        lastFailedAction: null,
        stepFailureCount: 0,
        tabs: {},
        activeTabName: 'main',
        isTraining: true,
        recordedActions: [],
        websiteFailures: {},
        isDeliberatePlan: false,
        initialStrategy: null,
    };

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id) {
        currentTask.tabs['main'] = activeTab.id;
        chrome.tabs.sendMessage(activeTab.id, { action: 'START_LEARNING' });
    }

    updateUI();
}

async function handleUnlockVault(passphrase: string) {
    if (!currentTask) return;
    const success = await unlockVault(passphrase);
    if (success) {
        if (!currentTask.researcherDecision) {
            addToScratchpad("Error: Cannot re-run research step. Researcher decision is missing.");
            updateTaskStatus('FAILED', 'Could not resume task after unlocking vault.');
            return;
        }

        addToScratchpad("Vault unlocked successfully. Proceeding to planning phase.");
        updateTaskStatus('PLANNING');

        const enrichedContext: EnrichedContext = {
            originalGoal: currentTask.originalGoal,
            researchData: currentTask.researchData,
        };

        const planDecision = await getPlannerDecision(enrichedContext);
        if (planDecision && planDecision.plan) {
            await agentOrchestrator('PLAN_COMPLETE', planDecision);
        } else {
            await agentOrchestrator('PLAN_FAILED');
        }

    } else {
        addToScratchpad("Vault unlock failed. Please try the passphrase again.");
        updateUI();
    }
}

async function handleStopTeaching() {
    // FIX: Use a local constant for the task to prevent race conditions after await calls.
    const task = currentTask;
    if (!task || task.status !== 'TEACHING') return;

    const activeTabId = task.tabs[task.activeTabName];
    if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, { action: 'STOP_LEARNING' });
    }

    addToScratchpad("Teaching session finished. Now summarizing what was learned.");
    updateUI();

    const teacherDecision = await getTeacherSummaryDecision(task.originalGoal, task.recordedActions || []);

    // After an await, the global currentTask could have been changed (e.g., by the user stopping the task).
    // We must check if the task we were working on is still the active one.
    if (currentTask !== task) {
        console.log("Task was stopped during summarization. Aborting final save.");
        return;
    }

    const summary = teacherDecision ? teacherDecision.summary : "I recorded the steps you took, but I was unable to create a summary.";
    currentTask.finalAnswer = summary;

    await saveLearnedTool(currentTask.originalGoal, currentTask.recordedActions || []);

    if (currentTask !== task) {
        console.log("Task was stopped during tool saving. Aborting final save.");
        return;
    }

    updateTaskStatus('COMPLETED');
    saveCompletedTask();
}

async function handleSaveCredential(name: string) {
    if (currentTask && currentTask.status === 'AWAITING_CREDENTIAL_NAME' && pendingCredentialValue) {
        try {
            const placeholder = await encryptAndSaveCredential(name, pendingCredentialValue);
            addToScratchpad(`User saved a credential named "${name}". The agent can now use the placeholder: ${placeholder}`);
            pendingCredentialValue = null; // Clear the temporary value

            await agentOrchestrator('RUN_NEXT_TURN');

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
            addToScratchpad(`Error saving credential: ${errorMessage}`);
            updateTaskStatus('FAILED', `Could not save credential: ${errorMessage}`);
        }
    } else {
        addToScratchpad(`Warning: Received SAVE_CREDENTIAL event in an invalid state. Current status: ${currentTask?.status}`);
    }
}

function handleRecordedAction(payload: any) {
    if (!currentTask) return;

    if (currentTask.isTraining && currentTask.status === 'USER_INPUT_PENDING') {
        console.log("Received recorded action from user:", payload);
        addToScratchpad(`User demonstrated action: ${payload.action} on selector ${payload.selector}`);
        saveLearnedAction(payload);
    }

    if (currentTask.status === 'TEACHING') {
        console.log("Recorded teaching action:", payload);
        currentTask.recordedActions?.push(payload);
        addToScratchpad(`Action Recorded: ${payload.action} ${payload.selector || ''} ${payload.text || ''}`);
    }
}

async function generateExpertPersonas(problem: string): Promise<ExpertPersona[]> {
    const prompt = `Based on the following problem, dynamically generate three distinct, expert personas to analyze it. Problem: "${problem}". Respond with ONLY a JSON object with a key "theorists", an array of objects. Each object must have "name", "title", and "persona". Ensure the entire response is in English.`;
    try {
        const response = await geminiCall(prompt, false, GEMINI_FLASH_API_URL, true);
        const theorists = response.theorists;
        theorists.forEach((t: any) => {
            t.model = GEMINI_PRO_API_URL;
        });
        return theorists;
    } catch (error) {
        console.error("Persona Generation/Parsing Error:", error);
        throw new Error("Could not generate or parse dynamic personas.");
    }
}

async function getSolutionTable(theorist: ExpertPersona, problem: string, model: string) {
    const prompt = `As the expert persona ${theorist.name}, ${theorist.title}, with the following perspective: "${theorist.persona}", analyze the problem: "${problem}".

Your response MUST be a valid JSON array of objects. Each object in the array represents a potential solution and MUST have three keys: "Solution" (string), "Likelihood (1-10)" (number), and "Rationale" (string). Rank the solutions in the array from highest to lowest likelihood.

**Example of Expected JSON Output:**
* Problem: "Improve employee morale at a tech company."
* Your JSON Output:
    [
      {
        "Solution": "Implement a flexible work-from-home policy.",
        "Likelihood (1-10)": 9,
        "Rationale": "Increases autonomy and work-life balance, which are major drivers of morale in the tech sector. This has been proven to be effective in similar organizations."
      },
      {
        "Solution": "Introduce quarterly anonymous feedback surveys and act on the results.",
        "Likelihood (1-10)": 8,
        "Rationale": "Gives employees a voice and provides actionable data for management to address specific concerns, fostering a culture of listening."
      },
      {
        "Solution": "Increase budget for team-building events.",
        "Likelihood (1-10)": 6,
        "Rationale": "Can improve camaraderie but often has a temporary effect if underlying systemic issues are not addressed. Less impactful than structural changes."
      }
    ]

Respond with ONLY the valid JSON array.`;
    return await geminiCall(prompt, false, model, true);
}

async function getRevisedSolution(theorist: ExpertPersona, problem: string, otherTables: any, model: string) {
    const prompt = `The other experts provided these tables: ${JSON.stringify(otherTables)}. Review their input. State your single, most preferred concise solution, explaining your final choice.`;
    return await geminiCall(prompt, false, model, true);
}

async function getFinalConsensus(problem: string, revisedSolutions: any) {
    const prompt = `You are a world-class synthesizer AI. Your task is to take the revised solutions from a panel of experts and synthesize them into a single, comprehensive, and detailed final plan.

**Expert Solutions:**
${JSON.stringify(revisedSolutions, null, 2)}

**Your Task:**
Your response MUST be a single, valid JSON object with two keys: "html" and "plan".

1.  **"html" key:** The value MUST be a string containing a detailed, multi-section strategic plan, formatted as a single, complete HTML document.
    * Do not include any text, comments, or markdown outside of the \`<html>\` tags.
    * Use semantic HTML tags for structure (\`<h2>\`, \`<h3>\`, \`<p>\`, \`<strong>\`, \`<ul>\`, \`<li>\`).
    * This HTML will be rendered directly to the user, so it should be well-written and easy to understand.

2.  **"plan" key:** The value MUST be a JSON array of strings. Each string should be a concise, high-level, actionable step derived from the strategic plan you generated for the "html" key. This array will be used for potential autonomous execution.

**Detailed Example of the Expected JSON Output Structure:**
{
  "html": "<html><body><h2>Strategic Plan to Improve Urban Farming Initiatives</h2><h3>Phase 1: Foundation and Community Engagement</h3><p>The first phase focuses on establishing the necessary groundwork and securing community buy-in.</p><ul><li><strong>Action Item:</strong> Secure permits for at least three vacant city lots.</li><li><strong>Action Item:</strong> Launch a volunteer recruitment campaign via social media and local community centers.</li><li><strong>Action Item:</strong> Establish partnerships with local hardware stores for tool and soil donations.</li></ul><h3>Phase 2: Implementation and Growth</h3><p>With resources secured, the next phase involves the physical setup and initial planting.</p><ul><li><strong>Action Item:</strong> Organize a community build day to construct raised garden beds.</li><li><strong>Action Item:</strong> Distribute initial seeds and saplings to volunteers.</li></ul></body></html>",
  "plan": [
    "Secure permits for three vacant city lots for community gardens",
    "Launch a volunteer recruitment campaign for urban farming",
    "Establish partnerships with local hardware stores for donations",
    "Organize a community build day for garden beds",
    "Distribute seeds and saplings to volunteers"
  ]
}

Now, based on the provided expert solutions for the problem "${problem}", produce your response. Respond with ONLY the valid JSON object.`;
    return await geminiCall(prompt, false, GEMINI_FLASH_API_URL, true);
}

async function runDeliberateFlow(goal: string) {
    try {
        addToScratchpad("Deliberate Flow selected. Generating expert personas...");
        console.log('[Deliberate Flow] Starting persona generation.');
        const personas = await generateExpertPersonas(goal);
        if (!currentTask) return;
        console.log('[Deliberate Flow] Personas generated successfully:', personas);


        addToScratchpad(`Personas generated: ${personas.map(p => p.name).join(', ')}`);
        updateTaskStatus('THINKING');

        addToScratchpad("Experts are creating initial solution tables...");
        console.log('[Deliberate Flow] Starting solution table generation for each persona.');
        const tables: any[] = [];
        for (const p of personas) {
            if (!currentTask) return; // Check before each API call
            console.log(`[Deliberate Flow] Requesting solution table from ${p.name}...`);
            const table = await getSolutionTable(p, goal, p.model);
            console.log(`[Deliberate Flow] Received raw table from ${p.name}:`, JSON.stringify(table));
            tables.push(table);
        }
        if (!currentTask) return;

        const agentTables: { [key: string]: any } = {};
        personas.forEach((p, i) => {
            if (tables[i]) {
                agentTables[p.name] = tables[i];
            }
        });
        addToScratchpad("Initial tables created.");
        console.log('[Deliberate Flow] All initial tables created:', agentTables);
        if (!currentTask) return;

        addToScratchpad("Experts are reviewing peer tables and providing revised solutions...");
        console.log('[Deliberate Flow] Starting revised solution generation for each persona.');
        const revisedSolutions: any[] = [];
        for (const p of personas) {
            if (!currentTask) return; // Check before each API call
            const otherTables = { ...agentTables };
            delete otherTables[p.name];
            console.log(`[Deliberate Flow] Requesting revised solution from ${p.name}...`);
            const solution = await getRevisedSolution(p, goal, otherTables, p.model);
            console.log(`[Deliberate Flow] Received raw revised solution from ${p.name}:`, JSON.stringify(solution));
            revisedSolutions.push(solution);
        }
        if (!currentTask) return;

        const finalAgentSolutions: { [key: string]: any } = {};
        personas.forEach((p, i) => {
            if (revisedSolutions[i]) {
                finalAgentSolutions[p.name] = revisedSolutions[i];
            }
        });
        addToScratchpad("Revised solutions provided.");
        console.log('[Deliberate Flow] All revised solutions created:', finalAgentSolutions);
        if (!currentTask) return;

        addToScratchpad("Generating final consensus...");
        console.log('[Deliberate Flow] Requesting final consensus...');
        const consensusResponse = await getFinalConsensus(goal, finalAgentSolutions);
        if (!currentTask) return;
        console.log('[Deliberate Flow] Received raw consensus response:', JSON.stringify(consensusResponse));

        addToScratchpad("Final consensus generated.");

        if (currentTask) {
            const callToAction = `<p><em>This is a strategic solution. If you wish, the system can autonomously attempt to execute the browser-based steps of this plan.</em></p>`;

            currentTask.finalAnswer = consensusResponse.html + callToAction;
            currentTask.plan = consensusResponse.plan;
            currentTask.isDeliberatePlan = true;
            console.log('[Deliberate Flow] Final consensus processed. HTML and Plan are set.');
            updateTaskStatus('COMPLETED');
            saveCompletedTask();
        }

    } catch (error) {
        if (!currentTask) {
            console.log("Deliberate flow was stopped, ignoring error.");
            return;
        }
        console.error("[Deliberate Flow] An error occurred:", error);
        updateTaskStatus('FAILED', error instanceof Error ? error.message : 'An unknown error occurred during the deliberate flow.');
    }
}

async function handleStartTask(goal: string) {
    if (currentTask && currentTask.status === 'USER_INPUT_PENDING') {
        await saveHistoricalTask(currentTask.originalGoal);
    }
    const taskId = `task-${Date.now()}`;
    currentTask = {
        id: taskId,
        originalGoal: goal,
        status: 'RESEARCHING',
        plan: [],
        currentStep: 0,
        turn: 0,
        scratchpad: [`Goal: ${goal}`],
        createdAt: Date.now(),
        researchData: [],
        researcherDecision: null,
        lastFailedAction: null,
        stepFailureCount: 0, // Initialize the new counter
        tabs: {},
        activeTabName: 'main',
        websiteFailures: {},
        isTraining: false,
        isDeliberatePlan: false,
        initialStrategy: null,
    };
    updateUI();

    try {
        const triageDecision = await getTriageDecision(goal);
        addToScratchpad(`Triage decision: ${triageDecision.flow}`);

        if (triageDecision.flow === 'Deliberate_Flow') {
            runDeliberateFlow(goal);
        } else {
            const preflightContext = await getPreflightContext();
            addToScratchpad(`Pre-flight context established. Location: ${preflightContext.location}`);

            const researcherDecision = await getResearcherFacts(goal, preflightContext.location);
            addToScratchpad(`Researcher thought: ${researcherDecision.thought}`);

            await agentOrchestrator('RESEARCH_COMPLETE', { decision: researcherDecision });
        }
    } catch (error) {
        console.error("Error during research phase:", error);
        updateTaskStatus('FAILED', error instanceof Error ? error.message : 'An unknown error occurred during research.');
    }
}

async function handleStopTask() {
    if (currentTask) {
        if (currentTask.waitTimeoutId) {
            clearTimeout(currentTask.waitTimeoutId);
            currentTask.waitTimeoutId = undefined;
        }
        if (currentTask.status === 'USER_INPUT_PENDING') {
            await saveHistoricalTask(currentTask.originalGoal);
        }
        updateTaskStatus('STOPPED', 'You have requested to stop the autonomous goal.');
        currentTask = null;
    }
}

/**
 * --- FIX: This is the new handler for resetting the UI from a terminal state. ---
 * It cleanly sets the current task to null and updates the UI without generating
 * a 'STOPPED' state, which was causing the erroneous error message.
 */
async function handleResetTaskSession() {
    if (currentTask) {
        // Clear any pending timeouts just in case, to prevent orphaned processes.
        if (currentTask.waitTimeoutId) {
            clearTimeout(currentTask.waitTimeoutId);
            currentTask.waitTimeoutId = undefined;
        }
        currentTask = null;
        // Broadcast the null state to all UI components so they can reset.
        updateUI();
    }
}

async function handleTakeOver() {
    if (currentTask) {
        currentTask.isTraining = true;
        updateTaskStatus('USER_INPUT_PENDING', 'Waiting for user to demonstrate the next step.');
        chrome.tabs.sendMessage(currentTask.tabs[currentTask.activeTabName], { action: 'START_LEARNING' });
    }
}

async function handleGoAutonomous() {
    if (currentTask) {
        currentTask.isTraining = false;
        addToScratchpad(`System: User has clicked 'Go Autonomous'. Stopping learning mode and triggering a replan.`);
        chrome.tabs.sendMessage(currentTask.tabs[currentTask.activeTabName], { action: 'STOP_LEARNING' });
        await handleStuckState(true);
    }
}

async function handleStuckState(isUserInitiated = false) {
    if (!currentTask) return;

    let failureReason = `The action '${currentTask.lastFailedAction?.action}' on selector '${currentTask.lastFailedAction?.selector}' has failed multiple times.`;
    if (isUserInitiated) {
        failureReason = "User has performed some actions and is handing control back to the agent.";
    } else if (!currentTask.lastFailedAction) {
        failureReason = "The agent was unable to decide on a next action from the current state.";
    }

    addToScratchpad(`System Alert: ${failureReason} I must re-plan my approach.`);
    updateTaskStatus('REPLANNING');

    const enrichedContext: EnrichedContext = {
        originalGoal: currentTask.originalGoal,
        researchData: currentTask.researchData,
    };

    const replanContext = {
        failedPlan: currentTask.plan,
        failingStep: currentTask.currentStep + 1,
        history: currentTask.scratchpad.slice(-10),
        isUserInitiated: isUserInitiated,
        websiteFailures: currentTask.websiteFailures
    };
    const newPlanDecision = await getPlannerDecision(enrichedContext, replanContext);
    if (newPlanDecision) {
        await agentOrchestrator('REPLAN_COMPLETE', newPlanDecision);
    } else {
        await agentOrchestrator('REPLAN_FAILED');
    }
}

async function runNextTurn() {
    if (!currentTask || ['COMPLETED', 'FAILED', 'STOPPED', 'USER_INPUT_PENDING', 'TEACHING', 'RESEARCHING', 'WAITING', 'AWAITING_CREDENTIAL_NAME', 'AWAITING_PASSPHRASE'].includes(currentTask.status)) {
        console.log("Agent turn skipped, task is in a non-execution state:", currentTask?.status);
        return;
    }


    if (currentTask.plan.length === 0) {
        const presenterDecision = await getPresenterDecision('ANSWER', 'All necessary information was gathered during the research phase.');
        if (presenterDecision) {
            currentTask.finalAnswer = presenterDecision.summary;
            updateTaskStatus('COMPLETED');
            saveCompletedTask();
        } else {
            updateTaskStatus('FAILED', 'Presenter agent failed to generate a final answer from research data.');
        }
        return;
    }

    if (Object.keys(currentTask.tabs).length === 0) {
        const startTab = await getStartTab();
        if (!startTab || !startTab.id) {
            updateTaskStatus('FAILED', 'Could not get a valid browser tab to start the task.');
            return;
        }
        currentTask.tabs['main'] = startTab.id;
    }


    currentTask.turn++;
    updateTaskStatus('THINKING');

    const activeTabId = currentTask.tabs[currentTask.activeTabName];
    let pageSnapshot;
    try {
        const observationPromise = observeCurrentState(activeTabId);
        pageSnapshot = await withTimeout(
            observationPromise,
            120000, // 2-minute timeout
            new Error('Page observation timed out. The website may be stuck in a loading state.')
        );

    } catch (error: any) {
        if (currentTask) {
            const activeTab = await chrome.tabs.get(activeTabId).catch(() => null);
            const hostname = activeTab?.url ? new URL(activeTab.url).hostname : 'unknown_site';

            currentTask.websiteFailures[hostname] = (currentTask.websiteFailures[hostname] || 0) + 1;

            addToScratchpad(`System Alert: Failed to observe ${hostname}. Reason: ${error.message}. Failure count for this site is now ${currentTask.websiteFailures[hostname]}. Triggering a replan.`);
        } else {
            addToScratchpad(`System Alert: Failed to observe the current tab. It may have crashed or been closed. Triggering a replan.`);
        }

        await handleStuckState();
        return;
    }


    if (!pageSnapshot) {
        updateTaskStatus('FAILED', `Could not observe the current tab: ${currentTask.activeTabName}`);
        return;
    }

    const truncatedSnapshot = {
        ...pageSnapshot,
        mainContent: pageSnapshot.mainContent.substring(0, 4000),
        interactiveElements: pageSnapshot.interactiveElements.slice(0, 50)
    };

    addToScratchpad(`Observation on tab '${currentTask.activeTabName}': The page title is "${pageSnapshot.title}". Snapshot has been truncated for efficiency.`);

    const currentUrl = new URL(pageSnapshot.url);
    const allLearnedTools = await getLearnedToolsForHost(currentUrl.hostname);
    const relevantTool = await getRelevantLearnedTool(currentTask.originalGoal, allLearnedTools);

    try {
        const decision = await getManagerDecision(truncatedSnapshot, relevantTool);
        if (decision) {
            await agentOrchestrator('ACTION_COMPLETE', decision);
        } else {
            addToScratchpad(`System Alert: The Manager agent failed to produce a decision. Attempting to recover by replanning.`);
            await handleStuckState();
        }
    } catch (error) {
        // @ts-ignore
        if (error instanceof Error && error.message.includes('API_LIMIT_REACHED')) {
            // @ts-ignore
            addToScratchpad(`System Alert: ${error.message}`);
            const presenterDecision = await getPresenterDecision('PARTIAL_SUCCESS', error.message);
             if (presenterDecision) {
                currentTask.finalAnswer = presenterDecision.summary;
                if (presenterDecision.call_to_action) {
                    currentTask.finalAnswer += `\n\n${presenterDecision.call_to_action}`;
                }
                currentTask.isPartialSuccess = true;
                updateTaskStatus('COMPLETED');
                saveCompletedTask();
            } else {
                updateTaskStatus('STOPPED', 'API limit reached during partial autonomous execution.');
            }
        } else {
            addToScratchpad(`System Alert: The Manager agent encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}. Attempting to recover by replanning.`);
            await handleStuckState();
        }
    }
}

async function handleAction(decision: ManagerDecision) {
    if (!currentTask) return;

    if (!decision || !decision.action) {
        addToScratchpad(`System Alert: The manager failed to return a valid action. Triggering a replan.`);
        await handleStuckState();
        return;
    }

    const needsVerification = ['GOTO', 'OPEN_TAB'].includes(decision.action) || (decision.action === 'CLICK' && decision.selector?.toLowerCase().includes('a'));

    if (needsVerification && decision.url) {
        updateTaskStatus('VERIFYING');
        addToScratchpad(`Verifying URL: ${decision.url}`);
        const verifierDecision = await getVerifierDecision(decision.url);

        if (verifierDecision && !verifierDecision.is_safe) {
            addToScratchpad(`Security Alert: Navigation to ${decision.url} blocked. Reason: ${verifierDecision.reason}`);
            await agentOrchestrator('ACTION_FAILED', { decision });
            return;
        }
        addToScratchpad(`Verification successful. Proceeding with action.`);
    }


    updateTaskStatus('EXECUTING');

    if (decision.thought) {
        addToScratchpad(`Turn ${currentTask.turn}: ${decision.thought}`);
    } else {
        addToScratchpad(`Turn ${currentTask.turn}: Warning - The manager decided on an action without providing a thought.`);
    }

    let preActionTabIds: number[] = [];
    if (decision.action === 'CLICK' || decision.action === 'SUBMIT') {
        const tabs = await chrome.tabs.query({});
        preActionTabIds = tabs.map(t => t.id).filter((id): id is number => id !== undefined);
    }

    let targetTabId: number | undefined;
    let success = true;

    switch (decision.action) {
        case 'OPEN_TAB':
            const newTab = await chrome.tabs.create({ url: decision.url, active: true });
            if (newTab && newTab.id) {
                const newTabName = decision.tabName || `tab_${Object.keys(currentTask.tabs).length + 1}`;
                currentTask.tabs[newTabName] = newTab.id;
                currentTask.activeTabName = newTabName;
                targetTabId = newTab.id;
                addToScratchpad(`Action: Opened new tab named '${newTabName}' and switched focus.`);
            } else {
                addToScratchpad(`Failed to open new tab.`);
                success = false;
            }
            break;

        case 'CHANGE_TAB':
            targetTabId = currentTask.tabs[decision.tabName || ''];
            if (!decision.tabName || !targetTabId) {
                addToScratchpad(`Failed to change tab: Tab name '${decision.tabName}' does not exist.`);
                success = false;
            } else {
                await chrome.tabs.update(targetTabId, { active: true });
                currentTask.activeTabName = decision.tabName;
                addToScratchpad(`Action: Changed active tab to '${decision.tabName}'.`);
            }
            break;

        case 'CLICK':
        case 'TYPE':
        case 'GOTO':
        case 'SUBMIT':
        case 'SEARCH':
        case 'SCROLL_DOWN':
        case 'PRESS_ESCAPE':
        case 'READ':
        case 'EXTRACT_TEXT':
        case 'SEARCH_PAGE':
            const targetTabNameForAction = decision.tabName || currentTask.activeTabName;
            targetTabId = currentTask.tabs[targetTabNameForAction];
            if (!targetTabId) {
                addToScratchpad(`Failed to execute action '${decision.action}'. Reason: Agent tried to act on a tab named '${targetTabNameForAction}' which does not exist.`);
                success = false;
            } else {
                await chrome.tabs.update(targetTabId, { active: true });
                currentTask.activeTabName = targetTabNameForAction;
                const actionToExecute = decision.action === 'READ'
                    ? { ...decision, action: 'EXTRACT_TEXT', selector: 'body' } as ManagerDecision
                    : decision;
                success = await executeAction(actionToExecute, targetTabId);
            }
            break;

        case 'WAIT':
            const waitDuration = decision.duration || 3000;
            addToScratchpad(`Action: Waiting for ${waitDuration / 1000} seconds for page to settle.`);
            await new Promise(resolve => setTimeout(resolve, waitDuration));
            break;
        case 'LONG_WAIT':
            const longWaitDuration = 5 * 60 * 1000; // 5 minutes
            updateTaskStatus('WAITING');
            addToScratchpad(`Action: Beginning a long wait for a generative process to complete. The agent will resume in 5 minutes.`);
            // @ts-ignore
            currentTask.waitTimeoutId = setTimeout(() => {
                if (currentTask && currentTask.status === 'WAITING') {
                    addToScratchpad("Long wait complete. Resuming task.");
                    // @ts-ignore
                    currentTask.waitTimeoutId = undefined;
                    agentOrchestrator('ACTION_COMPLETE');
                }
            }, longWaitDuration);
            return;
        case 'SAVE_CREDENTIAL_VALUE':
            if (decision.value) {
                pendingCredentialValue = decision.value;
                updateTaskStatus('AWAITING_CREDENTIAL_NAME');
                addToScratchpad(`I need to save a credential. Please provide a name for it.`);
            } else {
                addToScratchpad(`System Alert: SAVE_CREDENTIAL_VALUE action was called without a value.`);
                await agentOrchestrator('ACTION_FAILED', { decision });
            }
            return; // Pause execution
        case 'HELP_REPLAN':
            addToScratchpad("Action: Agent has requested help and is triggering a replan.");
            await handleStuckState();
            return;
        case 'ANSWER':
        case 'PARTIAL_SUCCESS':
            const presenterDecision = await getPresenterDecision(decision.action, decision.reason);
            if (presenterDecision) {
                currentTask.finalAnswer = presenterDecision.summary;
                if (presenterDecision.call_to_action) {
                    currentTask.finalAnswer += `\n\n${presenterDecision.call_to_action}`;
                }
                currentTask.isPartialSuccess = (decision.action === 'PARTIAL_SUCCESS');
                updateTaskStatus('COMPLETED');
                saveCompletedTask();
            } else {
                updateTaskStatus('FAILED', 'Presenter agent failed to generate a final answer.');
            }
            return;
        case 'FAIL':
            updateTaskStatus('FAILED', decision.reason);
            return;
        default:
            addToScratchpad(`System Alert: Manager returned an unknown action: '${(decision as any).action}'. This is a critical error. The agent will attempt to replan.`);
            await handleStuckState();
            return;
    }


    if (success && (decision.action === 'CLICK' || decision.action === 'SUBMIT')) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const postActionTabs = await chrome.tabs.query({});
        const postActionTabIds = postActionTabs.map(t => t.id).filter((id): id is number => id !== undefined);
        const newTabId = postActionTabIds.find(id => !preActionTabIds.includes(id));

        if (newTabId) {
            const newTabName = `tab_${Object.keys(currentTask.tabs).length + 1}`;
            currentTask.tabs[newTabName] = newTabId;
            currentTask.activeTabName = newTabName;
            targetTabId = newTabId;
            addToScratchpad(`System: Detected new tab opened by action. Switched focus to '${newTabName}'.`);
            await chrome.tabs.update(newTabId, { active: true });
        }
    }

    if (targetTabId && ['GOTO', 'CLICK', 'SUBMIT', 'SEARCH', 'OPEN_TAB'].includes(decision.action)) {
        await waitForTabLoad(targetTabId);
    }


    if (decision.action !== 'EXTRACT_TEXT') {
        if (success) {
            await agentOrchestrator('ACTION_COMPLETE');
        } else {
            await agentOrchestrator('ACTION_FAILED', { decision });
        }
    }
}


// --- LLM Communication ---

async function getUserLocation(): Promise<string> {
    return new Promise(async (resolve) => {
        const { defaultLocation } = await chrome.storage.sync.get('defaultLocation');

        try {
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const location = `${position.coords.latitude}, ${position.coords.longitude}`;
                    resolve(location);
                },
                (error) => {
                    console.warn("Geolocation failed:", error.message);
                    if (defaultLocation) {
                        addToScratchpad(`System Alert: Geolocation failed. Using default location from settings: ${defaultLocation}`);
                    }
                    resolve(defaultLocation || 'Not available');
                },
                { timeout: 5000 }
            );
        } catch (error) {
            console.warn("Geolocation API not available.");
            if (defaultLocation) {
                addToScratchpad(`System Alert: Geolocation not available. Using default location from settings: ${defaultLocation}`);
            }
            resolve(defaultLocation || 'Not available');
        }
    });
}


async function getTriageDecision(goal: string): Promise<TriageDecision> {
    const prompt = `
You are a Triage Agent. Your task is to analyze the user's goal and decide whether it should be handled by the "Standard Flow" or the "Deliberate Flow".

-   **Standard Flow:** For: actionable goals where the web would be useful to fulfill the user's request autonomously (e.g., "buy a book," "find the weather," "book a flight", "determine whether to sell bitcoin now", "generate a video", "build an app or a game"), OR, for inherent knowledge (e.g., "what's the first law of thermodynamics")
-   **Deliberate Flow:** For abstract, complex, or strategic problems that require deep analysis, multiple perspectives, and a comprehensive plan (e.g., "solve supply chain issues," "improve customer retention," "develop a marketing strategy").

**User's Goal:** "${goal}"

Based on the goal, which flow should be used?

Respond with ONLY a valid JSON object with a single key, "flow", and the value "Standard_Flow" or "Deliberate_Flow".

**Example 1:**
* **Goal:** "buy a ticket to the new Star Wars movie"
* **Your Output:**
    {
        "flow": "Standard_Flow"
    }

**Example 2:**
* **Goal:** "figure out how to improve my company's cybersecurity posture"
* **Your Output:**
    {
        "flow": "Deliberate_Flow"
    }
`;
    try {
        const response = await geminiCall(prompt, false, GEMINI_FLASH_API_URL, true);
        return response as TriageDecision;
    } catch (error) {
        console.error("Error in Triage Agent:", error);
        return { flow: 'Standard_Flow' };
    }
}

async function getPreflightContext(): Promise<{
    date: string,
    version: string,
    location: string
}> {
    const now = new Date();
    const manifest = chrome.runtime.getManifest();
    const location = await getUserLocation();
    return {
        date: now.toLocaleString(),
        version: manifest.version,
        location: location
    };
}

async function getResearcherFacts(goal: string, location: string): Promise<ResearcherDecision> {
    const prompt = `
You are a world-class AI, acting as the Researcher for a multi-agent system. Your job is to analyze a user's goal, use your built-in Google Search tool to find any necessary real-time information, and then determine if the browser automation agents are needed to complete the task.

**User's Goal:** "${goal}"

**Contextual Information:**
* **User's Location:** ${location}

**Your Task:**
1.  **Analyze the Goal & Context:** Read the user's goal carefully. Use the provided location to resolve any ambiguity (e.g., "the weather" means "the weather in ${location}").
2.  **Use Your Search Tool (If Necessary):** If the goal requires any real-time data (weather, stock prices, news, etc.), use your internal Google Search tool to find it. You can perform multiple searches if needed to gather all the facts.
3.  **Synthesize Facts:** Consolidate all the information you found into a clear, concise list of facts. Each fact should be a question/answer pair.
4.  **CRITICAL: Decide on Next Steps:**
    * If the user's goal is **purely informational** (e.g., "what's the weather?", "who won the game?") and you have found a COMPLETE answer, set \`requires_browser\` to \`false\`.
    * If the user's goal involves an **action** (e.g., "get a lyft", "buy a ticket", "post a tweet"), or further deep research you haven't discovered, even if that action is conditional on the facts you found, you MUST set \`requires_browser\` to \`true\`. Your job is only to gather the facts you know immediately; the Planner and Manager agents will handle the action.
5.  **Respond in JSON:** Your response MUST be a valid JSON object with the following schema. It is inexcusable to not produce correct JSON, either beginning and ending with {} and having the appropriate key/value pairs, or json objects wrapped in an array.
Note: if the answer to a question is long (separate paragraphs, multiple individual events, multiple statistics, multiple sites, etc.), please use <br> inside your answer value, to set a new line at each multiple item, which makes the answer more readable:
    {
        "thought": "Your reasoning for your research and decision.",
        "facts": [
            { "question": "The question you answered", "answer": "The concise answer you found" }
        ],
        "requires_browser": boolean,
        "requires_vault": boolean
    }

**Example 1 (Action-Oriented Goal):**
* **Goal:** "get me a ticket to six flags for tomorrow, if it's not going to rain and if the park is open after 6p"
* **Location:** "Atlanta, GA"
* **Your Output:**
    {
        "thought": "As the user is in Atlanta, the goal is to get a ticket to Six Flags over Georgia, which is an action that requires a browser. The action is conditional on the weather. I used my search tool to find the weather forecast. The action is conditional on the hours of Six Flags over Georgia. I used my search tool to find the park hours. Now the Planner agent needs to take this information and proceed with the action.",
        "facts": [
            { "question": "Will it rain in Atlanta, GA tomorrow?", "answer": "Yes, there is a 60% chance of thunderstorms." },
            { "question": "Park hours for Six Flags Over Georgia tomorrow", "answer": "11a-8p ET" }
        ],
        "requires_browser": true,
        "requires_vault": true
    }

**Example 2 (Purely Informational Goal):**
* **Goal:** "what was the score of the braves game last night"
* **Location:** "Atlanta, GA"
* **Your Output:**
    {
        "thought": "The user is asking a purely informational question. I used my search tool to find the score of the Braves game. No browser action is needed.",
        "facts": [
            { "question": "Score of the Braves game last night", "answer": "The Atlanta Braves won 5-3 against the Phillies." }
        ],
        "requires_browser": false,
        "requires_vault": false
    }

**Example 3 (Long answer):**
* **Goal:** "events in Savannah, GA this weekend"
* **Location:** "Atlanta, GA"
* **Your Output:**
    {
        "thought": "The user is asking a purely informational question. I used my search tool to find a list of events. No browser action is needed.",
        "facts": [
            { "question": "events in Savannah, GA for [date range]", "answer": "Concert: concert A<br>Cooking Class: cooking class<br>Race: racing event" }
        ],
        "requires_browser": false,
        "requires_vault": false
    }

Now produce your JSON object response.

`;

    const response = await geminiCall(prompt, true, GEMINI_FLASH_API_URL, true);
    return response as ResearcherDecision;
}

async function getVerifierDecision(url: string): Promise<VerifierDecision | null> {
    const prompt = `
You are a meticulous, security-conscious AI agent acting as a Verifier. Your sole responsibility is to determine if a given URL is safe for an autonomous browser agent to visit.

**URL to Verify:** "${url}"

**Your Task:**
1.  **Analyze the URL:** Look for common signs of phishing, malware, or suspicious patterns (e.g., misleading domains, excessive subdomains, strange file extensions).
2.  **Make a Safety Decision:** Based on your analysis, decide if the URL is safe.
3.  **Provide a Reason:** Briefly explain your reasoning.
4.  **Respond in JSON:** Your response MUST be a valid JSON object with the following schema:
    {
        "is_safe": boolean,
        "reason": "Your brief analysis."
    }
`;

    try {
        const response = await geminiCall(prompt, false, GEMINI_FLASH_API_URL, true);
        return response as VerifierDecision;
    } catch (error) {
        console.error("Error in Verifier Agent:", error);
        return { is_safe: true, reason: "Verifier agent failed, defaulting to safe." };
    }
}


async function getTeacherSummaryDecision(goal: string, actions: any[]): Promise<TeacherSummaryDecision | null> {
    const prompt = `
You are an expert AI assistant that helps an autonomous agent learn new skills by observing a human.
Your task is to convert a raw log of user actions into a concise, human-readable summary of the process. This summary will be saved to the agent's memory.

**The User's Stated Goal:** "${goal}"

**Raw User Actions Log:**
\`\`\`json
${JSON.stringify(actions, null, 2)}
\`\`\`

**Your Job:**
1.  **Analyze the Actions:** Review the sequence of clicks, types, and waits.
2.  **Synthesize a Narrative:** Write a short, clear, step-by-step summary in the first person, as if you are the agent explaining what you were taught.
3.  **Focus on the 'How':** The summary should describe the process. For example, instead of "I posted a tweet", say "I clicked the text box, typed the message, and then clicked the 'Post' button."
4.  **Be Concise:** Keep the summary to 2-4 sentences.
5.  **Respond in JSON:** Your response MUST be a valid JSON object with a single key, "summary".

**Example:**
* **Goal:** "Post a daily update to Twitter"
* **Your Output:**
    {
      "summary": "I learned how to post a daily update. I need to click the text area with the placeholder 'What is happening?!', type the message, and then click the button labeled 'Post'."
    }
`;

    try {
        const response = await geminiCall(prompt, false, GEMINI_FLASH_API_URL, true);
        return response as TeacherSummaryDecision;
    } catch (error) {
        console.error("Error in Teacher Agent:", error);
        return null;
    }
}

async function getPlannerDecision(context: EnrichedContext, replanContext?: { failedPlan: string[], failingStep: number, history: string[], isUserInitiated?: boolean, websiteFailures?: { [key: string]: number } }): Promise<PlannerDecision | null> {

    const similarTasks = await getSimilarCompletedTasks(context.originalGoal);
    const preflightContext = await getPreflightContext();

    let prompt;
    if (replanContext) {
        if (replanContext.isUserInitiated) {
            prompt = `
**Preflight Checklist:**
* **Current Date & Time:** ${preflightContext.date}
* **Agent Version:** ${preflightContext.version}
* **User's Location:** ${preflightContext.location}
---
You are a world-class AI, acting as a strategic planner. The user has just finished demonstrating some steps and is handing control back to you. You must create a new plan to continue the task from where they left off.

**Original User Goal:** "${context.originalGoal}"

**Original High-Level Plan:**
${replanContext.failedPlan.map((step, i) => `${i + 1}. ${step}`).join('\n')}

**Current Step to Continue From:** Step ${replanContext.failingStep} (${replanContext.failedPlan[replanContext.failingStep - 1] || 'N/A'})

**Recent History (which may include the user's actions):**
${replanContext.history.join('\n')}

**Your Task:**
1.  **Analyze the New Context:** The user has likely changed the state of the web page. Your goal is to create a new, concrete plan to achieve the **"Current Step to Continue From"** and all subsequent high-level steps.
2.  **Create a Plan to CONTINUE:** Your new plan must be a list of simple, actionable browser steps. It should start from the current context. Do NOT repeat steps the user has likely already completed (e.g., if the user just logged in, your first step should not be "Click login button").
NOTE - the autonomous AI has access to a semantic search for nearly any web page it accesses, so you can ask it to look for specific information. Instruct it to use SEARCH_PAGE if it is not having luck finding the right element to click/input/submit.
${!isMobile ? `
**Mobile Constraint:** You are operating on a mobile device. You CANNOT create new tabs. Your entire plan must be executable within the user's currently active browser tab. If the goal requires navigating to a different domain, use the GOTO action to change the URL of the current tab.
` : ''}
4.  **Acknowledge User's Work:** Your "thought" must acknowledge that you are taking over from the user and adapting the plan based on their progress.
5.  Your response MUST be a JSON object with a "thought" and a "plan" (array of strings).

**Example:**
* **Original Plan:** ["Go to delta.com", "Click 'Login'", "Enter username and password", "Find flights"]
* **Current Step to Continue From:** Step 3 (Enter username and password)
* **History shows:** "User demonstrated action: CLICK on selector [data-testid='login-button']..."
* **Your Output:**
{
  "thought": "The user has successfully logged in, advancing past the login step. I will now create a new plan to continue from the current state on the dashboard and proceed with finding flights.",
  "plan": [
    "Find the 'Book a Trip' form on the current page",
    "Enter the departure city from the original goal",
    "Enter the arrival city from the original goal",
    "Click the 'Find Flights' button"
  ]
}

Respond with ONLY the valid JSON object.`;
        } else {
            prompt = `
**Preflight Checklist:**
* **Current Date & Time:** ${preflightContext.date}
* **Agent Version:** ${preflightContext.version}
* **User's Location:** ${preflightContext.location}
---
You are a world-class AI, acting as a strategic planner. Your previous plan failed. You must create a new, more detailed, and robust plan to achieve the user's goal.
**Original User Goal:** "${context.originalGoal}"

**Enriched Context (Real-time data gathered by the Researcher):**
${JSON.stringify(context.researchData, null, 2)}

**The Plan That FAILED:**
${replanContext.failedPlan.map((step, i) => `${i + 1}. ${step}`).join('\n')}

**The Step That FAILED:** Step ${replanContext.failingStep}

**Recent History (What Went Wrong):**
${replanContext.history.join('\n')}

**Website Failure Counts (Site: Number of Failures):**
${JSON.stringify(replanContext.websiteFailures, null, 2)}

**Your Task:**
1.  **Analyze the Failure & Context:** Carefully read the history, research data, and website failure counts.
2.  **CRITICAL FAILURE-HANDLING RULES:**
    * **"Three-Strikes" Rule:** If any website in the \`Website Failure Counts\` has a count of 3 or more, you **MUST NOT** create a plan that uses that website again. Your new plan must try a different website (e.g., Expedia instead of Kayak).
    * **Move On:** If you have already tried several different websites for the same part of the goal (e.g., booking a flight) and they all fail, your new plan **MUST** move on to the next major part of the original goal (e.g., booking the hotel). Do not give up on a goal that has multiple parts! In these cases, the manager's scratchpad will tell the user that one part failed, but YOUR job is to replan for the next part.
    * **Give Up Gracefully:** Only if ALL major parts of the original goal have been attempted and failed, or if there are no other websites or strategies to try for ALL of the parts of the goal, you **MUST** give up. To do this, create a plan with a single step: \`PARTIAL_SUCCESS: Report progress and state that all available options have been exhausted.\`
3.  **Create a Plan to CONTINUE:** Your primary goal is to recover. Your new plan MUST start from the point of failure and contain ONLY the steps needed to complete the goal. Use the enriched context to make the plan more direct. A world-class AI is executing the plan, but you need to give it instructions with a bias for action.
NOTE - the autonomous AI has access to a semantic search for nearly any web page it accesses, so you can ask it to look for specific information. Instruct it to use SEARCH_PAGE if it is not having luck finding the right element to click/input/submit.
    * **Bad Plan:** ["Search for Bitcoin price", "Search for news articles", ...] (This starts over)
    * **Good Plan:** ["Using the known price of $68,000, navigate to the portfolio page", "Enter the sell order", ...] (This uses the context to act directly)
${!isMobile ? `
4.  Instruct the executor to use OPEN_TAB for entirely new actions that should be preserved in case of PARTIAL_SUCCESS, such as a flight versus a hotel, or a Lyft versus a park ticket. This REQUIRES a url parameter that you want the executor to open in that tab. An alternative approach would be to instruct the executor to do a web search in the current tab and open one of the search result links in a new tab.
` : ''}
5.  PARTIAL_SUCCESS: If the scratchpad provides evidence that the manager failed multiple times on the same website, even after using SEARCH_PAGE for the elements, and keeps asking you to replan, then you MUST take one of the following paths, usually in this order: a) use a different webpage for the same goal; b) replan to continue on another part of the goal; c) instruct the manager to use PARTIAL_SUCCESS to report the autonomy on ALL parts of the goal, and ask for user assistance with manual steps.
6.  Your response MUST be a JSON object with a "thought" and a "plan" (array of strings).
Respond with ONLY the valid JSON object.`;
        }
    } else {
        prompt = `
**Preflight Checklist:**
* **Current Date & Time:** ${preflightContext.date}
* **Agent Version:** ${preflightContext.version}
* **User's Location:** ${preflightContext.location}
---
You are a world-class AI, acting as a strategic planner. Your task is to break down a complex user goal into a series of simple, actionable steps for a browser automation agent.

**User Goal:** "${context.originalGoal}"

${isMobile ? `
**Mobile Constraint:** You are operating on a mobile device. You CANNOT create new tabs. Your entire plan must be executable within the user's currently active browser tab. If the goal requires navigating to a different domain, use the GOTO action to change the URL of the current tab.
` : ''}

**isDeliberatePlan:** ${currentTask?.isDeliberatePlan}
**Instruction on Deliberate Plan:** If isDeliberatePlan is true, the plan you are executing is a high-level strategy. It may contain steps that are not achievable through browser automation. If you encounter an insurmountable roadblock (e.g., a task requires physical action, a CAPTCHA, a private login you don't have credentials for), you should not get stuck in a replan loop. Instead, you MUST use the PARTIAL_SUCCESS action to report your progress and the obstacle you encountered.

**Enriched Context (Real-time data gathered by your Researcher):**
${JSON.stringify(context.researchData, null, 2)}

**Historical Examples for Similar Tasks (if available):**
${similarTasks.map(t => `Goal: ${t.goal}\nAnswer: ${t.answer}`).join('\n\n')}

**Your Task:**
1.  **EVALUATE CONDITIONS FIRST:** Before creating any steps, analyze the user's goal for any conditions (e.g., "if the weather is bad..."). Compare the condition to the facts in the Enriched Context. Your 'thought' MUST state your conclusion and whether you will proceed. If a condition is not met, you MUST produce an empty plan and explain why in your thought. However, if a conclusion would be confirmed or denied by further web actions (trying to find flights under $2000), you should produce a plan.
2.  **LEVERAGE THE RESEARCH:** You have been provided with real-time data. This is your ground truth. Your plan MUST be based on these facts. Do NOT create steps to re-discover this particular information.
3.  **Create a Concrete Action Plan:** Based on your evaluation, create a direct, efficient, step-by-step plan for the browser agent. If the research phase provides all necessary information and no browser actions are needed, your plan can be empty.
NOTE - the autonomous AI has access to a semantic search for nearly any web page it accesses, so you can ask it to look for specific information. Instruct it to use SEARCH_PAGE if it is not having luck finding the right element to click/input/submit.
${!isMobile ? `
4.  Instruct the executor to use OPEN_TAB for entirely new actions that should be preserved in case of PARTIAL_SUCCESS, such as a flight versus a hotel, or a Lyft versus a park ticket. This REQUIRES a url parameter that you want the executor to open in that tab. An alternative approach would be to instruct the executor to do a web search in the current tab and open one of the search result links in a new tab.
` : ''}
5.  **HANDLE LONG WAITS:** Only if the plan involves a long-running generative task (like creating a video or complex code), you MUST use the \`LONG_WAIT\` action. You can also optionally precede this with an \`ANSWER\` action to inform the user that the task is underway.
NOTE: LONG_WAIT is NOT to be used for standard waiting for content on non-generative websites. You may use WAIT for that.
6.  Your response MUST be a JSON object with a "thought" and a "plan" (array of strings).

**Example 1 (Condition MET):**
* **Goal:** "book me a Lyft if the weather will be bad tonight"
* **Enriched Context:** [{ "question": "weather in Atlanta, GA tonight", "answer": "Thunderstorms" }]
* **Your Output:**
    {
      "thought": "The user wants me to book a Lyft if the weather is bad. The research shows the weather will be 'Thunderstorms', which qualifies as bad weather. Therefore, I will proceed with a plan to book a Lyft.",
      "plan": [
        "Go to lyft.com.",
        "Log in to the user's account.",
        "Enter the destination for the concert.",
        "Confirm and book the ride."
      ]
    }

**Example 2 (Condition NOT MET):**
* **Goal:** "book me a Lyft if the weather will be bad tonight"
* **Enriched Context:** [{ "question": "weather in Atlanta, GA tonight", "answer": "Clear skies" }]
* **Your Output:**
    {
        "thought": "The user wants me to book a Lyft if the weather is bad. The research shows the weather will be 'Clear skies', which does not qualify as bad weather. Therefore, I will not book a Lyft and will create an empty plan.",
        "plan": []
    }

**Example 3 (Software Development):**
* **Goal:** "build a complete snake game"
* **Enriched Context:** []
* **Your Output:**
{
  "thought": "The user wants to build a snake game. I need to set up a new repo for this, and ask Google Jules to build the game.",
  "plan": [
    "Browse to https://www.Github.com.",
    "Read the page and click the 'New' repository button.",
    "Type 'snake-game' into the repository name input and click the 'Create repository' button.",
    "Read the new repository page to confirm it was created successfully.",
    "Open a new tab and browse to https://jules.google.com.",
    "Read the page, select the 'snake-game' repository from the drop-down.",
    "Create a complete prompt for Jules to create a snake game, and type it in the prompt box.",
    "Click the 'Create Plan' button.",
    "Read the page to determine if Jules was successful, and notify the user."
  ]
}

**Example 4 (Generative Content with LONG_WAIT):**
* **Goal:** "make a video of a monkey on a motorcycle"
* **Enriched Context:** []
* **Your Output:**
{
  "thought": "The user wants to generate a video. I will use a generative video tool, which can take a long time. I will first inform the user that the process has started, and then initiate the long wait.",
  "plan": [
    "Go to Google Gemini.",
    "If necessary based on the page content, select the video generation tool.",
    "Find the prompt box and create a prompt to generate the requested video.",
    "ANSWER: The video generation process has started. This may take several minutes.",
    "LONG_WAIT: Wait for the generative process to complete."
  ]
}

Now respond with ONLY the valid JSON object.`;
    }

    try {
        const response = await geminiCall(prompt, false, GEMINI_FLASH_API_URL, true);
        return response as PlannerDecision;
    } catch (error) {
        console.error("Error in Gemini Planner:", error);
        return null;
    }
}

async function getManagerDecision(pageSnapshot: any, learnedTools?: any): Promise<ManagerDecision | null> {
    const preflightContext = await getPreflightContext();
    const prompt = `
${preflightContext}
You are a meticulous, strategic, autonomous agent. Your job is to execute a plan step-by-step.

**High-Level Plan:**
${currentTask?.plan.map((step, i) => `${i + 1}. ${step}`).join('\n')}

**Current Step to Focus On:**
${currentTask?.plan[currentTask.currentStep]}

**isDeliberatePlan:** ${currentTask?.isDeliberatePlan}
**Instruction on Deliberate Plan:** If isDeliberatePlan is true, the plan you are executing is a high-level strategy. It may contain steps that are not achievable through browser automation. If you encounter an insurmountable roadblock (e.g., a task requires physical action, a CAPTCHA, a private login you don't have credentials for), you should not get stuck in a replan loop. Instead, you MUST use the PARTIAL_SUCCESS action to report your progress and the obstacle you encountered.

**Your Scratchpad (Recent History):**
${currentTask?.scratchpad.slice(-5).join('\n')}

**Your Tabs:**
${JSON.stringify(currentTask?.tabs, null, 2)}
You are currently observing tab: "${currentTask?.activeTabName}"

**Current Web Page Snapshot (from tab "${currentTask?.activeTabName}"):**
\`\`\`json
${JSON.stringify(pageSnapshot, null, 2)}
\`\`\`

**Learned Tools for this Website:**
\`\`\`json
${JSON.stringify(learnedTools, null, 2)}
\`\`\`

**Your Imperative Task:**
Decide on the single next action to advance the current step.

**Response Rules & Best Practices:**
1.  **THINK FIRST:** You MUST provide a 'thought' explaining your reasoning for every single action. No exceptions.
2.  **EXECUTE THE PLAN:** Your primary goal is to execute the current step of the plan. If the plan step is "LONG_WAIT: ...", you MUST use the \`LONG_WAIT\` action.
    **If the current step is "PARTIAL_SUCCESS:...", this is a direct order from the Planner to end the task. You MUST use the \`PARTIAL_SUCCESS\` action. For the 'reason' field, you MUST write your own concise summary based on the scratchpad history explaining *why* the task could not be completed (e.g., "All attempted flight search websites failed to load." or "The required login button could not be found after multiple replans.").**
3.  **BIAS FOR COMPLETION:** Before taking any action, review your scratchpad. If you believe you have gathered enough information to comprehensively answer the user's original goal, you MUST use the \`ANSWER\` action immediately. Do not continue with the plan if you can already provide a complete solution.
4.  **RECOVER FROM FAILURES:** If the scratchpad shows that your last action failed, you MUST try a different approach. Do not repeat the exact same failed action. Try a different selector, a different action, or use \`HELP_REPLAN\` if you are truly stuck.
5.  **USE LEARNED TOOLS:** If a learned tool exists for the current task, prioritize using it.
6.  **USE THE RIGHT TOOL:** For search bars, you MUST use the 'SEARCH' action which types and submits. Do not use 'TYPE' alone on a search bar.
7.  **BE METHODICAL WITH SEARCHING AND CONSUMING CONTENT:**
    * If a page seems empty, is obscured by a popup, or lacks content, your first attempt to fix it should be 'PRESS_ESCAPE'.
    * You have a semantic search tool for most web pages. If you cannot find what you need in the 'interactiveElements', your first instinct should be to use 'SEARCH_PAGE' with a 'query' to find relevant text chunks. This is more reliable than guessing selectors.
    * Make sure to record valuable information that you find on the visited web pages into your scratchpad, so that you can make use of it to answer the user's question or fulfill the user's goal.
8.  **USE VALID SELECTORS:** Your 'selector' MUST be a valid CSS selector copied directly from the 'interactiveElements' in the snapshot (e.g., "[data-beachdai-id='beachdai-id-39']"). Do NOT invent selectors or use pseudo-classes like ':has-text'.
9.  **MANAGE TABS:**
${isMobile ? `
    * **Mobile Constraint:** You are on a mobile device. You must perform all actions on the single, active tab. Do not attempt to open or switch tabs. Start your work on the tab the user has open.
` : `
    * **Opening Tabs:** To open a URL in a new tab, MUST use \`OPEN_TAB\`. This REQUIRES a url parameter that you want to open in that tab. You can optionally provide a logical \`tabName\` for it (e.g., "delta_flights", "hotel_search"). If you don't provide a name, one will be created. The new tab automatically becomes the active one.
    * **Switching Tabs:** To switch to an *existing* tab, use \`CHANGE_TAB\` and provide its name from the "Your Tabs" list.
    * **Acting on Tabs:** For actions like \`CLICK\` or \`TYPE\`, if you want to act on a tab that isn't the active one, provide its existing \`tabName\`. If you don't specify a \`tabName\`, the action will happen on the active tab.
    * **CRITICAL:** Do NOT invent tab names for any action *except* \`OPEN_TAB\`.
`}
10. **NEVER GET STUCK:** If you are truly stuck (e.g., repeated failures, page not loading correctly), use 'HELP_REPLAN'. This is your primary escape hatch. Do not invent new actions.
11. **ANSWER **ONLY AT THE END OF A PLAN**:** ONLY IF A PLAN IS COMPLETE! Only if you succeeded in executing ALL the planner's steps, may you provide an 'ANSWER' summarizing your scratchpad analysis or your autonomous work when the plan is complete. You may NOT use 'ANSWER' if the remaining steps in the plan contain real actions. You must consider using HELP_REPLAN or PARTIAL_SUCCESS in those circumstances. If you didn't succeed on every step, and the user would need to continue to help, that's not a ANSWER, that's a PARTIAL_SUCCESS.
12. **THE MEANING OF PARTIAL SUCCESS:** There is a PARTIAL_SUCCESS action. Use this action if you have tried and failed to complete all parts of the plan goal autonomously. The goal of PARTIAL_SUCCESS is to report that you tried to fulfill the entire goal, but unlike ANSWER, one or more parts of the goal didn't succeed. You are part of an autonomous system and there is no such thing as failure, just replanning or PARTIAL_SUCCESS.
13. **TERMINAL ACTIONS REQUIRE A REASON:** When ending a task, you MUST provide a 'reason'. This applies to the actions: 'ANSWER' and 'PARTIAL_SUCCESS'. A reason for PARTIAL_SUCCESS should include a concise summary of ALL of the autonomy you attempted for the parts of the goal, e.g. "I tried to plan flights and hotel. I retrieved some hotel results but was unable to find flight results."
14. **SAVING CREDENTIALS:** When you TYPE sensitive information (like a password or API key), you MUST immediately follow up with a 'SAVE_CREDENTIAL_VALUE' action in the next turn. The 'value' should be the exact text you just typed. The system will then ask the user to name this credential for future use.
15. **VALID ACTIONS ONLY:** Your 'action' MUST be one of the following: 'SEARCH', 'CLICK', 'TYPE', 'GOTO', 'SUBMIT', ${isMobile ? '' : "'OPEN_TAB', 'CHANGE_TAB',"} 'READ', 'ANSWER', 'WAIT', 'LONG_WAIT', 'HELP_REPLAN', 'SCROLL_DOWN', 'PRESS_ESCAPE', 'EXTRACT_TEXT', 'SEARCH_PAGE', 'PARTIAL_SUCCESS', 'SAVE_CREDENTIAL_VALUE'.

YOUR RESPONSE MUST BE IN A VALID JSON OBJECT! Your thought should be a concise summary of current conditions, in less than 500 characters.

**Action Examples:**
* **Searching:**
    {
        "thought": "I am on the Google search page. I need to search for 'current Bitcoin price'. The search bar is the textarea with selector '[data-beachdai-id='beachdai-id-8']'.",
        "action": "SEARCH",
        "selector": "[data-beachdai-id='beachdai-id-8']",
        "text": "current Bitcoin price"
    }
* **Replanning when stuck:**
    {
        "thought": "I have tried multiple times to click the button, but it's not working and I cannot find another way to proceed on this page. I need a new plan.",
        "action": "HELP_REPLAN"
    }
* **Answering when the goal is complete:**
    {
        "thought": "I have gathered all the necessary information (price and market sentiment) to answer the user's question about selling Bitcoin.",
        "action": "ANSWER",
        "reason": "Successfully found the current price and recent news articles to form a complete answer."
    }
* **Opening a new tab:**
    {
        "thought": "I need to start the flight search. I will open a new tab to the Delta website and name it 'delta_search' for future reference.",
        "action": "OPEN_TAB",
        "url": "https://www.delta.com",
        "tabName": "delta_search"
    }
* **Changing to an existing tab:**
    {
        "thought": "I have finished my work on the 'google_hotels' tab and now I need to go back to the 'delta_search' tab to continue booking the flight.",
        "action": "CHANGE_TAB",
        "tabName": "delta_search"
    }
* **Saving a Credential:**
    {
        "thought": "I just typed a password into the password field. I must now save this value to the vault so I can use it later without asking again.",
        "action": "SAVE_CREDENTIAL_VALUE",
        "value": "S3cureP@ssw0rd!"
    }
* **Reverting to partial success when the goal is impossible:**
    {
        "thought": "The plan requires me to log into a website, but the snapshot shows no login fields and I have no credentials. I have replanned and I have tried a different approach and I cannot proceed.",
        "action": "PARTIAL_SUCCESS",
        "reason": "The target website does not have the required login functionality to complete the task."
    }

* **Reverting to partial success when information that only the user can provide is not available and can't possibly be inferred:**
    {
        "thought": "Part of the goal to get a ticket to six flags has been met, but I do not know the precise location for Lyft pickup. The user would have to provide this.",
        "action": "PARTIAL_SUCCESS",
        "reason": "Some of our plan has succeeded, but we need the user to provide a location for Lyft pickup."
    }

Now respond with ONLY a valid JSON object similar to those examples.`;

    try {
        const response = await geminiCall(prompt, false, GEMINI_FLASH_API_URL, true);
        return response as ManagerDecision;
    } catch (error) {
        console.error("Error in Gemini Manager:", error);
        return null;
    }
}

async function getPresenterDecision(action: 'ANSWER' | 'PARTIAL_SUCCESS', managerReason?: string): Promise<PresenterDecision | null> {
    if (!currentTask) return null;

    const manifest = chrome.runtime.getManifest();
    const appInfo = `BeachdAI ${manifest.version} - `;

    const prompt = `
You are a brilliant and concise Presenter AI. Your job is to synthesize the results of a web automation task and present the final answer to the user. You will be given the original goal, the full execution log (the scratchpad), and the final outcome from the Manager or Planner agent.

**Original User Goal:**
${currentTask.originalGoal}

**Full Execution Log (Scratchpad):**
${currentTask.scratchpad.join('\n')}

**Final Action:** ${action}
**Reason:** ${managerReason || 'N/A'}

**REQUIRED: APP / VERSION INFO:** ${appInfo}

**Your Task:**
1.  **Analyze the Scratchpad:** Read the entire log to understand what the agent accomplished.
2.  **CRITICAL: Format with HTML.** Your summary will be rendered as HTML. You **MUST** use either plain text orHTML tags for all formatting. For lists of items, use a \`<ul>\` tag with \`<li>\` tags for each item. Use \`<br>\` for line breaks and \`<strong>\` for bold text. Do not use Markdown (\`*\`, \`#\`, etc.).
2a.  **CRITICAL: Sanitize the Output.** Your summary MUST be clean and user-friendly. Remove any source citations like '[1]', '[2]', etc., and present the information in a readable, narrative format.
3.  **CRITICAL: Check for Conditional Logic.** Look for the last "Planner thought" in the scratchpad. If that thought indicates that a plan was empty because a user's condition was not met, your summary MUST reflect that reality.
4.  **Synthesize a Final Summary:** Based on your analysis, it is your job to create the best presentation that directly addresses the user's original goal. Your summary should be a direct answer to a user question (e.g. whether to sell Bitcoin = an honest evaluation, not a direction to the user to do their own research) - OR - a concise and friendly overview of the successful autonomous actions towards the user's goal (e.g. the steps taken by BeachdAI on the user's behalf for software development, content generation, booking a vacation, etc.). **NEVER** ask a user to help with synthesis or analysis of their own QUESTION. You are an excellent summarizer.
5.  **Determine Call to Action:**
    * If the final action was 'ANSWER', the task is fully complete. Your 'call_to_action' MUST be null.
    ${isMobile ? `* **MOBILE-SPECIFIC INSTRUCTION:** If the final action was 'PARTIAL_SUCCESS', your 'call_to_action' MUST be exactly: "I can attempt to continue autonomously, or you can plan a new task."` : `* If the final action was 'PARTIAL_SUCCESS', the overall goal is incomplete. Your 'call_to_action' MUST be a friendly message drawing their attention to the 'Take Over' and 'Replan From Here' options.`}
6.  **Respond in JSON:** Your response MUST be a valid JSON object with the following schema, and the summary must begin with ${appInfo} and <br>. You are the final presenter, and it is inexcusable to produce a response that is not a JSON object with HTML tags.
    {
        "summary": "${appInfo}<br>Your full, synthesized answer for the user.",
        "call_to_action": "Your call to action text, or null if the task was a full success."
    }

**Example 1 (Conditional Goal - Condition NOT Met):**
* **Scratchpad includes:** "Planner thought: The user wants me to book a Lyft if the weather is bad... The research shows the weather will be 'Clear skies', which does not qualify as bad weather. Therefore, I will not book a Lyft and will create an empty plan."
* **Your Output:**
{
    "summary": "${appInfo}<br>As requested, I checked the weather for Monday. The forecast shows clear skies, so the condition to book a Lyft was not met and no further action was taken.",
    "call_to_action": null
}

**Example 2 (Normal Success):**
* **Scratchpad includes:** Log of successful web automation.
* **Your Output:**
{
    "summary": "${appInfo}<br>I have successfully bought a ticket to Six Flags for you: I checked the weather, confirmed the park was open, and visited SixFlags.com to purchase the ticket.",
    "call_to_action": null
}

**Example 3 (Partial Success):**
* **Scratchpad includes:** Log of partial success.
* **Your Output:**
{
    "summary": "${appInfo}<br>I was able to gather the current Bitcoin price ($114,233.06) and its 30-day trend (down 3.92%). However, I was unable to access recent news articles due to a paywall.",
    "call_to_action": ${isMobile ? `"I can attempt to continue autonomously, or you can plan a new task."` : `"I can attempt to continue autonomously if you use 'Replan From Here', or you can use the 'Take Over' option and I will learn from you."`}
}

**Example 4 (long answer to be presented from researcher):**
* (answer from researcher)
* **Your Output:**
{
    "summary": "${appInfo}<br>Concert: concert A<br>Cooking Class: cooking class<br>Race: racing event",
    "call_to_action": null
}

`;

    try {
        const response = await geminiCall(prompt, false, GEMINI_FLASH_API_URL, true);
        return response as PresenterDecision;
    } catch (error) {
        console.error("Error in Presenter Agent:", error);
        return null;
    }
}


async function geminiCall(prompt: string, useTool = false, model: string = GEMINI_FLASH_API_URL, expectJson = true): Promise<any> {
    const { googleApiKey } = await chrome.storage.sync.get('googleApiKey');
    if (!googleApiKey) {
        throw new Error("Google API key not found. Please set it in the extension options.");
    }

    const maxRetries = 5;
    let attempt = 0;

    const body: any = {
        contents: [{ parts: [{ text: prompt }] }],
    };

    if (useTool) {
        body.tools = [{ "google_search": {} }];
    } else if (expectJson) {
        // We will ask for JSON but handle potential text responses during self-healing
        body.generationConfig = { responseMimeType: "application/json" };
    }

    let response: Response | null = null;
    let responseText = '';

    while (attempt < maxRetries) {
        attempt++;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                console.warn(`Gemini API call timed out after 90 seconds.`);
                controller.abort();
            }, 90000);

            response = await fetch(`${model}?key=${googleApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                responseText = await response.text();
                break;
            }

            if (response.status === 503 || response.status === 429) {
                throw new Error(`Gemini API error: ${response.status}. Retrying...`);
            }

            console.error(`Gemini API returned a non-retryable error: ${response.status}`);
            break;

        } catch (error: any) {
            console.warn(`geminiCall network attempt ${attempt} failed: ${error.message}`);
            if (attempt >= maxRetries) {
                console.error("Gemini API call failed after multiple retries on network errors.", error);
                throw error;
            }
            const delay = (Math.pow(2, attempt) * 1000) + (Math.random() * 1000);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    if (!response || !response.ok) {
        const errorBody = await response?.text().catch(() => "Could not read error body.");
        throw new Error(`Gemini API call failed to get a successful response. Final status: ${response?.status}. Body: ${errorBody}`);
    }

    try {
        const result = JSON.parse(responseText);
        const textPart = result.candidates?.[0]?.content?.parts?.find((part: any) => part.text);

        if (!textPart) {
            throw new Error("No text part found in Gemini response.");
        }

        const textContent = textPart.text;

        if (expectJson) {
             try {
                return JSON.parse(textContent);
            } catch (initialParseError) {
                console.warn("Initial JSON.parse failed on text content. Trying to find JSON within the string.", initialParseError);

                const jsonStart = textContent.indexOf('{');
                const jsonEnd = textContent.lastIndexOf('}');
                const arrayStart = textContent.indexOf('[');
                const arrayEnd = textContent.lastIndexOf(']');

                let jsonString = '';
                if (jsonStart !== -1 && jsonEnd > jsonStart) {
                    jsonString = textContent.substring(jsonStart, jsonEnd + 1);
                } else if (arrayStart !== -1 && arrayEnd > arrayStart) {
                    jsonString = textContent.substring(arrayStart, arrayEnd + 1);
                }

                if (jsonString) {
                    try {
                        // FIX: Sanitize the extracted string to remove bad control characters
                        // before the final parse attempt. This handles unescaped newlines.
                        const sanitizedJsonString = jsonString.replace(/[\n\r\t]/g, '');
                        return JSON.parse(sanitizedJsonString);
                    } catch (e) {
                         throw new Error(`Failed to parse extracted JSON. Content: "${jsonString}"`);
                    }
                }
                throw new Error(`Could not find a valid JSON object or array in the text content. Full response: "${textContent}"`);
            }
        } else {
            return textContent;
        }

    } catch (e: any) {
        if (expectJson && e instanceof SyntaxError) {
            console.warn("Malformed JSON detected. Attempting self-healing by asking the model to fix it.");
            const correctionPrompt = `The following text is supposed to be a single, valid JSON object, but it is malformed. Please fix it. Pay special attention to unescaped double quotes within string values. Respond with ONLY the corrected, valid JSON object and nothing else.\n\nMalformed Text:\n\`\`\`\n${responseText}\n\`\`\`\n`;

            // Make a new call to the LLM to fix the broken JSON.
            // Note: We set expectJson=false here because the model might return the corrected JSON wrapped in markdown.
            const correctedResponseText = await geminiCall(correctionPrompt, false, model, false);

            const jsonStart = correctedResponseText.indexOf('{');
            const jsonEnd = correctedResponseText.lastIndexOf('}');
            const arrayStart = correctedResponseText.indexOf('[');
            const arrayEnd = correctedResponseText.lastIndexOf(']');

            let jsonString = '';
             if (jsonStart !== -1 && jsonEnd > jsonStart) {
                jsonString = correctedResponseText.substring(jsonStart, jsonEnd + 1);
            } else if (arrayStart !== -1 && arrayEnd > arrayStart) {
                jsonString = correctedResponseText.substring(arrayStart, arrayEnd + 1);
            }

            if (jsonString) {
                try {
                    // One final parse attempt on the cleaned string
                    return JSON.parse(jsonString);
                } catch (finalError) {
                    console.error("JSON self-healing failed. The model did not return a parsable object.", finalError);
                    throw new Error(`Self-healing failed. Final corrected text was not valid JSON: "${jsonString}"`);
                }
            } else {
                 throw new Error(`Self-healing failed. Could not extract JSON from corrected text: "${correctedResponseText}"`);
            }
        }
        // If it's not a syntax error or we weren't expecting JSON, re-throw the original error.
        throw e;
    }
}

function updateTaskStatus(status: TaskStatus, reason?: string) {
    if (currentTask) {
        currentTask.status = status;
        if (reason) {
            currentTask.failureReason = reason;
            addToScratchpad(`Error: ${reason}`);
        }
        updateUI();
    }
}

function addToScratchpad(log: string) {
    if (currentTask) {
        console.log(`[Scratchpad] ${log}`);
        currentTask.scratchpad.push(log);
        updateUI();
    }
}

function updateUI() {
    if (currentTask) {
        chrome.runtime.sendMessage({ type: 'TASK_UPDATE', task: { ...currentTask } });
        sendStateToWearable();
    }
}

async function getStartTab(): Promise<chrome.tabs.Tab | null> {
    try {
        const { newTaskUrl = 'https://www.google.com' } = await chrome.storage.sync.get('newTaskUrl');
        addToScratchpad(`Starting task on a new tab with URL: ${newTaskUrl}`);
        const newTab = await chrome.tabs.create({ url: newTaskUrl, active: true });
        await new Promise(resolve => setTimeout(resolve, 500));
        await waitForTabLoad(newTab.id!);
        return newTab;
    } catch (error) {
        console.error("Error creating new tab:", error);
        return null;
    }
}

async function observeCurrentState(tabId: number): Promise<any | null> {
    try {
        const pageSnapshot = await requestPageSnapshotFromContentScript(tabId);
        return pageSnapshot;
    } catch (error: any) {
        console.error("Error observing current state:", error);
        throw error;
    }
}

async function requestPageSnapshotFromContentScript(tabId: number): Promise<any | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'EXTRACT_PAGE_SNAPSHOT' });
    if (response && response.snapshot) {
        return response.snapshot;
    }
    throw new Error("Empty response from content script");
  } catch (error) {
    console.error(`Error getting page snapshot from tab ${tabId}:`, error);
    throw error;
  }
}

function waitForTabLoad(tabId: number): Promise<void> {
    return new Promise((resolve) => {
      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete' && tab.status === 'complete') {
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 1500);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      chrome.tabs.get(tabId, (tab) => {
        if (tab.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      });
    });
  }

async function executeAction(decision: ManagerDecision, tabId: number): Promise<boolean> {
  let sanitizedDecision = { ...decision };
  if (sanitizedDecision.selector && typeof sanitizedDecision.selector === 'string') {
      const selectorRegex = /\[beachdai-id='(.*?)'\]/;
      const match = sanitizedDecision.selector.match(selectorRegex);
      if (match) {
          const correctedSelector = `[data-beachdai-id='${match[1]}']`;
          console.log(`Corrected selector from '${sanitizedDecision.selector}' to '${correctedSelector}'`);
          sanitizedDecision.selector = correctedSelector;
      }
  }

  try {
    if (sanitizedDecision.action === 'SEARCH') {
        const typePayload = { ...sanitizedDecision, action: 'TYPE' };
        let response = await chrome.tabs.sendMessage(tabId, { action: 'EXECUTE_ACTION', payload: typePayload });
        if (response && response.status === 'Action failed') throw new Error(response.error);

        await new Promise(resolve => setTimeout(resolve, 200));

        const submitPayload = { ...sanitizedDecision, action: 'SUBMIT' };
        response = await chrome.tabs.sendMessage(tabId, { action: 'EXECUTE_ACTION', payload: submitPayload });
        if (response && response.status === 'Action failed') throw new Error(response.error);

    } else if (sanitizedDecision.action === 'SEARCH_PAGE') {
        // @ts-ignore
        const results = await searchPage(sanitizedDecision.query!, tabId);
        addToScratchpad(`Search results for query "${sanitizedDecision.query}":\n${results.join('\n')}`);
    } else {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'EXECUTE_ACTION', payload: sanitizedDecision });
        if (decision.action === 'EXTRACT_TEXT') {
            if (response && response.status === 'Action executed successfully') {
                await agentOrchestrator('TEXT_EXTRACTED', { text: response.text });
            } else {
                throw new Error(response.error || "Failed to extract text.");
            }
        } else if (response && response.status === 'Action failed') {
            throw new Error(response.error);
        }
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
    addToScratchpad(`Failed to execute action '${decision.action}' on selector '${decision.selector}'. Reason: ${errorMessage}`);
    return false;
  }
}

// --- Functions for saving and retrieving learned knowledge ---
async function saveLearnedTool(goal: string, actions: any[]) {
    if (!actions || actions.length === 0) return;

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.url || !activeTab.url.startsWith('http')) {
        console.warn("Skipping tool saving for a non-website tab:", activeTab.url);
        return;
    }
    const url = new URL(activeTab.url);
    const hostname = url.hostname;

    const { learnedTools = {} } = await chrome.storage.local.get('learnedTools');

    if (!learnedTools[hostname]) {
        learnedTools[hostname] = {};
    }

    learnedTools[hostname][goal] = actions;
    await chrome.storage.local.set({ learnedTools });
    console.log("Saved new learned tool for", hostname, `with goal: "${goal}"`);
}


async function saveLearnedAction(payload: any) {
    if (!currentTask) return;
    const tab = await chrome.tabs.get(currentTask.tabs[currentTask.activeTabName]);
    if (!tab.url || !tab.url.startsWith('http')) {
        console.warn("Skipping learning for a non-website tab:", tab.url);
        return;
    }
    const url = new URL(tab.url);
    const hostname = url.hostname;
    const taskDescription = currentTask.plan[currentTask.currentStep] || currentTask.originalGoal;

    const { learnedTools = {} } = await chrome.storage.local.get('learnedTools');

    if (!learnedTools[hostname]) {
        learnedTools[hostname] = {};
    }
    if (!learnedTools[hostname][taskDescription]) {
        learnedTools[hostname][taskDescription] = [];
    }

    learnedTools[hostname][taskDescription].push(payload);
    await chrome.storage.local.set({ learnedTools });
    console.log("Saved learned action for", hostname, taskDescription);
}

async function getLearnedToolsForHost(hostname: string): Promise<any | null> {
    const { learnedTools = {} } = await chrome.storage.local.get('learnedTools');
    return learnedTools[hostname] || null;
}

async function getRelevantLearnedTool(goal: string, allTools: any): Promise<any | null> {
    if (!allTools || Object.keys(allTools).length === 0) {
        return null;
    }

    const toolDescriptions = Object.keys(allTools);
    if (toolDescriptions.length === 0) {
        return null;
    }

    try {
        const extractor = await getPipeline();
        const cos_sim = await getCosSim();

        // Generate embeddings for the goal and all tool descriptions
        const goalEmbedding = await extractor(goal, { pooling: 'mean', normalize: true });
        const toolEmbeddings = await extractor(toolDescriptions, { pooling: 'mean', normalize: true });

        let bestMatch = { score: -1, description: '' };

        // Compare the goal embedding to each tool description embedding
        // @ts-ignore
        const toolEmbeddingsList = toolEmbeddings.tolist();
        for (let i = 0; i < toolEmbeddingsList.length; i++) {
            // @ts-ignore
            const score = cos_sim(Array.from(goalEmbedding.data), toolEmbeddingsList[i]);
            if (score > bestMatch.score) {
                bestMatch = { score: score, description: toolDescriptions[i] };
            }
        }

        // If a sufficiently similar tool is found, return it
        if (bestMatch.score > 0.7) {
            console.log(`Found relevant learned tool '${bestMatch.description}' with similarity score ${bestMatch.score}`);
            // Return a new object with only the relevant tool
            return { [bestMatch.description]: allTools[bestMatch.description] };
        }

    } catch (error) {
        console.error("Error finding relevant learned tool:", error);
        return null; // Don't block execution if similarity check fails
    }

    return null;
}


async function saveCompletedTask() {
    if (!currentTask || !currentTask.finalAnswer) return;

    const { completedTasks = [] } = await chrome.storage.local.get('completedTasks');

    const newCompletedTask: CompletedTask = {
        goal: currentTask.originalGoal,
        answer: currentTask.finalAnswer,
        timestamp: Date.now()
    };

    const updatedTasks = [newCompletedTask, ...completedTasks].slice(0, 50);

    await chrome.storage.local.set({ completedTasks: updatedTasks });
    console.log("Saved completed task:", newCompletedTask.goal);
    await saveHistoricalTask(currentTask.originalGoal);
}

async function getSimilarCompletedTasks(goal: string): Promise<CompletedTask[]> {
    const { completedTasks = [] } = await chrome.storage.local.get('completedTasks');
    const goalKeywords = goal.toLowerCase().split(' ');
    return completedTasks.filter((task: CompletedTask) => {
        const taskKeywords = task.goal.toLowerCase().split(' ');
        const commonKeywords = goalKeywords.filter(k => taskKeywords.includes(k));
        return commonKeywords.length > goalKeywords.length / 2;
    }).slice(0, 3);
}

async function saveHistoricalTask(goal: string) {
    if (!goal || goal.trim() === '') return;

    const { historicalTasks = [] } = await chrome.storage.local.get('historicalTasks');

    const goalExists = historicalTasks.some((task: HistoricalTask) => task.goal === goal);
    if (goalExists) {
        return;
    }

    const newHistoricalTask: HistoricalTask = {
        goal: goal,
        timestamp: Date.now()
    };

    const updatedTasks = [newHistoricalTask, ...historicalTasks].slice(0, 10);

    await chrome.storage.local.set({ historicalTasks: updatedTasks });
    console.log("Saved historical task:", newHistoricalTask.goal);

    chrome.runtime.sendMessage({ type: 'HISTORICAL_TASKS_UPDATE', tasks: updatedTasks });
}

async function handleDeleteHistoricalTask(payload: { timestamp: number }) {
    const { historicalTasks = [] } = await chrome.storage.local.get('historicalTasks');
    const updatedTasks = historicalTasks.filter((task: HistoricalTask) => task.timestamp !== payload.timestamp);
    await chrome.storage.local.set({ historicalTasks: updatedTasks });
    chrome.runtime.sendMessage({ type: 'HISTORICAL_TASKS_UPDATE', tasks: updatedTasks });
}

