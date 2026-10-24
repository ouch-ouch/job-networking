import { useState } from "react";
import type { ActivityEvent, AppState } from "../../shared/types";
import { useApp } from "../data/store";
import { useNav } from "../nav";
import { KIND_LABEL, SentimentBadge, StageBadge } from "../components/badges";
import { Button, Card, Empty, relTime } from "../components/ui";

const ICON: Record<ActivityEvent["type"], string> = {
  draft_created: "✎", approved: "✓", sent: "↗", reply_received: "↙",
  follow_up_due: "⏰", meeting_scheduled: "☕", agent_step: "◆", error: "!",
};

type Item = { kind: "event"; e: ActivityEvent } | { kind: "run"; runId: string; steps: ActivityEvent[] };

/** Collapses agent_step events with the same runId into one trace item. */
function toItems(events: ActivityEvent[]): Item[] {
  const runs = new Map<string, ActivityEvent[]>();
  const items: Item[] = [];
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    if (e.type === "agent_step" && e.runId) {
      if (!runs.has(e.runId)) { runs.set(e.runId, []); items.push({ kind: "run", runId: e.runId, steps: runs.get(e.runId)! }); }
      runs.get(e.runId)!.push(e);
    } else items.push({ kind: "event", e });
  }
  return items.reverse();
}

const toolOf = (s: ActivityEvent) => s.summary.match(/called (\w+)/)?.[1] ?? s.summary;

function AgentTrace({ steps }: { steps: ActivityEvent[] }) {
  const [open, setOpen] = useState(false);
  const last = steps.at(-1)!;
  return (
    <div className="rounded-lg bg-stone-900 p-3 text-stone-100">
      <button className="w-full text-left" onClick={() => setOpen(!open)}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-brand-200">◆ Grok agent · {steps.length} step{steps.length === 1 ? "" : "s"}</span>
          <span className="text-[11px] text-stone-400">{relTime(last.at)} {open ? "▴" : "▾"}</span>
        </div>
        <div className="mt-1 font-mono text-[11px] text-stone-300">{steps.map(toolOf).join(" → ")}</div>
        {!open && last.detail && <div className="mt-1 text-[12px] text-stone-200">{last.detail.replace(/^→\s*/, "")}</div>}
      </button>
      {open && (
        <ol className="mt-2 space-y-1.5 border-t border-stone-700 pt-2">
          {steps.map((s) => (
            <li key={s.id} className="text-[12px]">
              <div className="text-stone-100">{s.summary}</div>
              {s.detail && <div className="font-mono text-[11px] text-stone-400">{s.detail}</div>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Timeline() {
  const { state } = useApp();
  const nav = useNav();
  const items = toItems(state.activity);
  if (!items.length) return <Empty>Nothing yet.</Empty>;
  const name = (id: string) => state.contacts.find((c) => c.id === id)?.name;
  return (
    <div className="space-y-2">
      {items.map((it) => it.kind === "run"
        ? <AgentTrace key={it.runId} steps={it.steps} />
        : (
          <button key={it.e.id} onClick={() => it.e.contactId && nav.openContact(it.e.contactId)}
            className={`flex w-full items-start gap-2 rounded-lg bg-white p-2.5 text-left ring-1 ${it.e.type === "error" ? "ring-red-200" : "ring-stone-200"} hover:bg-stone-50`}>
            <span className="mt-0.5 w-4 text-center text-stone-500">{ICON[it.e.type]}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5 text-[13px]">{it.e.summary}<SentimentBadge sentiment={it.e.sentiment} /></span>
              {it.e.type === "reply_received" && it.e.detail && <span className="mt-0.5 block text-[12px] italic text-stone-600">"{it.e.detail}"</span>}
              {!it.e.summary.includes(name(it.e.contactId) ?? "\0") && name(it.e.contactId) && <span className="block text-[11px] text-stone-400">{name(it.e.contactId)}</span>}
            </span>
            <span className="whitespace-nowrap text-[11px] text-stone-400">{relTime(it.e.at)}</span>
          </button>
        ))}
    </div>
  );
}

type ThreadEntry = { at: number; from: "me" | "them"; label: string; body: string; sentiment?: ActivityEvent["sentiment"] };

function threadFor(s: AppState, contactId: string): ThreadEntry[] {
  const mine: ThreadEntry[] = s.drafts
    .filter((d) => d.contactId === contactId && d.status === "sent")
    .map((d) => ({ at: d.createdAt, from: "me", label: KIND_LABEL[d.kind], body: d.body }));
  const theirs: ThreadEntry[] = s.activity
    .filter((e) => e.contactId === contactId && e.type === "reply_received")
    .map((e) => ({ at: e.at, from: "them", label: e.summary, body: e.detail ?? "", sentiment: e.sentiment }));
  return [...mine, ...theirs].sort((a, b) => a.at - b.at);
}

function Messages() {
  const { state } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const people = state.contacts
    .map((c) => ({ c, thread: threadFor(state, c.id) }))
    .filter((x) => x.thread.length > 0)
    .sort((a, b) => b.thread.at(-1)!.at - a.thread.at(-1)!.at);
  if (!people.length) return <Empty>No conversations yet. Approve a draft to start one.</Empty>;

  return (
    <div className="space-y-2">
      {people.map(({ c, thread }) => {
        const last = thread.at(-1)!;
        const open = openId === c.id;
        return (
          <Card key={c.id} className="p-0">
            <button className="flex w-full items-start gap-2 p-3 text-left" onClick={() => setOpenId(open ? null : c.id)}>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><span className="font-medium">{c.name}</span><StageBadge stage={c.stage} /><SentimentBadge sentiment={last.sentiment} /></span>
                <span className="block truncate text-[12px] text-stone-500">{last.from === "me" ? "You: " : ""}{last.body}</span>
              </span>
              <span className="whitespace-nowrap text-[11px] text-stone-400">{relTime(last.at)}</span>
            </button>
            {open && (
              <div className="space-y-2 border-t border-stone-100 p-3">
                {thread.map((t, i) => (
                  <div key={i} className={`max-w-[88%] rounded-lg px-2.5 py-2 text-[12px] ${t.from === "me" ? "ml-auto bg-brand-50 text-stone-800" : "bg-stone-100 text-stone-800"}`}>
                    <div className="mb-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-stone-500">{t.from === "me" ? t.label : "Reply"}<SentimentBadge sentiment={t.sentiment} /> · {relTime(t.at)}</div>
                    <div className="whitespace-pre-wrap">{t.body}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export function ActivityScreen() {
  const { actions, busy } = useApp();
  const [view, setView] = useState<"timeline" | "messages">("timeline");
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md bg-stone-100 p-0.5">
          {(["timeline", "messages"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded px-2.5 py-1 text-[12px] font-medium capitalize ${view === v ? "bg-white shadow-sm" : "text-stone-600"}`}>{v}</button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" onClick={actions.tick} title="Run the follow-up scheduler now">Run scheduler</Button>
          <Button busy={busy.poll} onClick={actions.pollReplies}>Check replies</Button>
        </div>
      </div>
      {view === "timeline" ? <Timeline /> : <Messages />}
    </div>
  );
}
