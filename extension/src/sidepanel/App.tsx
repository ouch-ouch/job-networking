import { useMemo, useState } from "react";
import { useApp } from "./data/store";
import { NavContext, type Nav, type Tab } from "./nav";
import { ActivityScreen } from "./screens/ActivityScreen";
import { PipelineScreen } from "./screens/PipelineScreen";
import { QuestionsScreen } from "./screens/QuestionsScreen";
import { QueueScreen } from "./screens/QueueScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { TargetsScreen } from "./screens/TargetsScreen";
import { relTime } from "./components/ui";

const TABS: { id: Tab; label: string }[] = [
  { id: "targets", label: "Targets" },
  { id: "queue", label: "Queue" },
  { id: "questions", label: "Questions" },
  { id: "pipeline", label: "Pipeline" },
  { id: "activity", label: "Activity" },
  { id: "setup", label: "Setup" },
];

export function App() {
  const { state } = useApp();
  // `#queue` etc. opens a tab directly (handy for dev and screenshots).
  const [tab, setTab] = useState<Tab>(() => TABS.find((t) => `#${t.id}` === location.hash)?.id ?? "targets");
  const [focusedContactId, setFocused] = useState<string | null>(null);

  const nav = useMemo<Nav>(() => ({
    tab,
    go: (t) => { setFocused(null); setTab(t); },
    openContact: (id) => { setFocused(id); setTab("targets"); },
    focusedContactId,
  }), [tab, focusedContactId]);

  const pending = state.drafts.filter((d) => d.status === "pending" || (d.status === "approved" && d.channel !== "email")).length;
  const suggested = state.questions.filter((q) => q.status === "suggested").length;
  // "How did it go?" prompt: meetings that ended with no notes and no thank-you yet.
  const needsNotes = state.meetings.find((m) => {
    const c = state.contacts.find((x) => x.id === m.contactId);
    return new Date(m.end).getTime() < Date.now() && c && !c.notes && c.stage === "met"
      && !state.drafts.some((d) => d.contactId === c.id && d.kind === "thank_you");
  });
  const needsNotesContact = needsNotes && state.contacts.find((c) => c.id === needsNotes.contactId);
  const latest = [...state.activity].sort((a, b) => b.at - a.at)[0];

  return (
    <NavContext.Provider value={nav}>
      <div className="flex h-full flex-col">
        <header className="border-b border-stone-200 bg-white px-4 pb-0 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <h1 className="text-[15px] font-semibold text-brand-900">☕ Coffee Chat Copilot</h1>
            {state.settings.demoMode && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">Demo mode</span>}
          </div>
          <nav className="-mx-1 flex overflow-x-auto">
            {TABS.map((t) => {
              const count = t.id === "queue" ? pending : t.id === "questions" ? suggested : 0;
              return (
                <button key={t.id} onClick={() => nav.go(t.id)}
                  className={`relative whitespace-nowrap px-2 pb-2 pt-1 text-[13px] font-medium ${tab === t.id ? "text-brand-700" : "text-stone-500 hover:text-stone-800"}`}>
                  {t.label}
                  {count > 0 && <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-[10px] text-white">{count}</span>}
                  {tab === t.id && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-brand-600" />}
                </button>
              );
            })}
          </nav>
        </header>

        {needsNotesContact && (
          <button onClick={() => nav.openContact(needsNotesContact.id)}
            className="bg-amber-50 px-4 py-2 text-left text-[13px] text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100">
            ☕ How did it go with <b>{needsNotesContact.name}</b>? Add notes to draft a thank-you →
          </button>
        )}

        <main className="flex-1 overflow-y-auto px-4 py-3">
          {tab === "setup" && <SetupScreen />}
          {tab === "targets" && <TargetsScreen />}
          {tab === "queue" && <QueueScreen />}
          {tab === "questions" && <QuestionsScreen />}
          {tab === "pipeline" && <PipelineScreen />}
          {tab === "activity" && <ActivityScreen />}
        </main>

        {latest && tab !== "activity" && (
          <button onClick={() => nav.go("activity")}
            className="flex items-center gap-2 border-t border-stone-200 bg-white px-4 py-2 text-left text-[12px] text-stone-600 hover:bg-stone-50">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
            <span className="flex-1 truncate">{latest.summary}</span>
            <span className="text-stone-400">{relTime(latest.at)}</span>
          </button>
        )}
      </div>
    </NavContext.Provider>
  );
}
