# ReddJSON Architecture

Version 1.0.0

## Overview

ReddJSON is a Chrome extension (Manifest V3) that adds a native-looking "JSON" button to every Reddit post. When clicked, it fetches the raw full JSON from the post's permalink + `.json` endpoint and copies the pretty-printed JSON to the clipboard.

! Extension consists of:

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                 │                                                                                     │            │
│   Content Script         │   (1) Find post element with permalink    │
│   (shreddit-post)          │                      │                       │
│                     │   (2) Extract permalink                                     │
│                     │   (3) Add JSON button                                        │
│                     │   (4) On click → send message to background    │
│                     │   (5) Fetch from Reddit .json endpoint              │
│                     │   (6) Return pretty JSON to content             │
│                     │   (7) Copy to clipboard                                   │
│                     │   (8) Show success toast                                  │
│                     │   (9) Store in history                                 │
│                     ▔─────────────────────────────────────────────────────────────────────┘
│                                                                                     │                                                                                     │            │
│   Background Worker     │  (1) Receive fetch request                               │
│                     │   (2) Fetch JSON from Reddit API               │
│                     │   (3) Return JSON response                                │
│                     └─────────────────────────────────────────────────────────────────────┘
│                                                                                     │                                                                                     │            │
│   Storage (Chrome)       │  Stores copy history (last 50 entries)                       │
│                     │   Each entry: {permalink, title, subreddit, timestamp, postId, jsonPreview, }  │
│                     └─────────────────────────────────────────────────────────────────────┘
│                                                                                     │                                                                                     │            │
│   Popup UI          │  Displays history with search, copy, view, export                │
│                     └─────────────────────────────────────────────────────────────────────┘
│                                                                                     │                                                                                     │            │
│   Reddit .json API          │  Endpoint: https://www.reddit.com{permalink}.json                  │
│   Response: Array with two Listing objects:                                    │
│     [0]: { kind: "Listing", data: { children: [{ kind: "t3", data: {...}] } } ]     │
│     [1]: { kind: "Listing", data: { children: [...] } } // Comments                │
│                     │                                                                                     │            │
│   Full JSON: The entire response, pretty-printed                           │
│                     │                                                                                     │            │
```

## Component Structure
```

### manifest.json
- Extension manifest (Manifest V3)
- Permissions: storage, clipboardWrite
- Host permissions: *://*.reddit.com/*
- Action: popup configuration
- Content scripts: matches *://*.reddit.com/*
- Background: service worker

### background.js (Service Worker)
- **Message Handlers:**
  - `fetchJSON`: Fetches JSON from Reddit API
  - `addToHistory`: Adds entry to storage
  - `getHistory`: Retrieves history
  - `deleteHistoryEntry`: Removes entry
  - `clearHistory`: Clears all history
  - `getHistoryEntry`: Gets single entry
- **Install/Update Handler**: Initializes storage on install

- **Fetch Logic**:
  - Constructs `.json` URL
  - Uses `fetch()` API
  - Returns pretty-printed JSON
  - Error handling for private posts, rate limits, network errors

  - Maximum 50 entries
  - JSON preview: first 300 characters

### content.js
- **Post Detection:**
  - `shreddit-post` custom elements (new Reddit)
  - `.thing` elements (old Reddit)
  - Fallback selectors for containers
- **Button Injection:**
  - `createJsonButton()`: Creates styled button element
  - `injectButtonToNewRedditPost()`: For new Reddit
  - `injectButtonToOldRedditPost()`: For old Reddit
- **Event Handlers:**
  - `handleJsonCopy()`: Main click handler - fetches and copies JSON
- Uses `MutationObserver` to watch for dynamically loaded posts
- Prevents duplicate buttons with `data-reddjson-added`
- Shows toast notifications
- Extracts post data (permalink, title, subreddit, postId)
- Injects styles into page

- **Permalink Extraction:**
  - Primary: `shreddit-post[permalink]` attribute
  - Fallback: `data-permalink` attribute, or anchor `[href*="/comments/"]`
  - Old Reddit: `.thing[data-permalink]` or `data-url`

  - Last resort: URL from `a.comments` link`
- **Title/Subreddit Extraction:**
  - `shreddit-post`: `querySelector('h1, [slot="title"], a[href^="/r/"])`)
  - Old Reddit: `.thing a.querySelector('a.title')`
          - `querySelector('a[href^="/r/"]`)` - href
  - Old Reddit: Parse URL from link `href` attribute
          - Extract subreddit name
          - Last resort: parse from `.flat-list.buttons` container

### popup.html / popup.js / popup.css
- **History Display**:**
  - `renderHistory()`: Renders history list from storage
  - `updateStats()`: Updates statistics display
  - Search functionality with debounce
  - Event handlers for buttons, search, etc.
- **Actions:**
  - Copy JSON: Re-copy JSON
  - View JSON: Opens modal with formatted JSON
  - Delete: Removes entry from history
  - Export: Downloads history as JSON file
  - Clear All: Confirmation dialog

- **Modals:**
  - JSON View modal
          - Confirmation modal
- **Utilities**: Toast, escapeHtml, truncate, formatRelativeTime
- **Background Communication**: `chrome.runtime.sendMessage()`

- **Storage**: `chrome.storage.local` API

- **Clipboard**: `navigator.clipboard.writeText()`

## File Structure
```
reddjson/
├── manifest.json          # Extension manifest
├── background.js          # Service worker (fetching + storage)
├── content.js             # Content script (injection + observer)
├── content.css            # Additional content styles
├── popup.html             # Popup HTML structure
├── popup.js              # Popup logic
├── popup.css              # Popup styling
├── icons/
│   ├── icon-16.png       # 16x16 icon
│   ├── icon-48.png       # 48x48 icon
│   ├── icon-128.png      # 128x128 icon
│   ├── reddjson.svg      # Source SVG
│   └── generate-icons.js   # Icon generation script
├── README.md              # Documentation
└── ARCHITECTURE.md       # This file
```

## Key Features
1. **Native Integration**: Button looks and feels like part of Reddit's UI
2. **Full JSON**: Fetches complete post data including comments
3. **Smart History**: Persistent storage with search and export
4. **Toast Notifications**: Visual feedback for actions
5. **Error Handling**: Graceful handling of errors
6. **Accessibility**: ARIA labels and keyboard support
7. **Performance**: Optimized for large feeds
8. **Dual Reddit Support**: Works on both new and old Reddit
9. **Zero Dependencies**: No external libraries required

10. **Configurable**: Easy-to-update selectors

