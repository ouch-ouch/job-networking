import { useState } from "react";
import type { Profile } from "../../shared/types";
import { useApp } from "../data/store";
import { useNav } from "../nav";
import { TemplateEditor } from "../components/TemplateEditor";
import { Badge, Button, Card, Field, Input, SectionTitle, TextArea } from "../components/ui";

const CHANNEL_LABEL = { email: "Email", linkedin_connect: "LinkedIn note", linkedin_message: "LinkedIn message" } as const;

function Connections() {
  // Real status comes from chrome.identity (B) and a LinkedIn cookie check; mocked locally for now.
  const [google, setGoogle] = useState(false);
  const [linkedin, setLinkedin] = useState(true);
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium">Google</div>
          <div className="text-[12px] text-stone-500">Gmail send + read, Calendar events</div>
        </div>
        {google ? <Badge tone="green">Connected</Badge> : <Button variant="primary" onClick={() => setGoogle(true)}>Connect</Button>}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-stone-100 pt-2">
        <div>
          <div className="font-medium">LinkedIn</div>
          <div className="text-[12px] text-stone-500">Log in in this browser. We fill messages; you click Send.</div>
        </div>
        {linkedin ? <Badge tone="green">Logged in</Badge> : <Button onClick={() => setLinkedin(true)}>Check again</Button>}
      </div>
    </Card>
  );
}

function ProfileForm() {
  const { state, actions } = useApp();
  const [p, setP] = useState<Profile>(state.profile);
  const dirty = JSON.stringify(p) !== JSON.stringify(state.profile);
  const set = (k: keyof Profile) => (e: { target: { value: string } }) => setP({ ...p, [k]: e.target.value });
  return (
    <Card className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name"><Input value={p.name} onChange={set("name")} /></Field>
        <Field label="School"><Input value={p.school} onChange={set("school")} /></Field>
        <Field label="Major"><Input value={p.major} onChange={set("major")} /></Field>
        <Field label="Year"><Input value={p.year} onChange={set("year")} placeholder="junior" /></Field>
      </div>
      <Field label="Background" hint="A resume summary. The AI only uses facts from here, so be specific.">
        <TextArea rows={4} value={p.background} onChange={set("background")} />
      </Field>
      <Field label="Availability" hint='e.g. "Weekdays 2–5pm ET" or a Calendly link'>
        <Input value={p.availability} onChange={set("availability")} />
      </Field>
      <Field label="Email signature"><TextArea rows={2} value={p.signature} onChange={set("signature")} /></Field>
      <div className="flex justify-end gap-2">
        {dirty && <Button variant="ghost" onClick={() => setP(state.profile)}>Discard</Button>}
        <Button variant="primary" disabled={!dirty} onClick={() => actions.saveProfile(p)}>Save profile</Button>
      </div>
    </Card>
  );
}

function Templates() {
  const { state, actions } = useApp();
  const [activeId, setActiveId] = useState(state.templates[0]?.id);
  const active = state.templates.find((t) => t.id === activeId) ?? state.templates[0];
  if (!active) return null;
  return (
    <Card>
      <div className="mb-3 flex gap-1 rounded-md bg-stone-100 p-0.5">
        {state.templates.map((t) => (
          <button key={t.id} onClick={() => setActiveId(t.id)}
            className={`flex-1 rounded px-2 py-1 text-[12px] font-medium ${t.id === active.id ? "bg-white shadow-sm" : "text-stone-600"}`}>
            {CHANNEL_LABEL[t.channel]}
          </button>
        ))}
      </div>
      <TemplateEditor key={active.id} template={active} onSave={actions.saveTemplate} />
    </Card>
  );
}

export function SetupScreen() {
  const { state, actions } = useApp();
  const nav = useNav();
  const approved = state.questions.filter((q) => q.status === "approved").length;
  return (
    <div>
      <SectionTitle>Connections</SectionTitle>
      <Connections />
      <SectionTitle>Your profile</SectionTitle>
      <ProfileForm />
      <SectionTitle>Your template</SectionTitle>
      <Templates />
      <SectionTitle>Question bank</SectionTitle>
      <Card className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-stone-600">{approved} approved questions for coffee chats</span>
        <Button onClick={() => nav.go("questions")}>Add questions</Button>
      </Card>
      <SectionTitle>Demo</SectionTitle>
      <Card className="space-y-2">
        <label className="flex items-center justify-between gap-2">
          <span>
            <span className="block font-medium">Demo mode</span>
            <span className="block text-[12px] text-stone-500">Follow-ups come due in minutes, not days.</span>
          </span>
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={state.settings.demoMode} onChange={(e) => actions.setDemoMode(e.target.checked)} />
        </label>
        <div className="flex justify-end border-t border-stone-100 pt-2">
          <Button variant="ghost" onClick={() => { if (confirm("Reset everything to the mock data?")) actions.resetMock(); }}>Reset mock data</Button>
        </div>
      </Card>
    </div>
  );
}
