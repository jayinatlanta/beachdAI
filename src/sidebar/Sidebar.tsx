// src/sidebar/Sidebar.tsx

import React, { useState, useEffect } from 'react';
import { AgentState, HistoricalTask } from '../types';

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// --- NEW: Type definitions for theme ---
type Theme = 'light' | 'dark';

type ColorPalette = {
  text: string;
  subtleText: string;
  goalBg: string;
  goalText: string;
  scratchpadBg: string;
  scratchpadText: string;
  scratchpadBorder: string;
};
// ------------------------------------

// --- Component ---

const Sidebar = () => {
  const [goal, setGoal] = useState('');
  const [currentTask, setCurrentTask] = useState<AgentState | null>(null);
  const [isTeaching, setIsTeaching] = useState(false);
  const [teachingGoal, setTeachingGoal] = useState('');
  const [version, setVersion] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [credentialName, setCredentialName] = useState('');
  const [historicalTasks, setHistoricalTasks] = useState<HistoricalTask[]>([]);
  const [theme, setTheme] = useState<Theme>('light'); // Typed the state

  // --- Effects ---

  useEffect(() => {
    // --- Theme Detection ---
    const darkModeMatcher = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = () => {
        setTheme(darkModeMatcher.matches ? 'dark' : 'light');
    };
    updateTheme(); // Set initial theme
    darkModeMatcher.addEventListener('change', updateTheme);
    // -------------------------

    const manifest = chrome.runtime.getManifest();
    setVersion(manifest.version);

    chrome.runtime.sendMessage({ type: 'GET_TASK_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
      } else if (response && response.task) {
        setCurrentTask(response.task);
        if (response.task.status === 'TEACHING') {
            setIsTeaching(true);
            setTeachingGoal(response.task.originalGoal);
        }
      }
    });

    chrome.runtime.sendMessage({ type: 'GET_HISTORICAL_TASKS' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
        } else if (response && response.tasks) {
            setHistoricalTasks(response.tasks);
        }
    });

    const messageListener = (message: any, sender: chrome.runtime.MessageSender) => {
      if (sender.tab) return;
      if (message.type === 'TASK_UPDATE' && message.task) {
        console.log("Sidebar received task update:", message.task);
        setCurrentTask(message.task);
        if (message.task.status === 'TEACHING') {
            setIsTeaching(true);
            setTeachingGoal(message.task.originalGoal);
        } else {
            setIsTeaching(false);
            setTeachingGoal('');
        }
      }
      if (message.type === 'HISTORICAL_TASKS_UPDATE' && message.tasks) {
        setHistoricalTasks(message.tasks);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      darkModeMatcher.removeEventListener('change', updateTheme);
    };
  }, []);

  // --- Event Handlers ---

  const handleStartTask = (event: React.FormEvent) => {
    event.preventDefault();
    if (!goal.trim()) return;
    chrome.runtime.sendMessage({ type: 'START_TASK', payload: { goal } });
  };

  const handleStopTask = () => {
    chrome.runtime.sendMessage({ type: 'STOP_TASK' });
  };

  const handleNewTask = () => {
      // FIX: Send a dedicated message to reset the agent's state after a completed task.
      // Using 'STOP_TASK' was causing the background script to broadcast a 'STOPPED'
      // status, which was incorrectly rendered as an error state by the UI. A new,
      // more semantic message ('RESET_TASK_SESSION') avoids this race condition entirely.
      chrome.runtime.sendMessage({ type: 'RESET_TASK_SESSION' });
      setCurrentTask(null);
      setGoal('');
  }

  const handleRetryTask = () => {
    if (currentTask && currentTask.originalGoal) {
        chrome.runtime.sendMessage({ type: 'START_TASK', payload: { goal: currentTask.originalGoal } });
    }
  }

  const handleTakeOver = () => {
      chrome.runtime.sendMessage({ type: 'TAKE_OVER' });
  };

  const handleGoAutonomous = () => {
      chrome.runtime.sendMessage({ type: 'GO_AUTONOMOUS' });
  };

  const handleReplanFromHere = () => {
    chrome.runtime.sendMessage({ type: 'GO_AUTONOMOUS' });
  };

  const handleAttemptStrategy = () => {
    if (currentTask && currentTask.plan) {
        chrome.runtime.sendMessage({ type: 'ATTEMPT_STRATEGY', payload: { plan: currentTask.plan } });
    }
  };

  const handleStartTeachingSession = (event: React.FormEvent) => {
      event.preventDefault();
      if (!teachingGoal.trim()) return;
      chrome.runtime.sendMessage({ type: 'START_TEACHING', payload: { goal: teachingGoal } });
  };

  const handleStopTeachingSession = () => {
      chrome.runtime.sendMessage({ type: 'STOP_TEACHING' });
  };

  const handleSaveCredential = (event: React.FormEvent) => {
    event.preventDefault();
    if (!credentialName.trim()) return;
    chrome.runtime.sendMessage({ type: 'SAVE_CREDENTIAL', payload: { name: credentialName } });
    setCredentialName(''); // Clear the input after sending
  };

  const handleUnlockVault = (event: React.FormEvent) => {
    event.preventDefault();
    if (!passphrase.trim()) return;
    chrome.runtime.sendMessage({ type: 'UNLOCK_VAULT', payload: { passphrase } });
    setPassphrase('');
  };

  const handleDeleteHistoricalTask = (timestamp: number) => {
    chrome.runtime.sendMessage({ type: 'DELETE_HISTORICAL_TASK', payload: { timestamp } });
  };

  const handleOpenOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  // --- Theme-aware colors ---
  const colors: Record<Theme, ColorPalette> = { // Typed the object
      light: {
          text: '#212529',
          subtleText: '#555',
          goalBg: '#f0f0f0',
          goalText: '#333',
          scratchpadBg: '#f9f9f9',
          scratchpadText: '#555',
          scratchpadBorder: '#eee'
      },
      dark: {
          text: '#EAEAEA',
          subtleText: '#AAAAAA',
          goalBg: '#333',
          goalText: '#EAEAEA',
          scratchpadBg: '#2d2d2d',
          scratchpadText: '#AAAAAA',
          scratchpadBorder: '#444'
      }
  };
  const currentThemeColors = colors[theme]; // This line is now type-safe


  // --- Render Functions ---

  const renderUnlockVaultView = (task: AgentState) => (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: '#fff3cd' }}>
        <h1 style={{ fontSize: '18px', margin: '0 0 10px 0', color: '#856404' }}>Vault Locked</h1>
        <p style={{ margin: '0 0 16px 0', color: '#856404' }}>This task requires credentials. Please enter your passphrase to unlock the vault for this session.</p>
        <form onSubmit={handleUnlockVault}>
            <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter master passphrase"
                style={{
                    width: '100%',
                    padding: '10px',
                    boxSizing: 'border-box',
                    border: '1px solid #ffc107',
                    borderRadius: '4px',
                    marginBottom: '12px'
                }}
            />
            <button
                type="submit"
                disabled={!passphrase.trim()}
                style={{
                    width: '100%',
                    padding: '10px',
                    border: 'none',
                    borderRadius: '4px',
                    backgroundColor: !passphrase.trim() ? '#ccc' : '#007bff',
                    color: 'white',
                    cursor: 'pointer'
                }}
            >
                Unlock Vault
            </button>
        </form>
    </div>
  );

  const renderSaveCredentialView = (task: AgentState) => (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: '#fff9e6' }}>
        <h1 style={{ fontSize: '18px', margin: '0 0 10px 0', color: '#856404' }}>Save to Vault</h1>
        <p style={{ margin: '0 0 16px 0', color: '#856404' }}>I see you entered a password or another sensitive piece of information. What should I call it?</p>
        <form onSubmit={handleSaveCredential}>
            <input
                type="text"
                value={credentialName}
                onChange={(e) => setCredentialName(e.target.value)}
                placeholder="e.g., Amazon Password, API Key"
                style={{
                    width: '100%',
                    padding: '10px',
                    boxSizing: 'border-box',
                    border: '1px solid #ffc107',
                    borderRadius: '4px',
                    marginBottom: '12px'
                }}
            />
            <button
                type="submit"
                disabled={!credentialName.trim()}
                style={{
                    width: '100%',
                    padding: '10px',
                    border: 'none',
                    borderRadius: '4px',
                    backgroundColor: !credentialName.trim() ? '#ccc' : '#28a745',
                    color: 'white',
                    cursor: 'pointer'
                }}
            >
                Save Credential
            </button>
        </form>
    </div>
  );

  const renderMobileView = (task: AgentState) => {
    if ((task.status as any) === 'AWAITING_PASSPHRASE') {
        return renderUnlockVaultView(task);
    }
    if ((task.status as any) === 'AWAITING_CREDENTIAL_NAME') {
        return renderSaveCredentialView(task);
    }

    const isResearching = task.status === 'RESEARCHING';
    const isPlanning = task.status === 'PLANNING';
    const isThinking = task.status === 'THINKING';
    const isVerifying = task.status === 'VERIFYING';
    const isExecuting = task.status === 'EXECUTING';
    const isWaiting = task.status === 'WAITING';
    const isReplanning = task.status === 'REPLANNING';
    const isWorking = isResearching || isPlanning || isThinking || isExecuting || isReplanning || isVerifying || isWaiting;
    const isCompleted = task.status === 'COMPLETED';
    const isPartialSuccess = isCompleted && task.isPartialSuccess;
    const isFailed = task.status === 'FAILED';
    const isStopped = task.status === 'STOPPED';
    const isDeliberatePlanPresented = isCompleted && !task.isDeliberatePlan && task.finalAnswer?.includes("This is a strategic solution.");

    let statusText = "Working...";
    if (isResearching) statusText = "Researching...";
    if (isPlanning) statusText = "Planning...";
    if (isThinking) statusText = "Thinking...";
    if (isVerifying) statusText = "Verifying...";
    if (isExecuting) statusText = "Executing...";
    if (isWaiting) statusText = "Waiting...";
    if (isReplanning) statusText = "Replanning...";
    if (isCompleted && !isPartialSuccess) statusText = "Completed!";
    if (isPartialSuccess) statusText = "Partial Success";
    if (isFailed) statusText = "Failed.";
    if (isStopped) statusText = "Stopped.";

    const lastScratchpadEntry = task.scratchpad && task.scratchpad.length > 0
        ? task.scratchpad[task.scratchpad.length - 1]
        : 'Starting...';

    // --- FIX: Re-architected mobile view for clarity and robustness ---
    return (
        <div style={{ padding: '16px', boxSizing: 'border-box', width: '100%', display: 'flex', flexDirection: 'column', height: '100vh' }}>
            {/* Header */}
            <div style={{ marginBottom: '12px' }}>
                <h1 style={{ fontSize: '16px', margin: '0 0 4px 0', wordWrap: 'break-word', color: currentThemeColors.text }}>
                    Goal:
                </h1>
                <p style={{ margin: 0, fontSize: '14px', color: currentThemeColors.subtleText }}>{task.originalGoal}</p>
            </div>

            {/* Status & Last Thought */}
            <div style={{ marginBottom: '12px' }}>
                 <strong style={{ fontSize: '14px', color: isCompleted ? '#28a745' : (isFailed ? '#dc3545' : currentThemeColors.text) }}>
                    Status: {statusText}
                </strong>
                <div style={{
                    // --- FIX: Constrain the height of the scratchpad/last thought ---
                    marginTop: '8px',
                    fontSize: '12px',
                    background: currentThemeColors.scratchpadBg,
                    border: `1px solid ${currentThemeColors.scratchpadBorder}`,
                    borderRadius: '4px',
                    padding: '8px',
                    maxHeight: '70px', // Prevents this box from growing too large
                    overflowY: 'auto' // Allows scrolling within this box if content overflows
                }}>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontStyle: 'italic', color: currentThemeColors.scratchpadText }}>
                       {lastScratchpadEntry}
                    </p>
                </div>
            </div>

            {/* Final Answer (only when completed) */}
            {isCompleted && task.finalAnswer && (
                 <div style={{ flexGrow: 1, border: '1px solid #28a745', borderRadius: '4px', background: '#eaf6ec', marginBottom: '12px', display: 'flex', flexDirection: 'column', minHeight: '100px' }}>
                    <strong style={{ display: 'block', padding: '6px 10px', background: '#d4edda', borderBottom: '1px solid #c3e6cb', color: '#155724', fontSize: '14px' }}>
                        Final Answer
                    </strong>
                    <div
                        style={{ padding: '10px', margin: 0, fontSize: '12px', lineHeight: '1.5', color: '#155724', overflowY: 'auto' }}
                        dangerouslySetInnerHTML={{ __html: task.finalAnswer }}
                    />
                </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                {isDeliberatePlanPresented ? (
                    <>
                        <button onClick={handleAttemptStrategy} style={{ flex: 1, padding: '8px', border: 'none', borderRadius: '4px', backgroundColor: '#007bff', color: 'white', cursor: 'pointer' }}>
                            Attempt Execution
                        </button>
                        <button onClick={handleNewTask} style={{ flex: 1, padding: '8px', border: 'none', borderRadius: '4px', backgroundColor: '#28a745', color: 'white', cursor: 'pointer' }}>
                            New Task
                        </button>
                    </>
                ) : isWorking ? (
                    <button onClick={handleStopTask} style={{ width: '100%', padding: '8px', border: 'none', borderRadius: '4px', backgroundColor: '#dc3545', color: 'white', cursor: 'pointer' }}>
                        Stop Task
                    </button>
                ) : isPartialSuccess ? (
                    <>
                        <button onClick={handleReplanFromHere} style={{ flex: 1, padding: '8px', border: 'none', borderRadius: '4px', backgroundColor: '#17a2b8', color: 'white', cursor: 'pointer' }}>
                            Replan
                        </button>
                        <button onClick={handleNewTask} style={{ flex: 1, padding: '8px', border: 'none', borderRadius: '4px', backgroundColor: '#28a745', color: 'white', cursor: 'pointer' }}>
                            New Task
                        </button>
                    </>
                ) : isFailed || isStopped ? (
                    <>
                        <button onClick={handleRetryTask} style={{ flex: 1, padding: '8px', border: '1px solid #007bff', borderRadius: '4px', backgroundColor: '#e7f3ff', color: '#007bff', cursor: 'pointer' }}>
                            Retry
                        </button>
                        <button onClick={handleNewTask} style={{ flex: 2, padding: '8px', border: 'none', borderRadius: '4px', backgroundColor: '#28a745', color: 'white', cursor: 'pointer' }}>
                            New Task
                        </button>
                    </>
                ) : (
                    <button onClick={handleNewTask} style={{ width: '100%', padding: '8px', border: 'none', borderRadius: '4px', backgroundColor: '#28a745', color: 'white', cursor: 'pointer' }}>
                        New Task
                    </button>
                )}
            </div>
        </div>
    );
};


  const renderTaskView = (task: AgentState) => {
    if ((task.status as any) === 'AWAITING_PASSPHRASE') {
        return renderUnlockVaultView(task);
    }
    if ((task.status as any) === 'AWAITING_CREDENTIAL_NAME') {
        return renderSaveCredentialView(task);
    }

    const isResearching = task.status === 'RESEARCHING';
    const isPlanning = task.status === 'PLANNING';
    const isThinking = task.status === 'THINKING';
    const isVerifying = task.status === 'VERIFYING';
    const isExecuting = task.status === 'EXECUTING';
    const isWaiting = task.status === 'WAITING';
    const isReplanning = task.status === 'REPLANNING';
    const isWaitingForUser = task.status === 'USER_INPUT_PENDING';
    const isTeachingMode = task.status === 'TEACHING';
    const isAwaitingCredential = (task.status as any) === 'AWAITING_CREDENTIAL_NAME';
    const isAwaitingPassphrase = (task.status as any) === 'AWAITING_PASSPHRASE';
    const isWorking = isResearching || isPlanning || isThinking || isExecuting || isReplanning || isVerifying || isWaiting;
    const isCompleted = task.status === 'COMPLETED';
    const isFailed = task.status === 'FAILED';
    const isStopped = task.status === 'STOPPED';
    const isPartialSuccess = isCompleted && task.isPartialSuccess;
    const isDeliberatePlanPresented = isCompleted && !task.isDeliberatePlan && task.finalAnswer?.includes("This is a strategic solution.");

    let statusText = "Working...";
    if (isResearching) statusText = "Researching...";
    if (isPlanning) statusText = "Planning...";
    if (isThinking) statusText = "Thinking...";
    if (isVerifying) statusText = "Verifying security...";
    if (isExecuting) statusText = "Executing...";
    if (isWaiting) statusText = "Waiting, per an autonomous procedure...";
    if (isReplanning) statusText = "I'm stuck, trying a new plan...";
    if (isWaitingForUser) statusText = "Your turn! Show me what to do next...";
    if (isTeachingMode) statusText = `Learning: "${task.originalGoal}"`;
    if (isAwaitingCredential) statusText = "Waiting for you to name a credential...";
    if (isAwaitingPassphrase) statusText = "Vault is locked. Please unlock it to continue.";
    if (isCompleted && !isPartialSuccess) statusText = "Project Completed!";
    if (isPartialSuccess) statusText = "Partial Success";
    if (isFailed) statusText = "Task Failed.";
    if (isStopped) statusText = "Task Stopped.";


    return (
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box' }}>
        {isTeachingMode ? (
            <div style={{ textAlign: 'center', padding: '20px', background: '#e7f3ff', borderRadius: '8px', marginBottom: '16px' }}>
                <h1 style={{ fontSize: '18px', margin: '0 0 10px 0', color: '#004085' }}>I'm ready to learn!</h1>
                <p style={{ margin: 0, color: '#004085' }}>Now, show me how to: <strong>{task.originalGoal}</strong></p>
                <p style={{ fontSize: '12px', color: currentThemeColors.subtleText, marginTop: '10px' }}>Perform the steps in the browser. I'll record your actions.</p>
                <button onClick={handleStopTeachingSession} style={{ marginTop: '16px', width: '100%', padding: '10px', border: 'none', borderRadius: '4px', backgroundColor: '#dc3545', color: 'white', cursor: 'pointer' }}>
                    Stop Learning
                </button>
            </div>
        ) : (
          <>
            <h1 style={{ fontSize: '18px', margin: '0 0 16px 0', color: currentThemeColors.text }}>Task Status</h1>
            <div style={{ marginBottom: '16px' }}>
              <strong style={{ display: 'block', marginBottom: '4px', color: currentThemeColors.subtleText }}>Goal:</strong>
              <p style={{ margin: 0, padding: '8px', background: currentThemeColors.goalBg, borderRadius: '4px', color: currentThemeColors.goalText }}>
                {task.originalGoal}
              </p>
            </div>
          </>
        )}

        {!isTeachingMode && (
          <>
            <div style={{ marginBottom: '16px' }}>
                <div style={{ marginBottom: '8px', fontSize: '14px', fontWeight: 'bold', color: isCompleted ? '#28a745' : (isFailed ? '#dc3545' : currentThemeColors.text) }}>
                  Status: {statusText}
                </div>
                {(isFailed || isStopped) && task.failureReason && (
                     <p style={{ color: isFailed ? '#dc3545' : currentThemeColors.text, background: isFailed ? '#ffebee' : currentThemeColors.goalBg, padding: '8px', borderRadius: '4px', marginTop: '10px', fontSize: '12px' }}>
                        <strong>Reason:</strong> {task.failureReason}
                    </p>
                )}
                {task.initialStrategy && (
                    <div style={{ marginTop: '16px', border: `1px solid ${currentThemeColors.scratchpadBorder}`, borderRadius: '4px', background: currentThemeColors.scratchpadBg }}>
                        <strong style={{ display: 'block', padding: '8px 12px', background: currentThemeColors.goalBg, borderBottom: `1px solid ${currentThemeColors.scratchpadBorder}`, color: currentThemeColors.text }}>
                            Initial Strategy
                        </strong>
                        <div style={{ padding: '12px', margin: 0, fontSize: '14px', lineHeight: '1.6', color: currentThemeColors.text, whiteSpace: 'pre-wrap', maxHeight: '150px', overflowY: 'auto' }} dangerouslySetInnerHTML={{ __html: task.initialStrategy }} />
                    </div>
                )}
                {isCompleted && task.finalAnswer && (
                    <div style={{ marginTop: '16px', border: '1px solid #28a745', borderRadius: '4px', background: '#eaf6ec', display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
                        <strong style={{ display: 'block', padding: '8px 12px', background: '#d4edda', borderBottom: '1px solid #c3e6cb', color: '#155724' }}>
                            {task.isDeliberatePlan ? "Execution Summary" : (task.originalGoal.toLowerCase().startsWith("teach me") ? "What I Learned" : "Final Answer")}
                        </strong>
                        <div
                            style={{ padding: '12px', margin: 0, fontSize: '14px', lineHeight: '1.6', color: '#155724', overflowY: 'auto', flexGrow: 1 }}
                            dangerouslySetInnerHTML={{ __html: task.finalAnswer }}
                        />
                    </div>
                )}
            </div>

            <div style={{ flexGrow: 1, overflowY: 'auto', borderTop: `1px solid ${currentThemeColors.scratchpadBorder}`, paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>
                {!isCompleted &&
                <>
                    <div>
                      <strong style={{ display: 'block', marginBottom: '8px', color: currentThemeColors.subtleText }}>Plan:</strong>
                      {(isPlanning || isResearching) && <p style={{color: currentThemeColors.subtleText, fontStyle: 'italic'}}>The agent is currently thinking about a plan...</p>}
                      <ul style={{ margin: 0, paddingLeft: '20px', listStyleType: 'decimal' }}>
                        {task.plan && task.plan.map((step, index) => (
                          <li key={index} style={{ marginBottom: '8px', color: currentThemeColors.text }}>
                            {step}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div style={{display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0}}>
                      <strong style={{ display: 'block', marginBottom: '8px', color: currentThemeColors.subtleText }}>Scratchpad:</strong>
                      <div style={{ background: currentThemeColors.scratchpadBg, border: `1px solid ${currentThemeColors.scratchpadBorder}`, borderRadius: '4px', padding: '10px', flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column-reverse' }}>
                        <div>
                            {task.scratchpad && task.scratchpad.map((entry, index) => (
                              <p key={index} style={{ fontSize: '12px', color: currentThemeColors.scratchpadText, margin: '0 0 8px 0', whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>
                                {entry}
                              </p>
                            ))}
                        </div>
                      </div>
                    </div>
                </>
                }
            </div>
             <div style={{ display: 'flex', gap: '10px', marginTop: 'auto', paddingTop: '16px' }}>
                {isDeliberatePlanPresented ? (
                    <>
                        <button onClick={handleAttemptStrategy} style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '4px', backgroundColor: '#007bff', color: 'white', cursor: 'pointer' }}>
                            Attempt Autonomous Execution
                        </button>
                        <button onClick={handleNewTask} style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '4px', backgroundColor: '#28a745', color: 'white', cursor: 'pointer' }}>
                            New Task
                        </button>
                    </>
                ) : isWorking ? (
                    <>
                        {isWaiting &&
                            <button disabled style={{ flex: 1, padding: '10px', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#eee', color: '#aaa', cursor: 'not-allowed' }}>
                                Take Over
                            </button>
                        }
                        {!isWaiting &&
                            <button onClick={handleTakeOver} style={{ flex: 1, padding: '10px', border: '1px solid #ffc107', borderRadius: '4px', backgroundColor: '#fff3cd', color: '#856404', cursor: 'pointer' }}>
                                Take Over
                            </button>
                        }
                        <button onClick={handleStopTask} style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '4px', backgroundColor: '#dc3545', color: 'white', cursor: 'pointer' }}>
                            Stop Task
                        </button>
                    </>
                ) : isWaitingForUser ? (
                    <button onClick={handleGoAutonomous} style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '4px', backgroundColor: '#17a2b8', color: 'white', cursor: 'pointer' }}>
                        Go Autonomous
                    </button>
                ) : isPartialSuccess ? (
                    <>
                        <button onClick={handleTakeOver} style={{ flex: 1, padding: '10px', border: '1px solid #ffc107', borderRadius: '4px', backgroundColor: '#fff3cd', color: '#856404', cursor: 'pointer' }}>
                            Take Over
                        </button>
                        <button onClick={handleReplanFromHere} style={{ flex: 1, padding: '10px', border: '1px solid #17a2b8', borderRadius: '4px', backgroundColor: '#e2f6f8', color: '#17a2b8', cursor: 'pointer' }}>
                            Replan
                        </button>
                         <button onClick={handleNewTask} style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '4px', backgroundColor: '#28a745', color: 'white', cursor: 'pointer' }}>
                            New Task
                        </button>
                    </>
                ) : (
                    <>
                        <button onClick={handleRetryTask} style={{ flex: 1, padding: '10px', border: '1px solid #007bff', borderRadius: '4px', backgroundColor: '#e7f3ff', color: '#007bff', cursor: 'pointer' }}>
                            Retry
                        </button>
                        <button onClick={handleNewTask} style={{ flex: 2, padding: '10px', border: 'none', borderRadius: '4px', backgroundColor: '#28a745', color: 'white', cursor: 'pointer' }}>
                            New Task
                        </button>
                    </>
                )}
            </div>
          </>
        )}
      </div>
    );
  }

  const renderNewTaskForm = () => (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box' }}>
      {isTeaching ? (
        <div>
            <h1 style={{ fontSize: '18px', margin: '0 0 12px 0', color: currentThemeColors.text }}>Teach Me a New Skill</h1>
            <form onSubmit={handleStartTeachingSession}>
                <textarea
                  value={teachingGoal}
                  onChange={(e) => setTeachingGoal(e.target.value)}
                  placeholder="What are you teaching me to do?"
                  style={{
                    width: '100%', minHeight: '60px', boxSizing: 'border-box',
                    marginBottom: '12px', padding: '8px', border: '1px solid #ccc',
                    borderRadius: '4px',
                  }}
                />
                <button
                  type="submit"
                  disabled={!teachingGoal.trim()}
                  style={{
                    width: '100%', padding: '10px', border: 'none', borderRadius: '4px',
                    backgroundColor: !teachingGoal.trim() ? '#ccc' : '#17a2b8',
                    color: 'white', cursor: 'pointer',
                  }}
                >
                  Start Learning
                </button>
            </form>
            <button onClick={() => setIsTeaching(false)} style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', marginTop: '12px', padding: 0 }}>
                Cancel
            </button>
        </div>
      ) : (
        <>
            <div style={{ flexGrow: 1 }}>
                <h1 style={{ fontSize: '18px', margin: '0 0 12px 0', color: currentThemeColors.text }}>BeachdAI Agent</h1>
                <form onSubmit={handleStartTask}>
                    <textarea
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      placeholder="What should I do for you?"
                      style={{
                        width: '100%', minHeight: '100px', boxSizing: 'border-box',
                        marginBottom: '12px', padding: '8px', border: '1px solid #ccc',
                        borderRadius: '4px',
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!goal.trim()}
                      style={{
                        width: '100%', padding: '10px', border: 'none', borderRadius: '4px',
                        backgroundColor: !goal.trim() ? '#ccc' : '#007bff',
                        color: 'white', cursor: 'pointer',
                      }}
                    >
                      Start Task
                    </button>
                </form>
                <div style={{ textAlign: 'center', marginTop: '16px' }}>
                    <button onClick={() => setIsTeaching(true)} style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', textDecoration: 'underline', fontSize: '14px' }}>
                        teach me something
                    </button>
                </div>
                <hr style={{ border: 0, borderTop: `1px solid ${currentThemeColors.scratchpadBorder}`, margin: '20px 0' }} />
                {historicalTasks.length > 0 && (
                    <div style={{}}>
                        <h3 style={{ fontSize: '14px', marginBottom: '12px', fontWeight: 'normal', color: currentThemeColors.subtleText }}>Reuse a Goal</h3>
                        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                            {historicalTasks.map((task) => (
                                <li key={task.timestamp} style={{ marginBottom: '8px', display: 'flex', alignItems: 'center' }}>
                                    <button
                                        onClick={() => handleDeleteHistoricalTask(task.timestamp)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: '#dc3545',
                                            cursor: 'pointer',
                                            padding: '0 4px 0 0',
                                            fontSize: '16px',
                                            fontWeight: 'bold',
                                            lineHeight: '1'
                                        }}
                                        title="Delete this goal"
                                    >
                                        &times;
                                    </button>
                                    <span style={{ padding: '0 4px', color: '#ccc' }}>|</span>
                                    <button
                                        title={task.goal}
                                        onClick={() => setGoal(task.goal)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: '#007bff',
                                            cursor: 'pointer',
                                            padding: 0,
                                            textAlign: 'left',
                                            fontSize: '14px',
                                            textDecoration: 'underline',
                                            width: '100%',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis'
                                        }}
                                    >
                                        {task.goal}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
            <div style={{ textAlign: 'center', padding: '10px', color: '#aaa', fontSize: '12px' }}>
                v{version}
            </div>
            {isMobile && (
                <button onClick={handleOpenOptions} style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', textDecoration: 'underline', fontSize: '14px', marginTop: '10px' }}>
                    Settings
                </button>
            )}
        </>
      )}
    </div>
  );

  if (isMobile) {
    return currentTask ? renderMobileView(currentTask) : renderNewTaskForm();
  } else {
    return currentTask ? renderTaskView(currentTask) : renderNewTaskForm();
  }
};

export default Sidebar;