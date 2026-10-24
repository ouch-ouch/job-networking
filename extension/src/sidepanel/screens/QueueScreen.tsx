import { useState } from "react";
import type { Draft } from "../../shared/types";
import { EMAIL_CONFIDENCE_THRESHOLD, EMAIL_DAILY_CAP, LINKEDIN_CONNECT_LIMIT, useApp } from "../data/store";
import { useNav } from "../nav";
import { CHANNEL_LABEL, EmailConfidence, KIND_LABEL } from "../components/badges";
import { KeywordHighlight } from "../components/text";
import { Badge, Button, Card, Empty, Input, SectionTitle, TextArea, relTime } from "../components/ui";

function splitReferral(d: Draft): { main: string; referral?: string } {
  if (d.kind !== "thank_you") return { main: d.body };
  const paras = d.body.split(/\n\n+/);
  return paras.length > 1 ? { main: paras.slice(0, -1).join("\n\n"), referral: paras.at(-1) } : { main: d.body };
}

function DraftCard({ d }: { d: Draft }) {
  const { state, actions, busy } = useApp();
  const nav = useNav();
  const c = state.contacts.find((x) => x.id === d.contactId);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(d.subject ?? "");
  const [body, setBody] = useState(d.body);
  const [checkedEmail, setCheckedEmail] = useState(false);
  const [emailEdit, setEmailEdit] = useState<string | null>(null);
  const [withReferral, setWithReferral] = useState(true);

  const isEmail = d.channel === "email";
  const isConnect = d.channel === "linkedin_connect";
  const { main, referral } = splitReferral(d);
  const finalBody = referral && !withReferral ? main : d.body;
  const tooLong = isConnect && finalBody.length > LINKEDIN_CONNECT_LIMIT;
  const lowConfidence = isEmail && (c?.emailConfidence ?? 0) < EMAIL_CONFIDENCE_THRESHOLD;
  const blockedOnEmail = isEmail && (!c?.email || (lowConfidence && !checkedEmail));

  const saveEdit = () => { actions.updateDraft(d.id, { body, subject: isEmail ? subject : undefined }); setEditing(false); };
  const approve = () => {
    if (finalBody !== d.body) actions.updateDraft(d.id, { body: finalBody });
    actions.approveDraft(d.id);
  };

  if (d.status === "approved" && !isEmail) {
    return (
      <Card className="space-y-2 ring-sky-200">
        <div className="flex items-center justify-between">
          <span className="font-medium">{c?.name}</span>
          <Badge tone="blue">{CHANNEL_LABEL[d.channel]}</Badge>
        </div>
        <p className="text-[13px] text-stone-600">Filled on their LinkedIn profile. Review it there and click <b>Send</b> yourself, then mark it here.</p>
        <div className="flex gap-2">
          {c?.linkedinUrl && <Button onClick={() => window.open(c.linkedinUrl, "_blank")}>Open profile</Button>}
          <Button variant="primary" onClick={() => actions.markSent(d.id)}>Mark sent</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <button className="text-left" onClick={() => c && nav.openContact(c.id)}>
          <div className="font-medium hover:underline">{c?.name ?? "Unknown"}</div>
          <div className="text-[12px] text-stone-500">{c?.title}</div>
        </button>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-1">
            <Badge tone={d.kind === "initial" ? "stone" : "violet"}>{KIND_LABEL[d.kind]}</Badge>
            <Badge tone={isEmail ? "brand" : "blue"}>{CHANNEL_LABEL[d.channel]}</Badge>
          </div>
          <span className="text-[11px] text-stone-400">{relTime(d.createdAt)}</span>
        </div>
      </div>

      {isEmail && (
        <div className="space-y-1 rounded bg-stone-50 px-2 py-1.5 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="text-stone-500">To</span>
            {emailEdit === null
              ? <><span className="font-mono">{c?.email ?? "no email found"}</span><EmailConfidence value={c?.emailConfidence} />
                  <button className="ml-auto text-stone-500 underline" onClick={() => setEmailEdit(c?.email ?? "")}>edit</button></>
              : <><Input className="!py-0.5 font-mono" value={emailEdit} onChange={(e) => setEmailEdit(e.target.value)} />
                  <Button onClick={() => { if (c) actions.updateContactEmail(c.id, emailEdit.trim()); setEmailEdit(null); }}>Save</Button></>}
          </div>
          {lowConfidence && c?.email && emailEdit === null && (
            <label className="flex items-center gap-2 text-amber-800">
              <input type="checkbox" className="accent-brand-600" checked={checkedEmail} onChange={(e) => setCheckedEmail(e.target.checked)} />
              This address is a low-confidence guess. I checked it, send anyway.
            </label>
          )}
        </div>
      )}

      {editing ? (
        <div className="space-y-2">
          {isEmail && <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />}
          <TextArea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      ) : (
        <div className="space-y-1">
          {isEmail && d.subject && <div className="text-[13px] font-medium"><KeywordHighlight text={d.subject} keywords={d.filledKeywords} /></div>}
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-stone-800">
            <KeywordHighlight text={main} keywords={d.filledKeywords} />
          </p>
          {referral && (
            <div className={`rounded border border-dashed p-2 text-[13px] ${withReferral ? "border-brand-200 text-stone-800" : "border-stone-200 text-stone-400 line-through"}`}>
              <label className="mb-1 flex items-center gap-2 text-[11px] font-medium text-stone-500 no-underline">
                <input type="checkbox" className="accent-brand-600" checked={withReferral} onChange={(e) => setWithReferral(e.target.checked)} />
                Include referral ask
              </label>
              {referral}
            </div>
          )}
          {isEmail && <p className="text-[11px] text-stone-400">Your signature and a one-line opt-out are added when it sends.</p>}
        </div>
      )}

      {isConnect && (
        <div className={`text-right text-[11px] ${tooLong ? "font-medium text-red-600" : "text-stone-500"}`}>
          {(editing ? body : finalBody).length} / {LINKEDIN_CONNECT_LIMIT}{tooLong && " (LinkedIn will reject this, shorten it)"}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 pt-2">
        {editing ? (
          <>
            <Button variant="ghost" onClick={() => { setEditing(false); setBody(d.body); setSubject(d.subject ?? ""); }}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit}>Save</Button>
          </>
        ) : (
          <>
            <Button variant="danger" onClick={() => actions.rejectDraft(d.id)}>Skip</Button>
            <Button variant="ghost" busy={busy[`regen:${d.id}`]} onClick={() => actions.regenerateDraft(d.id)}>Regenerate</Button>
            <Button onClick={() => { setBody(d.body); setSubject(d.subject ?? ""); setEditing(true); }}>Edit</Button>
            <Button variant="primary" busy={busy[`approve:${d.id}`]} disabled={tooLong || blockedOnEmail} onClick={approve}
              title={blockedOnEmail ? "Confirm or fix the email address first" : undefined}>
              {isEmail ? "Approve + send" : "Approve + fill on LinkedIn"}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

export function QueueScreen() {
  const { state } = useApp();
  const pending = state.drafts.filter((d) => d.status === "pending").sort((a, b) => b.createdAt - a.createdAt);
  const awaitingLinkedIn = state.drafts.filter((d) => d.status === "approved" && d.channel !== "email");
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const emailsToday = state.activity.filter((e) => e.type === "sent" && e.threadId && e.at >= startOfDay).length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between rounded-md bg-brand-50 px-3 py-2 text-[12px] text-brand-900 ring-1 ring-brand-100">
        <span>Nothing sends until you approve it.</span>
        <span className={emailsToday >= EMAIL_DAILY_CAP ? "font-semibold text-red-700" : ""}>{emailsToday}/{EMAIL_DAILY_CAP} emails today</span>
      </div>
      {awaitingLinkedIn.length > 0 && (
        <>
          <SectionTitle>Waiting for you on LinkedIn</SectionTitle>
          <div className="space-y-2">{awaitingLinkedIn.map((d) => <DraftCard key={d.id} d={d} />)}</div>
        </>
      )}
      <SectionTitle>Needs approval ({pending.length})</SectionTitle>
      {pending.length === 0
        ? <Empty>All caught up. New drafts, follow-ups and replies show up here.</Empty>
        : <div className="space-y-2">{pending.map((d) => <DraftCard key={d.id} d={d} />)}</div>}
    </div>
  );
}
