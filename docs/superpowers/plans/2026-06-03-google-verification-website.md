# Google Verification Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a three-page static website (landing, privacy policy, terms of service) to GitHub Pages for Google OAuth verification.

**Architecture:** Three self-contained HTML files in `docs/` with all CSS inline — no build step, no dependencies. GitHub Pages serves the `docs/` folder from the `main` branch. The blob mascot logo is an inline SVG reused across all three pages.

**Tech Stack:** Plain HTML/CSS, inline SVG, GitHub Pages

---

## File Map

| File | Purpose |
|------|---------|
| `docs/index.html` | Landing page — hero, features, Google Calendar note, footer |
| `docs/privacy.html` | Privacy policy with Google API section |
| `docs/terms.html` | Terms of service with Google Limited Use reference |
| `.gitignore` | Add `.superpowers/` entry |

---

### Task 1: Add `.superpowers/` to `.gitignore` and create `docs/index.html`

**Files:**
- Modify: `.gitignore`
- Create: `docs/index.html`

- [ ] **Step 1: Add `.superpowers/` to `.gitignore`**

Open `.gitignore` and append this line:
```
.superpowers/
```

- [ ] **Step 2: Create `docs/index.html`**

Create the file with this exact content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fluffy Fiesta — Your personal productivity companion</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, serif; background: #FFFAF5; color: #5C3D2E; }
    a { color: #FF6B35; text-decoration: none; }
    a:hover { text-decoration: underline; }

    nav {
      background: #FFF8F0;
      border-bottom: 1px solid #FFD9BF;
      padding: 14px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .nav-brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 1.05rem; color: #D4501A; }
    .nav-links { display: flex; gap: 24px; font-size: 0.82rem; color: #A0664A; }
    .nav-links a { color: #A0664A; }

    .hero {
      background: linear-gradient(160deg, #FFF8F0, #FFF0E0);
      padding: 64px 32px 48px;
      text-align: center;
    }
    .hero svg { margin-bottom: 20px; }
    .hero h1 { font-size: 2.1rem; font-weight: 900; color: #D4501A; line-height: 1.2; margin-bottom: 14px; }
    .hero p { font-size: 0.95rem; color: #8B5E3C; max-width: 420px; margin: 0 auto 28px; line-height: 1.7; }
    .cta {
      display: inline-block;
      background: #FF6B35;
      color: white;
      border-radius: 10px;
      padding: 13px 32px;
      font-size: 0.9rem;
      font-weight: 700;
      text-decoration: none;
    }
    .cta:hover { background: #e85e2a; text-decoration: none; }

    .features { padding: 48px 32px; background: white; }
    .features-label {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: #A0664A;
      text-align: center;
      margin-bottom: 24px;
    }
    .features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      max-width: 720px;
      margin: 0 auto;
    }
    .feature-card {
      background: #FFF8F0;
      border-radius: 14px;
      padding: 20px;
    }
    .feature-card .icon { font-size: 1.5rem; margin-bottom: 8px; }
    .feature-card h3 { font-size: 0.88rem; font-weight: 700; color: #D4501A; margin-bottom: 6px; }
    .feature-card p { font-size: 0.78rem; color: #8B5E3C; line-height: 1.6; }

    .gcal-note {
      background: #FFF8F0;
      border-top: 1px solid #FFD9BF;
      padding: 28px 32px;
      text-align: center;
    }
    .gcal-note p { font-size: 0.82rem; color: #8B5E3C; max-width: 520px; margin: 0 auto; line-height: 1.7; }

    footer {
      background: #3D1A00;
      padding: 20px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    footer span { color: #A0664A; font-size: 0.75rem; }
    .footer-links { display: flex; gap: 20px; }
    .footer-links a { color: #A0664A; font-size: 0.75rem; }
  </style>
</head>
<body>

  <nav>
    <div class="nav-brand">
      <svg width="32" height="32" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="36" cy="38" rx="22" ry="24" fill="#FF8C55"/>
        <ellipse cx="36" cy="36" rx="20" ry="22" fill="#FFA06A"/>
        <ellipse cx="29" cy="33" rx="3.5" ry="4" fill="white"/>
        <ellipse cx="43" cy="33" rx="3.5" ry="4" fill="white"/>
        <circle cx="30" cy="34" r="2" fill="#333"/>
        <circle cx="44" cy="34" r="2" fill="#333"/>
        <path d="M28 41 Q36 48 44 41" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/>
        <rect x="10" y="14" width="5" height="5" rx="1" fill="#FFD166" transform="rotate(20 12 16)"/>
        <rect x="54" y="10" width="5" height="5" rx="1" fill="#4ECDC4" transform="rotate(-15 56 12)"/>
        <circle cx="16" cy="52" r="3" fill="#FF6B6B"/>
        <circle cx="58" cy="48" r="3" fill="#FFD166"/>
        <rect x="52" y="26" width="4" height="4" rx="1" fill="#FF6B6B" transform="rotate(30 54 28)"/>
        <rect x="13" y="30" width="4" height="4" rx="1" fill="#4ECDC4" transform="rotate(-20 15 32)"/>
      </svg>
      Fluffy Fiesta
    </div>
    <div class="nav-links">
      <a href="privacy.html">Privacy Policy</a>
      <a href="terms.html">Terms of Service</a>
    </div>
  </nav>

  <section class="hero">
    <svg width="96" height="96" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="36" cy="38" rx="22" ry="24" fill="#FF8C55"/>
      <ellipse cx="36" cy="36" rx="20" ry="22" fill="#FFA06A"/>
      <ellipse cx="29" cy="33" rx="3.5" ry="4" fill="white"/>
      <ellipse cx="43" cy="33" rx="3.5" ry="4" fill="white"/>
      <circle cx="30" cy="34" r="2" fill="#333"/>
      <circle cx="44" cy="34" r="2" fill="#333"/>
      <path d="M28 41 Q36 48 44 41" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/>
      <rect x="10" y="14" width="5" height="5" rx="1" fill="#FFD166" transform="rotate(20 12 16)"/>
      <rect x="54" y="10" width="5" height="5" rx="1" fill="#4ECDC4" transform="rotate(-15 56 12)"/>
      <circle cx="16" cy="52" r="3" fill="#FF6B6B"/>
      <circle cx="58" cy="48" r="3" fill="#FFD166"/>
      <rect x="52" y="26" width="4" height="4" rx="1" fill="#FF6B6B" transform="rotate(30 54 28)"/>
      <rect x="13" y="30" width="4" height="4" rx="1" fill="#4ECDC4" transform="rotate(-20 15 32)"/>
    </svg>
    <h1>Your personal productivity<br>companion on Telegram</h1>
    <p>Set tasks, track habits, get answers to anything, and receive a daily morning boost — all through a simple Telegram chat.</p>
    <a class="cta" href="https://t.me/YOUR_BOT_USERNAME">💬 Open in Telegram</a>
  </section>

  <section class="features">
    <p class="features-label">What Fluffy Fiesta can do</p>
    <div class="features-grid">
      <div class="feature-card">
        <div class="icon">📌</div>
        <h3>Tasks &amp; Reminders</h3>
        <p>Add tasks and recurring reminders synced to your Google Calendar automatically.</p>
      </div>
      <div class="feature-card">
        <div class="icon">🔥</div>
        <h3>Daily Habits</h3>
        <p>Set a daily commitment, log your progress, and build streaks over time.</p>
      </div>
      <div class="feature-card">
        <div class="icon">❓</div>
        <h3>Ask Me Anything</h3>
        <p>Get answers to any question — recipes, advice, or general knowledge.</p>
      </div>
      <div class="feature-card">
        <div class="icon">☀️</div>
        <h3>Morning Check-ins</h3>
        <p>A daily message with your tasks, streak status, and a motivational line.</p>
      </div>
    </div>
  </section>

  <section class="gcal-note">
    <p>📅 <strong>Google Calendar integration</strong> — Fluffy Fiesta can add your tasks to Google Calendar when you connect your account. We only request write access and never read, store, or share your calendar data beyond creating events you ask for. You can revoke access at any time via <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</p>
  </section>

  <footer>
    <span>© 2026 Fluffy Fiesta</span>
    <div class="footer-links">
      <a href="privacy.html">Privacy Policy</a>
      <a href="terms.html">Terms of Service</a>
    </div>
  </footer>

</body>
</html>
```

- [ ] **Step 3: Replace the Telegram bot username**

In `docs/index.html`, find:
```
https://t.me/YOUR_BOT_USERNAME
```
Replace `YOUR_BOT_USERNAME` with your actual Telegram bot username (e.g. `dailyreminders_bot`). You can find it in BotFather.

- [ ] **Step 4: Open the file locally to verify**

```bash
open docs/index.html
```

Expected: landing page opens in your browser with the blob logo, orange hero section, 4 feature cards, Google Calendar note, and dark footer.

- [ ] **Step 5: Commit**

```bash
git add .gitignore docs/index.html
git commit -m "feat: add Fluffy Fiesta landing page for Google verification"
```

---

### Task 2: Create `docs/privacy.html`

**Files:**
- Create: `docs/privacy.html`

- [ ] **Step 1: Create `docs/privacy.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — Fluffy Fiesta</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, serif; background: #FFFAF5; color: #5C3D2E; }
    a { color: #FF6B35; }

    nav {
      background: #FFF8F0;
      border-bottom: 1px solid #FFD9BF;
      padding: 14px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .nav-brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 1.05rem; color: #D4501A; text-decoration: none; }
    .nav-links { display: flex; gap: 24px; font-size: 0.82rem; }
    .nav-links a { color: #A0664A; text-decoration: none; }

    .content { max-width: 680px; margin: 0 auto; padding: 52px 32px 80px; }
    h1 { font-size: 2rem; font-weight: 900; color: #D4501A; margin-bottom: 8px; }
    .meta { font-size: 0.78rem; color: #A0664A; margin-bottom: 40px; }
    h2 { font-size: 1rem; font-weight: 700; color: #D4501A; margin: 32px 0 10px; }
    p { font-size: 0.88rem; line-height: 1.8; margin-bottom: 10px; }
    ul { padding-left: 20px; margin-bottom: 10px; }
    li { font-size: 0.88rem; line-height: 1.8; }

    footer {
      background: #3D1A00;
      padding: 20px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    footer span { color: #A0664A; font-size: 0.75rem; }
    .footer-links { display: flex; gap: 20px; }
    .footer-links a { color: #A0664A; font-size: 0.75rem; text-decoration: none; }
  </style>
</head>
<body>

  <nav>
    <a class="nav-brand" href="index.html">
      <svg width="28" height="28" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="36" cy="38" rx="22" ry="24" fill="#FF8C55"/>
        <ellipse cx="36" cy="36" rx="20" ry="22" fill="#FFA06A"/>
        <ellipse cx="29" cy="33" rx="3.5" ry="4" fill="white"/>
        <ellipse cx="43" cy="33" rx="3.5" ry="4" fill="white"/>
        <circle cx="30" cy="34" r="2" fill="#333"/>
        <circle cx="44" cy="34" r="2" fill="#333"/>
        <path d="M28 41 Q36 48 44 41" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/>
        <rect x="10" y="14" width="5" height="5" rx="1" fill="#FFD166" transform="rotate(20 12 16)"/>
        <rect x="54" y="10" width="5" height="5" rx="1" fill="#4ECDC4" transform="rotate(-15 56 12)"/>
        <circle cx="16" cy="52" r="3" fill="#FF6B6B"/>
        <circle cx="58" cy="48" r="3" fill="#FFD166"/>
      </svg>
      Fluffy Fiesta
    </a>
    <div class="nav-links">
      <a href="privacy.html">Privacy Policy</a>
      <a href="terms.html">Terms of Service</a>
    </div>
  </nav>

  <div class="content">
    <h1>Privacy Policy</h1>
    <p class="meta">Last updated: June 2026</p>

    <h2>1. What we collect</h2>
    <ul>
      <li>Your Telegram user ID and chat ID</li>
      <li>Tasks, reminders, and habit goals you create</li>
      <li>Energy levels and streak data you log</li>
      <li>Your timezone (only if you choose to share your location)</li>
      <li>Google Calendar OAuth tokens (only if you connect Google Calendar)</li>
    </ul>

    <h2>2. How we use it</h2>
    <p>Your data is used solely to provide the bot's features — saving tasks, sending reminders, and syncing events to Google Calendar. We do not sell, share, or use your data for advertising or any purpose beyond operating the service.</p>

    <h2>3. Google Calendar</h2>
    <p>If you connect Google Calendar, Fluffy Fiesta requests write-only access to add calendar events on your behalf. We store your OAuth token securely in our database to maintain the connection between sessions. We do not read, analyse, or share your existing calendar data.</p>
    <p>You can revoke access at any time by visiting <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> and removing Fluffy Fiesta, or by contacting us at the email below.</p>

    <h2>4. Data storage</h2>
    <p>Your data is stored in a secure PostgreSQL database hosted on Render. Your messages are processed by OpenRouter (an AI API provider) solely to generate responses — they are not stored or used to train models beyond what OpenRouter's own policies describe.</p>

    <h2>5. Data deletion</h2>
    <p>To delete all your data, send the message <strong>"delete my data"</strong> to the bot, or email us at the address below. We will remove your data within 7 days.</p>

    <h2>6. Contact</h2>
    <p>For any privacy questions, contact us at: <a href="mailto:jasminelim327@gmail.com">jasminelim327@gmail.com</a></p>
  </div>

  <footer>
    <span>© 2026 Fluffy Fiesta</span>
    <div class="footer-links">
      <a href="privacy.html">Privacy Policy</a>
      <a href="terms.html">Terms of Service</a>
    </div>
  </footer>

</body>
</html>
```

- [ ] **Step 2: Open locally to verify**

```bash
open docs/privacy.html
```

Expected: styled privacy policy page with orange headings, nav bar linking back to index, and footer.

- [ ] **Step 3: Commit**

```bash
git add docs/privacy.html
git commit -m "feat: add privacy policy page"
```

---

### Task 3: Create `docs/terms.html`

**Files:**
- Create: `docs/terms.html`

- [ ] **Step 1: Create `docs/terms.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service — Fluffy Fiesta</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, serif; background: #FFFAF5; color: #5C3D2E; }
    a { color: #FF6B35; }

    nav {
      background: #FFF8F0;
      border-bottom: 1px solid #FFD9BF;
      padding: 14px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .nav-brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 1.05rem; color: #D4501A; text-decoration: none; }
    .nav-links { display: flex; gap: 24px; font-size: 0.82rem; }
    .nav-links a { color: #A0664A; text-decoration: none; }

    .content { max-width: 680px; margin: 0 auto; padding: 52px 32px 80px; }
    h1 { font-size: 2rem; font-weight: 900; color: #D4501A; margin-bottom: 8px; }
    .meta { font-size: 0.78rem; color: #A0664A; margin-bottom: 40px; }
    h2 { font-size: 1rem; font-weight: 700; color: #D4501A; margin: 32px 0 10px; }
    p { font-size: 0.88rem; line-height: 1.8; margin-bottom: 10px; }
    ul { padding-left: 20px; margin-bottom: 10px; }
    li { font-size: 0.88rem; line-height: 1.8; }

    footer {
      background: #3D1A00;
      padding: 20px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    footer span { color: #A0664A; font-size: 0.75rem; }
    .footer-links { display: flex; gap: 20px; }
    .footer-links a { color: #A0664A; font-size: 0.75rem; text-decoration: none; }
  </style>
</head>
<body>

  <nav>
    <a class="nav-brand" href="index.html">
      <svg width="28" height="28" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="36" cy="38" rx="22" ry="24" fill="#FF8C55"/>
        <ellipse cx="36" cy="36" rx="20" ry="22" fill="#FFA06A"/>
        <ellipse cx="29" cy="33" rx="3.5" ry="4" fill="white"/>
        <ellipse cx="43" cy="33" rx="3.5" ry="4" fill="white"/>
        <circle cx="30" cy="34" r="2" fill="#333"/>
        <circle cx="44" cy="34" r="2" fill="#333"/>
        <path d="M28 41 Q36 48 44 41" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/>
        <rect x="10" y="14" width="5" height="5" rx="1" fill="#FFD166" transform="rotate(20 12 16)"/>
        <rect x="54" y="10" width="5" height="5" rx="1" fill="#4ECDC4" transform="rotate(-15 56 12)"/>
        <circle cx="16" cy="52" r="3" fill="#FF6B6B"/>
        <circle cx="58" cy="48" r="3" fill="#FFD166"/>
      </svg>
      Fluffy Fiesta
    </a>
    <div class="nav-links">
      <a href="privacy.html">Privacy Policy</a>
      <a href="terms.html">Terms of Service</a>
    </div>
  </nav>

  <div class="content">
    <h1>Terms of Service</h1>
    <p class="meta">Last updated: June 2026</p>

    <h2>1. Acceptance</h2>
    <p>By using Fluffy Fiesta, you agree to these terms. If you do not agree, please stop using the service.</p>

    <h2>2. What the service does</h2>
    <p>Fluffy Fiesta is a Telegram bot that helps you manage tasks, build daily habits, and stay productive. It uses AI to understand your messages and can integrate with Google Calendar to create events on your behalf when you authorise it to do so.</p>

    <h2>3. Your responsibilities</h2>
    <ul>
      <li>Use the service for lawful purposes only</li>
      <li>Do not attempt to abuse, overload, or reverse-engineer the bot</li>
      <li>Keep your Telegram account secure</li>
    </ul>

    <h2>4. Google API services</h2>
    <p>Fluffy Fiesta's use of Google APIs complies with the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. We only use Google Calendar access to create events explicitly requested by you, and for no other purpose.</p>

    <h2>5. Availability</h2>
    <p>We aim for high availability but do not guarantee uninterrupted service. The bot may be updated, restarted, or taken offline at any time without notice.</p>

    <h2>6. Limitation of liability</h2>
    <p>Fluffy Fiesta is provided as-is. We are not liable for missed reminders, lost data, or any indirect damages arising from use of the service.</p>

    <h2>7. Changes to these terms</h2>
    <p>We may update these terms at any time. Continued use of the service after changes are posted constitutes acceptance of the new terms.</p>

    <h2>8. Contact</h2>
    <p>For any questions, contact us at: <a href="mailto:jasminelim327@gmail.com">jasminelim327@gmail.com</a></p>
  </div>

  <footer>
    <span>© 2026 Fluffy Fiesta</span>
    <div class="footer-links">
      <a href="privacy.html">Privacy Policy</a>
      <a href="terms.html">Terms of Service</a>
    </div>
  </footer>

</body>
</html>
```

- [ ] **Step 2: Open locally to verify**

```bash
open docs/terms.html
```

Expected: styled terms of service page matching the privacy policy layout.

- [ ] **Step 3: Commit and push**

```bash
git add docs/terms.html
git commit -m "feat: add terms of service page"
git push
```

---

### Task 4: Enable GitHub Pages

**No code changes — GitHub settings only.**

- [ ] **Step 1: Go to repo settings**

Open: `https://github.com/jasminelim327/fluffy-fiesta/settings/pages`

- [ ] **Step 2: Enable Pages**

- Under **Source**, select **Deploy from a branch**
- Branch: `main`
- Folder: `/docs`
- Click **Save**

- [ ] **Step 3: Wait ~2 minutes, then verify all three URLs load**

```
https://jasminelim327.github.io/fluffy-fiesta/
https://jasminelim327.github.io/fluffy-fiesta/privacy.html
https://jasminelim327.github.io/fluffy-fiesta/terms.html
```

Expected: all three pages load with the warm orange design.

- [ ] **Step 4: Enter URLs in Google Cloud Console**

Go to: `https://console.cloud.google.com` → APIs & Services → OAuth consent screen

Fill in:
| Field | Value |
|-------|-------|
| App name | Fluffy Fiesta |
| Homepage URL | `https://jasminelim327.github.io/fluffy-fiesta` |
| Privacy Policy URL | `https://jasminelim327.github.io/fluffy-fiesta/privacy.html` |
| Terms of Service URL | `https://jasminelim327.github.io/fluffy-fiesta/terms.html` |
| Authorised domain | `jasminelim327.github.io` |
