/**
 * @file This file contains shared type definitions used across the extension.
 */

// The status of the agent's task.
export type TaskStatus =
  | 'RESEARCHING'
  | 'PLANNING'
  | 'THINKING'
  | 'VERIFYING'
  | 'EXECUTING'
  | 'WAITING'
  | 'COMPLETED'
  | 'FAILED'
  | 'STOPPED'
  | 'REPLANNING'
  | 'USER_INPUT_PENDING'
  | 'TEACHING'
  | 'AWAITING_CREDENTIAL_NAME'
  | 'AWAITING_PASSPHRASE';

// Events that can be sent to the agent orchestrator.
export type AgentEvent =
  | 'START_TASK'
  | 'STOP_TASK'
  // --- FIX: Add the new event to the list of valid agent events ---
  | 'RESET_TASK_SESSION'
  | 'TAKE_OVER'
  | 'GO_AUTONOMOUS'
  | 'RECORDED_ACTION'
  | 'RUN_NEXT_TURN'
  | 'RESEARCH_COMPLETE'
  | 'RESEARCH_FAILED'
  | 'PLAN_COMPLETE'
  | 'PLAN_FAILED'
  | 'ACTION_COMPLETE'
  | 'ACTION_FAILED'
  | 'REPLAN_COMPLETE'
  | 'REPLAN_FAILED'
  | 'TEXT_EXTRACTED'
  | 'START_TEACHING'
  | 'STOP_TEACHING'
  | 'UNLOCK_VAULT'
  | 'GET_HISTORICAL_TASKS'
  | 'HISTORICAL_TASKS_UPDATE'
  | 'ATTEMPT_STRATEGY'
  | 'DELETE_HISTORICAL_TASK'
  | 'SAVE_CREDENTIAL';

// The main state object for a task.
export interface AgentState {
  id: string;
  originalGoal: string;
  status: TaskStatus;
  plan: string[];
  currentStep: number;
  stepFailureCount: number; // This replaces consecutiveFailureCount
  turn: number;
  scratchpad: string[];
  createdAt: number;
  researchData: ResearchData[];
  researcherDecision: ResearcherDecision | null;
  finalAnswer?: string;
  failureReason?: string;
  lastFailedAction: ManagerDecision | null;
  websiteFailures: { [key: string]: number };
  tabs: { [key: string]: number };
  activeTabName: string;
  isTraining: boolean;
  isPartialSuccess?: boolean;
  recordedActions?: any[];
  waitTimeoutId?: NodeJS.Timeout;
  isDeliberatePlan: boolean;
  initialStrategy: string | null;
}

export interface CompletedTask {
    goal: string;
    answer: string;
    timestamp: number;
}

export interface HistoricalTask {
    goal: string;
    timestamp: number;
}

// Decision from the Researcher agent.
export interface ResearcherDecision {
    thought: string;
    facts: ResearchData[];
    requires_browser: boolean;
    requires_vault: boolean; // New field!
}

// --- Other supporting types ---

export interface ResearchData {
    question: string;
    answer: string;
    source?: string;
}

export interface ManagerDecision {
    thought: string;
    action: 'CLICK' | 'TYPE' | 'GOTO' | 'SUBMIT' | 'ANSWER' | 'FAIL' | 'READ' | 'OPEN_TAB' | 'SEARCH' | 'WAIT' | 'LONG_WAIT' | 'CHANGE_TAB' | 'HELP_REPLAN' | 'SCROLL_DOWN' | 'PRESS_ESCAPE' | 'EXTRACT_TEXT' | 'SEARCH_PAGE' | 'PARTIAL_SUCCESS' | 'SAVE_CREDENTIAL_VALUE' | 'FULL_PAGE_SEARCH';
    tabName?: string;
    selector?: string;
    text?: string;
    url?: string;
    answer?: string;
    reason?: string;
    duration?: number;
    query?: string;
    value?: string;
}
