# Coffee Chat Copilot

A Chrome side panel that helps you turn a job opportunity into a thoughtful coffee chat. Write your outreach template once, find people with a warm connection, and review every message before sending.

## Teammates: test the `julia` branch

This branch combines the Coffee Chat interface and Chrome extension with the team's Grok/X research backend. Run all commands below from the **repository root**; the backend is an npm workspace.

Requires **Node.js 20+**, npm, and **Google Chrome 116+** for extension features.

```bash
git clone --branch julia --single-branch https://github.com/ouch-ouch/job-networking.git
cd job-networking
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The demo works immediately with fictional contacts and simulated sends; no keys or Google configuration are needed. Use the walkthrough below to test the complete demo flow.

If you already have the repository, save your current changes, run `git fetch origin`, and switch to `julia` before running `npm ci`.

| What you want to test | Setup needed |
| --- | --- |
| UI, approval flow, simulated outreach, meetings, and follow-ups | Demo commands above |
| Real Grok job parsing, personalized drafts, and smart web-search queries | Local `.env` with `XAI_API_KEY`, a running backend, and Demo mode off |
| Live LinkedIn result imports and composer filling | Built extension loaded in Chrome and an open, signed-in LinkedIn tab |
| Real Gmail sends/replies and Calendar invitations | Built extension, matching Google OAuth client, enabled APIs, test-user access, and Google consent |

### Enable live AI and the extension

1. On a fresh clone, copy `.env.example` to `.env`. Set your own `XAI_API_KEY` and a local `BACKEND_TOKEN` of at least 16 characters; the backend and extension build must use the same token. Keep the supplied model defaults unless your API account requires another supported model. Each developer runs their own backend. Share team credentials only through your team's approved secret-sharing channel, never through Git.
2. In one terminal, run `npm run server` and leave it running. In the app, use backend URL `http://127.0.0.1:8787`. **Settings → Test connection** checks reachability and key presence; a successful live AI task checks actual provider access.
3. Run `npm run build`. In Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose this clone's **`dist`** folder.
4. Click Chrome's puzzle-piece menu, pin **Coffee Chat Copilot**, and click its icon to open the side panel. In **Settings**, turn **Demo mode off** and save your own name, school, major, background, availability, and signature. Also review your message template.
5. For Gmail/Calendar, follow **[docs/SETUP.md](docs/SETUP.md)**. Each developer needs an OAuth client matching their extension ID, or a deliberately coordinated stable public extension key/client. The Google Cloud project owner must add each connecting Google account as a test user. Julia's local OAuth connection and API key are not included in this repository.
6. Add a target job with its full description. Choose **Find people → Create smart searches**. Grok combines the job, team, company, and saved profile into editable Google/Bing queries. Review the resulting profiles. Add people found on the web manually, or use **Import LinkedIn results** on an open LinkedIn people-results tab.

App records are stored locally in each browser/extension installation. The browser preview and extension also have separate storage. Teammates can test the same code independently; contacts, drafts, Google connections, and approvals do **not** sync across computers. There is no shared database or hosted backend in this branch.

### Pull updates and load the latest build

```bash
git pull --ff-only
npm ci
npm run build
```

Restart `npm run server` after backend or `.env` changes. At `chrome://extensions`, click **Reload ↻** on Coffee Chat Copilot. Refresh any already-open LinkedIn/job tabs, then close and reopen the side panel. Refreshing a normal webpage alone does not reload the extension.

The current people-search screen says **“Find a shared path”** and has a **“Create smart searches”** button. **“Find a warm way in”** identifies an older loaded build. If needed, use **Load unpacked** again and check that you selected this clone's `dist` directory.

### If LinkedIn import appears unresponsive

In live mode, open a **LinkedIn people-results page** (`linkedin.com/search/results/people/`) in the active Chrome tab, then use the extension side panel. Google/Bing search pages and individual profiles are not import sources; add those people manually. The import footer shows whether the active tab is ready and disables Import when the source is unsupported. The normal browser preview cannot import live pages.

While reading, the button says **Importing…**. Errors and duplicate-only results remain beside the button. If everyone on the page was already added to this target, the app explains that instead of silently importing zero people. A missing or stale reader is refreshed once automatically; an unavailable reader times out with a visible error. Reload the extension after pulling/rebuilding the code. The daily limit is 20 newly imported profiles; manual contacts remain available.

### Before reporting a live test as successful

Run `npm test` and `npm run build`. Live job parsing and search planning have been exercised with Grok; the automated suite uses mocks for Gmail/Calendar and never sends real outreach. For an end-to-end test, use a separate inbox you control, confirm its address in the contact form, generate/review/approve/send one message, reply from that inbox, and check reply detection. Create a test Calendar event only when you intend to send its attendee invitation. See the detailed verification steps in [docs/SETUP.md](docs/SETUP.md#4-verify-real-actions-in-order).

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

## Load the Chrome extension

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
backend/src/       Local Express API, validated AI contracts and prompts
tests/             Engine, sourcing, and integration tests
scripts/           Manifest generation and extension bundling
docs/SPEC.md       Original product specification
```

## Personal X/Grok direction

See [Sushant’s X networking spec](docs/X-NETWORKING-SPEC.md): open a job portal, recognize the posting, use Grok research to find relevant people on X, and compose person-specific interactions without fixed templates. The existing [hackathon spec](docs/SPEC.md) remains available as a separate proposal.

[Tsenta research](docs/TSENTA-RESEARCH.md) records the reference frontend findings.

[Four-person feature split and build plan](docs/TEAM-PLAN.md): Julia, Sushant, Rachel, and Maryam.
