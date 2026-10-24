# Rachel's tasks (Role A): what's done and what's left

Role A in SPEC §9 covers the side panel UI, the demo, `mock.ts`, `job-page.ts`, Snowflake setup, and Google Cloud OAuth setup.

## What I made

| File | What it is |
|---|---|
| `extension/src/sidepanel/` | The full side panel React app (Vite + React 18 + Tailwind v4), running on mock data |
| `extension/src/sidepanel/data/store.tsx` | The **only** data layer. Every screen calls `useApp()`. Each action is named after a router action in §9 (`PARSE_JOB`, `SCRAPE_SEARCH`, `APPROVE_DRAFT`, ...) and is mocked for now |
| `extension/src/shared/mock.ts` | Mock data anyone can reuse: `createMockState()` returns a full `AppState` |
| `extension/src/shared/types.ts` | A copy of §5 so the UI could start before D's scaffold. **D owns this file**, see below |
| `extension/src/content/job-page.ts` | Content script that grabs the job description from LinkedIn, Greenhouse, or Lever, falling back to `document.body.innerText` |
| `extension/package.json`, `vite.config.ts`, `tsconfig.json` | A minimal build so the panel runs in a normal tab. D adds `@crxjs` on top |
| `snowflake/setup.sql` | The whole §6b checklist in one script: cross-region inference, role, warehouse, `COFFEE_CHAT` database, 8 tables, a service user, the PAT, and smoke tests |
| Extension key | Pinned extension ID **`baeippkikgolnalkpiabdfhidjpploaa`**. The private key is at `C:\Users\rache\Downloads\coffee-chat-copilot-extension-key.pem`. It's not in the repo, and `*.pem` is now gitignored. The public key is below for D |

### Screens (all of §9 "A")
- **Targets:** "Network for this job" (grab the open page) or paste a job description or URL → extracted fields → "Find people on LinkedIn" → contacts ranked by relevance with warm-path badges, reason, connection degree, and email confidence → "Draft N messages" (email or LinkedIn note). Add contacts by hand. Expanding a contact card shows its meeting, prep brief, and notes.
- **Queue (Approval Queue):** edit, approve, skip, and regenerate. Filled keywords are highlighted, and the AI-written `personal_hook` gets its own color. Other things it handles:
  - LinkedIn notes show a 300-character counter and Approve is blocked over the limit.
  - Email addresses below 50% confidence need an "I checked it" tick, or an edit, before they can be approved.
  - The thank-you's referral ask can be switched off.
  - Approved LinkedIn drafts wait with "Open profile" and "Mark sent" buttons.
  - The header shows "N/30 emails today".
- **Questions:** AI suggestion cards with Add / Skip that you can edit first, "Suggest more", writing your own, and the bank grouped by category with ★ landed-well counts and used-N× counts.
- **Prep brief:** shown on a scheduled contact's card. It has Generate / Regenerate and renders the markdown. Any picked question that isn't approved yet shows as "new" with an "Add to bank" button.
- **Post-chat notes:** a "How did it go with X?" banner appears once a meeting ends. Notes plus "which questions landed well" checkboxes → a thank-you + referral ask goes to the queue.
- **Activity:** a timeline where Grok `agent_step` events collapse into one expandable dark "agent trace" card. Reply-sentiment badges (warm / neutral / cold) appear on replies. A Messages view shows per-contact threads. There are "Check replies" and "Run scheduler" buttons.
- **Pipeline:** board with columns Found → Drafted → Sent → Followed up → Replied → Scheduled → Met → Thanked / Cold.
- **Setup:** Google and LinkedIn connection status, profile form, template editor with live `{{placeholder}}` highlighting (red for placeholders the AI won't know) and click-to-insert chips, demo mode toggle, and reset mock data.
- A slim latest-activity bar sits at the bottom of every tab.

### Checked
- `npx tsc --noEmit` is clean and `vite build` succeeds.
- Every tab renders in headless Chrome with the mock data. I took screenshots; no runtime errors.
- **Not yet checked:** clicking through every flow by hand, and running inside the real extension (that needs D's manifest).

## How to run it
```bash
cd extension
npm install
npm run dev        # opens /src/sidepanel/index.html; add #queue, #activity, etc. to jump to a tab
```
Mock state is saved to localStorage. Setup → "Reset mock data" restores it.

## Demo flow that already works on mocks (§12)
1. Questions: Add a few suggestions.
2. Targets → "+ New target" → "Network for this job" → Extract → Find people → Draft messages.
3. Activity: expand the Grok trace.
4. Queue: approve an email (it "sends") and a LinkedIn note (Mark sent).
5. Setup → Demo mode on: about a minute after a send, a follow-up shows up in the queue on its own.
6. Activity → "Check replies": "Sure, Thursday at 3?" comes in tagged warm, with a scheduling reply drafted. Approving it books the meeting and builds the prep brief.
7. On the contact card, ⏩ fast-forward → "How did it go?" → notes → the thank-you lands in the queue.

## Still on you (needs your accounts, so I couldn't click through these)

### 1. Snowflake (hand-off to C due at 0:25)
No install needed: Snowflake runs in the browser, and you only paste and click Run.
1. Ask the organizers whether there's a hackathon Snowflake account. If not, sign up at signup.snowflake.com (Enterprise edition, AWS, a US region) and verify your email. The trial user is ACCOUNTADMIN automatically.
2. Log in → **+ Create** (top left) → **SQL Worksheet**.
3. Open `snowflake/setup.sql` in VS Code → Ctrl+A, Ctrl+C → paste it into the worksheet.
4. Next to the blue ▶ Run button, open the dropdown → **Run All** (Ctrl+Shift+Enter). It takes about a minute.
5. If it stops on a red error, copy the error text and ask Claude. Nothing secret has been made yet at that point.
6. The last result is one row with `token_secret`, shown **once**. Put it straight into Vercel env vars, or send it to C in a password manager. Don't paste it in Slack or commit it.
7. Send C:
   - `SNOWFLAKE_ACCOUNT_URL` (bottom-left account menu → your account → copy the account URL)
   - `SNOWFLAKE_PAT`
   - the names `COFFEE_CHAT_ROLE` / `COFFEE_CHAT_WH` / `COFFEE_CHAT.APP`
- Then open `snowflake/smoke-tests.sql`, run each SELECT on its own (cursor inside it, Ctrl+Enter), and note which work.
- **Known blocker:** trial accounts get "AI function ... is not available for trial accounts" on `AI_COMPLETE`, which is how Grok is called. Ask the organizers for a hackathon Snowflake account (or credits). Tell C right away, because the Grok loop is on the spec's never-cut list.
- If `AI_COMPLETE('grok-4.7', ...)` fails for any other reason, tell C to switch to `claude-sonnet-4-6` (§6b fallback).
- If the script's step 5 (authentication policy) errors, use the commented-out network-policy fallback right below it.

C's first REST smoke test:
```bash
curl -X POST "$SNOWFLAKE_ACCOUNT_URL/api/v2/cortex/v1/chat/completions" \
  -H "Authorization: Bearer $SNOWFLAKE_PAT" -H "Content-Type: application/json" \
  -d '{"model":"grok-4.7","messages":[{"role":"user","content":"say hi"}]}'
```

### 2. Google Cloud OAuth client (hand-off to B due at 0:20)
1. console.cloud.google.com → new project `coffee-chat-copilot`.
2. APIs & Services → Library → enable **Gmail API** and **Google Calendar API**.
3. Google Auth Platform (OAuth consent screen):
   - **External**, then **Testing**.
   - Add **test users**: all 4 teammates plus the demo test inboxes.
   - Scopes: `gmail.send`, `gmail.readonly`, `calendar.events` (only these, per §8).
4. Clients → Create → type **Chrome Extension** → Item ID `baeippkikgolnalkpiabdfhidjpploaa`.
5. Send the client ID (`...apps.googleusercontent.com`) to B and D. It isn't a secret.

### 3. Demo prep (from 2:15)
- Test LinkedIn account and test inboxes (§13 open question). Put a teammate's inbox in `MOCK_TEST_INBOX` in `mock.ts` for live send tests.
- Seed data, backup video at 2:40, pitch.
- When D's `useStore` lands (around 1:15): swap the insides of `data/store.tsx` for live state and `chrome.runtime.sendMessage` calls. No screen code changes.

## Notes for teammates

**D (scaffold):**
- The manifest needs this pinned `key` so the extension ID matches the OAuth client:
  ```
  "key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiE4JbkMiaRP1QJX0zK8oQu9meHXgldTXJUgg/Ht/zakFLivdXVHQW18djAXQxe/9h3fI7zXx5T9hR1ZbYVU2+r8cEFghlwMDxZ2/g4AMQtcBe2IeeLf/39thWsJOkIfHhWidWQce3euosiyBEfe5cCVc3BuaxXJM5wETIjeO883NdUKdpW/k9QNdwtu0W58ehx0BBejnqDvPoRJXvxr1GzksjmPejBTH6MGeH4VlfYJip0bWoaJZE8rxDtzRMfOHgCpgCOkQCH+TVkglHwFrp6ngwfTHWTlg/JnglJGbONNQW7Tue9BcPeUavLQrKfyW5HaIL7SoQlefw0lhzpkaoQIDAQAB"
  ```
  Add `"oauth2": { "client_id": "<from Rachel>", "scopes": ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.events"] }` and the `identity` permission.
- `side_panel.default_path`: `src/sidepanel/index.html`.
- `job-page.ts` content-script matches:
  - `https://www.linkedin.com/jobs/*`
  - `https://boards.greenhouse.io/*`
  - `https://job-boards.greenhouse.io/*`
  - `https://jobs.lever.co/*`
- Proposed additions to the shared contract. They're already in `types.ts` as optional fields, so take them or tell me:
  - `ActivityEvent.sentiment`, for the AI_SENTIMENT badge. §5 has nowhere to store it.
  - `ActivityEvent.runId`, to group a Grok run's steps into one trace.
  - `ActivityEvent.detail`, for tool args and results, and for reply text in the thread view.
  - A `Settings { demoMode }` type. §7 has a demo-mode toggle but §5 has nowhere to keep it.
  - A new router action `GRAB_JOB_PAGE` for `job-page.ts`. It isn't in the §9 list.
  - Agent steps for a whole target use `contactId: ""`. Making `contactId` optional would be cleaner.

**C (backend):** Table columns are snake_case versions of the §5 fields, with 4 renames for Snowflake keywords:
- `start_at` / `end_at` (Meeting `start` / `end`)
- `occurred_at` (ActivityEvent `at`)
- `question_text` (Question `text`)

Ranking needs each contact's headline and experience text, which §5's `Contact` doesn't have. You may want a `profile_text` column.

**Spec mismatches I noticed:**
- §11 marks `src/google/` as (C), but §9 gives it to B.
- §11's layout has `SPEC.md` at the root; ours is in `docs/`. I put `extension/` and `snowflake/` at the repo root, following §11.
