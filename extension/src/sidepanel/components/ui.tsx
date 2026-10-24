import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-200",
  secondary: "bg-white text-stone-800 ring-1 ring-stone-300 hover:bg-stone-50 disabled:text-stone-400",
  ghost: "text-stone-600 hover:bg-stone-100 disabled:text-stone-300",
  danger: "bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:text-red-300",
};

export function Button({ variant = "secondary", busy, className = "", children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg bg-white p-3 ring-1 ring-stone-200 ${className}`}>{children}</div>;
}

const tones = {
  stone: "bg-stone-100 text-stone-700",
  brand: "bg-brand-100 text-brand-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  blue: "bg-sky-50 text-sky-700",
  violet: "bg-violet-50 text-violet-700",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "stone", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-stone-500">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-md bg-white px-2.5 py-1.5 text-[13px] ring-1 ring-stone-300 outline-none focus:ring-2 focus:ring-brand-500";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} leading-relaxed ${props.className ?? ""}`} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-4 flex items-center justify-between first:mt-0">
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-stone-500">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-stone-300 p-4 text-center text-[13px] text-stone-500">{children}</div>;
}

export function relTime(at: number | string): string {
  const t = typeof at === "string" ? new Date(at).getTime() : at;
  const diff = t - Date.now();
  const abs = Math.abs(diff);
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60_000) return diff < 0 ? "just now" : "in a moment";
  if (abs < 3_600_000) return fmt.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return fmt.format(Math.round(diff / 3_600_000), "hour");
  return fmt.format(Math.round(diff / 86_400_000), "day");
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
