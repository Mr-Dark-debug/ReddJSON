# ReddJSON Architecture

> Version 1.0.0 · Manifest V3 · Chrome Extension

---

## Overview

ReddJSON is a Chrome extension that adds a native-looking **JSON** button to every Reddit post. Clicking it fetches the raw full JSON from Reddit's `.json` endpoint and copies the pretty-printed response to the clipboard. A popup provides persistent copy history with search, re-copy, view, and export functionality.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CHROME BROWSER                                  │
│                                                                         │
│  ┌──────────────────────┐     Messages      ┌──────────────────────┐   │
│  │   Content Script      │ ◄──────────────► │   Background Worker   │   │
│  │   (content.js)        │                   │   (background.js)     │   │
│  │                        │                   │                        │   │
│  │  • Find posts          │  fetchJSON ──►   │  • fetch() Reddit API  │   │
│  │  • Inject buttons      │  ◄── JSON data   │  • Parse response      │   │
│  │  • Copy to clipboard   │                   │  • Store history       │   │
│  │  • Show toasts         │  addToHistory ──► │                        │   │
│  │  • MutationObserver    │                   │                        │   │
│  └──────────────────────┘                   └──────┬───────────────┘   │
│                                                      │                   │
│  ┌──────────────────────┐     Messages      ┌──────▼───────────────┐   │
│  │   Popup UI            │ ◄──────────────► │   chrome.storage      │   │
│  │   (popup.html/js/css) │                   │   .local              │   │
│  │                        │  getHistory ──►   │                        │   │
│  │  • History list        │  ◄── entries      │  { reddjson_history:   │   │
│  │  • Search & filter     │                   │    [ ...50 entries ] } │   │
│  │  • JSON viewer modal   │  deleteEntry ──►  │                        │   │
│  │  • Export as file      │  clearHistory ──► │                        │   │
│  └──────────────────────┘                   └──────────────────────┘   │
│                                                                         │
│  ┌──────────────────────┐                                               │
│  │   Reddit .json API    │                                               │
│  │                        │                                               │
│  │  GET https://www.      │                                               │
│  │  reddit.com{permalink} │                                               │
│  │  .json                 │                                               │
│  │                        │                                               │
│  │  Returns: Array[2]     │                                               │
│  │  [0] Post Listing      │                                               │
│  │  [1] Comments Listing  │                                               │
│  └──────────────────────┘                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Button Click → JSON Copy

```
User clicks [JSON] button on a Reddit post
        │
        ▼
content.js: extractPostData()
  └─ Gets permalink from <shreddit-post permalink="...">
        │
        ▼
content.js → background.js: sendMessage({ action: 'fetchJSON', permalink })
        │
        ▼
background.js: fetchRedditJSON(permalink)
  └─ fetch(`https://www.reddit.com${permalink}.json`)
  └─ Handles 403/404/429/5xx errors
        │
        ▼
background.js → content.js: { success: true, data: [...] }
        │
        ▼
content.js: JSON.stringify(data, null, 2)
  └─ navigator.clipboard.writeText(prettyJson)
  └─ showToast('JSON copied!', 'success')
        │
        ▼
content.js → background.js: sendMessage({ action: 'addToHistory', entry })
  └─ Stores in chrome.storage.local (max 50 entries)
```

### 2. Popup Interaction

```
User clicks extension icon
        │
        ▼
popup.js: init()
  └─ sendMessage({ action: 'getHistory' })
  └─ Renders history list from storage
        │
        ├─ [Copy JSON]  → navigator.clipboard.writeText(entry.fullJson)
        ├─ [View]       → Opens modal with formatted <pre> block
        ├─ [Delete]     → Confirmation → sendMessage({ action: 'deleteHistoryEntry' })
        ├─ [Clear All]  → Confirmation → sendMessage({ action: 'clearHistory' })
        ├─ [Export]     → Blob download as .json file
        └─ [Search]     → Client-side filter on title/subreddit/postId
```

---

## Component Reference

### `manifest.json`
| Key | Value | Purpose |
|-----|-------|---------|
| `manifest_version` | `3` | Manifest V3 compliance |
| `permissions` | `["storage"]` | Persistent history storage |
| `host_permissions` | `["*://*.reddit.com/*"]` | Reddit API access |
| `content_scripts` | `content.js + content.css` | Injected into Reddit pages |
| `background.service_worker` | `background.js` | API fetching & storage |
| `action.default_popup` | `popup.html` | Extension popup |

### `background.js` — Service Worker

| Function | Message Action | Description |
|----------|---------------|-------------|
| `fetchRedditJSON()` | `fetchJSON` | Fetches `{permalink}.json` from Reddit |
| `addToHistory()` | `addToHistory` | Adds/updates entry in storage |
| `getHistory()` | `getHistory` | Returns all history entries |
| `deleteHistoryEntry()` | `deleteHistoryEntry` | Removes single entry |
| `clearHistory()` | `clearHistory` | Removes all entries |
| `getHistoryEntry()` | `getHistoryEntry` | Returns single entry by ID |

### `content.js` — Content Script

| Function | Description |
|----------|-------------|
| `processAllPosts()` | Scans DOM for posts, injects buttons |
| `injectButtonToNewRedditPost()` | Handles `<shreddit-post>` elements |
| `injectButtonToOldRedditPost()` | Handles `.thing.link` elements |
| `extractNewRedditPostData()` | Extracts permalink, title, subreddit, postId |
| `extractOldRedditPostData()` | Same for old.reddit.com |
| `handleJsonCopy()` | Click handler: fetch → copy → toast → store |
| `startObserver()` | MutationObserver for infinite scroll |
| `showToast()` | Floating notification near button |

### `popup.js` — Popup Controller

| Function | Description |
|----------|-------------|
| `loadHistory()` | Fetches history from background |
| `renderHistory()` | Builds DOM for history list |
| `createEntryCard()` | Creates single entry card element |
| `copyJson()` | Re-copies JSON to clipboard |
| `showJsonModal()` | Opens full JSON viewer |
| `exportHistory()` | Downloads history as .json file |
| `handleSearch()` | Debounced search filter |
| `updateStats()` | Updates counts in stats bar |

---

## File Structure

```
ReddJSON/
├── manifest.json           # Extension manifest (Manifest V3)
├── background.js           # Service worker – fetch + storage
├── content.js              # Content script – injection + observer
├── content.css             # Content script styles (injected into Reddit)
├── popup.html              # Popup HTML structure
├── popup.js                # Popup logic & event handling
├── popup.css               # Popup styles (premium design)
├── reddjosn.svg            # Source SVG icon (Reddit Snoo + JSON)
├── icons/
│   ├── icon-16.png         # 16×16 toolbar icon
│   ├── icon-48.png         # 48×48 management icon
│   ├── icon-128.png        # 128×128 store icon
│   ├── reddjosn.svg        # SVG copy in icons folder
│   ├── icon-generator.html # Browser-based PNG generator
│   └── generate-icons.js   # Node.js icon generator script
├── docs/
│   └── ARCHitecture.md     # Legacy architecture doc
├── TEST/
│   └── test-plan.md        # Manual test checklist
├── README.md               # Full documentation
└── ARCHITECTURE.md         # This file
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Manifest V3** | Required for Chrome Web Store (2024+), better security model |
| **Service Worker** | Can make cross-origin fetch() to Reddit API |
| **MutationObserver** | Reddit uses infinite scroll & SPA navigation |
| **`data-reddjson-added` marker** | Prevents duplicate button injection |
| **Inline styles on buttons** | Avoids race conditions with style injection |
| **`credentials: 'omit'`** | Public endpoint behavior, no cookie leaking |
| **`chrome.storage.local`** | Persists across sessions, shared between components |
| **Full JSON storage** | Enables re-copy without re-fetching |
| **50-entry limit** | Prevents storage quota exhaustion |
| **Zero dependencies** | No build step, no CDN reliance, instant loadability |

---

## Reddit .json API Reference

Every Reddit URL can be appended with `.json` to get the raw data:

```
https://www.reddit.com/r/{subreddit}/comments/{postId}/{slug}/.json
```

### Response Structure

```json
[
  {
    "kind": "Listing",
    "data": {
      "children": [
        {
          "kind": "t3",
          "data": {
            "subreddit": "javascript",
            "title": "...",
            "author": "...",
            "score": 42,
            "url": "...",
            "selftext": "...",
            "created_utc": 1710000000,
            ...
          }
        }
      ]
    }
  },
  {
    "kind": "Listing",
    "data": {
      "children": [
        { "kind": "t1", "data": { /* comment */ } },
        { "kind": "t1", "data": { /* comment */ } }
      ]
    }
  }
]
```

- **Element [0]**: Post listing (`t3` = link/post)
- **Element [1]**: Comments listing (`t1` = comment)
- ReddJSON copies the **entire response** (both elements), pretty-printed.

---

## Storage Schema

```json
{
  "reddjson_history": [
    {
      "id": "reddjson_1710000000000_abc123",
      "permalink": "/r/javascript/comments/abc123/title/",
      "title": "Post Title",
      "subreddit": "javascript",
      "postId": "abc123",
      "jsonPreview": "[\n  {\n    \"kind\": \"Listing\",\n    ...",
      "fullJson": [ /* full response */ ],
      "timestamp": 1710000000000,
      "copiedCount": 3
    }
  ]
}
```

---

## Browser Support

| Browser | Support |
|---------|---------|
| Chrome 88+ | ✅ Full support |
| Edge 88+ | ✅ Full support (Chromium-based) |
| Brave | ✅ Full support |
| Opera | ✅ Full support |
| Firefox | ❌ Requires manifest adaptation |
| Safari | ❌ Different extension API |
