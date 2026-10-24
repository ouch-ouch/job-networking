import { useEffect, useRef, useState } from "react";
import type { Contact, Target, Template } from "../../shared/types";
import { useApp } from "../data/store";
import { useNav } from "../nav";
import { DegreeBadge, EmailConfidence, StageBadge, WarmBadge } from "../components/badges";
import { MeetingPanel } from "../components/Meeting";
import { Badge, Button, Card, Empty, Field, Input, SectionTitle, TextArea, relTime } from "../components/ui";

function NewTarget({ onDone }: { onDone: (t: Target) => void }) {
  const { actions, busy } = useApp();
  const [text, setText] = useState("");
  const [url, setUrl] = useState<string>();
  const isUrl = /^https?:\/\/\S+$/.test(text.trim());

  const grab = async () => {
    const page = await actions.grabJobPage();
    setText(page.text);
    setUrl(page.url);
  };
  const parse = async () => {
    let raw = text, link = url;
    if (isUrl) { link = text.trim(); raw = (await actions.grabJobPage()).text; }
    onDone(await actions.parseJob(raw, link));
    setText(""); setUrl(undefined);
  };

  return (
    <Card className="space-y-2">
      <Button variant="primary" className="w-full" busy={busy.grab} onClick={grab}>Network for this job (grab open page)</Button>
      <div className="text-center text-[11px] text-stone-400">or paste it</div>
      <TextArea rows={5} value={text} onChange={(e) => { setText(e.target.value); setUrl(undefined); }}
        placeholder="Paste a job description or a job URL" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-stone-500">Snowflake AI_EXTRACT pulls company, role, team, location, skills.</span>
        <Button variant="primary" disabled={!text.trim()} busy={busy.parse} onClick={parse}>Extract</Button>
      </div>
    </Card>
  );
}

function TargetSummary({ t }: { t: Target }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-semibold">{t.role}</div>
          <div className="text-[13px] text-stone-600">{t.company}{t.team && ` · ${t.team}`}{t.location && ` · ${t.location}`}</div>
        </div>
        {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="text-[12px] text-brand-700 underline">Posting</a>}
      </div>
      {t.skills.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">{t.skills.map((s) => <Badge key={s}>{s}</Badge>)}</div>
      )}
    </Card>
  );
}

function ContactCard({ c, open, onToggle }: { c: Contact; open: boolean; onToggle: () => void }) {
  const { state } = useApp();
  const nav = useNav();
  const ref = useRef<HTMLDivElement>(null);
  const meeting = state.meetings.find((m) => m.contactId === c.id);
  const pending = state.drafts.filter((d) => d.contactId === c.id && d.status === "pending").length;

  useEffect(() => { if (open && nav.focusedContactId === c.id) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [open, nav.focusedContactId, c.id]);

  return (
    <div ref={ref} className="rounded-lg bg-white ring-1 ring-stone-200">
      <button className="flex w-full items-start gap-3 p-3 text-left" onClick={onToggle}>
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${c.relevance >= 85 ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-700"}`}
          title="Relevance score">{c.relevance}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{c.name}</span>
            <DegreeBadge d={c.connectionDegree} />
          </div>
          <div className="truncate text-[12px] text-stone-500">{c.title}</div>
          <div className="mt-1 text-[12px] text-stone-700">{c.reason}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <StageBadge stage={c.stage} />
            {c.warmPaths.map((w, i) => <WarmBadge key={i} path={w} />)}
            {pending > 0 && <Badge tone="amber">{pending} to approve</Badge>}
          </div>
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t border-stone-100 p-3">
          <div className="space-y-1 text-[12px]">
            {c.email && <div className="flex items-center gap-2"><span className="text-stone-500">Email</span><span className="font-mono">{c.email}</span><EmailConfidence value={c.emailConfidence} /></div>}
            {c.linkedinUrl && <div><a className="text-brand-700 underline" href={c.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn profile</a></div>}
            {c.warmPaths.map((w, i) => <div key={i} className="text-stone-600">↳ {w.detail}</div>)}
            {c.nextActionAt && <div className="text-stone-500">Next check {relTime(c.nextActionAt)} · {c.followUpCount} follow-up{c.followUpCount === 1 ? "" : "s"} sent</div>}
          </div>
          {meeting && <MeetingPanel meeting={meeting} />}
          <div className="flex gap-2">
            {pending > 0 && <Button onClick={() => nav.go("queue")}>Review drafts</Button>}
            <Button variant="ghost" onClick={() => nav.go("activity")}>Thread</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddContact({ targetId, company, onDone }: { targetId: string; company: string; onDone: () => void }) {
  const { actions } = useApp();
  const [f, setF] = useState({ name: "", title: "", linkedinUrl: "", email: "" });
  return (
    <Card className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      </div>
      <Field label="LinkedIn URL"><Input value={f.linkedinUrl} onChange={(e) => setF({ ...f, linkedinUrl: e.target.value })} /></Field>
      <Field label="Email (optional)" hint="Leave blank and we'll guess it from the company domain.">
        <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" disabled={!f.name.trim()} onClick={() => {
          actions.addContact({ targetId, company, name: f.name.trim(), title: f.title.trim(), linkedinUrl: f.linkedinUrl || undefined, email: f.email || undefined, emailConfidence: f.email ? 1 : undefined });
          onDone();
        }}>Add</Button>
      </div>
    </Card>
  );
}

export function TargetsScreen() {
  const { state, actions, busy } = useApp();
  const nav = useNav();
  const [targetId, setTargetId] = useState(state.targets.at(-1)?.id);
  const [adding, setAdding] = useState(state.targets.length === 0);
  const [addingContact, setAddingContact] = useState(false);
  const [openId, setOpenId] = useState<string | null>(nav.focusedContactId);
  const [channel, setChannel] = useState<Template["channel"]>("email");

  useEffect(() => {
    if (!nav.focusedContactId) return;
    setOpenId(nav.focusedContactId);
    const c = state.contacts.find((x) => x.id === nav.focusedContactId);
    if (c) setTargetId(c.targetId);
  }, [nav.focusedContactId, state.contacts]);

  const target = state.targets.find((t) => t.id === targetId);
  const contacts = state.contacts.filter((c) => c.targetId === targetId).sort((a, b) => b.relevance - a.relevance);
  const found = contacts.filter((c) => c.stage === "found").length;

  return (
    <div>
      <SectionTitle action={state.targets.length > 0 && <Button variant="ghost" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ New target"}</Button>}>
        Target job
      </SectionTitle>
      {adding && <div className="mb-3"><NewTarget onDone={(t) => { setTargetId(t.id); setAdding(false); }} /></div>}
      {state.targets.length > 1 && (
        <select className="mb-2 w-full rounded-md bg-white px-2 py-1.5 text-[13px] ring-1 ring-stone-300" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {state.targets.map((t) => <option key={t.id} value={t.id}>{t.company} · {t.role}</option>)}
        </select>
      )}
      {target && <TargetSummary t={target} />}

      {target && (
        <>
          <SectionTitle action={<Button variant="ghost" onClick={() => setAddingContact(!addingContact)}>+ Add by hand</Button>}>
            People ({contacts.length})
          </SectionTitle>
          {addingContact && <div className="mb-2"><AddContact targetId={target.id} company={target.company} onDone={() => setAddingContact(false)} /></div>}
          <div className="mb-2 flex flex-wrap gap-2">
            <Button busy={busy[`scrape:${target.id}`]} onClick={() => actions.scrapeSearch(target.id)}>Find people on LinkedIn</Button>
            {found > 0 && (
              <div className="flex items-center gap-1">
                <select value={channel} onChange={(e) => setChannel(e.target.value as Template["channel"])}
                  className="rounded-md bg-white px-1.5 py-1.5 text-[12px] ring-1 ring-stone-300">
                  <option value="email">Email</option>
                  <option value="linkedin_connect">LinkedIn note</option>
                </select>
                <Button variant="primary" busy={busy[`gen:${target.id}`]} onClick={() => actions.generateDrafts(target.id, channel)}>
                  Draft {found} message{found === 1 ? "" : "s"}
                </Button>
              </div>
            )}
          </div>
          {contacts.length === 0
            ? <Empty>No one yet. "Find people" opens a LinkedIn search for {target.company} with an NYU alumni filter.</Empty>
            : (
              <div className="space-y-2">
                {contacts.map((c) => <ContactCard key={c.id} c={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} />)}
              </div>
            )}
        </>
      )}
    </div>
  );
}
