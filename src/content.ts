// src/content.ts

/**
 * @file This script is injected into every webpage. It acts as an intelligent
 * browser controller. It now extracts a full "snapshot" of the page, including
 * both interactive elements and readable text content.
 * NEW: It can now enter a "learning mode" to record user actions.
 * NEW: It now extracts alt text from images for richer context.
 * NEW: Increased character limit and prioritized data collection.
 * NEW: Uses a more robust polling mechanism to wait for dynamic content.
 * NEW: Implements the EXTRACT_TEXT action for targeted reading.
 */

console.log("BeachdAI Content Script/Controller Loaded (v6.1).");

// --- State ---
let elementCounter = 0;
let isLearning = false;
let lastActionTimestamp = 0;

// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request);

  if (request.action === 'EXTRACT_PAGE_SNAPSHOT') {
    waitForPageLoad().then(() => {
        const snapshot = getPageSnapshot();
        sendResponse({ snapshot: snapshot });
    });
  } else if (request.action === 'EXECUTE_ACTION') {
    executeActionOnPage(request.payload)
      .then((result) => sendResponse({ status: 'Action executed successfully', ...result }))
      .catch(error => sendResponse({ status: 'Action failed', error: error.message }));
  } else if (request.action === 'START_LEARNING') {
      startLearning();
      sendResponse({ status: 'Learning started' });
  } else if (request.action === 'STOP_LEARNING') {
      stopLearning();
      sendResponse({ status: 'Learning stopped' });
  } else if (request.action === 'GET_PAGE_TEXT') {
    const text = extractAllText();
    sendResponse({ text });
  }

  return true; // Indicates an asynchronous response.
});


// --- Core Controller Functions ---

interface PageElement {
  tag: string;
  attributes: { [key: string]: string };
  text: string;
  value?: string;
}

interface PageSnapshot {
    url: string;
    title: string;
    mainContent: string;
    interactiveElements: PageElement[];
    images: { src: string, alt: string }[];
}

/**
 * Scans the DOM and creates a comprehensive snapshot for the agent.
 */
function getPageSnapshot(): PageSnapshot {
  elementCounter = 0;

  const interactiveElementsList: PageElement[] = [];
  const interactiveSelector = 'a, button, input, textarea, select, [role="button"], [role="link"], [data-testid]';
  document.querySelectorAll(interactiveSelector).forEach(el => {
    const element = el as HTMLElement;
    const uniqueId = `beachdai-id-${elementCounter++}`;
    element.setAttribute('data-beachdai-id', uniqueId);

    const attributes: { [key: string]: string } = { 'data-beachdai-id': uniqueId };
    const tagName = element.tagName.toLowerCase();

    const text = (element.textContent || element.innerText || (element as HTMLInputElement).value || '').trim();
    const value = (element as HTMLInputElement).value;

    if (element.id) attributes.id = element.id;
    if (element.getAttribute('name')) attributes.name = element.getAttribute('name')!;
    if (element.getAttribute('aria-label')) attributes['aria-label'] = element.getAttribute('aria-label')!;
    if (element.getAttribute('placeholder')) attributes.placeholder = element.getAttribute('placeholder')!;
    if (element.getAttribute('data-testid')) attributes['data-testid'] = element.getAttribute('data-testid')!;

    if (tagName === 'a' && element.getAttribute('href')) {
        attributes.href = element.getAttribute('href')!;
    }

    const elementData: PageElement = {
      tag: tagName,
      attributes: attributes,
      text: text.substring(0, 150)
    };

    if (value) {
        elementData.value = value.substring(0, 150);
    }
    interactiveElementsList.push(elementData);
  });

  const imageList: { src: string, alt: string }[] = [];
  document.querySelectorAll('img').forEach(img => {
      if (img.alt) {
          imageList.push({
              src: img.src,
              alt: img.alt
          });
      }
  });

  const bodyClone = document.body.cloneNode(true) as HTMLElement;
  bodyClone.querySelectorAll('script, style, nav, header, footer, aside').forEach(el => el.remove());
  let mainContent = (bodyClone.innerText || '').replace(/\s\s+/g, ' ').trim();

  return {
    url: window.location.href,
    title: document.title,
    mainContent: mainContent,
    interactiveElements: interactiveElementsList,
    images: imageList.slice(0, 20)
  };
}

/**
 * Extracts all meaningful text content from the document.
 */
function extractAllText(): string {
  const bodyClone = document.body.cloneNode(true) as HTMLElement;
  bodyClone.querySelectorAll('script, style, nav, header, footer, aside, form').forEach(el => el.remove());
  let pageText = (bodyClone.innerText || '').replace(/\s\s+/g, ' ').trim();
  document.querySelectorAll('img[alt]').forEach(img => {
    pageText += ` ${img.getAttribute('alt')}`;
  });
  document.querySelectorAll('[aria-label]').forEach(el => {
    pageText += ` ${el.getAttribute('aria-label')}`;
  });
  return pageText;
}

/**
 * Executes a specific action on the webpage based on the LLM's command.
 */
async function executeActionOnPage(actionDetails: any): Promise<any> {
  console.log("Executing action on page:", actionDetails);

  const { action, selector, text, url } = actionDetails;

  if (!action) throw new Error("No action specified.");

  const targetElement = selector ? document.querySelector(selector) as HTMLElement : null;

  if (selector && !targetElement && action !== 'EXTRACT_TEXT') {
    throw new Error(`Controller could not find element with selector: "${selector}"`);
  }

  switch (action) {
    case 'CLICK':
      if (targetElement) targetElement.click();
      else throw new Error(`CLICK action failed: No element found for selector "${selector}"`);
      break;

    case 'TYPE':
      if (targetElement && (targetElement instanceof HTMLInputElement || targetElement instanceof HTMLTextAreaElement)) {
        targetElement.focus();
        targetElement.value = text || '';
        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
        targetElement.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        throw new Error(`TYPE action failed: Element for selector "${selector}" is not a valid input field.`);
      }
      break;

    case 'GOTO':
        if (url) window.location.href = url;
        else throw new Error('GOTO action failed: No URL provided.');
        break;

    case 'SUBMIT':
      if (targetElement) {
        const form = targetElement.closest('form');
        if (form) form.requestSubmit();
        else targetElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      } else {
        throw new Error(`SUBMIT action failed: No element found for selector "${selector}"`);
      }
      break;

    case 'SCROLL_DOWN':
        window.scrollBy(0, window.innerHeight);
        break;

    case 'PRESS_ESCAPE':
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
        break;

    case 'EXTRACT_TEXT':
        if (targetElement) {
            if (selector === 'body') {
                const mainEl = document.querySelector('main, [role="main"], #main, #rcnt');
                if (mainEl) {
                    return { text: (mainEl as HTMLElement).innerText.trim() };
                }
            }
            return { text: (targetElement.innerText || '').trim() };
        } else {
            throw new Error(`EXTRACT_TEXT action failed: No element found for selector "${selector}"`);
        }

    default:
      throw new Error(`Unknown action type: "${action}"`);
  }
  return {};
}

// --- Functions for Learning Mode ---

function startLearning() {
    if (isLearning) return;
    isLearning = true;
    lastActionTimestamp = Date.now();
    console.log("Starting to learn from user actions...");
    document.addEventListener('click', handleUserClick, true);
    document.addEventListener('change', handleUserChange, true);
}

function stopLearning() {
    if (!isLearning) return;
    isLearning = false;
    lastActionTimestamp = 0;
    console.log("Stopping learning from user actions.");
    document.removeEventListener('click', handleUserClick, true);
    document.removeEventListener('change', handleUserChange, true);
}

function handleUserClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const selector = getStableSelector(target);
    recordAction({
        action: 'CLICK',
        selector: selector,
    });
}

function handleUserChange(event: Event) {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const selector = getStableSelector(target);
    recordAction({
        action: 'TYPE',
        selector: selector,
        text: target.value,
    });
}

function recordAction(payload: any) {
    const now = Date.now();
    const timeSinceLastAction = now - lastActionTimestamp;
    const WAIT_THRESHOLD_MS = 3000;

    if (timeSinceLastAction > WAIT_THRESHOLD_MS) {
        console.log(`User waited for ${timeSinceLastAction / 1000}s, recording WAIT action.`);
        chrome.runtime.sendMessage({
            type: 'RECORDED_ACTION',
            payload: {
                action: 'WAIT',
                duration: timeSinceLastAction
            }
        });
    }

    chrome.runtime.sendMessage({
        type: 'RECORDED_ACTION',
        payload: payload
    });

    lastActionTimestamp = Date.now();
}

function getStableSelector(element: HTMLElement): string {
    if (element.getAttribute('data-beachdai-id')) {
        return `[data-beachdai-id='${element.getAttribute('data-beachdai-id')}']`;
    }
    if (element.id) {
        return `#${element.id}`;
    }
    if (element.getAttribute('data-testid')) {
        return `[data-testid='${element.getAttribute('data-testid')}']`;
    }
    if (element.getAttribute('name')) {
        return `[name='${element.getAttribute('name')}']`;
    }

    let path = '';
    let current = element;
    while (current.parentElement) {
        const tagName = current.tagName.toLowerCase();
        const siblings = Array.from(current.parentElement.children);
        const sameTagSiblings = siblings.filter(sibling => sibling.tagName.toLowerCase() === tagName);
        const index = sameTagSiblings.indexOf(current) + 1;
        path = `/${tagName}[${index}]${path}`;
        current = current.parentElement;
    }
    return path;
}

function waitForPageLoad(): Promise<void> {
    return new Promise(resolve => {
        let attempts = 0;
        const maxAttempts = 10;
        const interval = 500;

        const checkContent = () => {
            const bodyClone = document.body.cloneNode(true) as HTMLElement;
            bodyClone.querySelectorAll('script, style, nav, header, footer, aside').forEach(el => el.remove());
            const mainContent = (bodyClone.innerText || '').replace(/\s\s+/g, ' ').trim();

            if (mainContent.length > 100) {
                resolve();
            } else {
                attempts++;
                if (attempts < maxAttempts) {
                    setTimeout(checkContent, interval);
                } else {
                    console.warn("waitForPageLoad timed out. Proceeding with potentially incomplete content.");
                    resolve();
                }
            }
        };

        if (document.readyState === 'complete') {
            setTimeout(checkContent, 100);
        } else {
            window.addEventListener('load', () => setTimeout(checkContent, 100));
        }
    });
}

