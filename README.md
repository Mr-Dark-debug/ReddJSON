# ReddJSON — Reddit Post JSON Copier

<div align="center">
  <img src="reddjosn.svg" alt="ReddJSON Logo" width="160" height="160">
</div>

<p align="center">
  <strong>Copy Reddit post JSON with one click ⚡</strong><br>
  <sub>A beautiful Chrome extension that adds a native JSON button to every Reddit post</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-FF4500?style=flat-square&logo=googlechrome&logoColor=white" alt="Version">
  <img src="https://img.shields.io/badge/manifest-v3-4285F4?style=flat-square" alt="Manifest V3">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License">
  <img src="https://img.shields.io/badge/zero-dependencies-blueviolet?style=flat-square" alt="Zero Dependencies">
</p>

---

## ✨ Features

- **One-Click Copy** — Click the `{} JSON` button on any post to copy the full, pretty-printed JSON to your clipboard
- **Native Integration** — Button seamlessly blends into Reddit's toolbar with matching colors and styling
- **Infinite Scroll Support** — Automatically adds buttons to new posts as you scroll (MutationObserver)
- **Dual Reddit Support** — Works on both `www.reddit.com` (new) and `old.reddit.com`
- **Copy History** — Popup shows your last 50 copied posts with persistent storage
- **Re-Copy & View** — Re-copy any previous JSON or view it in a full-screen modal
- **Search History** — Filter your history by title, subreddit, or post ID
- **Export History** — Download your entire copy history as a JSON file
- **Error Handling** — Graceful toasts for network errors, private subs, rate limits
- **Zero Dependencies** — No external libraries, no build step, instant load

---

## 📸 Screenshots

### JSON Button in Reddit Feed
> The `{} JSON` button appears in every post's action bar, right next to Share, Save, etc. Styled to match Reddit's native UI with Reddit-orange hover effect.

### Popup Copy History
> Clean, modern popup (420×600px) with gradient header, search bar, stats counter, and scrollable history cards. Each card shows title, subreddit badge, relative time, and action buttons.

### JSON Viewer Modal
> Full JSON viewer with dark syntax-highlighted `<pre>` block, copy button, and backdrop blur. Displays the complete Reddit API response.

### Toast Notifications
> Floating pill-shaped toasts with icons — success (green ✓), error (red ✕), info (orange ℹ). Auto-dismiss after 2 seconds.

---

## 🚀 Installation

### Load Unpacked (Developer Mode)

1. **Clone or download** this repository:
   ```bash
   git clone https://github.com/Mr-Dark-debug/ReddJSON.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **"Load unpacked"**
5. Select the `ReddJSON` folder from this project
6. The extension icon appears in your toolbar — you're ready! 🎉

### Chrome Web Store
> Coming soon — submission in progress.

---

## 📖 Usage

### Copy Post JSON
1. Browse any Reddit page (`www.reddit.com` or `old.reddit.com`)
2. Find the **`{} JSON`** button in any post's action bar
3. Click it → a green toast **"✅ JSON copied!"** appears
4. Paste the JSON anywhere (VS Code, Postman, etc.)

### Popup History
1. Click the **ReddJSON** extension icon in your browser toolbar
2. View your last 50 copied posts
3. For each entry you can:
   - **Copy JSON** — Re-copy the full JSON to clipboard
   - **View** — Open the JSON in a syntax-highlighted modal
   - **Open Post** — Click the title to open the original Reddit post
   - **Delete** — Remove the entry from history
4. **Search** — Type to filter by title, subreddit, or post ID
5. **Export** — Download all history as a timestamped `.json` file
6. **Clear All** — Remove all history (with confirmation)

### Keyboard Shortcuts (Popup)
| Shortcut | Action |
|----------|--------|
| `Ctrl+F` / `Cmd+F` | Focus search input |
| `Escape` | Close any open modal |

---

## 🔧 How It Works

### The Reddit `.json` Endpoint

Every Reddit URL can be appended with `.json` to get raw data:

```
https://www.reddit.com/r/javascript/comments/abc123/post_title/.json
```

The response is an array of two "Listing" objects:

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
            "title": "Post Title",
            "author": "username",
            "score": 42,
            "url": "https://...",
            "selftext": "Post body...",
            "created_utc": 1710000000
          }
        }
      ]
    }
  },
  {
    "kind": "Listing",
    "data": {
      "children": [/* comments */]
    }
  }
]
```

**ReddJSON copies the entire response** (post + comments), pretty-printed with `JSON.stringify(data, null, 2)`.

### Architecture

```
Content Script (content.js)           Background Worker (background.js)
┌──────────────────────────┐          ┌──────────────────────────┐
│ 1. Find <shreddit-post>  │          │                          │
│ 2. Extract permalink     │ ──msg──► │ 3. fetch(permalink.json) │
│ 4. Copy to clipboard     │ ◄──msg── │    Return JSON data      │
│ 5. Show toast            │ ──msg──► │ 6. Store in history      │
│ 7. MutationObserver      │          │                          │
│    (infinite scroll)     │          │                          │
└──────────────────────────┘          └──────────────────────────┘
                                                │
                                      ┌─────────▼──────────┐
                                      │ chrome.storage.local│
                                      │ (last 50 entries)   │
                                      └────────────────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full component reference and data flow.

---

## 🎛️ Configuration

All configurable values are at the top of `content.js` with clear comments:

### Selectors (Update if Reddit changes UI)

```javascript
const SELECTORS = {
  shredditPost: 'shreddit-post',              // New Reddit custom element
  postContainer: '[data-testid="post-container"]', // Fallback
  oldRedditThing: '.thing.link',              // Old Reddit
  shareButton: 'button[aria-label="Share"]',  // Inject after this
  oldRedditToolbar: '.flat-list.buttons',     // Old Reddit toolbar
  permalinkAttr: 'permalink',                 // <shreddit-post permalink="...">
};
```

### Options

```javascript
const CONFIG = {
  buttonLabel: 'JSON',          // Button text (change to "{}" etc.)
  toastDuration: 2000,          // Toast display time (ms)
  observerDebounce: 150,        // MutationObserver debounce (ms)
  redditOrange: '#FF4500',      // Reddit brand color
  markerAttribute: 'data-reddjson-added'  // Prevents duplicate buttons
};
```

---

## 🐛 Troubleshooting

### Buttons not appearing?
| Issue | Solution |
|-------|----------|
| No buttons on any posts | Open DevTools Console (F12) → check for `[ReddJSON]` logs |
| Reddit UI changed | Update selectors in `SELECTORS` object at top of `content.js` |
| Extension not loading | Check `chrome://extensions` → ensure extension is enabled |
| Conflicting extensions | Disable other Reddit extensions temporarily |
| SPA navigation issue | Try hard refresh (`Ctrl+Shift+R`) |

### JSON not copying?
| Issue | Solution |
|-------|----------|
| "Focus this tab" error | Click on the Reddit tab first, then click JSON |
| Network error | Check internet connection |
| Private subreddit | Extension shows error toast (expected behavior) |
| Rate limited | Wait a moment and try again |
| Very large JSON | May take longer — button shows spinner |

### Popup issues?
| Issue | Solution |
|-------|----------|
| Empty history | Copy at least one post first |
| Search not working | Check for typos; searches title, subreddit, postId |
| Export fails | Ensure popup has permission to download |

---

## 🧪 Test Plan

Use this checklist to verify the extension works correctly:

### Core Functionality
- [ ] **T01 — Fresh Load**: Navigate to `reddit.com` → JSON buttons appear on 5+ posts
- [ ] **T02 — Infinite Scroll**: Scroll down → new posts automatically get buttons
- [ ] **T03 — Basic Copy**: Click JSON button → toast appears → clipboard has valid JSON
- [ ] **T04 — Toast Behavior**: Toast appears near button, auto-dismisses after ~2s

### Popup
- [ ] **T05 — History Load**: Open popup → entries appear with correct title/sub/time
- [ ] **T06 — Copy Again**: Click "Copy JSON" → clipboard updated, success toast shown
- [ ] **T07 — View JSON**: Click "View" → modal opens with formatted JSON + copy button
- [ ] **T08 — Delete Entry**: Click delete → confirmation → entry removed
- [ ] **T09 — Export**: Click export → `.json` file downloads with all history

### Cross-Platform
- [ ] **T10 — Old Reddit**: Navigate to `old.reddit.com` → buttons appear and work
- [ ] **T11 — Single Post Page**: Open any post page → button appears
- [ ] **T12 — NSFW Post**: Button appears and copies JSON (if enabled in settings)
- [ ] **T13 — Media Posts**: Test with image, video, and gallery posts

### Error Handling
- [ ] **T14 — Offline**: Disable network → click button → error toast appears
- [ ] **T15 — Private Sub**: Navigate to private sub → graceful error
- [ ] **T16 — Rate Limit**: Rapid clicks → rate limit message (or normal operation)

### Performance
- [ ] **T17 — Large Feed**: Load 100+ posts → no lag or stuttering
- [ ] **T18 — Memory**: Check DevTools → no memory leaks over time
- [ ] **T19 — Multiple Tabs**: Open Reddit in 3+ tabs → all work independently

### Edge Cases
- [ ] **T20 — Duplicate Prevention**: Scroll up/down → no duplicate buttons
- [ ] **T21 — SPA Navigation**: Click post → go back → buttons still work
- [ ] **T22 — Long Thread**: Copy post with 1000+ comments → handles gracefully
- [ ] **T23 — Cross-Posted Post**: Button works on cross-posted content

---

## 📁 Project Structure

```
ReddJSON/
├── manifest.json           # Chrome extension manifest (V3)
├── background.js           # Service worker — fetch + storage helper
├── content.js              # Content script — injection + observer + toasts
├── content.css             # Content script styles
├── popup.html              # Popup HTML structure
├── popup.js                # Popup logic — history, search, modals
├── popup.css               # Popup styles — premium dark/light design
├── reddjosn.svg            # Main SVG icon (Reddit Snoo + JSON document)
├── icons/
│   ├── icon-16.png         # 16×16 icon (toolbar)
│   ├── icon-48.png         # 48×48 icon (extensions page)
│   ├── icon-128.png        # 128×128 icon (Chrome Web Store)
│   ├── reddjosn.svg        # SVG source copy
│   ├── icon-generator.html # Browser-based PNG generator tool
│   └── generate-icons.js   # Node.js icon generation script
├── docs/
│   └── ARCHitecture.md     # Architecture documentation
├── TEST/
│   └── test-plan.md        # Extended test checklist
├── ARCHITECTURE.md         # Architecture overview (this repo root)
└── README.md               # This file
```

---

## 🔮 Future Ideas

- [ ] **Options page** — Customize button label, toast duration, history limit
- [ ] **Dark mode** — Detect system preference for popup
- [ ] **Keyboard shortcuts** — `Alt+J` to copy JSON on focused post
- [ ] **Context menu** — Right-click → "Copy Post JSON"
- [ ] **Export formats** — CSV, YAML, XML
- [ ] **JSON path filter** — Copy only `data.children[0].data` (post only, no comments)
- [ ] **Syntax highlighting** — Color-coded JSON viewer in popup
- [ ] **Notification badge** — Show unread copy count on icon
- [ ] **Firefox support** — Adapt manifest for Firefox Add-ons
- [ ] **History sync** — `chrome.storage.sync` for cross-device history

---

## 🤝 Contributing

Contributions are welcome! Here's how:

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/awesome-thing`)
3. Commit your changes (`git commit -m 'Add awesome thing'`)
4. Push to your branch (`git push origin feature/awesome-thing`)
5. Open a Pull Request

### Development Setup
1. Clone the repo
2. Load unpacked in `chrome://extensions`
3. Make changes → click the refresh button in extensions page
4. Test on `www.reddit.com` and `old.reddit.com`

---

## 📄 License

MIT License

Copyright (c) 2025 ReddJSON

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

<div align="center">
  <img src="reddjosn.svg" alt="ReddJSON" width="48" height="48">
  <br>
  <sub>Made with ❤️ for Reddit developers & data enthusiasts</sub>
</div>
