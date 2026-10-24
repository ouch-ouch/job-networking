import type { ActivityEvent, Contact, Draft, WarmPath } from "../../shared/types";
import { EMAIL_CONFIDENCE_THRESHOLD } from "../data/store";
import { Badge, type Tone } from "./ui";

export const STAGES: Contact["stage"][] = ["found", "drafted", "sent", "followed_up", "replied", "scheduled", "met", "thanked", "cold"];

export const STAGE_LABEL: Record<Contact["stage"], string> = {
  found: "Found", drafted: "Drafted", sent: "Sent", followed_up: "Followed up", replied: "Replied",
  scheduled: "Scheduled", met: "Met", thanked: "Thanked", cold: "Cold",
};

const STAGE_TONE: Record<Contact["stage"], Tone> = {
  found: "stone", drafted: "stone", sent: "blue", followed_up: "blue", replied: "violet",
  scheduled: "green", met: "green", thanked: "brand", cold: "red",
};

export const StageBadge = ({ stage }: { stage: Contact["stage"] }) => <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>;

const WARM_LABEL: Record<WarmPath["type"], string> = {
  alumni: "NYU alum", past_employer: "Shared employer", shared_org: "Shared org", mutual_connection: "Mutual",
};

export const WarmBadge = ({ path }: { path: WarmPath }) => (
  <Badge tone={path.type === "alumni" ? "violet" : "brand"} title={path.detail}>{WARM_LABEL[path.type]}</Badge>
);

export function EmailConfidence({ value }: { value?: number }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const tone: Tone = value >= 0.75 ? "green" : value >= EMAIL_CONFIDENCE_THRESHOLD ? "amber" : "red";
  return <Badge tone={tone} title="How sure we are the guessed email is right">{pct}% email</Badge>;
}

export function SentimentBadge({ sentiment }: { sentiment?: ActivityEvent["sentiment"] }) {
  if (!sentiment) return null;
  const tone: Tone = sentiment === "warm" ? "amber" : sentiment === "cold" ? "blue" : "stone";
  const icon = sentiment === "warm" ? "●" : sentiment === "cold" ? "○" : "◐";
  return <Badge tone={tone} title="Snowflake AI_SENTIMENT">{icon} {sentiment}</Badge>;
}

export const KIND_LABEL: Record<Draft["kind"], string> = {
  initial: "First message", follow_up: "Follow-up", schedule_reply: "Scheduling reply",
  confirmation: "Confirmation", thank_you: "Thank-you",
};

export const CHANNEL_LABEL: Record<Draft["channel"], string> = {
  email: "Email", linkedin_connect: "LinkedIn note", linkedin_message: "LinkedIn message",
};

export const DegreeBadge = ({ d }: { d?: 1 | 2 | 3 }) =>
  d ? <Badge tone="stone" title="LinkedIn connection degree">{d === 1 ? "1st" : d === 2 ? "2nd" : "3rd"}</Badge> : null;
