# Tsenta networking inspection

Inspected 2026-10-24. This records evidence for the networkMAX specification, not a claim of full behavioral parity.

## Access and method

- Native browser control worked on retry. Chrome redirected the networking URL to `/login?returnTo=%2Fdashboard%2Fnetworking`.
- An existing Brave tab stayed at `/dashboard/networking`, but accessibility exposed browser chrome only and screenshot capture returned a blank image. Its authentication state and rendered contents could not be confirmed.
- Claude Code is installed at `/opt/homebrew/bin/claude`. A read-only inspection request using its Chrome integration exited with `Not logged in · Please run /login`. No Claude findings were obtained.
- Public HTML and JavaScript assets were fetched without authentication. Static inspection identified the route module, recommendation panel, agent action helpers, and client API definitions. No private endpoints were called and no outreach was sent.

## Public assets inspected

| Asset | Evidence |
| --- | --- |
| [Dashboard HTML](https://dashboard.tsenta.com/dashboard/networking) | Client-rendered application shell; entry script reference |
| [Entry bundle](https://dashboard.tsenta.com/assets/index-CzbEZ4ae.js) | Networking route mapping, API query/mutation definitions |
| [Networking route](https://dashboard.tsenta.com/assets/page-CNag2L9s.js) | Company search, applied-company rail, usage indicator |
| [Recommendation panel](https://dashboard.tsenta.com/assets/recommendation_panel-8THdDWj1.js) | Company/contact presentation, drafting channels, discovery states, news |
| [Networking actions](https://dashboard.tsenta.com/assets/networking_actions-Bdx5adWd.js) | Agent request for a three-contact outreach bundle |

Asset names are deployment-specific. These links document the inspected deployment, not stable integration interfaces.

## Findings from frontend code

| Area | Implemented frontend behavior | Confidence/limit |
| --- | --- | --- |
| Starting point | Company-centered workspace with an applied-company rail, sorted by application recency; company name, logo, role context, contact count | Static code observed; account data not loaded |
| Search | Company-name combobox, grouped applied and other-company suggestions, raw-name lookup fallback, keyboard selection | Static code observed; suggestion quality not tested |
| Resolution | Resolves a company name/domain, retrieves company contacts and enriched company information | Client calls observed; backend implementation unknown |
| Discovery | Agent request seeks three hiring contacts or warm introductions, with channel-specific drafts; another request excludes people already shown | Request intent observed; exactly three usable results is not guaranteed |
| Contact grouping | Warm introductions, hiring team, and recruiters presented separately | Grouping observed; relationship-verification method unknown |
| Company context | Website, LinkedIn, role/application links, headquarters/location, employee count, industry tags where present | Fields observed; data quality unknown |
| News | Company news panel with article links, publisher/date, titles, optional descriptions/images | Static code observed; live feed not tested |
| Contact detail | Name/title, connection reason, email-verification status, available LinkedIn/email channels | Fields observed; verification provider unknown |
| Drafting | Editable email subject/body and LinkedIn note; drafts can be requested from the networking agent; copy actions | Static code observed; generation quality unknown |
| LinkedIn note | Frontend uses a 199-character note limit and opens LinkedIn/copies the note | Product implementation detail; do not treat as universal LinkedIn limit |
| Usage | Remaining and total daily lookups come from usage data; UI handles exhausted quota | No fixed account quota verified |
| Resilience | Loading/error/empty states; discovery-in-progress checks; retry and rebuild paths preserve existing contacts on failed research | Static code observed; runtime reliability untested |
| Outreach history | Client defines history retrieval and a contact-send mutation; successful sent status triggers history refresh | Does not prove a send button is enabled on this screen or that delivery works |

Client-side API routes found include application/contact retrieval, company search/resolve/contacts/discover/news, usage, outreach history, and contact send. These describe Tsenta's own client contract; networkMAX must implement its own backend and must not depend on these private service routes.

## What this changes for networkMAX

The reference's clearest reusable pattern is **choose company → build a small people shortlist → explain relevance → provide context and a channel-specific draft**.

For X, implement:

1. A target-company workspace independent of an application tracker. Allow optional role/job URL and manually recorded application context.
2. A company lookup with domain disambiguation, plus a three-person initial shortlist across relevant practitioners, hiring contacts, and evidenced shared professional connections.
3. Each person gets public X sources, why they fit the user's confirmed background, a recent relevant post, and an appropriate next step.
4. Replace email verification with evidence status for X identity, company affiliation, recent activity, and conversation context. A visible account or open DM setting does not mean the person welcomes unsolicited outreach.
5. Replace LinkedIn/email composition with public-reply, DM, and coffee-chat drafts, copied and sent manually in X.
6. Offer another bounded shortlist that excludes existing recommendations, saved people, and do-not-contact records.
7. Add the user's requested coffee-chat, follow-up, relationship, and career-outcome workflow. These are networkMAX requirements; they were not established by this reference inspection.

## Still unverified

Rendered layout and visual fidelity; actual search/discovery results; backend ranking and enrichment vendors; resume influence on contact selection or drafting; exact quota; delivery behavior; saved-contact lifecycle; follow-up automation; coffee-chat scheduling; X/Grok integration; measured job outcomes.

The inspected modules do not establish those capabilities. Absence from the inspected modules is not proof they are absent from the entire product.
