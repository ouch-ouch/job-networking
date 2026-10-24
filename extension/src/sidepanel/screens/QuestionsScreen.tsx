import { useState } from "react";
import type { Question, QuestionCategory } from "../../shared/types";
import { useApp } from "../data/store";
import { Badge, Button, Card, Empty, Input, SectionTitle, TextArea } from "../components/ui";

const CATEGORIES: { id: QuestionCategory; label: string }[] = [
  { id: "role", label: "Role" },
  { id: "team", label: "Team" },
  { id: "career_path", label: "Career path" },
  { id: "culture", label: "Culture" },
  { id: "recruiting", label: "Recruiting" },
  { id: "advice", label: "Advice" },
];
const label = (c: QuestionCategory) => CATEGORIES.find((x) => x.id === c)!.label;

function CategorySelect({ value, onChange }: { value: QuestionCategory; onChange: (c: QuestionCategory) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as QuestionCategory)}
      className="rounded-md bg-white px-1.5 py-1 text-[12px] ring-1 ring-stone-300">
      {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  );
}

/** An AI suggestion: edit it if you like, then Add or Skip. */
function SuggestionCard({ q }: { q: Question }) {
  const { actions } = useApp();
  const [text, setText] = useState(q.text);
  const [category, setCategory] = useState(q.category);
  return (
    <Card className="space-y-2 ring-violet-200">
      <TextArea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex items-center justify-between gap-2">
        <CategorySelect value={category} onChange={setCategory} />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => actions.updateQuestion(q.id, { status: "skipped" })}>Skip</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={() => actions.updateQuestion(q.id, { status: "approved", text: text.trim(), category })}>Add</Button>
        </div>
      </div>
    </Card>
  );
}

function BankRow({ q }: { q: Question }) {
  const { actions } = useApp();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(q.text);
  if (editing) {
    return (
      <div className="flex gap-2 py-1.5">
        <Input value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <Button variant="primary" onClick={() => { actions.updateQuestion(q.id, { text: text.trim() }); setEditing(false); }}>Save</Button>
      </div>
    );
  }
  return (
    <div className="group flex items-start gap-2 py-1.5 text-[13px]">
      <span className="flex-1">{q.text}</span>
      {(q.landedWell ?? 0) > 0 && <Badge tone="green" title="Marked as landing well after a chat">★ {q.landedWell}</Badge>}
      {q.timesUsed > 0 && <span className="text-[11px] text-stone-400" title="Times picked for a prep brief">used {q.timesUsed}×</span>}
      <button className="text-[11px] text-stone-400 opacity-0 group-hover:opacity-100 hover:text-stone-700" onClick={() => { setText(q.text); setEditing(true); }}>edit</button>
      <button className="text-[11px] text-stone-400 opacity-0 group-hover:opacity-100 hover:text-red-600" onClick={() => actions.updateQuestion(q.id, { status: "skipped" })}>remove</button>
    </div>
  );
}

export function QuestionsScreen() {
  const { state, actions, busy } = useApp();
  const [text, setText] = useState("");
  const [category, setCategory] = useState<QuestionCategory>("role");
  const suggested = state.questions.filter((q) => q.status === "suggested");
  const approved = state.questions.filter((q) => q.status === "approved");

  return (
    <div>
      <SectionTitle action={<Button busy={busy.suggest} onClick={actions.suggestQuestions}>Suggest more</Button>}>
        Suggestions ({suggested.length})
      </SectionTitle>
      {suggested.length === 0
        ? <Empty>No suggestions waiting. The AI writes them from your profile, your targets, and who you're meeting.</Empty>
        : <div className="space-y-2">{suggested.map((q) => <SuggestionCard key={q.id} q={q} />)}</div>}

      <SectionTitle>Write your own</SectionTitle>
      <Card className="space-y-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="What do you want to ask?"
          onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { actions.addQuestion(text.trim(), category); setText(""); } }} />
        <div className="flex items-center justify-between">
          <CategorySelect value={category} onChange={setCategory} />
          <Button variant="primary" disabled={!text.trim()} onClick={() => { actions.addQuestion(text.trim(), category); setText(""); }}>Add to bank</Button>
        </div>
      </Card>

      <SectionTitle>Your bank ({approved.length})</SectionTitle>
      <p className="mb-2 text-[12px] text-stone-500">Prep briefs only pick from here, 5 per chat.</p>
      <div className="space-y-2">
        {CATEGORIES.map(({ id }) => {
          const qs = approved.filter((q) => q.category === id);
          if (!qs.length) return null;
          return (
            <Card key={id} className="py-2">
              <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">{label(id)}</div>
              <div className="divide-y divide-stone-100">{qs.map((q) => <BankRow key={q.id} q={q} />)}</div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
