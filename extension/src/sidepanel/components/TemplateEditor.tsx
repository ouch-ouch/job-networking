import { useRef, useState } from "react";
import type { Template } from "../../shared/types";
import { KNOWN_PLACEHOLDERS, placeholdersIn } from "../data/fill";
import { LINKEDIN_CONNECT_LIMIT } from "../data/store";
import { Badge, Button, Field, Input } from "./ui";

/** Textarea with {{placeholders}} highlighted live (a styled backdrop under a transparent textarea). */
function HighlightArea({ value, onChange, minRows = 6 }: { value: string; onChange: (v: string) => void; minRows?: number }) {
  const back = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const parts = value.split(/(\{\{\s*[a-z_]+\s*\}\})/g);
  return (
    <div className="relative rounded-md bg-white ring-1 ring-stone-300 focus-within:ring-2 focus-within:ring-brand-500">
      <div ref={back} aria-hidden className="hl-layer pointer-events-none absolute inset-0 overflow-hidden text-transparent">
        {parts.map((p, i) => {
          if (!p.startsWith("{{")) return <span key={i}>{p}</span>;
          const known = (KNOWN_PLACEHOLDERS as readonly string[]).includes(p.replace(/[{}\s]/g, ""));
          return <mark key={i} className={`rounded text-transparent ${known ? "bg-brand-100" : "bg-red-100"}`}>{p}</mark>;
        })}
        {"\n"}
      </div>
      <textarea
        ref={ta}
        value={value}
        rows={minRows}
        spellCheck
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => { if (back.current) back.current.scrollTop = e.currentTarget.scrollTop; }}
        className="hl-layer relative block w-full resize-y bg-transparent text-stone-900 caret-stone-900 outline-none"
      />
    </div>
  );
}

export function TemplateEditor({ template, onSave }: { template: Template; onSave: (t: Template) => void }) {
  const [draft, setDraft] = useState(template);
  const dirty = JSON.stringify(draft) !== JSON.stringify(template);
  const used = placeholdersIn(draft.body + (draft.subject ?? ""));
  const unknown = used.filter((p) => !(KNOWN_PLACEHOLDERS as readonly string[]).includes(p));
  const isConnect = draft.channel === "linkedin_connect";
  // Rough length check: placeholders usually fill to ~10 chars except the hook (~110).
  const estLength = draft.body.replace(/\{\{\s*personal_hook\s*\}\}/g, "x".repeat(110)).replace(/\{\{\s*[a-z_]+\s*\}\}/g, "x".repeat(10)).length;

  const insert = (p: string) => setDraft((d) => ({ ...d, body: `${d.body}${d.body.endsWith(" ") ? "" : " "}{{${p}}}` }));

  return (
    <div className="space-y-3">
      {draft.channel === "email" && (
        <Field label="Subject">
          <Input value={draft.subject ?? ""} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
        </Field>
      )}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] font-medium text-stone-600">Message</span>
          {isConnect && (
            <span className={`text-[11px] ${estLength > LINKEDIN_CONNECT_LIMIT ? "text-red-600" : "text-stone-500"}`}>
              ~{estLength} / {LINKEDIN_CONNECT_LIMIT} once filled
            </span>
          )}
        </div>
        <HighlightArea value={draft.body} onChange={(body) => setDraft({ ...draft, body })} />
      </div>
      <div className="flex flex-wrap gap-1">
        {KNOWN_PLACEHOLDERS.map((p) => (
          <button key={p} type="button" onClick={() => insert(p)}
            className={`rounded px-1.5 py-0.5 font-mono text-[11px] ring-1 ${used.includes(p) ? "bg-brand-100 text-brand-700 ring-brand-200" : "bg-white text-stone-600 ring-stone-200 hover:bg-stone-50"}`}>
            {`{{${p}}}`}
          </button>
        ))}
      </div>
      {unknown.length > 0 && (
        <p className="text-[12px] text-red-700">The AI won't know how to fill: {unknown.map((u) => <Badge key={u} tone="red">{`{{${u}}}`}</Badge>)}</p>
      )}
      <p className="text-[11px] text-stone-500">
        You write this once. The AI only swaps the highlighted <span className="font-mono">{"{{placeholders}}"}</span> per person and keeps the rest of your wording.
        <span className="font-mono"> {"{{personal_hook}}"}</span> is one sentence it writes from a real warm path, or leaves out.
      </p>
      <div className="flex justify-end gap-2">
        {dirty && <Button variant="ghost" onClick={() => setDraft(template)}>Discard</Button>}
        <Button variant="primary" disabled={!dirty} onClick={() => onSave(draft)}>Save template</Button>
      </div>
    </div>
  );
}
