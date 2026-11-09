# Sentinel's Journal - Security Learnings

## 2026-11-09 - Credentialed Subdomain Fetch & Safe Import Sanitization
**Vulnerability:** Unauthenticated API requests (`credentials: 'omit'`) prevented accessing quarantined and age-restricted content that users explicitly authorized in-session. Conversely, unbounded JSON imports in sidebar history without schema validation risked prototype pollution and storage exhaustion.
**Learning:** Browser extension background fetches to first-party session APIs (`reddit.com`) require `credentials: 'include'` to pass session authentication cookies, while third-party API fetches (OpenRouter, Groq) must remain strictly isolated. Imported user files must undergo strict schema validation and string truncation before entering storage.
**Prevention:** Strictly scope `credentials: 'include'` only to trusted first-party host permissions, and enforce type checks and payload limits on imported data.
