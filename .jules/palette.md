# Palette's Journal - UX & Accessibility Learnings

## 2026-11-09 - Accessible Shadow-DOM Slotted Actions & In-Situ Visual Feedback
**Learning:** In modern Web Component architectures with Shadow DOM (like Reddit's `<shreddit-post>`), custom interactive buttons injected directly into light DOM elements must specify valid `slot` attributes (e.g., `slot="action-bar"`) to be projected and accessible. Furthermore, icon-only and compact buttons require clear `aria-label`, `aria-haspopup="menu"`, and immediate in-situ visual feedback (brief button state text update) alongside toast alerts to confirm user action.
**Action:** Always inspect component slot boundaries when augmenting Web Components, and pair non-modal notifications with in-situ micro-interaction states.
