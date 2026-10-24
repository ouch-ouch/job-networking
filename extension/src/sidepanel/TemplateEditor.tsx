// Click-and-type template editor. The user types normally and clicks a field to drop
// it in at the cursor; fields render as chips instead of raw {{placeholders}}.
// The stored template is still plain text with {{key}} markers, which is what the
// backend's fill-template contract (backend/src/coffee/contracts.ts) expects.
import { useEffect, useRef } from "react";
import type { Profile } from "../shared/types";

type Group = "you" | "varies";
export type TemplateField = { key: string; label: string; group: Group; hint: string };

export const TEMPLATE_FIELDS: TemplateField[] = [
  { key: "my_name", label: "Your name", group: "you", hint: "From your profile" },
  { key: "my_school", label: "Your school", group: "you", hint: "From your profile" },
  { key: "my_year", label: "Your year", group: "you", hint: "From your profile" },
  { key: "my_major", label: "Your major", group: "you", hint: "From your profile" },
  { key: "my_availability", label: "Your availability", group: "you", hint: "From your profile" },
  { key: "signature", label: "Your signature", group: "you", hint: "From your profile" },
  { key: "first_name", label: "Their first name", group: "varies", hint: "Different for each person" },
  { key: "company", label: "Company", group: "varies", hint: "From the job you're targeting" },
  { key: "role", label: "Role", group: "varies", hint: "From the job you're targeting" },
  { key: "their_title", label: "Their job title", group: "varies", hint: "From the person's profile" },
  { key: "their_team", label: "Their team", group: "varies", hint: "From the person's title" },
  { key: "location", label: "Job location", group: "varies", hint: "From the job you're targeting" },
  { key: "skills", label: "Skill keywords", group: "varies", hint: "From the job description" },
  { key: "personal_hook", label: "Personal hook", group: "varies", hint: "AI writes one line from a real connection, or leaves it out" },
];

// Older names the backend also accepts; shown with the canonical chip.
const ALIASES: Record<string, string> = {
  school: "my_school",
  availability: "my_availability",
  name: "first_name",
  their_name: "first_name",
};
const fieldFor = (key: string) => TEMPLATE_FIELDS.find((f) => f.key === (ALIASES[key] || key));

function profileValue(key: string, profile: Profile): string {
  const k = ALIASES[key] || key;
  return (
    { my_name: profile.name, my_school: profile.school, my_year: profile.year, my_major: profile.major, my_availability: profile.availability, signature: profile.signature }[k] || ""
  );
}

type Token = { text: string } | { key: string };
export function tokenize(value: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    if (m.index! > last) out.push({ text: value.slice(last, m.index) });
    out.push({ key: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < value.length) out.push({ text: value.slice(last) });
  return out;
}

function makeChip(key: string, profile: Profile): HTMLSpanElement {
  const field = fieldFor(key);
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.field = key;
  chip.className = `tchip ${field ? `tchip--${field.group}` : "tchip--unknown"}`;
  const shown = field?.group === "you" ? profileValue(key, profile) || field.label : field?.label || key;
  chip.textContent = shown;
  chip.title = field ? `${field.label} · ${field.hint}` : `Unknown field "${key}". Remove it or retype it.`;
  return chip;
}

/** DOM → stored text. Chips become {{key}}; <br> and block breaks become newlines. */
function serialize(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node, isFirstChild: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent || "").replace(/​/g, "");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.field) {
      out += `{{${node.dataset.field}}}`;
      return;
    }
    if (node.tagName === "BR") {
      out += "\n";
      return;
    }
    const block = node !== root && ["DIV", "P"].includes(node.tagName);
    if (block && !isFirstChild && !out.endsWith("\n")) out += "\n";
    node.childNodes.forEach((child, i) => walk(child, i === 0));
  };
  walk(root, true);
  return out;
}

function render(root: HTMLElement, value: string, profile: Profile) {
  root.replaceChildren(
    ...tokenize(value).map((t) => ("key" in t ? makeChip(t.key, profile) : document.createTextNode(t.text))),
  );
}

export function TemplateEditor({
  value,
  onChange,
  profile,
  singleLine = false,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  profile: Profile;
  singleLine?: boolean;
  label: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);

  // Only rewrite the DOM when the value changed from outside, so the caret never jumps.
  useEffect(() => {
    const el = ref.current;
    if (el && serialize(el) !== value) render(el, value, profile);
  }, [value, profile]);

  useEffect(() => {
    const save = () => {
      const sel = document.getSelection();
      if (sel?.rangeCount && ref.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", save);
    return () => document.removeEventListener("selectionchange", save);
  }, []);

  const emit = () => ref.current && onChange(serialize(ref.current));

  const insertField = (key: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = document.getSelection()!;
    let r = range.current && el.contains(range.current.startContainer) ? range.current : null;
    if (!r) {
      r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
    }
    r.deleteContents();
    const chip = makeChip(key, profile);
    const after = document.createTextNode(" ");
    r.insertNode(after);
    r.insertNode(chip);
    r.setStartAfter(after);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    range.current = r.cloneRange();
    emit();
  };

  return (
    <div className="template-editor">
      <span className="template-editor-label">{label}</span>
      <div
        ref={ref}
        className={`template-input ${singleLine ? "single-line" : ""}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline={!singleLine}
        aria-label={label}
        data-placeholder={placeholder}
        spellCheck
        onInput={emit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (!singleLine) document.execCommand("insertLineBreak");
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, singleLine ? text.replace(/\s*\n\s*/g, " ") : text);
        }}
      />
      <FieldPicker profile={profile} onPick={insertField} compact={singleLine} />
    </div>
  );
}

function FieldPicker({ profile, onPick, compact }: { profile: Profile; onPick: (key: string) => void; compact: boolean }) {
  const groups: { group: Group; title: string; note: string }[] = [
    { group: "you", title: "About you", note: "Same in every message" },
    { group: "varies", title: "Changes per person", note: "Filled in for each contact" },
  ];
  return (
    <div className={`field-picker ${compact ? "compact" : ""}`}>
      {groups.map(({ group, title, note }) => (
        <div className="field-picker-group" key={group}>
          <div className="field-picker-heading">
            <strong>{title}</strong>
            <small>{note}</small>
          </div>
          <div className="field-picker-chips">
            {TEMPLATE_FIELDS.filter((f) => f.group === group).map((f) => (
              <button
                type="button"
                key={f.key}
                className={`tchip tchip--${f.group} tchip-button`}
                title={f.hint}
                // Keep the caret in the editor while clicking a field.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(f.key)}
              >
                + {f.group === "you" && profileValue(f.key, profile) ? `${f.label}: ${profileValue(f.key, profile)}` : f.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Shows how the message reads: your profile filled in, per-person fields as light labels. */
export function TemplatePreview({ subject, body, profile }: { subject?: string; body: string; profile: Profile }) {
  const paint = (text: string) =>
    tokenize(text).map((t, i) => {
      if (!("key" in t)) return <span key={i}>{t.text}</span>;
      const field = fieldFor(t.key);
      if (field?.group === "you")
        return (
          <mark key={i} className="preview-fill preview-fill--you">
            {profileValue(t.key, profile) || field.label}
          </mark>
        );
      return (
        <mark key={i} className={`preview-fill ${field ? "preview-fill--varies" : "preview-fill--unknown"}`}>
          {field ? field.label : `${t.key}?`}
        </mark>
      );
    });
  return (
    <div className="template-preview">
      <div className="template-preview-top">
        <strong>Preview</strong>
      </div>
      {subject?.trim() && <p className="template-preview-subject">{paint(subject)}</p>}
      <p className="template-preview-body">{paint(body)}</p>
      <p className="template-preview-legend">
        <mark className="preview-fill preview-fill--varies">Labeled</mark> parts are filled in differently for
        each person when drafts are made. <mark className="preview-fill preview-fill--you">Underlined</mark> parts
        come from your profile.
      </p>
    </div>
  );
}
