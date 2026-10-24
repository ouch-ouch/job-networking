-- Coffee Chat Copilot: Snowflake setup (SPEC §6b checklist). Owner: A (Rachel).
-- Run top to bottom in a Snowsight SQL worksheet as ACCOUNTADMIN.
-- Safe to re-run: everything is IF NOT EXISTS / OR REPLACE where it matters.
--
-- At the end you hand C (backend) three things:
--   SNOWFLAKE_ACCOUNT_URL  https://<org>-<account>.snowflakecomputing.com   (Snowsight: bottom-left account menu → "Connect a tool")
--   SNOWFLAKE_PAT          the token_secret printed by step 6 (shown ONCE)
--   names: role COFFEE_CHAT_ROLE, warehouse COFFEE_CHAT_WH, database COFFEE_CHAT, schema APP

USE ROLE ACCOUNTADMIN;

-- 1. Cross-region inference (Grok isn't hosted in every region).
ALTER ACCOUNT SET CORTEX_ENABLED_CROSS_REGION = 'ANY_REGION';

-- 2. Role with Cortex access, plus a small auto-suspending warehouse.
CREATE ROLE IF NOT EXISTS COFFEE_CHAT_ROLE;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE COFFEE_CHAT_ROLE;

CREATE WAREHOUSE IF NOT EXISTS COFFEE_CHAT_WH
  WAREHOUSE_SIZE = 'XSMALL' AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE;
GRANT USAGE, OPERATE ON WAREHOUSE COFFEE_CHAT_WH TO ROLE COFFEE_CHAT_ROLE;

-- Let you (whoever runs this) use the role in worksheets too.
SET me = CURRENT_USER();
GRANT ROLE COFFEE_CHAT_ROLE TO USER IDENTIFIER($me);

-- 3. Database + tables. One table per type in SPEC §5, each with user_id.
--    Column names are the snake_case of the TS fields, except where a name is
--    reserved in Snowflake: Meeting.start/end → start_at/end_at,
--    ActivityEvent.at → occurred_at, Question.text → question_text.
CREATE DATABASE IF NOT EXISTS COFFEE_CHAT;
CREATE SCHEMA IF NOT EXISTS COFFEE_CHAT.APP;
GRANT USAGE ON DATABASE COFFEE_CHAT TO ROLE COFFEE_CHAT_ROLE;
GRANT ALL ON SCHEMA COFFEE_CHAT.APP TO ROLE COFFEE_CHAT_ROLE;  -- C can add views / scratch tables

USE SCHEMA COFFEE_CHAT.APP;

CREATE TABLE IF NOT EXISTS profiles (
  user_id       VARCHAR NOT NULL PRIMARY KEY,
  name          VARCHAR,
  school        VARCHAR,
  major         VARCHAR,
  year          VARCHAR,
  background    VARCHAR,
  availability  VARCHAR,
  signature     VARCHAR,
  updated_at    TIMESTAMP_TZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE TABLE IF NOT EXISTS templates (
  id        VARCHAR NOT NULL,
  user_id   VARCHAR NOT NULL,
  name      VARCHAR,
  channel   VARCHAR,          -- email | linkedin_connect | linkedin_message
  subject   VARCHAR,
  body      VARCHAR,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS targets (
  id               VARCHAR NOT NULL,
  user_id          VARCHAR NOT NULL,
  company          VARCHAR,
  role             VARCHAR,
  team             VARCHAR,
  location         VARCHAR,
  skills           ARRAY,
  raw_description  VARCHAR,
  url              VARCHAR,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id                 VARCHAR NOT NULL,
  user_id            VARCHAR NOT NULL,
  target_id          VARCHAR,
  name               VARCHAR,
  title              VARCHAR,
  company            VARCHAR,
  linkedin_url       VARCHAR,
  email              VARCHAR,
  email_confidence   FLOAT,
  connection_degree  NUMBER(1),
  warm_paths         VARIANT,   -- [{type, detail}]
  relevance          NUMBER(3),
  reason             VARCHAR,
  stage              VARCHAR,   -- found | drafted | sent | followed_up | replied | scheduled | met | thanked | cold
  notes              VARCHAR,
  follow_up_count    NUMBER DEFAULT 0,
  next_action_at     NUMBER,    -- epoch ms, same as the extension
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS drafts (
  id               VARCHAR NOT NULL,
  user_id          VARCHAR NOT NULL,
  contact_id       VARCHAR,
  kind             VARCHAR,     -- initial | follow_up | schedule_reply | confirmation | thank_you
  channel          VARCHAR,
  subject          VARCHAR,
  body             VARCHAR,
  filled_keywords  VARIANT,     -- {placeholder: value}
  status           VARCHAR,     -- pending | approved | rejected | sent | failed
  created_at       NUMBER,      -- epoch ms
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS activity (
  id           VARCHAR NOT NULL,
  user_id      VARCHAR NOT NULL,
  contact_id   VARCHAR,
  occurred_at  NUMBER,          -- ActivityEvent.at, epoch ms
  type         VARCHAR,         -- draft_created | approved | sent | reply_received | follow_up_due | meeting_scheduled | agent_step | error
  summary      VARCHAR,
  thread_id    VARCHAR,
  sentiment    VARCHAR,         -- proposed field: warm | neutral | cold (AI_SENTIMENT)
  run_id       VARCHAR,         -- proposed field: groups agent_step rows from one /agent/run
  detail       VARCHAR,         -- proposed field: tool args/result or reply text
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS meetings (
  id                 VARCHAR NOT NULL,
  user_id            VARCHAR NOT NULL,
  contact_id         VARCHAR,
  start_at           TIMESTAMP_TZ,  -- Meeting.start (ISO string)
  end_at             TIMESTAMP_TZ,  -- Meeting.end
  calendar_event_id  VARCHAR,
  meet_link          VARCHAR,
  prep_brief         VARCHAR,       -- markdown
  question_ids       ARRAY,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS questions (
  id             VARCHAR NOT NULL,
  user_id        VARCHAR NOT NULL,
  question_text  VARCHAR,           -- Question.text
  category       VARCHAR,           -- role | team | career_path | culture | recruiting | advice
  source         VARCHAR,           -- ai_suggested | user_written
  status         VARCHAR,           -- suggested | approved | skipped  (only approved may be picked)
  times_used     NUMBER DEFAULT 0,
  landed_well    NUMBER DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA COFFEE_CHAT.APP TO ROLE COFFEE_CHAT_ROLE;
GRANT SELECT, INSERT, UPDATE, DELETE ON FUTURE TABLES IN SCHEMA COFFEE_CHAT.APP TO ROLE COFFEE_CHAT_ROLE;

-- 4. A service user for the backend, so the PAT isn't tied to anyone's login.
CREATE USER IF NOT EXISTS COFFEE_CHAT_SVC
  TYPE = SERVICE
  DEFAULT_ROLE = COFFEE_CHAT_ROLE
  DEFAULT_WAREHOUSE = COFFEE_CHAT_WH
  DEFAULT_NAMESPACE = COFFEE_CHAT.APP
  COMMENT = 'Coffee Chat Copilot backend (Vercel). Hackathon only.';
GRANT ROLE COFFEE_CHAT_ROLE TO USER COFFEE_CHAT_SVC;

-- 5. PATs normally require a network policy. Vercel's outbound IPs aren't fixed,
--    so for the hackathon we let the PAT work without one.
--    If this errors on your account, use the fallback below instead.
CREATE AUTHENTICATION POLICY IF NOT EXISTS COFFEE_CHAT.APP.PAT_ANY_NETWORK
  PAT_POLICY = (NETWORK_POLICY_EVALUATION = ENFORCED_NOT_REQUIRED);
ALTER USER COFFEE_CHAT_SVC SET AUTHENTICATION POLICY COFFEE_CHAT.APP.PAT_ANY_NETWORK;

-- Fallback (only if step 5 fails): an allow-all network policy on the service user.
-- CREATE NETWORK POLICY IF NOT EXISTS COFFEE_CHAT_ALLOW_ALL ALLOWED_IP_LIST = ('0.0.0.0/0');
-- ALTER USER COFFEE_CHAT_SVC SET NETWORK_POLICY = COFFEE_CHAT_ALLOW_ALL;

-- 6. The token. The result row's token_secret is shown ONCE: copy it straight
--    into Vercel env vars (or a 1Password/Bitwarden note). Never commit it or paste it in chat.
ALTER USER COFFEE_CHAT_SVC ADD PROGRAMMATIC ACCESS TOKEN COFFEE_CHAT_BACKEND
  ROLE_RESTRICTION = 'COFFEE_CHAT_ROLE'
  DAYS_TO_EXPIRY = 7
  COMMENT = 'Shipyard hackathon backend';
-- Lost it? ALTER USER COFFEE_CHAT_SVC REMOVE PROGRAMMATIC ACCESS TOKEN COFFEE_CHAT_BACKEND; then re-run step 6.

-- 7. Smoke tests, run as the app role so they prove the grants work.
USE ROLE COFFEE_CHAT_ROLE;
USE WAREHOUSE COFFEE_CHAT_WH;
USE SCHEMA COFFEE_CHAT.APP;

SELECT AI_COMPLETE('grok-4.7', 'say hi') AS grok;
-- If that errors with "model not available": SPEC fallback, same endpoint.
-- SELECT AI_COMPLETE('claude-sonnet-4-6', 'say hi') AS fallback;

-- The two Snowflake AI calls the spec says we can never cut:
SELECT AI_EXTRACT(
  text => 'Ledgerly, Software Engineer Intern, Payments Platform. New York, NY. We use TypeScript, Go and SQL.',
  responseFormat => ['company', 'role', 'team', 'location', 'skills']
) AS parsed_job;

SELECT AI_CLASSIFY(
  'Sure, Thursday at 3?',
  ['interested', 'proposes_time', 'not_interested', 'referral', 'ooo']
) AS reply_intent;

SELECT AI_SENTIMENT('Happy to chat! Grab any slot on my calendar this week.') AS warmth;

SHOW TABLES IN SCHEMA COFFEE_CHAT.APP;
