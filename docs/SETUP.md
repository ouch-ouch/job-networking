# Connect live Grok (xAI), Gmail, and Calendar

The app opens in demo mode with fictional contacts and simulated actions. Live Google access runs in the installed Chrome extension. Live AI runs through the local backend, which alone holds the xAI API key. A regular browser preview cannot use `chrome.identity`.

## Teammate setup and local data

Each teammate needs Node.js 20+, their own checkout, and a local dependency install. From the repository root, run `npm ci` using the committed lockfile. For a credentials-free first look, run `npm run dev` and open `http://127.0.0.1:5173` in demo mode. This verifies the UI and simulated workflow; it does not verify a real AI request, Google authorization, email delivery, or Calendar invitation.

For live work, each developer creates their own local `.env`, configures their own xAI API key, and runs `npm run server` on their own computer. Keep keys, `.env`, access tokens, private signing keys, and personal workspace exports out of Git and chat. Public OAuth client IDs and public extension keys can be coordinated with teammates without sharing an API secret.

Profiles, targets, contacts, drafts, questions, and activity are saved locally in the current Chrome profile's extension storage. The browser preview uses that browser origin's local storage and has separate data from the installed extension. Demo and live workspaces are also separate. There is no shared remote database or automatic teammate synchronization: using the same repository, Google Cloud project, or OAuth client does not share app records. Each person connects their own Google account and operates on that account's Gmail and Calendar.

## 1. Configure Grok (xAI) locally

The integrated backend also requires `BACKEND_TOKEN` (a random local secret of at least 16 characters). Set it in root `.env` before starting the server or building the extension; both use the same value. Set `ALLOWED_ORIGINS` to your actual `chrome-extension://<extension-id>` and `http://127.0.0.1:5173`, separated by a comma, for X research. These settings do not change the LinkedIn page reader.

1. Open [xAI Console → API Keys](https://console.x.ai/team/default/api-keys) and create an API key for this project under the intended team. Ensure that team has API credits/billing and access to `grok-4.7`. Use an inference API key; this app does not need a Management API key. See the [official xAI quickstart](https://docs.x.ai/developers/quickstart) for account and key setup.
2. In the repository root, copy `.env.example` to `.env` if `.env` does not already exist. Open `.env` in your editor and put the key after `XAI_API_KEY=`. Do not paste it into chat, put it in a `VITE_` variable, or add it to the extension settings. `.env` is ignored by Git.
3. After `npm ci`, run `npm run server`. Keep that terminal running. It listens only at `http://127.0.0.1:8787` on your computer; every teammate starts their own server.
4. Open [the local health endpoint](http://127.0.0.1:8787/health). `configured: true` means the environment contains a key; the first live job parse verifies the key, billing, and model access. Health does not expose the key.

Both drafts and reply classification default to `grok-4.7`. Override `XAI_DRAFT_MODEL` and `XAI_CLASSIFY_MODEL` only with model IDs supported by the xAI Responses API and available to your API account. The app calls `POST https://api.x.ai/v1/responses` with structured JSON Schema output, followed by local validation. After editing environment variables, restart the backend.

## 2. Create the Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project for Coffee Chat Copilot. Teammates can share a Cloud project, or use individual projects. For a shared project, ask its administrator to complete the following configuration and create the needed OAuth clients if you do not have permission.
2. In **APIs & Services → Library**, enable **Gmail API** and **Google Calendar API** for that same project.
3. Open **Google Auth Platform**. Complete **Branding** with an app name and your support/developer email. In **Audience**, use **External → Testing** for a personal demo. The Cloud project administrator must add **each teammate's exact Google account** that will connect as a **test user**; repository access alone does not grant OAuth access. An eligible organization can instead choose Internal. Keep the app in Testing for your own demo.
4. In **Data Access**, add exactly these scopes:
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/calendar.events`

Gmail read access is a restricted scope. Public distribution has additional Google verification requirements; a configured test user can exercise the testing app. Google Workspace administrators may block scopes or unverified testing apps. OAuth grants for an external app in Testing generally expire after seven days with these scopes; reconnect when needed.

## 3. Match the Chrome extension and OAuth client

1. Run `npm run build`. This creates the local `dist` folder; generated builds are not committed. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose that folder.
2. Copy the extension's displayed ID. Without a pinned public key, teammates loading different checkout paths may have different IDs. Keep your unpacked directory at the same absolute path so its ID stays stable during this demo.
3. In **Google Auth Platform → Clients**, create a client of type **Chrome Extension**, or ask the shared Cloud project administrator to create it. Enter **your currently displayed extension ID** in **Item ID**. Each developer with a different extension ID needs a matching client; do not reuse a teammate's client ID with an unmatched extension ID. Do not create a web client, desktop client, service account, or client secret for this flow.
4. Copy the resulting public client ID (ending in `.apps.googleusercontent.com`) into `GOOGLE_CLIENT_ID=` in root `.env`.
5. Run `npm run build` again, then click **Reload** for this extension at `chrome://extensions`. **Refresh already-open LinkedIn and job tabs** so they load the current content scripts. Open the side panel, go to Settings, set backend URL to `http://127.0.0.1:8787`, and **turn demo mode off**. Then choose **Connect Google**. Choose your own test-user account and allow all three requested permissions. Chrome itself should have a signed-in Google profile; merely signing into Gmail in a tab may not be sufficient for Chrome Identity.
6. Live mode opens an independent workspace and intentionally clears the seeded demo identity. In **Settings**, enter and **save your own personal profile**, including your name, before creating or sending outreach; a blank name blocks sending. Then add real contacts for controlled tests. Keep your Google account, OAuth client, and enabled APIs in the same intended configuration. Fictional contacts stay in the demo workspace and are blocked from live sends.

The client ID is public and compiled into `dist/manifest.json`. No Google secret or Google access token is placed in `.env`. Tokens stay in Chrome Identity's cache and are used directly against Google APIs.

New team builds use a pinned public extension key by default. If you already connected Google using an earlier build with **no** manifest key, set `PRESERVE_UNPACKED_ID=true` in your local `.env` before rebuilding and keep the same `dist` path. This keeps that installation's existing extension ID and local records. Leave it false for a new team installation. Always match the OAuth client to the ID Chrome actually displays.

As an alternative to separate clients, the team can agree on one **public** extension key and put that same value in each developer's local `EXTENSION_PUBLIC_KEY=`. Rebuild and reload each extension, verify that the displayed IDs match, then register that resulting ID in one Chrome Extension OAuth client. Developers can use that client's public `GOOGLE_CLIENT_ID` while each authorizes their own Google account; the project administrator still needs to allow every account as a test user. Chrome's [official OAuth guide](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth) explains obtaining and using the public `key`. Never share a private signing key or use one in the manifest. If you change the public key or extension ID, create/update the Google Chrome Extension client to match and rebuild.

Optionally set `ALLOWED_EXTENSION_IDS=` to the exact extension ID, then restart the backend to restrict extension callers. Localhost browser previews are also allowed by the development CORS policy.

After pulling teammate changes, run `npm ci` when dependencies or the lockfile change, then `npm run build`, reload the extension, and refresh LinkedIn/job tabs. Restart `npm run server` after backend code or `.env` changes. Rebuilding alone does not update an already loaded extension or its existing content scripts.

## 4. Verify real actions in order

1. Parse a real job description with demo mode off. A successful result verifies the backend and xAI account. A key/billing/model failure is shown as an error; the app does not silently substitute demo AI.
2. Add a manual contact using a second mailbox you control, with a real address. Because you independently know that mailbox is correct, select **“I’ve confirmed this is their email address”** when saving the contact. A manually entered address otherwise defaults to 50% confidence, below the 80% sending threshold. Only confirm addresses you have actually verified. Review a draft, approve it, and explicitly click Send. Inspect both your Sent folder and that mailbox before testing another send. Every email includes a simple opt-out line.
3. Reply from the other mailbox, then poll replies. Only inbound messages are returned; your own sent messages and aliases present in the thread are excluded. A response stops automated follow-up drafting.
4. Choose a confirmed date and time with a time zone in the app and explicitly create a meeting. This creates a real Calendar event and emails an invitation to the attendee. Check the event and Meet link in Calendar. Meet provisioning can remain pending or be unavailable under an account's Calendar policy; never claim a link exists unless Google returned one.
5. Approve a few bank questions and generate a prep brief. Only approved questions are picked; any new suggestions remain separate. Calendar prep descriptions are updated without sending another invite notification.

Each teammate should complete these checks with their own configured accounts. A passing build, mocked test suite, healthy backend, or another teammate's successful send does not establish that your own live authorization and delivery work.

If a send/create request loses its connection after submission, check Gmail Sent or Google Calendar before retrying: the remote action may have succeeded even if the response was lost.

## Common fixes

| Error                                | Check                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| OAuth client not configured          | Add `GOOGLE_CLIENT_ID` to root `.env`, rebuild, reload the unpacked extension.                               |
| `bad client id` / OAuth flow failure | Client type must be Chrome Extension and Item ID must match the ID currently shown in `chrome://extensions`. |
| Access blocked / test-user error     | Add that account to Audience → Test users, and check Workspace admin restrictions.                           |
| Gmail or Calendar `403`              | Enable both APIs in the client project's console and grant all three scopes.                                 |
| Permissions partially granted        | Reconnect Google and allow all three permission checkboxes.                                                  |
| Google authorization expired         | Connect Google again; testing grants may expire.                                                             |
| Backend offline                      | Run `npm run server`, confirm `/health`, and check the exact backend URL.                                    |
| xAI API key not configured           | Add `XAI_API_KEY` to root `.env`, then restart `npm run server`.                                             |
| Grok model unavailable              | Use a supported model ID the xAI API account can access and restart the backend after editing `.env`.        |

References: [Chrome Identity](https://developer.chrome.com/docs/extensions/reference/api/identity), [Google testing OAuth apps](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance), [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending), [Gmail threading](https://developers.google.com/workspace/gmail/api/guides/threads), [Calendar events and Meet](https://developers.google.com/workspace/calendar/api/guides/create-events), [xAI models](https://docs.x.ai/developers/models), [Grok 4.7 guide](https://docs.x.ai/developers/grok-4-7), [structured outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs).
