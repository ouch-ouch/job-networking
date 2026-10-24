import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Coffee,
  AtSign,
  Copy,
  Presentation,
  ExternalLink,
  FileText,
  Inbox,
  Linkedin,
  ListFilter,
  LoaderCircle,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target as TargetIcon,
  Trash2,
  UsersRound,
  WandSparkles,
  X,
} from "lucide-react";
import type {
  Action,
  ActionResult,
  AppState,
  Contact,
  Draft,
  Meeting,
  DemoSceneId,
  PeopleSearchPlan,
  Profile,
  Question,
  QuestionCategory,
  Stage,
  Target,
} from "../shared/types";
import { useStore } from "../shared/useStore";
import { DEMO_SCENES, SAMPLE_JOB_POSTING } from "../shared/demoScenes";
import { TemplateEditor, TemplatePreview } from "./TemplateEditor";
import {
  buildLinkedInSearchQuery,
  buildLinkedInSearchUrl,
  buildWebSearchUrl,
} from "../content/sourcing";
import { grabJobPage } from "../content";

const DialogErrorContext = createContext<string | null>(null);

type Page =
  | "network"
  | "approvals"
  | "chats"
  | "questions"
  | "activity"
  | "template"
  | "settings";
type Modal = "target" | "contact" | "source" | null;
const stageLabels: Record<Stage, string> = {
  found: "Found",
  drafted: "Draft ready",
  sent: "Sent",
  followed_up: "Followed up",
  replied: "Replied",
  scheduled: "Scheduled",
  met: "Met",
  thanked: "Thanked",
  cold: "Cold",
};
const categoryLabels: Record<QuestionCategory, string> = {
  role: "The role",
  team: "The team",
  career_path: "Career path",
  culture: "Culture",
  recruiting: "Recruiting",
  advice: "Advice",
};
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const ago = (timestamp: number) => {
  const mins = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  return mins < 1
    ? "Just now"
    : mins < 60
      ? `${mins}m ago`
      : mins < 1440
        ? `${Math.floor(mins / 60)}h ago`
        : `${Math.floor(mins / 1440)}d ago`;
};
const cleanLink = (url?: string) => {
  try {
    if (url && new URL(url).protocol === "https:") return url;
  } catch {
    /* no unsafe link */
  }
  return undefined;
};

function Avatar({
  name,
  small = false,
  index = 0,
}: {
  name: string;
  small?: boolean;
  index?: number;
}) {
  return (
    <span className={`avatar ${small ? "small" : ""} avatar-${index % 5}`}>
      {initials(name)}
    </span>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Dialog({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dialogError = useContext(DialogErrorContext);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll<HTMLElement>(
          "button, input, textarea, select, a[href]",
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`dialog ${wide ? "dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="dialog-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        {dialogError && (
          <div className="dialog-error" role="alert">
            {dialogError}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const { state, loading, dispatch, error, clearError } = useStore();
  const [page, setPage] = useState<Page>("network");
  const [modal, setModal] = useState<Modal>(null);
  const [targetId, setTargetId] = useState("all");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const openChat = (meetingId: string) => {
    setChatId(meetingId);
    setPage("chats");
  };
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [queueTab, setQueueTab] = useState("pending");
  const [presenter, setPresenter] = useState(false);
  /** Load a presentation scene and jump to the screen it's about. */
  async function loadScene(scene: DemoSceneId) {
    const result = await run({ type: "LOAD_DEMO_SCENE", scene });
    if (!result) return;
    setModal(null);
    setSelected(null);
    setTargetId("all");
    setFilter("all");
    setSearch("");
    if (scene === "reply") {
      setQueueTab("pending");
      setPage("approvals");
    } else if (scene === "chat") {
      const meeting = result.state.meetings.find((m) => m.contactId === "demo_maya");
      if (meeting) openChat(meeting.id);
      else setPage("chats");
    } else if (scene === "after") {
      setPage("network");
      setSelected("demo_maya");
    } else setPage("network");
  }
  // Alt+1..5 jump to a scene, Alt+0 shows or hides the presenter panel (demo mode only).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!state?.settings.demoMode || !e.altKey) return;
      const digit = /^Digit(\d)$/.exec(e.code)?.[1];
      if (digit === undefined) return;
      e.preventDefault();
      if (digit === "0") setPresenter((v) => !v);
      else if (DEMO_SCENES[Number(digit) - 1]) void loadScene(DEMO_SCENES[Number(digit) - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (toast) {
      const timeout = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timeout);
    }
  }, [toast]);
  async function run(
    action: Action,
    message?: string,
  ): Promise<ActionResult | undefined> {
    setBusy(true);
    clearError();
    try {
      const result = await dispatch(action);
      if (result.state.drafts.some((d) => d.status === "failed" && d.error))
        setToast(
          result.message ||
            "Send failed. Review the error before trying again.",
        );
      else if (message || result.message)
        setToast(result.message || message || "Saved");
      return result;
    } catch (e) {
      setToast("");
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  const pending =
    state?.drafts.filter(
      (d) =>
        d.status === "pending" ||
        d.status === "approved" ||
        d.status === "failed" ||
        d.status === "sending",
    ) || [];
  const currentTarget =
    state?.targets.find((t) => t.id === targetId) || state?.targets[0];
  const contact = state?.contacts.find((c) => c.id === selected);
  useEffect(() => {
    if (
      state &&
      targetId !== "all" &&
      !state.targets.some((t) => t.id === targetId)
    )
      setTargetId("all");
  }, [state?.targets, targetId]);
  const contacts = useMemo(
    () =>
      (state?.contacts || [])
        .filter(
          (c) =>
            (targetId === "all" || c.targetId === targetId) &&
            (filter === "all" || c.stage === filter) &&
            `${c.name} ${c.title} ${c.company} ${c.reason}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) => b.relevance - a.relevance),
    [state?.contacts, targetId, filter, search],
  );
  if (loading || !state)
    return (
      <div className="loading-screen">
        <Coffee size={36} />
        <h2>
          {error ? "Could not load your data." : "Loading…"}
        </h2>
        {error && (
          <>
            <p>{error}</p>
            <button
              className="button outline"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </>
        )}
        <LoaderCircle className="spin" size={20} />
      </div>
    );
  const s = state;
  const sent = s.contacts.filter(
    (c) => !["found", "drafted"].includes(c.stage),
  ).length;
  const conversations = s.contacts.filter((c) =>
    ["replied", "scheduled", "met", "thanked"].includes(c.stage),
  ).length;
  const upcoming = s.meetings.filter(
    (m) => new Date(m.end).getTime() > Date.now() && s.contacts.some(c => c.id === m.contactId && c.stage === "scheduled"),
  ).length;
  const navItems: {
    id: Page;
    label: string;
    icon: ReactNode;
    count?: number;
  }[] = [
    { id: "network", label: "My network", icon: <UsersRound size={19} /> },
    {
      id: "approvals",
      label: "Message approval queue",
      icon: <Inbox size={19} />,
      count: pending.length,
    },
    {
      id: "chats",
      label: "Coffee chats",
      icon: <CalendarDays size={19} />,
      count: upcomingChats(s).length,
    },
    { id: "questions", label: "Question bank", icon: <BookOpen size={19} /> },
    { id: "activity", label: "Activity", icon: <Clock3 size={19} /> },
  ];
  const labels: Record<Page, string> = {
    network: "My network",
    approvals: "Message approval queue",
    chats: "Coffee chats",
    questions: "Question bank",
    activity: "Activity",
    template: "Your template",
    settings: "Settings & profile",
  };
  return (
    <DialogErrorContext.Provider value={error}>
      <div className="app-shell">
        <aside className="sidebar">
          <a
            className="brand"
            aria-label="Coffee Chat home"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setPage("network");
            }}
          >
            <span className="brand-mark">
              <Coffee size={23} strokeWidth={1.7} />
            </span>
            <span>
              coffeechat<span className="brand-period">.</span>
              <small>YOUR NETWORKING COPILOT</small>
            </span>
          </a>
          <nav aria-label="Main navigation">
            {navItems.map((n) => (
              <button
                key={n.id}
                aria-label={n.label}
                title={n.label}
                className={`nav-item ${page === n.id ? "active" : ""}`}
                onClick={() => setPage(n.id)}
              >
                {n.icon}
                <span>{n.label}</span>
                {n.count ? <span className="nav-count">{n.count}</span> : null}
              </button>
            ))}
          </nav>
          <div className="sidebar-section-label">MAKE IT YOURS</div>
          <button
            aria-label="Message template"
            title="Message template"
            className={`nav-item ${page === "template" ? "active" : ""}`}
            onClick={() => setPage("template")}
          >
            <FileText size={19} />
            <span>Message template</span>
          </button>
          <button
            aria-label="Settings and profile"
            title="Settings and profile"
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => setPage("settings")}
          >
            <Settings2 size={19} />
            <span>Settings & profile</span>
          </button>
          <div className="sidebar-bottom">
            <div className="human-card">
              <span className="human-icon">
                <ShieldCheck size={19} />
              </span>
              <strong>Nothing sends without you.</strong>
              <p>Every message waits for your approval before it goes out.</p>
            </div>
            <button
              className="profile-chip"
              onClick={() => setPage("settings")}
            >
              <Avatar name={s.profile.name || "Your profile"} small />
              <span>
                <strong>{s.profile.name || "Set up your profile"}</strong>
                <small>{s.profile.school || "Add your school"}</small>
              </span>
              <MoreHorizontal size={18} />
            </button>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <strong>{labels[page]}</strong>
            </div>
            <div className="topbar-right">
              <span
                className={`mode-indicator ${s.settings.demoMode ? "demo" : ""}`}
              >
                <span />
                {s.settings.demoMode ? "Demo mode" : "Live"}
              </span>
              <button
                className="icon-button notifications"
                title="View activity"
                aria-label="View activity"
                onClick={() => setPage("activity")}
              >
                <Bell size={18} />
                {pending.length > 0 && <i />}
              </button>
              <span className="topbar-divider" />
              <Avatar name={s.profile.name || "You"} small />
            </div>
          </header>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={clearError}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {s.settings.demoMode && (
            <div className="demo-strip">
              <Sparkles size={13} />
              <span>
                Demo mode · Fictional contacts and simulated sends. Your changes
                are saved locally.
              </span>
              <button onClick={() => setPresenter((v) => !v)}>
                {presenter ? "Hide presenter" : "Presenter"} <Presentation size={12} />
              </button>
              <button onClick={() => setPage("settings")}>
                Set up live integrations <ArrowUpRight size={12} />
              </button>
            </div>
          )}
          <main className="main-content">
            {page === "network" && (
              <>
                <div className="page-heading">
                  <div className="heading-line">
                    <div>
                      <h1>Start a conversation.</h1>
                      <p>
                        Add a job you’re applying to, find people who work
                        there, and send messages you’ve approved.
                      </p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => setModal("target")}
                    >
                      <Plus size={17} /> Add a target
                    </button>
                  </div>
                </div>
                <div className="stats-grid">
                  <Stat
                    label="People"
                    value={s.contacts.length}
                    detail={`${s.contacts.filter((c) => c.warmPaths.length).length} with a warm connection`}
                    icon={<UsersRound size={19} />}
                  />
                  <Stat
                    label="Outreach sent"
                    value={sent}
                    detail="Messages you’ve sent"
                    icon={<Send size={18} />}
                  />
                  <Stat
                    label="Conversations"
                    value={conversations}
                    detail={`${upcoming} coffee chat${upcoming === 1 ? "" : "s"} on the calendar`}
                    icon={<MessageSquare size={19} />}
                  />
                </div>
                <div className="network-layout">
                  <section className="panel people-panel">
                    <div className="section-heading">
                      <div>
                        <h2>
                          Your people <span>{contacts.length}</span>
                        </h2>
                        <p>Closest connections first.</p>
                      </div>
                      <button
                        className="button subtle compact"
                        onClick={() => setModal("contact")}
                      >
                        <Plus size={15} />
                        Add person
                      </button>
                    </div>
                    <div className="target-select-row">
                      <TargetIcon size={16} />
                      <select
                        aria-label="Filter by target job"
                        value={targetId}
                        onChange={(e) => setTargetId(e.target.value)}
                      >
                        <option value="all">All opportunities</option>
                        {s.targets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.company} · {t.role}
                          </option>
                        ))}
                      </select>
                      <button
                        className="text-button"
                        onClick={() =>
                          setModal(s.targets.length ? "source" : "target")
                        }
                      >
                        Find people <ArrowUpRight size={13} />
                      </button>
                    </div>
                    <div className="table-tools">
                      <label className="search-input">
                        <Search size={16} />
                        <input
                          placeholder="Search your network"
                          aria-label="Search your network"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                          <button
                            aria-label="Clear search"
                            onClick={() => setSearch("")}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </label>
                      <label className="filter-select">
                        <ListFilter size={15} />
                        <select
                          aria-label="Filter contacts by stage"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">All stages</option>
                          {Object.entries(stageLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="contacts-table">
                      <div className="table-head">
                        <span>PERSON</span>
                        <span>CONNECTION</span>
                        <span>STATUS</span>
                        <span />
                      </div>
                      {contacts.length === 0 ? (
                        <Empty
                          icon={<UsersRound size={28} />}
                          title="A new connection is waiting"
                        >
                          {search || filter !== "all"
                            ? "Try another search or stage."
                            : "Add a target, then find people on LinkedIn or add your own contact."}
                        </Empty>
                      ) : (
                        contacts.map((c, i) => (
                          <div className="contact-row" key={c.id}>
                            <button
                              className="person-cell"
                              onClick={() => setSelected(c.id)}
                            >
                              <Avatar name={c.name} index={i} />
                              <span>
                                <strong>{c.name}</strong>
                                <small>{c.title}</small>
                                <span className="company-line">
                                  {c.company} <span>·</span>{" "}
                                  {c.connectionDegree
                                    ? `${c.connectionDegree}${c.connectionDegree === 1 ? "st" : c.connectionDegree === 2 ? "nd" : "rd"}`
                                    : "New connection"}
                                </span>
                              </span>
                            </button>
                            <button
                              className="connection-cell"
                              onClick={() => setSelected(c.id)}
                            >
                              {c.warmPaths[0] ? (
                                <>
                                  <span className="warm-tag">
                                    <span className="warm-dot" />
                                    {c.warmPaths[0].type === "alumni"
                                      ? `${s.profile.school || "School"} alum`
                                      : c.warmPaths[0].type ===
                                          "mutual_connection"
                                        ? "2nd connection"
                                        : "Shared background"}
                                  </span>
                                  <small>{c.reason}</small>
                                </>
                              ) : (
                                <>
                                  <span className="relevance-tag">
                                    {c.relevance}% match
                                  </span>
                                  <small>
                                    {c.reason || "Relevant to your target"}
                                  </small>
                                </>
                              )}
                            </button>
                            <div className="status-cell">
                              <Badge
                                tone={
                                  ["replied", "scheduled", "thanked"].includes(
                                    c.stage,
                                  )
                                    ? "green"
                                    : c.stage === "drafted"
                                      ? "amber"
                                      : "neutral"
                                }
                              >
                                <span className="status-dot" />
                                {stageLabels[c.stage]}
                              </Badge>
                            </div>
                            <button
                              className="row-action"
                              title={
                                c.stage === "found"
                                  ? "Draft outreach"
                                  : "View contact"
                              }
                              aria-label={`${c.stage === "found" ? "Draft outreach for" : "View"} ${c.name}`}
                              disabled={busy}
                              onClick={() =>
                                c.stage === "found"
                                  ? void run(
                                      {
                                        type: "GENERATE_DRAFTS",
                                        contactIds: [c.id],
                                      },
                                      "Draft added to your message approval queue",
                                    )
                                  : setSelected(c.id)
                              }
                            >
                              {c.stage === "found" ? (
                                <WandSparkles size={17} />
                              ) : (
                                <ChevronRight size={17} />
                              )}
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="table-footer">
                      <span>
                        <ShieldCheck size={13} /> Warm connections come first.
                      </span>
                      <button
                        className="text-button"
                        disabled={
                          busy || !contacts.some((c) => c.stage === "found")
                        }
                        onClick={() =>
                          void run(
                            {
                              type: "GENERATE_DRAFTS",
                              contactIds: contacts
                                .filter((c) => c.stage === "found")
                                .map((c) => c.id),
                            },
                            "Personalized drafts are ready to review",
                          )
                        }
                      >
                        Draft outreach <ArrowRight size={14} />
                      </button>
                    </div>
                  </section>
                  <aside className="right-column">
                    <section className="panel queue-preview">
                      <div className="section-heading">
                        <div className="icon-title">
                          <span className="mini-icon">
                            <Inbox size={18} />
                          </span>
                          <h2>Waiting for approval</h2>
                        </div>
                        <Badge tone="amber">{pending.length}</Badge>
                      </div>
                      <p className="section-intro">
                        Drafts to review. Nothing sends until you approve it.
                      </p>
                      {pending.slice(0, 2).map((d) => {
                        const c = s.contacts.find((c) => c.id === d.contactId);
                        return (
                          <button
                            className="draft-preview"
                            key={d.id}
                            onClick={() => {
                              setPage("approvals");
                              setQueueTab("pending");
                            }}
                          >
                            <div className="preview-person">
                              <Avatar name={c?.name || "Contact"} small />
                              <div>
                                <strong>{c?.name}</strong>
                                <small>
                                  {d.kind === "follow_up"
                                    ? "Follow-up"
                                    : d.channel === "email"
                                      ? "Email outreach"
                                      : "LinkedIn note"}{" "}
                                  <span>·</span> {c?.company}
                                </small>
                              </div>
                              <span className="preview-indicator" />
                            </div>
                            <h4>{d.subject || "A quick hello"}</h4>
                            <p>{d.body}</p>
                            <span className="preview-review">
                              Review draft <ArrowUpRight size={13} />
                            </span>
                          </button>
                        );
                      })}
                      {pending.length === 0 && (
                        <div className="queue-clear">
                          <CheckCircle2 size={25} />
                          <strong>You’re all caught up.</strong>
                          <p>Draft a hello to get a conversation started.</p>
                        </div>
                      )}
                      <button
                        className="button outline full"
                        onClick={() => {
                          setPage("approvals");
                          setQueueTab("pending");
                        }}
                      >
                        Open message approval queue <ArrowRight size={15} />
                      </button>
                      <div className="approval-note">
                        <ShieldCheck size={12} /> Nothing sends until you say
                        so.
                      </div>
                    </section>
                    <section className="tip-card">
                      <span className="tip-icon">
                        <Coffee size={21} />
                      </span>
                      <div className="eyebrow">TIP</div>
                      <h3>
                        Bring a few good questions.
                      </h3>
                      <p>
                        Coffee chats go better as conversations than
                        interviews. Save questions in your question bank.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setPage("questions")}
                      >
                        Build your question bank <ArrowUpRight size={14} />
                      </button>
                      <span className="tip-decoration" aria-hidden="true">
                        ✳
                      </span>
                    </section>
                  </aside>
                </div>
                <section className="recent-activity">
                  <div className="section-heading">
                    <h2>A little momentum</h2>
                    <button
                      className="text-button"
                      onClick={() => setPage("activity")}
                    >
                      All activity <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="momentum-grid">
                    {[...s.activities]
                      .sort((a, b) => b.at - a.at)
                      .slice(0, 3)
                      .map((event) => (
                        <div className="momentum-item" key={event.id}>
                          <span
                            className={`event-icon ${event.type === "sent" ? "green-icon" : ""}`}
                          >
                            {event.type === "sent" ? (
                              <ArrowUpRight size={16} />
                            ) : event.type === "meeting_scheduled" ? (
                              <CalendarDays size={16} />
                            ) : (
                              <Sparkles size={16} />
                            )}
                          </span>
                          <div>
                            <p>{event.summary}</p>
                            <small>{ago(event.at)}</small>
                          </div>
                        </div>
                      ))}
                    {!s.activities.length && (
                      <p className="muted">
                        Your first step will show up here.
                      </p>
                    )}
                  </div>
                </section>
              </>
            )}
            {page === "approvals" && (
              <>
                <PageHeading
                  eyebrow="REVIEW BEFORE SENDING"
                  title="Message approval queue"
                  description="Edit, approve, or skip each draft. Nothing is sent until you approve it."
                />
                <div className="queue-toolbar">
                  <div className="tabs">
                    <button
                      className={queueTab === "pending" ? "active" : ""}
                      onClick={() => setQueueTab("pending")}
                    >
                      To review <span>{pending.length}</span>
                    </button>
                    <button
                      className={queueTab === "sent" ? "active" : ""}
                      onClick={() => setQueueTab("sent")}
                    >
                      Sent{" "}
                      <span>
                        {s.drafts.filter((d) => d.status === "sent").length}
                      </span>
                    </button>
                    <button
                      className={queueTab === "rejected" ? "active" : ""}
                      onClick={() => setQueueTab("rejected")}
                    >
                      Skipped
                    </button>
                  </div>
                  <div className="quiet-note">
                    <ShieldCheck size={14} /> You approve. Then you send.
                  </div>
                </div>
                <div className="drafts-grid">
                  {s.drafts
                    .filter((d) =>
                      queueTab === "pending"
                        ? ["pending", "approved", "failed", "sending"].includes(
                            d.status,
                          )
                        : d.status === queueTab,
                    )
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((d) => (
                      <DraftCard
                        key={d.id + d.createdAt}
                        draft={d}
                        contact={s.contacts.find((c) => c.id === d.contactId)}
                        busy={busy}
                        run={run}
                        onContact={setSelected}
                        demo={s.settings.demoMode}
                      />
                    ))}
                </div>
                {(queueTab === "pending"
                  ? pending
                  : s.drafts.filter((d) => d.status === queueTab)
                ).length === 0 && (
                  <div className="panel">
                    <Empty
                      icon={<Inbox size={32} />}
                      title={
                        queueTab === "pending"
                          ? "A clear queue. A fresh start."
                          : "Nothing here yet."
                      }
                    >
                      Draft outreach from your network to start a conversation.
                    </Empty>
                    <div className="empty-button">
                      <button
                        className="button primary"
                        onClick={() => setPage("network")}
                      >
                        Go to my network <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            {page === "chats" && (
              <ChatsPage
                state={s}
                run={run}
                busy={busy}
                chatId={chatId}
                onChat={setChatId}
                onContact={setSelected}
              />
            )}
            {page === "questions" && (
              <QuestionsPage state={s} run={run} busy={busy} onOpenChat={openChat} />
            )}
            {page === "activity" && (
              <>
                <div className="heading-line">
                  <PageHeading
                    eyebrow="HISTORY"
                    title="Activity"
                    description="Everything that's happened: messages sent, replies, and coffee chats."
                  />
                  <button
                    className="button outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        { type: "POLL_REPLIES" },
                        s.settings.demoMode
                          ? "Demo inbox checked. Use a contact’s reply simulator to continue."
                          : "Inbox checked",
                      )
                    }
                  >
                    <RefreshCw size={15} />
                    Check replies
                  </button>
                </div>
                {s.settings.demoMode && (
                  <div className="demo-lab">
                    <Clock3 size={20} />
                    <div>
                      <strong>Try the follow-up loop</strong>
                      <p>
                        Move the demo clock forward 8 days. Due follow-ups
                        arrive in your queue for approval.
                      </p>
                    </div>
                    <button
                      className="button outline compact"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          {
                            type: "RUN_SCHEDULER",
                            now: Date.now() + 8 * 86400000,
                          },
                          "Demo clock advanced. Check your message approval queue.",
                        )
                      }
                    >
                      Advance demo clock <ArrowRight size={14} />
                    </button>
                  </div>
                )}
                <div className="activity-layout">
                  <section className="panel timeline-panel">
                    <h2>The latest</h2>
                    <div className="timeline">
                      {[...s.activities]
                        .sort((a, b) => b.at - a.at)
                        .map((e) => {
                          const c = s.contacts.find(
                            (c) => c.id === e.contactId,
                          );
                          return (
                            <div className="timeline-event" key={e.id}>
                              <span
                                className={`timeline-symbol event-${e.type}`}
                              >
                                {e.type === "sent" ? (
                                  <Send size={16} />
                                ) : e.type === "reply_received" ? (
                                  <ArrowDownLeft size={16} />
                                ) : e.type === "meeting_scheduled" ? (
                                  <CalendarDays size={16} />
                                ) : e.type === "approved" ? (
                                  <Check size={16} />
                                ) : (
                                  <Sparkles size={16} />
                                )}
                              </span>
                              <div>
                                <strong>{e.summary}</strong>
                                {c && (
                                  <button onClick={() => setSelected(c.id)}>
                                    {c.name} <ArrowUpRight size={11} />
                                  </button>
                                )}
                                <small>
                                  {new Date(e.at).toLocaleString([], {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                </small>
                              </div>
                            </div>
                          );
                        })}
                      {!s.activities.length && (
                        <Empty
                          icon={<Clock3 size={28} />}
                          title="It starts with one hello."
                        >
                          Your networking activity will appear here.
                        </Empty>
                      )}
                    </div>
                  </section>
                  <section className="panel meetings-panel">
                    <h2>
                      <CalendarDays size={18} /> On the calendar
                    </h2>
                    {s.meetings.map((m) => {
                      const c = s.contacts.find((c) => c.id === m.contactId);
                      return (
                        <button
                          className="meeting-card"
                          key={m.id}
                          onClick={() => openChat(m.id)}
                        >
                          <div className="meeting-date">
                            <strong>{new Date(m.start).getDate()}</strong>
                            <span>
                              {new Date(m.start).toLocaleString([], {
                                month: "short",
                              })}
                            </span>
                          </div>
                          <div>
                            <strong>{c?.name || "Coffee chat"}</strong>
                            <small>
                              {new Date(m.start).toLocaleTimeString([], {
                                hour: "numeric",
                                minute: "2-digit",
                              })}{" "}
                              · 15 min
                            </small>
                            <span>
                              {m.prepBrief
                                ? "Prep brief ready"
                                : "Prepare for your chat"}{" "}
                              <ChevronRight size={12} />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                    {!s.meetings.length && (
                      <p className="muted">
                        Your next coffee chat will appear here. Schedule one
                        from a contact’s profile.
                      </p>
                    )}
                  </section>
                </div>
              </>
            )}
            {page === "template" && (
              <TemplatePage state={s} run={run} busy={busy} />
            )}
            {page === "settings" && (
              <SettingsPage state={s} run={run} busy={busy} />
            )}
            <footer className="app-footer">
              <span>
                <Coffee size={13} /> A small hello can change a lot.
              </span>
              <span>Made for meaningful connections.</span>
            </footer>
          </main>
        </div>
        {presenter && s.settings.demoMode && (
          <aside className="presenter-panel" aria-label="Presenter controls">
            <div className="presenter-top">
              <strong>
                <Presentation size={15} /> Presenter
              </strong>
              <button
                className="icon-button"
                aria-label="Hide presenter controls"
                onClick={() => setPresenter(false)}
              >
                <X size={14} />
              </button>
            </div>
            <ol className="presenter-scenes">
              {DEMO_SCENES.map((scene, i) => (
                <li key={scene.id}>
                  <button disabled={busy} onClick={() => void loadScene(scene.id)}>
                    <span className="presenter-num">{i + 1}</span>
                    <span>
                      <strong>{scene.title}</strong>
                      <small>{scene.shows}</small>
                    </span>
                    <kbd>Alt+{i + 1}</kbd>
                  </button>
                </li>
              ))}
            </ol>
            <button
              className="button outline compact full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(SAMPLE_JOB_POSTING);
                  setToast("Sample job posting copied. Paste it into Add a target.");
                } catch {
                  setToast("Could not copy. The posting is in docs/DEMO-SCRIPT.md.");
                }
              }}
            >
              <Copy size={14} /> Copy sample job posting
            </button>
            <p className="presenter-note">
              Everyone here is fictional and nothing is really sent. Alt+0 hides this panel.
            </p>
          </aside>
        )}
        {toast && (
          <div className="toast" role="status">
            <CheckCircle2 size={17} />
            {toast}
            <button
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {busy && (
          <div className="working-pill" role="status">
            <LoaderCircle size={14} className="spin" /> Working on it…
          </div>
        )}
        {modal === "target" && (
          <TargetDialog
            onClose={() => setModal(null)}
            busy={busy}
            run={run}
            onAdded={(id) => {
              setTargetId(id);
              setModal(null);
            }}
          />
        )}
        {modal === "contact" && (
          <ContactDialog
            targets={s.targets}
            targetId={currentTarget?.id}
            onClose={() => setModal(null)}
            busy={busy}
            run={run}
          />
        )}
        {modal === "source" && (
          <PeopleSearchDialog
            key={currentTarget?.id || "no-target"}
            state={s}
            target={currentTarget}
            onTargetChange={setTargetId}
            busy={busy}
            run={run}
            onClose={() => setModal(null)}
            onAddManually={() => setModal("contact")}
          />
        )}
        {contact && (
          <ContactDetail
            contact={contact}
            state={s}
            onClose={() => setSelected(null)}
            busy={busy}
            run={run}
            onQueue={() => {
              setSelected(null);
              setPage("approvals");
              setQueueTab("pending");
            }}
          />
        )}
      </div>
    </DialogErrorContext.Provider>
  );
}

type Runner = (
  action: Action,
  message?: string,
) => Promise<ActionResult | undefined>;

function PeopleSearchDialog({
  state,
  target,
  onTargetChange,
  busy,
  run,
  onClose,
  onAddManually,
}: {
  state: AppState;
  target?: Target;
  onTargetChange: (id: string) => void;
  busy: boolean;
  run: Runner;
  onClose: () => void;
  onAddManually: () => void;
}) {
  const [keywords, setKeywords] = useState(() =>
    target ? buildLinkedInSearchQuery(target, state.profile) : "",
  );
  const [plan, setPlan] = useState<PeopleSearchPlan | null>(null);
  const searchUrl =
    target && keywords.trim()
      ? buildLinkedInSearchUrl(target, state.profile, { keywords })
      : undefined;
  return (
    <Dialog
      title="Find a shared path."
      subtitle="Let Grok turn your job and profile into searches across the web."
      onClose={onClose}
    >
      <div className="dialog-body">
        <label className="field">
          Target opportunity
          <select
            value={target?.id || ""}
            onChange={(e) => onTargetChange(e.target.value)}
          >
            {state.targets.map((item) => (
              <option value={item.id} key={item.id}>
                {item.company} · {item.role}
              </option>
            ))}
          </select>
        </label>
        <div className="callout search-context">
          <AtSign size={20} />
          <p>
            <strong>Find people on X.</strong> Grok searches X for up to three
            people tied to this job and shows the real post that makes each one
            relevant. Live research takes 1 to 3 minutes.
          </p>
        </div>
        <button
          className="button primary full"
          disabled={busy || !target}
          onClick={async () => {
            if (!target) return;
            const result = await run({ type: "FIND_ON_X", targetId: target.id });
            if (result) onClose();
          }}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <AtSign size={16} />}
          {busy ? "Researching on X…" : "Find people on X"}
        </button>
        <div className="callout search-context">
          <Sparkles size={20} />
          <p>
            Or search the web and LinkedIn: Grok uses this job’s full
            description, role, team and company, together with your saved
            profile.
          </p>
        </div>
        <button
          className="button primary full"
          disabled={busy || !target}
          onClick={async () => {
            if (!target) return;
            const result = await run({
              type: "GENERATE_SEARCH_PLAN",
              targetId: target.id,
            });
            if (result?.data) setPlan(result.data as PeopleSearchPlan);
          }}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
          {busy ? "Creating searches…" : plan ? "Regenerate smart searches" : "Create smart searches"}
        </button>
        {!state.profile.school.trim() && !state.profile.background.trim() && (
          <p className="field-help">
            Add your school and experience in Settings for more personal search
            ideas.
          </p>
        )}
        {plan && (
          <div className="people-search-plan" aria-live="polite">
            <details className="search-strategy">
              <summary>How these searches were chosen</summary>
              <p className="search-plan-summary">{plan.summary}</p>
            </details>
            {plan.queries.map((item, index) => (
              <article className="people-search-card" key={index}>
                <div className="search-card-heading">
                  <strong>{item.label}</strong>
                  <Badge>{({
                    alumni: "Alumni",
                    shared_background: "Similar background",
                    team: "Target team",
                    recruiting: "Recruiting",
                    company: "Company",
                  } as const)[item.connectionType]}</Badge>
                </div>
                <p>{item.rationale}</p>
                <label className="field">
                  Search keywords
                  <textarea
                    aria-label={`Search keywords for ${item.label}`}
                    rows={2}
                    maxLength={500}
                    value={item.query}
                    onChange={(e) => {
                      const query = e.target.value;
                      setPlan((previous) => previous && ({
                        ...previous,
                        queries: previous.queries.map((value, position) =>
                          position === index ? { ...value, query } : value,
                        ),
                      }));
                    }}
                  />
                </label>
                <div className="people-search-presets">
                  {item.query.trim() ? (
                    <>
                      <a
                        className="button outline compact"
                        aria-label={`Search ${item.label} on Google`}
                        href={buildWebSearchUrl(item.query)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Search Google <ExternalLink size={13} />
                      </a>
                      <a
                        className="button subtle compact"
                        aria-label={`Search ${item.label} on Bing`}
                        href={buildWebSearchUrl(item.query, "bing")}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Search Bing <ExternalLink size={13} />
                      </a>
                    </>
                  ) : (
                    <span className="field-help">Enter keywords to open this search.</span>
                  )}
                </div>
              </article>
            ))}
            <p className="field-help">
              Review the results and check the person’s actual experience and
              shared connection before adding them. Use Add manually for people
              found on the web, or import an open LinkedIn results page.
            </p>
          </div>
        )}
        <details className="manual-people-search">
          <summary>Search LinkedIn manually</summary>
        <label className="field">
          LinkedIn search keywords
          <input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="Enter the company’s LinkedIn name"
          />
        </label>
        <div className="people-search-presets" aria-label="Search options">
          {([
            ["company", "Company only"],
            ["role", "Company + role"],
            ["alumni", "Company + school"],
          ] as const).map(([scope, label]) => {
            const query = target
              ? buildLinkedInSearchQuery(target, state.profile, scope)
              : "";
            return (
              <button
                key={scope}
                className="button outline compact"
                disabled={!query}
                aria-pressed={Boolean(query && keywords === query)}
                onClick={() => setKeywords(query)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="field-help">
          No results? Choose Company only or edit the keywords to match the
          company’s LinkedIn name. Your school is optional; shared connections
          are ranked after import.
        </p>
        {searchUrl ? (
          <a
            className="button outline full"
            href={searchUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open LinkedIn search <ExternalLink size={15} />
          </a>
        ) : (
          <button className="button outline full" disabled>
            Enter search keywords first
          </button>
        )}
        <div className="callout">
          <Linkedin size={20} />
          <p>
            Review the LinkedIn results, then use this extension’s side panel
            on that tab to import up to 20 visible people. Use LinkedIn’s
            Current companies filter to narrow to employees.
          </p>
        </div>
        </details>
      </div>
      <div className="dialog-footer">
        <button className="button subtle" onClick={onAddManually}>
          Add manually
        </button>
        <button
          className="button primary"
          disabled={busy || !target}
          onClick={async () => {
            if (!target) return;
            const result = await run({ type: "SCRAPE_SEARCH", targetId: target.id });
            if (result) onClose();
          }}
        >
          Import LinkedIn results <ArrowDownLeft size={16} />
        </button>
      </div>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">
        {label}
        <span>{icon}</span>
      </div>
      <strong>{String(value).padStart(2, "0")}</strong>
      <p>{detail}</p>
      <span className="stat-line" />
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading secondary-heading">
      <div className="eyebrow">
        <span />
        {eyebrow}
      </div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}

function DraftCard({
  draft: d,
  contact: c,
  busy,
  run,
  onContact,
  demo,
}: {
  draft: Draft;
  contact?: Contact;
  busy: boolean;
  run: Runner;
  onContact: (id: string) => void;
  demo: boolean;
}) {
  const [body, setBody] = useState(d.body),
    [subject, setSubject] = useState(d.subject || ""),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  useEffect(() => {
    setBody(d.body);
    setSubject(d.subject || "");
  }, [d.body, d.subject]);
  const dirty = body !== d.body || subject !== (d.subject || "");
  const editable = !["sent", "rejected", "sending"].includes(d.status);
  return (
    <article className="panel draft-card">
      <div className="draft-card-top">
        <button className="preview-person" onClick={() => c && onContact(c.id)}>
          <Avatar name={c?.name || "Contact"} />
          <div>
            <strong>{c?.name || "Contact"}</strong>
            <small>
              {c?.title} · {c?.company}
            </small>
          </div>
        </button>
        <Badge
          tone={
            d.status === "approved"
              ? "green"
              : d.status === "failed"
                ? "red"
                : "neutral"
          }
        >
          {d.status === "pending"
            ? "Needs review"
            : d.status === "approved"
              ? "Approved"
              : d.status}
        </Badge>
      </div>
      <div className="draft-meta">
        <span>
          {d.channel === "email" ? <Mail size={14} /> : d.channel === "x" ? <AtSign size={14} /> : <Linkedin size={14} />}{" "}
          {d.channel === "email" ? "Email" : d.channel === "x" ? "X" : "LinkedIn"} ·{" "}
          {d.kind.replaceAll("_", " ")}
        </span>
        {c?.warmPaths[0] && (
          <span className="warm-tag">
            <span className="warm-dot" />
            {c.warmPaths[0].detail}
          </span>
        )}
      </div>
      {d.channel === "email" && (
        <div className="recipient-line">
          To: <strong>{c?.email || "No email added"}</strong>
          <Badge tone={c?.emailVerified ? "green" : "amber"}>
            {c?.emailVerified
              ? "Confirmed"
              : `${Math.round((c?.emailConfidence || 0) * 100)}% · guessed`}
          </Badge>
        </div>
      )}
      {d.channel === "x" && c?.xHandle && (
        <div className="recipient-line">
          To: <strong>@{c.xHandle}</strong> on X
          <Badge tone="neutral">You send it yourself</Badge>
        </div>
      )}
      {d.channel === "x" && c?.xPost && (
        <p className="field-help">
          Responding to their post: “{c.xPost.excerpt}”
        </p>
      )}
      {d.channel === "email" && (
        <label className="subject-field">
          <span>Subject</span>
          <input
            aria-label={`Subject for ${c?.name}`}
            value={subject}
            disabled={!editable}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
      )}
      <label className="draft-body-label">
        <span className="sr-only">Message for {c?.name}</span>
        <textarea
          className="draft-body"
          value={body}
          disabled={!editable}
          onChange={(e) => setBody(e.target.value)}
          rows={9}
        />
      </label>
      {d.channel === "linkedin_connect" && (
        <div
          className={`character-count ${body.length > 300 ? "over-limit" : ""}`}
        >
          {body.length}/300 characters
        </div>
      )}
      {copyError && <p className="field-help">{copyError}</p>}
      {d.error && <p className="inline-error">{d.error}</p>}
      <div className="draft-card-footer">
        {d.status === "sending" ? (
          <div className="delivery-recovery">
            <p>
              Delivery is unconfirmed. Check Gmail Sent before taking another
              action.
            </p>
            <div className="inline-actions">
              <button
                className="button outline compact"
                disabled={busy}
                onClick={() =>
                  void run(
                    { type: "RESOLVE_SEND", draftId: d.id, sent: false },
                    "Returned to review. Approval is required again.",
                  )
                }
              >
                I checked: not sent
              </button>
              <button
                className="button primary compact"
                disabled={busy}
                onClick={() =>
                  void run(
                    { type: "RESOLVE_SEND", draftId: d.id, sent: true },
                    "Delivery confirmed by you",
                  )
                }
              >
                I found it in Sent <Check size={14} />
              </button>
            </div>
          </div>
        ) : editable ? (
          <>
            <div className="draft-secondary-actions">
              <button
                className="icon-button"
                title={copied ? "Copied" : "Copy message"}
                aria-label={
                  copied ? "Message copied" : `Copy message for ${c?.name}`
                }
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `${subject ? subject + "\n\n" : ""}${body}`,
                    );
                    setCopied(true);
                    setCopyError("");
                  } catch {
                    setCopyError(
                      "Select the message text and copy it using your keyboard.",
                    );
                  }
                }}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
              <button
                className="icon-button"
                title="Skip draft"
                aria-label={`Skip draft for ${c?.name}`}
                disabled={busy}
                onClick={() =>
                  void run(
                    { type: "REJECT_DRAFT", draftId: d.id },
                    "Draft skipped",
                  )
                }
              >
                <Trash2 size={16} />
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void run(
                    { type: "REGENERATE_DRAFT", draftId: d.id },
                    "Fresh draft ready for review",
                  )
                }
              >
                <RefreshCw size={14} /> Regenerate
              </button>
            </div>
            {dirty ? (
              <button
                className="button primary compact"
                disabled={busy || !body.trim()}
                onClick={() =>
                  void run(
                    { type: "UPDATE_DRAFT", draftId: d.id, body, subject },
                    "Edits saved. Review and approve when ready.",
                  )
                }
              >
                Save changes <Check size={15} />
              </button>
            ) : d.status === "approved" ? (
              d.channel === "email" ? (
                <button
                  className="button primary compact"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      { type: "SEND_EMAIL", draftId: d.id },
                      demo
                        ? "Demo email sent. No real email was sent."
                        : "Email sent",
                    )
                  }
                >
                  {demo ? "Simulate send" : "Send email"} <Send size={15} />
                </button>
              ) : d.channel === "x" ? (
                <div className="linkedin-actions">
                  <button
                    className="button outline compact"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(body);
                        setCopied(true);
                        setCopyError("");
                      } catch {
                        setCopyError("Select the message text and copy it using your keyboard.");
                      }
                      if (c?.xUrl) window.open(c.xUrl, "_blank", "noopener");
                    }}
                  >
                    {copied ? "Copied" : "Copy & open X"} <ExternalLink size={14} />
                  </button>
                  <button
                    className="button primary compact"
                    disabled={busy}
                    onClick={() =>
                      void run({ type: "MARK_SENT", draftId: d.id }, "Marked as sent on X")
                    }
                  >
                    I sent it <Check size={14} />
                  </button>
                </div>
              ) : (
                <div className="linkedin-actions">
                  <button
                    className="button outline compact"
                    disabled={busy}
                    onClick={() =>
                      void run({ type: "FILL_LINKEDIN", draftId: d.id })
                    }
                  >
                    Fill LinkedIn <ExternalLink size={14} />
                  </button>
                  <button
                    className="button primary compact"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        { type: "MARK_SENT", draftId: d.id },
                        "Marked as sent",
                      )
                    }
                  >
                    Mark sent <Check size={14} />
                  </button>
                </div>
              )
            ) : (
              <button
                className="button primary compact"
                disabled={
                  busy ||
                  !body.trim() ||
                  (d.channel === "linkedin_connect" && body.length > 300)
                }
                onClick={() =>
                  void run(
                    { type: "APPROVE_DRAFT", draftId: d.id },
                    "Approved. You can now send this message.",
                  )
                }
              >
                Approve draft <Check size={16} />
              </button>
            )}
          </>
        ) : (
          <div className="draft-sent">
            <CheckCheck size={16} />
            {d.status === "sent" ? "Message sent" : "Draft skipped"} ·{" "}
            {ago(d.sentAt || d.createdAt)}
          </div>
        )}
      </div>
    </article>
  );
}

function TargetDialog({
  onClose,
  busy,
  run,
  onAdded,
}: {
  onClose: () => void;
  busy: boolean;
  run: Runner;
  onAdded: (id: string) => void;
}) {
  const [text, setText] = useState(""),
    [url, setUrl] = useState(""),
    [domain, setDomain] = useState(""),
    [grabbing, setGrabbing] = useState(false),
    [grabError, setGrabError] = useState("");
  return (
    <Dialog
      title="A new opportunity. A new hello."
      subtitle="Paste a job description. We’ll pull out what matters."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(
            {
              type: "PARSE_JOB",
              rawDescription: text,
              url: url || undefined,
              domain: domain || undefined,
            },
            "Target added. Let’s find your people.",
          );
          if (r) {
            const target = r.state.targets.at(-1);
            if (target) onAdded(target.id);
          }
        }}
      >
        <div className="dialog-body">
          <button
            className="button outline full"
            type="button"
            disabled={grabbing}
            onClick={async () => {
              setGrabbing(true);
              setGrabError("");
              try {
                setText((await grabJobPage()).slice(0, 18000));
              } catch (e) {
                setGrabError(
                  e instanceof Error
                    ? e.message
                    : "Open a job page in Chrome with the extension.",
                );
              } finally {
                setGrabbing(false);
              }
            }}
          >
            <FileText size={16} />
            {grabbing ? "Reading page…" : "Use the open job page"}{" "}
            <ArrowDownLeft size={15} />
          </button>
          {grabError && <p className="inline-error">{grabError}</p>}
          <div className="or-divider">
            <span />
            or paste below
            <span />
          </div>
          <label className="field">
            Job description
            <textarea
              autoFocus
              required
              minLength={35}
              maxLength={18000}
              rows={9}
              placeholder="Product Designer at Acme\nNew York, NY\nWe’re looking for a designer to join our payments team…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              Job URL <span className="optional">optional</span>
              <input
                type="url"
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="field">
              Company email domain <span className="optional">optional</span>
              <input
                placeholder="acme.com"
                value={domain}
                pattern="[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
                onChange={(e) => setDomain(e.target.value)}
              />
            </label>
          </div>
          <p className="field-help">
            Email patterns are guesses until you confirm an address.
          </p>
        </div>
        <div className="dialog-footer">
          <button type="button" className="button subtle" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || text.trim().length < 35}
          >
            <Sparkles size={15} /> Add target
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function ContactDialog({
  targets,
  targetId,
  onClose,
  busy,
  run,
}: {
  targets: Target[];
  targetId?: string;
  onClose: () => void;
  busy: boolean;
  run: Runner;
}) {
  const [target, setTarget] = useState(targetId || targets[0]?.id || ""),
    [name, setName] = useState(""),
    [title, setTitle] = useState(""),
    [email, setEmail] = useState(""),
    [linkedin, setLinkedin] = useState(""),
    [verified, setVerified] = useState(false),
    [alumni, setAlumni] = useState("");
  const t = targets.find((t) => t.id === target);
  return (
    <Dialog
      title="Someone worth a hello."
      subtitle="Add a person you’d like to learn from."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await run(
            {
              type: "ADD_CONTACT",
              contact: {
                name,
                title,
                email: email || undefined,
                emailVerified: verified && !!email,
                emailConfidence: verified ? 1 : email ? 0.5 : undefined,
                linkedinUrl: linkedin || undefined,
                targetId: target,
                company: t?.company || "",
                warmPaths: alumni ? [{ type: "alumni", detail: alumni }] : [],
              },
            },
            "Contact added to your network",
          );
          if (result) onClose();
        }}
      >
        <div className="dialog-body">
          {!targets.length && (
            <p className="inline-error">
              Add a job target before adding contacts.
            </p>
          )}
          <label className="field">
            Target opportunity
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
            >
              {targets.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.company} · {t.role}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label className="field">
              Full name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Alex Morgan"
                maxLength={120}
              />
            </label>
            <label className="field">
              Role / title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="Product Designer"
                maxLength={200}
              />
            </label>
          </div>
          <label className="field">
            Email address <span className="optional">optional</span>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setVerified(false);
              }}
              placeholder="alex@company.com"
            />
          </label>
          {email && (
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
              />{" "}
              I’ve confirmed this is their email address.
            </label>
          )}
          <label className="field">
            LinkedIn profile <span className="optional">optional</span>
            <input
              type="url"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="https://www.linkedin.com/in/…"
            />
          </label>
          <label className="field">
            Shared school / alumni connection{" "}
            <span className="optional">optional</span>
            <input
              value={alumni}
              onChange={(e) => setAlumni(e.target.value)}
              placeholder="NYU, Class of 2022"
              maxLength={150}
            />
          </label>
        </div>
        <div className="dialog-footer">
          <button type="button" className="button subtle" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !target || !name.trim() || !title.trim()}
          >
            Add person <Plus size={16} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function TemplatePage({
  state: s,
  run,
  busy,
}: {
  state: AppState;
  run: Runner;
  busy: boolean;
}) {
  const [body, setBody] = useState(s.template.body),
    [subject, setSubject] = useState(s.template.subject || ""),
    [channel, setChannel] = useState(s.template.channel);
  return (
    <>
      <PageHeading
        eyebrow="MESSAGE TEMPLATE"
        title="Write your message once."
        description="Type it the way you'd say it. Click a field to add details that change for each person; the rest stays exactly as you wrote it."
      />
      <div className="settings-layout">
        <form
          className="panel form-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              {
                type: "SAVE_TEMPLATE",
                template: { ...s.template, body, subject, channel },
              },
              "Template saved. New drafts will use your words.",
            );
          }}
        >
          <div className="section-heading">
            <h2>Your outreach template</h2>
            <Badge tone="green">One template. Many connections.</Badge>
          </div>
          <label className="field">
            Send via
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as typeof channel)}
            >
              <option value="email">Email</option>
              <option value="linkedin_connect">
                LinkedIn connection note · 300 characters
              </option>
              <option value="linkedin_message">LinkedIn message</option>
            </select>
          </label>
          {channel === "email" && (
            <TemplateEditor
              label="Subject"
              singleLine
              value={subject}
              onChange={setSubject}
              profile={s.profile}
              placeholder="Coffee chat about the role?"
            />
          )}
          <TemplateEditor
            label="Your message"
            value={body}
            onChange={setBody}
            profile={s.profile}
            placeholder="Hi, I'm a student at…"
          />
          <TemplatePreview
            subject={channel === "email" ? subject : undefined}
            body={body}
            profile={s.profile}
          />
          {channel === "linkedin_connect" && (
            <p className="field-help">
              Filled connection notes must fit within 300 characters. Keep the
              template short.
            </p>
          )}
          <div className="form-actions">
            <button className="button primary" disabled={busy || !body.trim()}>
              Save template <Check size={16} />
            </button>
          </div>
        </form>
        <aside className="panel form-panel template-guide">
          <span className="mini-icon">
            <WandSparkles size={21} />
          </span>
          <h2>How the personal hook works</h2>
          <p>
            Add the <strong>Personal hook</strong> field and the AI writes one
            line from a real connection: a shared school, a past employer, or
            something they posted. If there’s nothing real, it’s left out.
          </p>
          <div className="template-example">
            <small>A WARM CONNECTION</small>
            <p>
              “As a fellow NYU grad, I’d love to hear about your path to the
              payments team.”
            </p>
          </div>
          <p>
            Keep it short. Be specific about what you’d like to learn. Make
            saying yes feel easy.
          </p>
          <div className="quiet-note">
            <ShieldCheck size={15} /> No invented achievements or connections.
          </div>
        </aside>
      </div>
    </>
  );
}

/** Scheduled chats that haven't happened yet, soonest first. */
function upcomingChats(s: AppState): Meeting[] {
  return s.meetings
    .filter((m) => new Date(m.end).getTime() > Date.now())
    .sort((a, b) => a.start.localeCompare(b.start));
}
const chatWhen = (m: Meeting) =>
  new Date(m.start).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** "Add to Leo Nguyen coffee chat" (one chat) or a picker (several). Clicking again removes it. */
function AddToChat({
  question: q,
  state: s,
  run,
  busy,
  onOpenChat,
}: {
  question: Question;
  state: AppState;
  run: Runner;
  busy: boolean;
  onOpenChat: (meetingId: string) => void;
}) {
  const chats = upcomingChats(s);
  const nameFor = (m: Meeting) =>
    s.contacts.find((c) => c.id === m.contactId)?.name || "Coffee chat";
  const toggle = (m: Meeting) =>
    void run({
      type: "SET_CHAT_QUESTIONS",
      meetingId: m.id,
      questionIds: m.questionIds.includes(q.id)
        ? m.questionIds.filter((id) => id !== q.id)
        : [...m.questionIds, q.id],
    });
  if (!chats.length)
    return <span className="quiet-note">No chats scheduled yet</span>;
  if (chats.length === 1) {
    const m = chats[0];
    const added = m.questionIds.includes(q.id);
    return (
      <span className="add-to-chat">
        <button
          className={`button compact ${added ? "subtle" : "outline"}`}
          disabled={busy}
          onClick={() => toggle(m)}
          title={added ? "Click to remove it from this chat" : undefined}
        >
          {added ? <Check size={14} /> : <Plus size={14} />}
          {added ? `In ${nameFor(m)} chat` : `Add to ${nameFor(m)} coffee chat`}
        </button>
        {added && (
          <button className="text-button" onClick={() => onOpenChat(m.id)}>
            Open chat
          </button>
        )}
      </span>
    );
  }
  const inChats = chats.filter((m) => m.questionIds.includes(q.id));
  return (
    <span className="add-to-chat">
      <select
        aria-label={`Add "${q.text}" to a coffee chat`}
        value=""
        disabled={busy}
        onChange={(e) => {
          const m = chats.find((item) => item.id === e.target.value);
          if (m) toggle(m);
        }}
      >
        <option value="">
          {inChats.length
            ? `In ${inChats.map((m) => nameFor(m).split(" ")[0]).join(", ")} chat${inChats.length > 1 ? "s" : ""}`
            : "Add to coffee chat…"}
        </option>
        {chats.map((m) => (
          <option value={m.id} key={m.id}>
            {m.questionIds.includes(q.id) ? "Remove from" : "Add to"} {nameFor(m)} coffee chat
          </option>
        ))}
      </select>
    </span>
  );
}

function QuestionsPage({
  state: s,
  run,
  busy,
  onOpenChat,
}: {
  state: AppState;
  run: Runner;
  busy: boolean;
  onOpenChat: (meetingId: string) => void;
}) {
  const [tab, setTab] = useState<"approved" | "suggested">("approved"),
    [text, setText] = useState(""),
    [category, setCategory] = useState<QuestionCategory>("role");
  const list = s.questions.filter((q) => q.status === tab);
  async function addQuestion(e: React.FormEvent) {
    e.preventDefault();
    const q: Question = {
      id: crypto.randomUUID(),
      text: text.trim(),
      category,
      source: "user_written",
      status: "approved",
      timesUsed: 0,
    };
    if (
      await run(
        { type: "UPDATE_QUESTION", question: q },
        "Question added to your bank",
      )
    )
      setText("");
  }
  return (
    <>
      <div className="heading-line">
        <PageHeading
          eyebrow="FOR YOUR COFFEE CHATS"
          title="Question bank"
          description="Questions you want to ask. Add them to a scheduled coffee chat, or let a prep brief pick from them."
        />
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            if (
              await run(
                { type: "SUGGEST_QUESTIONS" },
                "Suggested questions are ready to review",
              )
            )
              setTab("suggested");
          }}
        >
          <Sparkles size={16} /> Suggest questions
        </button>
      </div>
      <form className="panel question-add-row" onSubmit={addQuestion}>
        <input
          aria-label="Write your own question"
          placeholder="Write your own question…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          required
        />
        <select
          aria-label="Question category"
          value={category}
          onChange={(e) => setCategory(e.target.value as QuestionCategory)}
        >
          {Object.entries(categoryLabels).map(([v, l]) => (
            <option value={v} key={v}>
              {l}
            </option>
          ))}
        </select>
        <button className="button primary compact" disabled={busy || !text.trim()}>
          <Plus size={14} /> Add question
        </button>
      </form>
      <div className="tabs standalone">
        <button
          className={tab === "approved" ? "active" : ""}
          onClick={() => setTab("approved")}
        >
          My question bank{" "}
          <span>{s.questions.filter((q) => q.status === "approved").length}</span>
        </button>
        <button
          className={tab === "suggested" ? "active" : ""}
          onClick={() => setTab("suggested")}
        >
          Suggestions{" "}
          <span>{s.questions.filter((q) => q.status === "suggested").length}</span>
        </button>
      </div>
      <section className="panel question-list" aria-label="Questions">
        {list.map((q) => (
          <QuestionRow
            key={q.id}
            question={q}
            state={s}
            run={run}
            busy={busy}
            onOpenChat={onOpenChat}
          />
        ))}
        {!list.length && (
          <Empty
            icon={<BookOpen size={28} />}
            title={tab === "approved" ? "No questions yet." : "No suggestions waiting."}
          >
            {tab === "approved"
              ? "Write one above, or click Suggest questions."
              : "Click Suggest questions to get more."}
          </Empty>
        )}
      </section>
    </>
  );
}

function QuestionRow({
  question: q,
  state: s,
  run,
  busy,
  onOpenChat,
}: {
  question: Question;
  state: AppState;
  run: Runner;
  busy: boolean;
  onOpenChat: (meetingId: string) => void;
}) {
  const [text, setText] = useState(q.text),
    [editing, setEditing] = useState(false);
  return (
    <div className="question-row">
      <span className="question-row-category">
        <Badge>{categoryLabels[q.category]}</Badge>
      </span>
      <div className="question-row-text">
        {editing ? (
          <input
            aria-label="Edit question"
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <p>{q.text}</p>
        )}
        <small>
          {q.source === "ai_suggested" ? "Suggested by AI" : "Written by you"}
          {q.timesUsed ? ` · used in ${q.timesUsed} chat${q.timesUsed === 1 ? "" : "s"}` : ""}
          {q.landedWell ? ` · landed well ${q.landedWell}×` : ""}
        </small>
      </div>
      <div className="question-row-actions">
        {q.status === "suggested" ? (
          <>
            <button
              className="text-button muted"
              disabled={busy}
              onClick={() =>
                void run({ type: "UPDATE_QUESTION", question: { ...q, status: "skipped" } })
              }
            >
              Skip
            </button>
            <button className="text-button" onClick={() => setEditing((v) => !v)}>
              {editing ? "Done" : "Edit"}
            </button>
            <button
              className="button primary compact"
              disabled={busy || !text.trim()}
              onClick={() =>
                void run(
                  { type: "UPDATE_QUESTION", question: { ...q, text, status: "approved" } },
                  "Added to your bank",
                )
              }
            >
              <Plus size={14} /> Add to bank
            </button>
          </>
        ) : (
          <>
            <button
              className="text-button"
              disabled={busy || !text.trim()}
              onClick={async () => {
                if (editing)
                  await run({ type: "UPDATE_QUESTION", question: { ...q, text } }, "Question updated");
                setEditing((v) => !v);
              }}
            >
              {editing ? "Save" : "Edit"}
            </button>
            <AddToChat question={q} state={s} run={run} busy={busy} onOpenChat={onOpenChat} />
          </>
        )}
      </div>
    </div>
  );
}

/** All scheduled coffee chats; open one to pick questions and see everything about the person. */
function ChatsPage({
  state: s,
  run,
  busy,
  chatId,
  onChat,
  onContact,
}: {
  state: AppState;
  run: Runner;
  busy: boolean;
  chatId: string | null;
  onChat: (id: string) => void;
  onContact: (contactId: string) => void;
}) {
  const upcoming = upcomingChats(s);
  const past = s.meetings
    .filter((m) => !upcoming.includes(m))
    .sort((a, b) => b.start.localeCompare(a.start));
  const chat = s.meetings.find((m) => m.id === chatId) || upcoming[0] || past[0];
  const row = (m: Meeting) => {
    const c = s.contacts.find((item) => item.id === m.contactId);
    return (
      <button
        key={m.id}
        className={`chat-row ${chat?.id === m.id ? "active" : ""}`}
        onClick={() => onChat(m.id)}
      >
        <Avatar name={c?.name || "Coffee chat"} small />
        <span>
          <strong>{c?.name || "Coffee chat"}</strong>
          <small>{chatWhen(m)}</small>
        </span>
        <span className="chat-row-count" title="Questions added">
          {m.questionIds.length} <BookOpen size={12} />
        </span>
      </button>
    );
  };
  return (
    <>
      <PageHeading
        eyebrow="SCHEDULED"
        title="Coffee chats"
        description="Open a chat to choose your questions and see everything you have on the person."
      />
      {!s.meetings.length ? (
        <div className="panel">
          <Empty icon={<CalendarDays size={28} />} title="No coffee chats yet.">
            Once someone agrees to a time, the chat shows up here.
          </Empty>
        </div>
      ) : (
        <div className="chats-layout">
          <nav className="panel chats-list" aria-label="Coffee chats">
            <div className="chats-list-heading">Upcoming</div>
            {upcoming.map(row)}
            {!upcoming.length && <p className="muted">Nothing upcoming.</p>}
            {past.length > 0 && (
              <>
                <div className="chats-list-heading">Past</div>
                {past.map(row)}
              </>
            )}
          </nav>
          {chat && (
            <ChatDetail
              key={chat.id}
              meeting={chat}
              state={s}
              run={run}
              busy={busy}
              onContact={onContact}
            />
          )}
        </div>
      )}
    </>
  );
}

function ChatDetail({
  meeting: m,
  state: s,
  run,
  busy,
  onContact,
}: {
  meeting: Meeting;
  state: AppState;
  run: Runner;
  busy: boolean;
  onContact: (contactId: string) => void;
}) {
  const [filter, setFilter] = useState<QuestionCategory | "all">("all");
  const c = s.contacts.find((item) => item.id === m.contactId);
  const target = c && s.targets.find((t) => t.id === c.targetId);
  const chosen = m.questionIds
    .map((id) => s.questions.find((q) => q.id === id))
    .filter((q): q is Question => !!q);
  const bank = s.questions.filter(
    (q) =>
      q.status === "approved" &&
      !m.questionIds.includes(q.id) &&
      (filter === "all" || q.category === filter),
  );
  const setQuestions = (ids: string[]) =>
    void run({ type: "SET_CHAT_QUESTIONS", meetingId: m.id, questionIds: ids });
  const history = s.activities
    .filter((e) => e.contactId === m.contactId)
    .sort((a, b) => b.at - a.at)
    .slice(0, 6);
  const sent = s.drafts.filter((d) => d.contactId === m.contactId && d.status === "sent");
  const first = c?.name.split(" ")[0] || "them";
  return (
    <section className="panel chat-detail">
      <div className="chat-detail-header">
        <Avatar name={c?.name || "Coffee chat"} />
        <div>
          <h2>{c?.name || "Coffee chat"}</h2>
          <p>
            {c?.title}
            {c?.company ? ` · ${c.company}` : ""}
          </p>
          <p className="chat-when">
            <CalendarDays size={14} /> {chatWhen(m)}
            {m.meetLink && (
              <>
                {" · "}
                <a href={m.meetLink} target="_blank" rel="noreferrer">
                  Join Google Meet <ExternalLink size={12} />
                </a>
              </>
            )}
          </p>
        </div>
        <div className="chat-detail-actions">
          {c && (
            <button className="button outline compact" onClick={() => onContact(c.id)}>
              Full profile
            </button>
          )}
          {c && (
            <button
              className="button primary compact"
              disabled={busy}
              onClick={() =>
                void run({ type: "GENERATE_PREP_BRIEF", contactId: c.id }, "Prep brief ready")
              }
            >
              <Sparkles size={14} /> {m.prepBrief ? "Redo prep brief" : "Make prep brief"}
            </button>
          )}
        </div>
      </div>

      <div className="chat-detail-grid">
        <div>
          <h3>
            Questions for this chat <span>{chosen.length}</span>
          </h3>
          {chosen.length ? (
            <ol className="chat-questions">
              {chosen.map((q) => (
                <li key={q.id}>
                  <span>{q.text}</span>
                  <button
                    className="icon-button"
                    title="Remove from this chat"
                    aria-label={`Remove "${q.text}" from this chat`}
                    disabled={busy}
                    onClick={() => setQuestions(m.questionIds.filter((id) => id !== q.id))}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No questions yet. Add some from your bank below.</p>
          )}

          <h3 className="chat-bank-heading">
            Your question bank
            <select
              aria-label="Filter by category"
              value={filter}
              onChange={(e) => setFilter(e.target.value as QuestionCategory | "all")}
            >
              <option value="all">All categories</option>
              {Object.entries(categoryLabels).map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </h3>
          <ul className="chat-bank">
            {bank.map((q) => (
              <li key={q.id}>
                <Badge>{categoryLabels[q.category]}</Badge>
                <span>{q.text}</span>
                <button
                  className="button outline compact"
                  disabled={busy}
                  onClick={() => setQuestions([...m.questionIds, q.id])}
                >
                  <Plus size={13} /> Add
                </button>
              </li>
            ))}
            {!bank.length && (
              <li className="muted">Everything here is already in this chat.</li>
            )}
          </ul>
        </div>

        <aside className="chat-about">
          <h3>About {first}</h3>
          <dl>
            {c?.title && (
              <>
                <dt>Role</dt>
                <dd>
                  {c.title} at {c.company}
                </dd>
              </>
            )}
            {target && (
              <>
                <dt>Your target job</dt>
                <dd>
                  {target.role} at {target.company}
                </dd>
              </>
            )}
            {c?.email && (
              <>
                <dt>Email</dt>
                <dd>
                  {c.email}{" "}
                  <Badge tone={c.emailVerified ? "green" : "amber"}>
                    {c.emailVerified
                      ? "Confirmed"
                      : `${Math.round((c.emailConfidence || 0) * 100)}% guess`}
                  </Badge>
                </dd>
              </>
            )}
            {c?.linkedinUrl && (
              <>
                <dt>LinkedIn</dt>
                <dd>
                  <a href={c.linkedinUrl} target="_blank" rel="noreferrer">
                    Profile <ExternalLink size={12} />
                  </a>
                </dd>
              </>
            )}
            {c?.xHandle && (
              <>
                <dt>X</dt>
                <dd>
                  <a href={c.xUrl} target="_blank" rel="noreferrer">
                    @{c.xHandle} <ExternalLink size={12} />
                  </a>
                  {c.xPost && <blockquote>“{c.xPost.excerpt}”</blockquote>}
                </dd>
              </>
            )}
            {c?.warmPaths.length ? (
              <>
                <dt>What you share</dt>
                <dd>{c.warmPaths.map((w) => w.detail).join(" · ")}</dd>
              </>
            ) : null}
            {c?.reason && (
              <>
                <dt>Why them</dt>
                <dd>{c.reason}</dd>
              </>
            )}
            {c?.connectionDegree && (
              <>
                <dt>Connection</dt>
                <dd>
                  {c.connectionDegree === 1 ? "1st" : c.connectionDegree === 2 ? "2nd" : "3rd"}
                  -degree on LinkedIn
                </dd>
              </>
            )}
            {c?.notes && (
              <>
                <dt>Your notes</dt>
                <dd>{c.notes}</dd>
              </>
            )}
          </dl>
          {sent.length > 0 && (
            <>
              <h4>Messages you sent ({sent.length})</h4>
              {sent.slice(-2).map((d) => (
                <p className="chat-sent" key={d.id}>
                  {d.body.slice(0, 220)}
                  {d.body.length > 220 ? "…" : ""}
                </p>
              ))}
            </>
          )}
          {history.length > 0 && (
            <>
              <h4>Recent activity</h4>
              <ul className="chat-history">
                {history.map((e) => (
                  <li key={e.id}>
                    {e.summary} <small>{new Date(e.at).toLocaleDateString()}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
          {m.prepBrief && (
            <details className="chat-brief">
              <summary>Prep brief</summary>
              <pre>{m.prepBrief}</pre>
            </details>
          )}
        </aside>
      </div>
    </section>
  );
}

function SettingsPage({
  state: s,
  run,
  busy,
}: {
  state: AppState;
  run: Runner;
  busy: boolean;
}) {
  const [profile, setProfile] = useState<Profile>(s.profile),
    [backend, setBackend] = useState(s.settings.backendUrl),
    [health, setHealth] = useState(""),
    [checking, setChecking] = useState(false);
  const savedProfile = JSON.stringify(s.profile);
  useEffect(() => {
    setProfile(JSON.parse(savedProfile) as Profile);
  }, [savedProfile]);
  useEffect(() => {
    setBackend(s.settings.backendUrl);
    setHealth("");
  }, [s.settings.backendUrl, s.settings.demoMode]);
  const update = (key: keyof Profile, value: string) =>
    setProfile((p) => ({ ...p, [key]: value }));
  return (
    <>
      <PageHeading
        eyebrow="YOUR PROFILE"
        title="Settings & profile"
        description="Your school, year, major, and background get filled into every message."
      />
      <div className="settings-layout">
        <form
          className="panel form-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void run({ type: "SAVE_PROFILE", profile }, "Profile saved");
          }}
        >
          <h2>Your profile</h2>
          <div className="form-grid">
            <label className="field">
              Your name
              <input
                required
                value={profile.name}
                onChange={(e) => update("name", e.target.value)}
                maxLength={100}
              />
            </label>
            <label className="field">
              School
              <input
                value={profile.school}
                onChange={(e) => update("school", e.target.value)}
              />
            </label>
            <label className="field">
              Major / field
              <input
                value={profile.major}
                onChange={(e) => update("major", e.target.value)}
              />
            </label>
            <label className="field">
              Year / stage
              <input
                value={profile.year}
                onChange={(e) => update("year", e.target.value)}
                placeholder="master’s student"
              />
            </label>
          </div>
          <label className="field">
            A bit about you
            <textarea
              rows={4}
              value={profile.background}
              onChange={(e) => update("background", e.target.value)}
              placeholder="Your interests, experience, and what you’re looking for…"
            />
          </label>
          <label className="field">
            Availability or scheduling link
            <input
              value={profile.availability}
              onChange={(e) => update("availability", e.target.value)}
              placeholder="Weekdays 2–5 pm ET"
            />
          </label>
          <label className="field">
            Email signature
            <textarea
              rows={2}
              value={profile.signature}
              onChange={(e) => update("signature", e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button className="button primary" disabled={busy}>
              Save profile <Check size={16} />
            </button>
          </div>
        </form>
        <div className="settings-right">
          <section className="panel form-panel">
            <h2>Your connections</h2>
            <div className="integration-row">
              <span className="integration-symbol gmail-symbol">M</span>
              <div>
                <strong>Gmail & Google Calendar</strong>
                <p>
                  {s.settings.googleConnected
                    ? "Google connected"
                    : "Connect your own Google account"}
                </p>
              </div>
              {s.settings.googleConnected && (
                <CheckCircle2 size={17} className="green-text" />
              )}
            </div>
            <button
              className="button outline full"
              disabled={busy || s.settings.demoMode}
              onClick={() =>
                void run({ type: "CONNECT_GOOGLE" }, "Google connected")
              }
            >
              {s.settings.googleConnected
                ? "Reconnect Google"
                : "Connect Google"}{" "}
              <ArrowUpRight size={15} />
            </button>
            <p className="field-help">
              Live connection requires a Chrome extension OAuth client. See the
              setup guide in the repository.
            </p>
            <hr />
            <div className="integration-row">
              <span className="integration-symbol ai-symbol">
                <Sparkles size={20} />
              </span>
              <div>
                <strong>AI backend</strong>
                <p>Grok (xAI) · Key stored on your server</p>
              </div>
            </div>
            <label className="field">
              Backend URL
              <input
                type="url"
                value={backend}
                onChange={(e) => setBackend(e.target.value)}
                placeholder="http://127.0.0.1:8787"
              />
            </label>
            <div className="inline-actions">
              <button
                className="button outline compact"
                disabled={busy || !backend}
                onClick={() =>
                  void run(
                    {
                      type: "UPDATE_SETTINGS",
                      settings: { backendUrl: backend },
                    },
                    "Backend URL saved",
                  )
                }
              >
                Save URL
              </button>
              <button
                className="text-button"
                disabled={checking || !backend}
                onClick={async () => {
                  setChecking(true);
                  setHealth("");
                  try {
                    const res = await fetch(
                      `${backend.replace(/\/$/, "")}/health`,
                      { signal: AbortSignal.timeout(6000) },
                    );
                    if (!res.ok) throw new Error("Backend returned an error");
                    const data = await res.json();
                    setHealth(
                      data.configured === false || data.aiConfigured === false
                        ? "Backend reachable. Add XAI_API_KEY to .env, then restart it."
                        : "Backend reachable. Ready for live requests.",
                    );
                  } catch (e) {
                    setHealth(
                      "Backend unavailable. Run npm run server and check the URL.",
                    );
                  } finally {
                    setChecking(false);
                  }
                }}
              >
                {checking ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <RefreshCw size={14} />
                )}{" "}
                Test connection
              </button>
            </div>
            {health && (
              <p className="connection-result" role="status">
                {health}
              </p>
            )}
          </section>
          <section className="panel form-panel">
            <div className="toggle-line">
              <div>
                <h2>Demo mode</h2>
                <p>
                  Fictional people. Simulated sends.
                  <br />A faster follow-up clock.
                </p>
              </div>
              <button
                className={`toggle ${s.settings.demoMode ? "on" : ""}`}
                role="switch"
                aria-checked={s.settings.demoMode}
                aria-label="Demo mode"
                disabled={busy}
                onClick={() =>
                  void run(
                    {
                      type: "UPDATE_SETTINGS",
                      settings: { demoMode: !s.settings.demoMode },
                    },
                    s.settings.demoMode
                      ? "Live mode enabled. Configure integrations before sending."
                      : "Demo mode enabled",
                  )
                }
              >
                <span />
              </button>
            </div>
            <p className="field-help">
              Demo and live data are kept separate.
            </p>
            <div className="limits-line">
              <ShieldCheck size={16} />
              <span>
                30 emails/day · 20 profiles/day
                <br />
                Guessed email threshold:{" "}
                {Math.round(s.settings.emailThreshold * 100)}%
              </span>
            </div>
            {s.settings.demoMode && (
              <button
                className="text-button muted"
                disabled={busy}
                onClick={() =>
                  void run({ type: "RESET_DEMO" }, "Demo data reset")
                }
              >
                Reset demo data <RefreshCw size={13} />
              </button>
            )}
          </section>
          <section className="setup-help">
            <strong>Bring your own connections.</strong>
            <p>
              Follow <code>backend/SETUP.md</code> for the Google OAuth and
              Grok (xAI) setup. No API key belongs in the extension.
            </p>
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
            >
              Open Google Cloud <ExternalLink size={13} />
            </a>
            <a
              href="https://console.x.ai/team/default/api-keys"
              target="_blank"
              rel="noreferrer"
            >
              Open xAI Console <ExternalLink size={13} />
            </a>
          </section>
        </div>
      </div>
    </>
  );
}

function ContactDetail({
  contact: c,
  state: s,
  onClose,
  busy,
  run,
  onQueue,
}: {
  contact: Contact;
  state: AppState;
  onClose: () => void;
  busy: boolean;
  run: Runner;
  onQueue: () => void;
}) {
  const [tab, setTab] = useState("overview"),
    [reply, setReply] = useState(
      "Sure, I’d be happy to chat! What times work for you?",
    ),
    [notes, setNotes] = useState(c.notes || ""),
    [includeReferral, setIncludeReferral] = useState(true),
    [start, setStart] = useState(() => {
      const date = new Date(Date.now() + 86400000);
      date.setMinutes(0);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    }),
    [brief, setBrief] = useState(""),
    [email, setEmail] = useState(c.email || ""),
    [emailVerified, setEmailVerified] = useState(c.emailVerified || false),
    [editingEmail, setEditingEmail] = useState(false);
  const target = s.targets.find((t) => t.id === c.targetId),
    meeting = s.meetings.filter((m) => m.contactId === c.id).at(-1);
  const events = s.activities
    .filter((e) => e.contactId === c.id)
    .sort((a, b) => b.at - a.at);
  const drafts = s.drafts.filter(
    (d) => d.contactId === c.id && d.status !== "rejected",
  );
  const profileUrl = cleanLink(c.linkedinUrl);
  return (
    <Dialog title="A closer connection." onClose={onClose} wide>
      <div className="contact-detail-header">
        <Avatar name={c.name} />
        <div>
          <h2>{c.name}</h2>
          <p>
            {c.title} at {c.company}
          </p>
        </div>
        <Badge
          tone={
            ["scheduled", "replied"].includes(c.stage) ? "green" : "neutral"
          }
        >
          {stageLabels[c.stage]}
        </Badge>
      </div>
      <div className="tabs contact-tabs">
        {["overview", "messages", "prep & notes"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="dialog-body contact-detail-body">
        {tab === "overview" && (
          <>
            <div className="detail-grid">
              <div>
                <label>YOUR WARM PATH</label>
                {c.warmPaths.length ? (
                  c.warmPaths.map((w, i) => (
                    <p className="warm-detail" key={i}>
                      <Sparkles size={14} />
                      {w.detail}
                    </p>
                  ))
                ) : (
                  <p>No shared background added yet.</p>
                )}
                <p className="muted">{c.reason}</p>
                {c.xHandle && (
                  <p>
                    <a href={c.xUrl} target="_blank" rel="noreferrer">
                      @{c.xHandle} on X <ExternalLink size={12} />
                    </a>
                  </p>
                )}
                {c.xPost && (
                  <blockquote className="muted">
                    “{c.xPost.excerpt}”{" "}
                    <a href={c.xPost.url} target="_blank" rel="noreferrer">
                      View post
                    </a>
                  </blockquote>
                )}
              </div>
              <div>
                <label>THE OPPORTUNITY</label>
                <p>
                  <strong>{target?.company}</strong>
                </p>
                <p>{target?.role}</p>
              </div>
            </div>
            <div className="contact-address">
              <Mail size={17} />
              <span>
                {c.email || "No email address"}
                <small>
                  {c.emailVerified
                    ? "Confirmed by you"
                    : `Guessed address · ${Math.round((c.emailConfidence || 0) * 100)}% confidence`}
                </small>
              </span>
              <button
                className="text-button"
                onClick={() => setEditingEmail((v) => !v)}
              >
                Edit
              </button>
              {profileUrl && (
                <a
                  className="icon-button"
                  href={profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open LinkedIn profile"
                >
                  <Linkedin size={17} />
                </a>
              )}
            </div>
            {editingEmail && (
              <form
                className="email-edit-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await run(
                      {
                        type: "UPDATE_CONTACT",
                        contactId: c.id,
                        patch: {
                          email,
                          emailVerified,
                          emailConfidence: emailVerified ? 1 : 0.5,
                        },
                      },
                      "Email updated. Existing drafts need approval again.",
                    )
                  )
                    setEditingEmail(false);
                }}
              >
                <label className="field">
                  Contact email
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setEmailVerified(false);
                    }}
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={emailVerified}
                    onChange={(e) => setEmailVerified(e.target.checked)}
                  />{" "}
                  I have confirmed this email address.
                </label>
                <button
                  className="button outline compact"
                  disabled={busy || !email}
                >
                  Save email <Check size={14} />
                </button>
              </form>
            )}
            <div className="inline-actions detail-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  if (
                    await run(
                      { type: "GENERATE_DRAFTS", contactIds: [c.id] },
                      "Outreach draft ready",
                    )
                  )
                    onQueue();
                }}
              >
                <WandSparkles size={15} /> Draft outreach
              </button>
              <button className="button outline" onClick={onQueue}>
                View message approval queue <ArrowRight size={14} />
              </button>
            </div>
            {s.settings.demoMode && (
              <section className="demo-reply-box">
                <h3>
                  <MessageSquare size={16} /> Simulate an incoming reply
                </h3>
                <p>
                  Use the demo inbox to try reply classification and stop
                  follow-ups.
                </p>
                <textarea
                  rows={2}
                  aria-label="Simulated reply"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                <button
                  className="button outline compact"
                  disabled={busy || !reply.trim()}
                  onClick={() =>
                    void run(
                      {
                        type: "RECORD_REPLY",
                        contactId: c.id,
                        replyText: reply,
                      },
                      "Reply recorded. Follow-ups stopped.",
                    )
                  }
                >
                  Receive demo reply <ArrowDownLeft size={14} />
                </button>
              </section>
            )}
            <section className="schedule-section">
              <h3>
                <CalendarDays size={17} /> Plan a 15-minute coffee chat
              </h3>
              <p className="field-help">
                Choose a time you’ve agreed with {c.name.split(" ")[0]}.{" "}
                {s.settings.demoMode
                  ? "This creates a demo meeting."
                  : "This sends a Google Calendar invitation with a Meet link."}
              </p>
              <label className="field">
                Meeting time ({Intl.DateTimeFormat().resolvedOptions().timeZone}
                )
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  required
                />
              </label>
              <button
                className="button outline compact"
                disabled={busy || !start}
                onClick={() => {
                  const date = new Date(start);
                  if (!Number.isNaN(date.getTime()))
                    void run(
                      {
                        type: "CREATE_MEETING",
                        contactId: c.id,
                        start: date.toISOString(),
                        end: new Date(
                          date.getTime() + 15 * 60000,
                        ).toISOString(),
                      },
                      s.settings.demoMode
                        ? "Demo coffee chat scheduled"
                        : "Coffee chat scheduled. Invitation sent.",
                    );
                }}
              >
                {meeting ? "Schedule another chat" : "Schedule chat"}{" "}
                <CalendarDays size={14} />
              </button>
            </section>
          </>
        )}
        {tab === "messages" && (
          <>
            <div className="contact-thread">
              {drafts.length ? (
                drafts
                  .sort((a, b) => a.createdAt - b.createdAt)
                  .map((d) => (
                    <div className="thread-message" key={d.id}>
                      <div>
                        <strong>
                          {d.subject || d.kind.replaceAll("_", " ")}
                        </strong>
                        <Badge tone={d.status === "sent" ? "green" : "amber"}>
                          {d.status}
                        </Badge>
                      </div>
                      <p>{d.body}</p>
                      <small>{new Date(d.createdAt).toLocaleString()}</small>
                    </div>
                  ))
              ) : (
                <p className="muted">
                  Your messages with {c.name.split(" ")[0]} will appear here.
                </p>
              )}
            </div>
            <h3 className="detail-section-title">Connection history</h3>
            {events.map((e) => (
              <div className="thread-event" key={e.id}>
                <Circle size={8} />
                <span>{e.summary}</span>
                <small>{ago(e.at)}</small>
              </div>
            ))}
          </>
        )}
        {tab === "prep & notes" && (
          <>
            <section>
              <div className="section-heading">
                <div>
                  <h3>Your coffee chat brief</h3>
                  <p>Questions picked from your approved bank.</p>
                </div>
                <button
                  className="button outline compact"
                  disabled={busy}
                  onClick={async () => {
                    const r = await run(
                      { type: "GENERATE_PREP_BRIEF", contactId: c.id },
                      "Prep brief ready",
                    );
                    if (r) {
                      if (typeof r.data === "string") setBrief(r.data);
                      else if (r.data)
                        setBrief(JSON.stringify(r.data, null, 2));
                    }
                  }}
                >
                  <Sparkles size={14} /> Build brief
                </button>
              </div>
              {(meeting?.prepBrief || brief) && (
                <div className="prep-brief">{meeting?.prepBrief || brief}</div>
              )}
              {meeting?.meetLink && cleanLink(meeting.meetLink) && (
                <a
                  className="text-button"
                  href={meeting.meetLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  Join Google Meet <ExternalLink size={14} />
                </a>
              )}
            </section>
            <hr />
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await run(
                    {
                      type: "SAVE_MEETING_NOTES",
                      contactId: c.id,
                      notes,
                      includeReferral,
                    },
                    "Notes saved. Thank-you draft is ready for review.",
                  )
                )
                  onQueue();
              }}
            >
              <h3>How did it go?</h3>
              <p className="field-help">
                Jot down something you learned. Your thank-you will pick up the
                thread.
              </p>
              <label className="field">
                <span className="sr-only">Meeting notes</span>
                <textarea
                  rows={4}
                  required
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="We talked about their path into product and how the payments team works…"
                />
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={includeReferral}
                  onChange={(e) => setIncludeReferral(e.target.checked)}
                />{" "}
                Include a soft referral ask
              </label>
              <button
                className="button primary"
                disabled={busy || !notes.trim()}
              >
                Save & draft a thank-you <ArrowRight size={15} />
              </button>
            </form>
          </>
        )}
      </div>
    </Dialog>
  );
}
