# Google Verification Website — Design Spec

**Date:** 2026-06-03  
**Status:** Approved

## Context

Fluffy Fiesta's Telegram bot integrates with Google Calendar via OAuth. Google requires apps requesting sensitive scopes (calendar write access) to have a publicly accessible homepage, privacy policy, and terms of service before the OAuth consent screen can be verified. This website fulfils those requirements.

---

## Hosting

**GitHub Pages** served from the `docs/` folder in the existing `jasminelim327/fluffy-fiesta` repo.

- Enable in repo Settings → Pages → Source: `main` branch, `/docs` folder
- Base URL: `https://jasminelim327.github.io/fluffy-fiesta`

---

## File Structure

```
docs/
  index.html      → landing page
  privacy.html    → privacy policy
  terms.html      → terms of service
```

No external dependencies. All CSS is inline. Logo is an inline SVG. No build step required.

---

## Visual Design

- **Style:** Warm & friendly — soft oranges, cream backgrounds, cosy tone
- **Font:** Georgia (serif) for headings and body; system sans-serif for nav/labels
- **Colours:**
  - Primary: `#D4501A` (dark orange — headings, links)
  - Accent: `#FF6B35` (bright orange — buttons, CTAs)
  - Background: `#FFF8F0` / `#FFFAF5` (warm cream)
  - Text: `#5C3D2E` (dark brown)
  - Muted: `#8B5E3C` / `#A0664A`
  - Dark footer: `#3D1A00`

---

## Logo

Inline SVG blob mascot: a friendly round orange face with confetti dots (rectangles + circles) in yellow, teal, and red scattered around it. Used in two sizes:
- **Large (88×88):** hero section of `index.html`
- **Small (32×32 or 24×24):** nav bar and legal pages

---

## index.html — Landing Page

### Sections

1. **Nav bar** — small logo + "Fluffy Fiesta" wordmark left; "Privacy Policy" and "Terms of Service" links right
2. **Hero** — large logo, headline "Your personal productivity companion on Telegram", subtitle, "Open in Telegram" CTA button (links to the bot's Telegram URL)
3. **Features grid** (2×2) — Tasks & Reminders, Daily Habits, Ask Me Anything, Morning Check-ins
4. **Google Calendar note** — explicitly states: write-only access, no data shared, revoke at myaccount.google.com/permissions *(required for Google verification)*
5. **Footer** — copyright + Privacy Policy + Terms of Service links

---

## privacy.html — Privacy Policy

Sections:
1. What we collect (Telegram IDs, tasks, habits, timezone, Google OAuth tokens)
2. How we use it (bot features only, no advertising, no selling)
3. Google Calendar (write-only access, token stored securely, revoke instructions)
4. Data storage (Render database, OpenRouter for AI processing)
5. Deletion ("delete my data" command or email)
6. Contact: jasminelim327@gmail.com

---

## terms.html — Terms of Service

Sections:
1. Acceptance
2. What the service does
3. User responsibilities (lawful use, no abuse)
4. Google API services — explicitly references [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) and Limited Use requirements *(required for Google verification)*
5. Availability (no uptime guarantee)
6. Limitation of liability
7. Contact: jasminelim327@gmail.com

---

## Google OAuth Consent Screen Fields (after site is live)

| Field | Value |
|-------|-------|
| App name | Fluffy Fiesta |
| Homepage | `https://jasminelim327.github.io/fluffy-fiesta` |
| Privacy Policy | `https://jasminelim327.github.io/fluffy-fiesta/privacy.html` |
| Terms of Service | `https://jasminelim327.github.io/fluffy-fiesta/terms.html` |
| Authorised domain | `jasminelim327.github.io` |

---

## Verification

1. Push `docs/` to GitHub, enable Pages in repo settings
2. Confirm `https://jasminelim327.github.io/fluffy-fiesta` loads
3. Confirm `/privacy.html` and `/terms.html` load
4. Paste homepage URL into Google Cloud Console → OAuth consent screen
5. Paste privacy + terms URLs into the respective fields
6. Submit for verification
