import { useApp } from "../data/store";
import { useNav } from "../nav";
import { STAGES, STAGE_LABEL, WarmBadge } from "../components/badges";

export function PipelineScreen() {
  const { state } = useApp();
  const nav = useNav();
  return (
    <div>
      <p className="mb-2 text-[12px] text-stone-500">Found → Drafted → Sent → Followed up → Replied → Scheduled → Met → Thanked / Cold</p>
      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        <div className="flex gap-2">
          {STAGES.map((stage) => {
            const cs = state.contacts.filter((c) => c.stage === stage).sort((a, b) => b.relevance - a.relevance);
            return (
              <div key={stage} className="w-40 shrink-0 rounded-lg bg-stone-100 p-2">
                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  <span>{STAGE_LABEL[stage]}</span><span>{cs.length}</span>
                </div>
                <div className="space-y-1.5">
                  {cs.map((c) => (
                    <button key={c.id} onClick={() => nav.openContact(c.id)} className="block w-full rounded-md bg-white p-2 text-left ring-1 ring-stone-200 hover:ring-brand-500">
                      <div className="truncate text-[12px] font-medium">{c.name}</div>
                      <div className="truncate text-[11px] text-stone-500">{c.company}</div>
                      {c.warmPaths[0] && <div className="mt-1"><WarmBadge path={c.warmPaths[0]} /></div>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
