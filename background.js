/**
 * ReddJSON Background Service Worker
 * ═══════════════════════════════════════════════════════════════════
 * Handles JSON fetching from Reddit API and storage operations.
 * 
 * This is the backbone of ReddJSON — it bridges the content script
 * (which runs on reddit.com) with:
 *   1. Reddit's .json API (cross-origin fetch)
 *   2. chrome.storage.local (persistent copy history)
 *
 * @fileoverview Service worker for fetch + storage operations
 * @author ReddJSON Team
 * @version 1.0.0
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum number of history entries to store */
const MAX_HISTORY_ENTRIES = 50;

/** User-Agent string for Reddit API requests */
const USER_AGENT = 'ReddJSON/1.0.0 (Chrome Extension; https://github.com/reddjson)';

// ============================================================================
// JSON FETCHING
// ============================================================================

/**
 * Fetches JSON data from a Reddit permalink.
 * 
 * Reddit's .json endpoint returns:
 * ```
 * [
 *   { kind: "Listing", data: { children: [{ kind: "t3", data: postData }] } },
 *   { kind: "Listing", data: { children: [...commentObjects...] } }
 * ]
 * ```
 * We return the ENTIRE response, pretty-printed.
 *
 * @async
 * @param {string} permalink - The Reddit post permalink (e.g., "/r/javascript/comments/abc123/title/")
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function fetchRedditJSON(permalink) {
  try {
    // Normalize permalink — ensure it starts with / and strip trailing slash
    let normalizedPath = permalink.startsWith('/') ? permalink : '/' + permalink;
    normalizedPath = normalizedPath.replace(/\/+$/, '');

    // Construct the .json URL
    const jsonUrl = `https://www.reddit.com${normalizedPath}.json`;

    console.log('[ReddJSON] Fetching:', jsonUrl);

    const response = await fetch(jsonUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      },
      // Don't send cookies — we want public endpoint behavior
      credentials: 'omit'
    });

    // ── Handle HTTP errors with user-friendly messages ──
    if (!response.ok) {
      const errorMap = {
        403: 'Private or quarantined subreddit — access denied',
        404: 'Post not found or has been deleted',
        429: 'Rate limited by Reddit — please wait a moment',
        500: 'Reddit server error — try again later',
        502: 'Reddit is temporarily unreachable',
        503: 'Reddit is under heavy load — try again',
      };
      return {
        success: false,
        error: errorMap[response.status] || `HTTP error ${response.status}`
      };
    }

    const data = await response.json();

    // Validate the expected array-of-listings structure
    if (!Array.isArray(data) || data.length === 0) {
      return { success: false, error: 'Unexpected JSON structure from Reddit' };
    }

    return { success: true, data };
  } catch (error) {
    console.error('[ReddJSON] Fetch error:', error);

    // Network / connectivity errors
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      return { success: false, error: 'Network error — check your internet connection' };
    }

    return { success: false, error: error.message || 'An unknown error occurred' };
  }
}

// ============================================================================
// STORAGE OPERATIONS
// ============================================================================

/**
 * Adds a copy event to the persistent history.
 * If the same post already exists, it bumps it to the top and increments the copy count.
 *
 * @async
 * @param {object} entry
 * @param {string} entry.permalink  - Post permalink
 * @param {string} entry.title      - Post title
 * @param {string} entry.subreddit  - Subreddit name (without r/)
 * @param {string} entry.postId     - Reddit post ID
 * @param {object} entry.jsonData   - Full JSON response
 * @returns {Promise<{success: boolean, entry?: object}>}
 */
async function addToHistory(entry) {
  try {
    const result = await chrome.storage.local.get(['reddjson_history']);
    let history = result.reddjson_history || [];

    // Create a 300-char preview of the pretty-printed JSON
    const jsonString = JSON.stringify(entry.jsonData, null, 2);
    const jsonPreview = jsonString.substring(0, 300) + (jsonString.length > 300 ? '…' : '');

    // Build the history entry
    const historyEntry = {
      id: `reddjson_${Date.now()}_${entry.postId}`,
      permalink: entry.permalink,
      title: entry.title || 'Untitled Post',
      subreddit: entry.subreddit || 'unknown',
      postId: entry.postId || 'unknown',
      jsonPreview,
      fullJson: entry.jsonData,
      timestamp: Date.now(),
      copiedCount: 1
    };

    // Check if post already exists — if so, update and promote to top
    const existingIndex = history.findIndex(h => h.postId === entry.postId);
    if (existingIndex !== -1) {
      const existing = history.splice(existingIndex, 1)[0];
      existing.timestamp = Date.now();
      existing.copiedCount = (existing.copiedCount || 1) + 1;
      existing.jsonPreview = jsonPreview;
      existing.fullJson = entry.jsonData;
      history.unshift(existing);
    } else {
      history.unshift(historyEntry);
    }

    // Enforce maximum history size
    if (history.length > MAX_HISTORY_ENTRIES) {
      history = history.slice(0, MAX_HISTORY_ENTRIES);
    }

    await chrome.storage.local.set({ reddjson_history: history });

    console.log('[ReddJSON] History updated:', historyEntry.id);
    return { success: true, entry: historyEntry };
  } catch (error) {
    console.error('[ReddJSON] Storage error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Retrieves the full copy history.
 * @async
 * @returns {Promise<{success: boolean, history?: Array}>}
 */
async function getHistory() {
  try {
    const result = await chrome.storage.local.get(['reddjson_history']);
    return { success: true, history: result.reddjson_history || [] };
  } catch (error) {
    console.error('[ReddJSON] Get history error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Deletes a single history entry by its ID.
 * @async
 * @param {string} entryId - The unique entry ID (e.g., "reddjson_1710000000000_abc123")
 * @returns {Promise<{success: boolean}>}
 */
async function deleteHistoryEntry(entryId) {
  try {
    const result = await chrome.storage.local.get(['reddjson_history']);
    let history = result.reddjson_history || [];

    history = history.filter(entry => entry.id !== entryId);

    await chrome.storage.local.set({ reddjson_history: history });
    return { success: true };
  } catch (error) {
    console.error('[ReddJSON] Delete error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Clears all history entries.
 * @async
 * @returns {Promise<{success: boolean}>}
 */
async function clearHistory() {
  try {
    await chrome.storage.local.set({ reddjson_history: [] });
    return { success: true };
  } catch (error) {
    console.error('[ReddJSON] Clear error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Gets a single history entry by ID.
 * @async
 * @param {string} entryId - The entry ID
 * @returns {Promise<{success: boolean, entry?: object}>}
 */
async function getHistoryEntry(entryId) {
  try {
    const result = await chrome.storage.local.get(['reddjson_history']);
    const history = result.reddjson_history || [];
    const entry = history.find(e => e.id === entryId);
    return entry
      ? { success: true, entry }
      : { success: false, error: 'Entry not found' };
  } catch (error) {
    console.error('[ReddJSON] Get entry error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

/**
 * Central message router.
 * All messages from content.js and popup.js come through here.
 * 
 * Message shapes:
 *   { action: 'fetchJSON',         permalink: string }
 *   { action: 'addToHistory',      entry: object }
 *   { action: 'getHistory' }
 *   { action: 'deleteHistoryEntry', entryId: string }
 *   { action: 'clearHistory' }
 *   { action: 'getHistoryEntry',   entryId: string }
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ReddJSON] Message received:', message.action);

  // Dispatch asynchronously, then send the response
  (async () => {
    switch (message.action) {
      case 'fetchJSON':
        return await fetchRedditJSON(message.permalink);

      case 'addToHistory':
        return await addToHistory(message.entry);

      case 'getHistory':
        return await getHistory();

      case 'deleteHistoryEntry':
        return await deleteHistoryEntry(message.entryId);

      case 'clearHistory':
        return await clearHistory();

      case 'getHistoryEntry':
        return await getHistoryEntry(message.entryId);

      default:
        return { success: false, error: `Unknown action: ${message.action}` };
    }
  })().then(sendResponse).catch(err => {
    console.error('[ReddJSON] Message handler error:', err);
    sendResponse({ success: false, error: err.message });
  });

  // Return true → we will call sendResponse asynchronously
  return true;
});

// ============================================================================
// INSTALL / UPDATE HANDLER
// ============================================================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[ReddJSON] 🎉 Extension installed!');
    chrome.storage.local.set({ reddjson_history: [] });
  } else if (details.reason === 'update') {
    console.log('[ReddJSON] ⬆️ Updated to v' + chrome.runtime.getManifest().version);
  }
});

console.log('[ReddJSON] Background service worker loaded ✓');
