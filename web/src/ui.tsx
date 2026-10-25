import { useState, type ReactNode } from "react";
import { EXPLORER_TX } from "./lib/config";
import { pct } from "./lib/format";

export function Panel({ title, intro, children, aside }: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="border border-rule bg-paper rounded-md">
      <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
        <div>
          <h2 className="font-cond text-xl font-semibold leading-tight">{title}</h2>
          {intro && <p className="mt-1 max-w-[62ch] text-sm text-ink-soft">{intro}</p>}
        </div>
        {aside}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "mt-1 w-full rounded border border-rule bg-white px-3 py-2 text-[15px] outline-none focus:border-nd";

export function Button({ children, onClick, disabled, kind = "primary", type = "button" }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: "primary" | "quiet" | "danger";
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-ink text-white hover:bg-nd",
    quiet: "border border-rule bg-white text-ink hover:border-nd",
    danger: "bg-oxide text-white hover:opacity-90",
  }[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-4 py-2 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-sm text-ink-soft">{label}</div>
      <div className="font-cond text-xl font-semibold leading-tight sm:text-2xl">{value}</div>
      {sub && <div className="text-xs text-ink-soft">{sub}</div>}
    </div>
  );
}

export const HEALTH = [
  { label: "Sem dívida", fg: "text-ink-soft", bg: "bg-mist", bar: "var(--color-ink-soft)" },
  { label: "Saudável", fg: "text-pr", bg: "bg-pr-soft", bar: "var(--color-pr)" },
  { label: "Alerta", fg: "text-assay", bg: "bg-assay-soft", bar: "var(--color-assay)" },
  { label: "Congelado", fg: "text-oxide", bg: "bg-oxide-soft", bar: "var(--color-oxide)" },
  { label: "Liquidável", fg: "text-oxide", bg: "bg-oxide-soft", bar: "var(--color-oxide)" },
];

export function HealthBadge({ health }: { health: number }) {
  const h = HEALTH[health] ?? HEALTH[0];
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-sm font-semibold ${h.fg} ${h.bg}`}>
      {h.label}
    </span>
  );
}

/**
 * Régua de LTV: como a escala de um laudo, com as marcas que mudam o estado.
 * A faixa vai de 0% a 100%; o preenchimento usa a cor do estado atual.
 */
export function LtvScale({ ltvBps, health, marks }: {
  ltvBps: number;
  health: number;
  marks: { bps: number; label: string }[];
}) {
  const fill = Math.min(ltvBps / 100, 100);
  const color = (HEALTH[health] ?? HEALTH[0]).bar;
  return (
    <div aria-label={`LTV atual ${pct(ltvBps)}`} role="img">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-ink-soft">LTV atual</span>
        <span className="font-cond text-5xl font-bold leading-none" style={{ color }}>
          {pct(ltvBps)}
        </span>
      </div>
      <div className="relative mt-4 h-10">
        <div className="absolute inset-x-0 top-3 h-4 rounded-sm bg-mist" />
        <div
          className="absolute left-0 top-3 h-4 rounded-sm transition-[width] duration-700"
          style={{ width: `${fill}%`, background: color }}
        />
        {Array.from({ length: 21 }, (_, i) => (
          <div
            key={i}
            className="absolute top-1 w-px bg-rule"
            style={{ left: `${i * 5}%`, height: i % 2 === 0 ? 8 : 4 }}
          />
        ))}
        {marks.map((m) => (
          <div key={m.bps} className="absolute top-0 h-10 w-px bg-ink" style={{ left: `${m.bps / 100}%` }} />
        ))}
      </div>
      <div className="relative h-9 text-xs text-ink-soft">
        {marks.map((m) => (
          <div
            key={m.bps}
            className="absolute -translate-x-1/2 text-center leading-tight"
            style={{ left: `${m.bps / 100}%` }}
          >
            <div className="font-semibold text-ink">{pct(m.bps)}</div>
            <div>{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export type Notice = { kind: "pending" | "ok" | "error"; text: string; hash?: string };

export function NoticeBar({ notice, onClose }: { notice?: Notice; onClose: () => void }) {
  if (!notice) return null;
  const style = {
    pending: "border-nd bg-nd-soft",
    ok: "border-pr bg-pr-soft",
    error: "border-oxide bg-oxide-soft",
  }[notice.kind];
  return (
    <div role="status" className={`flex items-start justify-between gap-4 rounded border-l-4 px-4 py-3 text-[15px] ${style}`}>
      <div>
        {notice.text}
        {notice.hash && (
          <a className="ml-2 underline" href={EXPLORER_TX(notice.hash)} target="_blank" rel="noreferrer">
            Ver transação
          </a>
        )}
      </div>
      {notice.kind !== "pending" && (
        <button onClick={onClose} className="text-sm text-ink-soft hover:text-ink" aria-label="Fechar aviso">
          Fechar
        </button>
      )}
    </div>
  );
}

export function useBusy() {
  const [busy, setBusy] = useState(false);
  return { busy, setBusy };
}
