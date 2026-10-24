import { useState } from "react";
import type { Meeting } from "../../shared/types";
import { useApp } from "../data/store";
import { useNav } from "../nav";
import { MiniMarkdown } from "./text";
import { Badge, Button, TextArea, fmtDateTime } from "./ui";

export function PrepBrief({ meeting }: { meeting: Meeting }) {
  const { state, actions, busy } = useApp();
  // Picked questions the bank hasn't approved yet are AI-written gap fillers: "new: add to bank?"
  const newOnes = state.questions.filter((q) => meeting.questionIds.includes(q.id) && q.status === "suggested");
  const b = busy[`brief:${meeting.id}`];
  return (
    <div className="rounded-md bg-stone-50 p-3 ring-1 ring-stone-200">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-stone-500">Prep brief</span>
        <Button variant="ghost" busy={b} onClick={() => actions.generatePrepBrief(meeting.id)}>
          {meeting.prepBrief ? "Regenerate" : "Generate"}
        </Button>
      </div>
      {meeting.prepBrief
        ? <MiniMarkdown source={meeting.prepBrief} />
        : <p className="text-[13px] text-stone-500">Picks 5 questions from your approved bank for this person and job.</p>}
      {newOnes.map((q) => (
        <div key={q.id} className="mt-2 flex items-center justify-between gap-2 rounded bg-white p-2 ring-1 ring-amber-200">
          <span className="text-[12px]"><Badge tone="amber">new</Badge> {q.text}</span>
          <Button onClick={() => actions.updateQuestion(q.id, { status: "approved" })}>Add to bank</Button>
        </div>
      ))}
      {meeting.prepBrief && <p className="mt-2 text-[11px] text-stone-500">Also attached to the calendar event description.</p>}
    </div>
  );
}

export function MeetingNotes({ meeting }: { meeting: Meeting }) {
  const { state, actions, busy } = useApp();
  const contact = state.contacts.find((c) => c.id === meeting.contactId);
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [landed, setLanded] = useState<string[]>([]);
  const asked = state.questions.filter((q) => meeting.questionIds.includes(q.id));
  const nav = useNav();
  const thanked = state.drafts.some((d) => d.contactId === meeting.contactId && d.kind === "thank_you");

  if (contact?.notes || thanked) {
    return (
      <div className="rounded-md bg-emerald-50 p-3 text-[13px] text-emerald-900 ring-1 ring-emerald-200">
        <div className="mb-1 font-medium">Notes saved</div>
        {contact?.notes && <p className="mb-2 whitespace-pre-wrap text-emerald-800">{contact.notes}</p>}
        <Button onClick={() => nav.go("queue")}>See thank-you in queue</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md bg-amber-50 p-3 ring-1 ring-amber-200">
      <div className="font-medium text-amber-900">How did it go with {contact?.name.split(" ")[0]}?</div>
      <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="Quick notes: what they said, advice, who to talk to next. The thank-you will reference this." />
      {asked.length > 0 && (
        <div>
          <div className="mb-1 text-[12px] font-medium text-amber-900">Which questions landed well?</div>
          <div className="space-y-1">
            {asked.map((q) => (
              <label key={q.id} className="flex items-start gap-2 text-[12px] text-stone-700">
                <input type="checkbox" className="mt-0.5 accent-brand-600" checked={landed.includes(q.id)}
                  onChange={(e) => setLanded(e.target.checked ? [...landed, q.id] : landed.filter((x) => x !== q.id))} />
                {q.text}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <Button variant="primary" busy={busy[`notes:${meeting.id}`]} onClick={() => actions.saveMeetingNotes(meeting.id, notes, landed)}>
          Save + draft thank-you
        </Button>
      </div>
    </div>
  );
}

export function MeetingPanel({ meeting }: { meeting: Meeting }) {
  const { actions } = useApp();
  const over = new Date(meeting.end).getTime() < Date.now();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Badge tone="green">☕ {fmtDateTime(meeting.start)}</Badge>
        {meeting.meetLink && <a href={meeting.meetLink} target="_blank" rel="noreferrer" className="text-[12px] text-brand-700 underline">Meet link</a>}
        {!over && <button className="text-[11px] text-stone-400 hover:text-stone-600" onClick={() => actions.fastForwardMeeting(meeting.id)} title="Demo: pretend the chat already happened">⏩ fast-forward</button>}
      </div>
      {over ? <MeetingNotes meeting={meeting} /> : <PrepBrief meeting={meeting} />}
    </div>
  );
}
