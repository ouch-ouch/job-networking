# coffeechat (networkMAX)

A Chrome side panel that turns a job posting into coffee chats. Find people on **X** (Grok research), LinkedIn, or the web; write your message **once** as a template and let the AI fill in the `{{keywords}}` for each person (the hook comes from something real, like their X post); build a **question bank** for the chat; and review every message before it goes anywhere.

This is the merged app: Julia's UI and coffee-chat engine, Maryam's Grok/X research backend, Sushant's X wiring, and Rachel's setup and specs. See [what came from where](docs/rachel-tasks.md#merged-app-integration-branch).

## Run it

Requires Node.js 20.12+, npm, and Google Chrome 116+ for extension features.

```bash
npm install            # one install for the app and the backend (npm workspace)
cp .env.example .env   # one .env for everything; see the comments inside
npm run server         # backend on http://127.0.0.1:8787 (leave it running)
npm run dev            # app on http://127.0.0.1:5173
```

Open **http://127.0.0.1:5173**. It starts in demo mode with fictional people and simulated sends, so you need no keys. **Find people → Find people on X** works in demo mode too (fictional, labeled people).

| What you want to test | What you need |
| --- | --- |
| UI, templates, question bank, approval flow, X flow with fictional people | Nothing beyond the commands above |
| Real X research (Grok X Search) | `XAI_API_KEY` and `PROVIDER_MODE=live` in `.env`, a running backend, demo mode off |
| Real template filling, questions, prep briefs, job parsing | `XAI_API_KEY` in `.env`, a running backend, demo mode off |
| Gmail, Calendar, LinkedIn import/fill | The built extension loaded in Chrome (below), plus Google setup in [docs/SETUP.md](docs/SETUP.md) |

Without an xAI key, set `PROVIDER_MODE=fixture` so the backend still starts; X research then returns labeled fixture people.

### One backend

`npm run server` starts one Hono server (`backend/`) with two route groups:

- `/v1/*`: X research and person-specific drafts (Maryam). Needs `BACKEND_TOKEN`; the build bakes the same value into the extension.
- `/ai/*` and `/health`: template filling, question suggestions, prep briefs, job parsing, reply handling (Julia). Origin-checked; localhost and the extension only.

### Load the extension (needed for Google)

```bash
npm run build
```

In Chrome: `chrome://extensions` → **Developer mode** on → **Load unpacked** → choose this repo's **`dist`** folder. The extension ID is always **`baeippkikgolnalkpiabdfhidjpploaa`** (a pinned public key in `scripts/build-extension.mjs`), which is the ID our Google OAuth client is registered for. So teammates don't need their own OAuth clients; the Google Cloud owner only has to add each person's Google account as a **test user**.

After pulling changes: `npm install`, `npm run build`, then **Reload ↻** the extension and refresh any open job or LinkedIn tabs.

### Before calling a live test successful

Run `npm test` and `npm run build`. Mocked tests never send real outreach. For live sends, use inboxes and accounts you control; see [docs/SETUP.md](docs/SETUP.md#4-verify-real-actions-in-order).

## Run the demo

Requires Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The app starts in a persistent demo workspace with clearly fictional people and simulated sends. No credentials are needed. Demo data and live data are saved separately; switching modes restores the appropriate workspace.

### A two-minute walkthrough

1. In **My network**, open the seeded Stripe target and see NYU alumni ranked first. Add your own target by pasting a job description (use `Company:` and `Role:` lines for the deterministic demo parser). Choose **Find people → Create smart searches** to see editable web-search ideas grounded in the job and your saved profile; demo mode uses deterministic examples and live mode asks Grok.
2. Open **Approval queue**. Edit a draft, save it, approve it, then click **Simulate send**. Approving alone sends nothing. Editing the message or changing its recipient invalidates its approval.
3. In **Activity**, click **Advance demo clock**. Follow-ups appear in the queue, with a maximum of two per person. Nothing is automatically sent. In the installed extension, Chrome alarms run this automatically; a browser preview uses the explicit clock button.
4. Open a contact and click **Receive demo reply**. Follow-ups stop and a scheduling reply is queued. Choose an agreed time to create a demo meeting, which includes a prep brief.
5. In **Question bank**, add or skip suggestions, edit a question, or write one yourself. Only approved questions enter a prep brief. Open a contact’s **Prep & notes** tab to build one on demand.
6. Save conversation notes to queue a thank-you, with an optional referral paragraph. Every send still needs review and approval.

**Settings → Reset demo workspace** restores the initial demo. No real email or calendar invitation is sent in demo mode.

## Load the Chrome extension (details)

```bash
npm run build
```

1. Open `chrome://extensions` in Chrome 116+ and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository’s `dist/` folder.
3. Pin Coffee Chat Copilot and click its toolbar icon to open the side panel.
4. Rebuild and reload the extension after changing source code or OAuth settings.

The output includes a Manifest V3 service worker, side panel, bundled fonts, and content scripts. The build uses Vite for the panel and esbuild for the service worker/content scripts; it does not require a Chrome development plugin. Chrome storage is the installed extension’s source of truth. The browser preview uses local storage.

## Connect live AI, Gmail, and Calendar

Follow **[docs/SETUP.md](docs/SETUP.md)** for the complete setup, test-account checks, and troubleshooting.

- Copy `.env.example` to `.env` and configure `XAI_API_KEY` locally using an API key from [xAI Console](https://console.x.ai/team/default/api-keys). The backend alone reads this secret; it never enters the extension bundle.
- Run `npm run server` in another terminal. Check **http://127.0.0.1:8787/health** or **Settings → Test connection**.
- Enable Gmail API and Google Calendar API in a Google Cloud project, configure an OAuth testing app and test users, then create a **Chrome Extension** OAuth client matching your unpacked extension ID.
- Add the public `GOOGLE_CLIENT_ID` to `.env`, rebuild, reload the extension, switch to live mode, and click **Connect Google**.

Live Google access requires the loaded Chrome extension. A normal browser preview supports the UI and live AI, but cannot authorize Gmail or Calendar. No credentials are included in this repository. Real sends, live LinkedIn scraping/filling, and Google consent must be verified with your own test accounts.

AI now uses **Grok (xAI)** through the xAI Responses API with structured JSON Schema output. Both draft generation and reply classification default to `grok-4.7`; `XAI_DRAFT_MODEL` and `XAI_CLASSIFY_MODEL` can select supported models available to your API account. The original [product spec](docs/SPEC.md) retains its historical Claude architecture; the implementation and setup guide reflect this provider change. See [xAI models](https://docs.x.ai/developers/models) and [structured outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs).

## What is implemented

- **Find people on X:** Grok X Search finds up to three people tied to the job, each with the real post that makes them relevant. X drafts are filled from your template (the hook can reference their post); you copy, open X, send it yourself, and mark it sent.
- Profile, one message template, job description parsing, manual contacts, target filtering, contact search and warm-path ranking.
- Grok search plans use the full job description, role, team, company and saved profile to propose 3–6 searches for alumni, similar backgrounds, relevant teams and recruiting contacts. Each query is editable and opens in Google or Bing. These are search hypotheses to review, not verified people or connections. A manual LinkedIn search starts with the company only, with optional role or school presets.
- Active-tab LinkedIn people search import (up to 20 visible results, including whole-card result layouts), explicit-domain email pattern guesses, confirmed-email correction, and job text capture from supported job sites. People found elsewhere on the web can be added manually.
- Nine AI backend endpoints using Grok (xAI) structured JSON Schema output, input/output validation, preserved literal template wording, and a hard 300-character LinkedIn note limit.
- Editable approval queue with separate approval/send steps, skipped/sent views, approval revocation on edits, and explicit delivery recovery for interrupted sends.
- Gmail OAuth, Unicode MIME sending, thread-based reply polling/classification, scheduling replies, Calendar invitations and Meet provisioning.
- Service-worker alarms, duplicate follow-up prevention, a two-follow-up maximum, opt-out cancellation, and a final reply check before sending a follow-up.
- Editable question suggestions/bank, approved-bank prep briefs, Calendar description updates, post-chat notes, and thank-you/referral drafts.
- Per-contact messages and history, activity timeline, scheduled meetings, and persistent isolated demo/live workspaces.
- Daily limits of 30 email attempts and 20 imported profiles. Guesses below 80% confidence are blocked until the address is confirmed. Email guesses are explicitly unverified, not deliverability checks.

## Demo boundaries

The two-hour target is a hackathon demo, not a production release. There is no Hunter verification, LinkedIn reply scraping, analytics, server hosting, or drag-and-drop pipeline board; contact stages are visible in the list and filters. Company context comes from the job description, not live company news. LinkedIn page selectors are inherently brittle and need validation on the current logged-in layout. A manual contact form and copyable draft text provide the fallback.

LinkedIn reading happens only on a page you open. Filling requires an already open matching profile and composer. The extension never clicks LinkedIn’s Send button; you send and then mark it sent. LinkedIn policies may prohibit scraping/automation; use a test account for a controlled demo.

Google may apply OAuth test-user, Workspace, and verification restrictions. Meet links depend on account policy. Gmail and Calendar are real external actions in live mode, and credentials, billing, consent, and real-account integration tests remain necessary before presenting a live send as verified.

## Development checks

```bash
npm run typecheck
npm test
npm run build
```

Tests cover approval and recipient changes, mode isolation, follow-up and reply state transitions, email confidence/rate limits, content-script boundaries, template contracts, MIME, Calendar validation, and backend HTTP contracts with mocked provider calls. Tests never send real outreach. HTTP tests bind temporary localhost ports.

## Structure

```text
extension/src/
  sidepanel/       React app and responsive styles
  shared/          types, persistence, state engine, demo fixtures, AI client
  background/      Chrome action router and alarms
  content/         LinkedIn/job-page reading and manual composer filling
  google/          Chrome OAuth, Gmail, Calendar
backend/src/       One Hono server: X research (/v1), coffee-chat AI routes (coffee/, /ai)
backend/test/      Backend tests (vitest)
tests/             Engine, sourcing, and integration tests
scripts/           Manifest generation and extension bundling
docs/             Specs (SPEC, X-NETWORKING-SPEC, GROK-BACKEND-SPEC), TEAM-PLAN, SETUP
snowflake/        Snowflake setup (storage only; Cortex AI is blocked on the trial)
```

## Personal X/Grok direction

See [Sushant’s X networking spec](docs/X-NETWORKING-SPEC.md): open a job portal, recognize the posting, use Grok research to find relevant people on X, and compose person-specific interactions. **Open question for the team:** that spec says "no fixed templates", but this merged app keeps the user-written template with AI-filled keywords (plus the question bank) as the app's key differentiators, grounding the hook in the person's real X post. The [hackathon spec](docs/SPEC.md) describes the template approach.

[Tsenta research](docs/TSENTA-RESEARCH.md) records the reference frontend findings.

[Four-person feature split and build plan](docs/TEAM-PLAN.md): Julia, Sushant, Rachel, and Maryam.
