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
<img width="1305" height="870" alt="image" src="https://github.com/user-attachments/assets/d0ec2ea7-6e5a-4fe2-962e-faf9ac41af5c" />

### Sidebar Copy History
> Clean, modern sidebar with gradient header, search bar, stats counter, and scrollable history cards. Each card shows title, subreddit badge, relative time, and action buttons.
<img width="1913" height="927" alt="image" src="https://github.com/user-attachments/assets/579756d6-5f99-445a-a24f-35ff9050383d" />

### JSON Viewer Modal
> Full JSON viewer with dark syntax-highlighted `<pre>` block, copy button, and backdrop blur. Displays the complete Reddit API response.
<img width="662" height="934" alt="image" src="https://github.com/user-attachments/assets/efb868f2-5a7e-41c1-81dc-d7535534fef1" />

### AI post generator 
> Generates viral LinkedIn post directly with one click.
<img width="1919" height="929" alt="image" src="https://github.com/user-attachments/assets/2f449d4e-f5d4-44e6-beff-b69d2ca6a412" />

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
                                      ┌─────────▼───────────┐
                                      │ chrome.storage.local│
                                      │ (last 50 entries)   │
                                      └─────────────────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full component reference and data flow.

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
