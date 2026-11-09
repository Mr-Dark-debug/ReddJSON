# Bolt's Journal - Performance Learnings

## 2026-11-09 - Elimination of Full-Subtree SPA Mutation Observers
**Learning:** Attaching a separate `MutationObserver` to `document` with `{ subtree: true, childList: true }` solely to detect SPA URL transitions (`location.href !== lastUrl`) triggers thousands of redundant callbacks on every scroll, media load, and UI micro-interaction on infinite-scroll pages.
**Action:** Replace full-document URL mutation observers with native `history.pushState` / `history.replaceState` patching, `popstate` events, and scoped checks inside debounced lifecycle observers.
