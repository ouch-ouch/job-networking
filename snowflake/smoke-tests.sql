-- Coffee Chat Copilot: which Snowflake AI functions work on this account?
-- Run AFTER setup.sql. Run each SELECT on its own: click inside it, press Ctrl+Enter
-- (plain Enter, no Shift), and note "works" or the error text for each one.

USE ROLE COFFEE_CHAT_ROLE;
USE WAREHOUSE COFFEE_CHAT_WH;
USE SCHEMA COFFEE_CHAT.APP;

-- A. Grok (the agent + drafting). Known: trial accounts get
--    "AI function ... is not available for trial accounts".
SELECT AI_COMPLETE('grok-4.7', 'say hi') AS grok;

-- B. Spec fallback model, same function.
SELECT AI_COMPLETE('claude-sonnet-4-6', 'say hi') AS fallback;

-- C. Parse a job description (spec: never cut).
SELECT AI_EXTRACT(
  text => 'Ledgerly, Software Engineer Intern, Payments Platform. New York, NY. We use TypeScript, Go and SQL.',
  responseFormat => ['company', 'role', 'team', 'location', 'skills']
) AS parsed_job;

-- D. Reply intent (spec: never cut).
SELECT AI_CLASSIFY(
  'Sure, Thursday at 3?',
  ['interested', 'proposes_time', 'not_interested', 'referral', 'ooo']
) AS reply_intent;

-- E. Reply warmth badge.
SELECT AI_SENTIMENT('Happy to chat! Grab any slot on my calendar this week.') AS warmth;

-- F. Contact ranking / question picking.
SELECT AI_SIMILARITY('payments platform engineer', 'software engineer on the payments team') AS similarity;
