import { Fragment, type ReactNode } from "react";

/** Renders `text` with every filled keyword value highlighted (hover shows the placeholder name). */
export function KeywordHighlight({ text, keywords }: { text: string; keywords: Record<string, string> }) {
  const entries = Object.entries(keywords)
    .filter(([, v]) => v && v.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  if (!entries.length) return <>{text}</>;
  const escaped = entries.map(([, v]) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "g");
  const keyFor = new Map(entries.map(([k, v]) => [v, k]));
  return (
    <>
      {text.split(re).map((part, i) => {
        const key = keyFor.get(part);
        if (!key) return <Fragment key={i}>{part}</Fragment>;
        const hook = key === "personal_hook";
        return (
          <mark key={i} title={`{{${key}}}`} className={`rounded px-0.5 ${hook ? "bg-violet-100 text-violet-900" : "bg-brand-100 text-brand-900"}`}>
            {part}
          </mark>
        );
      })}
    </>
  );
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>);
}

/** Just enough markdown for prep briefs: ## headings, - bullets, 1. lists, **bold**, paragraphs. */
export function MiniMarkdown({ source }: { source: string }) {
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(
      <Tag key={out.length} className={`mb-2 space-y-1 pl-5 ${list.ordered ? "list-decimal" : "list-disc"}`}>
        {list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}
      </Tag>,
    );
    list = null;
  };
  for (const line of source.split("\n")) {
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+\.\s+(.*)/);
    if (ul || ol) {
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    flush();
    if (line.startsWith("#")) out.push(<h3 key={out.length} className="mb-1 mt-3 text-[13px] font-semibold text-stone-900 first:mt-0">{inline(line.replace(/^#+\s*/, ""))}</h3>);
    else if (line.trim()) out.push(<p key={out.length} className="mb-2">{inline(line)}</p>);
  }
  flush();
  return <div className="text-[13px] leading-relaxed text-stone-700">{out}</div>;
}
