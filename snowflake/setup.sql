-- Coffee Chat Copilot: Snowflake setup (SPEC §6b checklist). Owner: A (Rachel).
-- Run top to bottom in a Snowsight SQL worksheet as ACCOUNTADMIN.
-- Safe to re-run: everything is IF NOT EXISTS / OR REPLACE where it matters.
--
-- At the end you hand C (backend) three things:
--   SNOWFLAKE_ACCOUNT_URL  https://<org>-<account>.snowflakecomputing.com   (Snowsight: bottom-left account menu → "Connect a tool")
--   SNOWFLAKE_PAT          the token_secret printed by step 7, the last result (shown ONCE)
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

-- Let you (whoever runs this) use the role in worksheets too. Granting it under
-- SYSADMIN means ACCOUNTADMIN inherits it, without naming your user (school/SSO
-- accounts often have a login name that differs from the user name).
GRANT ROLE COFFEE_CHAT_ROLE TO ROLE SYSADMIN;

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
ALTER USER COFFEE_CHAT_SVC UNSET AUTHENTICATION POLICY;  -- a user can hold only one; this makes re-runs safe
ALTER USER COFFEE_CHAT_SVC SET AUTHENTICATION POLICY COFFEE_CHAT.APP.PAT_ANY_NETWORK;

-- Fallback (only if step 5 fails): an allow-all network policy on the service user.
-- CREATE NETWORK POLICY IF NOT EXISTS COFFEE_CHAT_ALLOW_ALL ALLOWED_IP_LIST = ('0.0.0.0/0');
-- ALTER USER COFFEE_CHAT_SVC SET NETWORK_POLICY = COFFEE_CHAT_ALLOW_ALL;

-- 6. AI smoke tests live in smoke-tests.sql, run one statement at a time, so an
--    AI function that isn't available on the account (e.g. trial accounts can't
--    use AI_COMPLETE) doesn't stop setup before the token is made.

-- 7. The token. Kept LAST on purpose: Snowsight's "Run All" only shows the final
--    statement's result, so this is the row you'll see. Its token_secret is shown ONCE:
--    copy it straight into Vercel env vars or a password manager. Never commit it or paste it in chat.
USE ROLE ACCOUNTADMIN;
ALTER USER COFFEE_CHAT_SVC ADD PROGRAMMATIC ACCESS TOKEN COFFEE_CHAT_BACKEND
  ROLE_RESTRICTION = 'COFFEE_CHAT_ROLE'
  DAYS_TO_EXPIRY = 7
  COMMENT = 'Shipyard hackathon backend';
-- Re-running the file? "Programmatic access token COFFEE_CHAT_BACKEND already exists"
-- on this last statement is expected: everything above it still ran.
-- Need another token (e.g. for local testing)? Add one with a new name instead of
-- removing this one, which would break the backend that already uses it:
--   ALTER USER COFFEE_CHAT_SVC ADD PROGRAMMATIC ACCESS TOKEN COFFEE_CHAT_LOCAL
--     ROLE_RESTRICTION = 'COFFEE_CHAT_ROLE' DAYS_TO_EXPIRY = 7;
-- Lost the backend token? REMOVE it, then re-run this statement (C must update Vercel):
--   ALTER USER COFFEE_CHAT_SVC REMOVE PROGRAMMATIC ACCESS TOKEN COFFEE_CHAT_BACKEND;
