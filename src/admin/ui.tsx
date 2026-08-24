import type { ReactNode } from "react";
import type {
  MovementStatus,
  RingDefinition,
} from "../components/TechRadar/types";
import {
  starPoints,
  trianglePointsDown,
  trianglePointsUp,
} from "../components/TechRadar/utils/shapes";

/* ────────────────────────────────────────────────────────────────────────
 * Design tokens (match the radar's visual language)
 * ──────────────────────────────────────────────────────────────────────── */

export const NAVY = "#1F2A44";
export const BLUE = "#1D4ED8";
export const BORDER = "#E7EAF0";

/* ────────────────────────────────────────────────────────────────────────
 * Icons — thin-stroke 24-grid glyphs, same language as the radar icons
 * ──────────────────────────────────────────────────────────────────────── */

export type IconName =
  | "home"
  | "radar"
  | "list"
  | "sliders"
  | "chart"
  | "doc"
  | "users"
  | "gear"
  | "plug"
  | "bell"
  | "calendar"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "search"
  | "plus"
  | "upload"
  | "download"
  | "pencil"
  | "trash"
  | "copy"
  | "eye"
  | "eye-off"
  | "more-v"
  | "x"
  | "check"
  | "warning"
  | "external"
  | "menu";

const ICON_PATHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="m3 9.5 9-7 9 7V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20Z" />
      <path d="M9.5 21.5V13h5v8.5" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 3v18M3 12h18" opacity="0.55" />
      <circle cx="14.6" cy="9" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  list: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M3 10h18M9.5 10v9.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9.5" cy="7" r="2" fill="#fff" />
      <circle cx="15" cy="12" r="2" fill="#fff" />
      <circle cx="7.5" cy="17" r="2" fill="#fff" />
    </>
  ),
  chart: (
    <>
      <path d="M5 20v-7M11 20V5.5M17 20v-10" />
      <path d="M3 20h18" />
    </>
  ),
  doc: (
    <>
      <path d="M6 2.5h7.5L18 7v14.5H6Z" />
      <path d="M13.5 2.5V7H18M9 12h6M9 16h6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 21v-.5a6 6 0 0 1 12 0v.5" />
      <path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M17.8 14.6A6 6 0 0 1 21 20v1" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.2 5.2 7 7M17 17l1.8 1.8M18.8 5.2 17 7M7 17l-1.8 1.8" />
    </>
  ),
  plug: (
    <>
      <path d="M9 6.5V3M15 6.5V3" />
      <path d="M6.5 6.5h11V12a5.5 5.5 0 0 1-11 0Z" />
      <path d="M12 17.5V21" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 4.8 1.8 6 1.8 6H4.2s1.8-1.2 1.8-6" />
      <path d="M10.4 19.5a1.8 1.8 0 0 0 3.2 0" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10.5h17" />
    </>
  ),
  "chevron-down": <path d="m6 9.5 6 6 6-6" />,
  "chevron-left": <path d="m14.5 6-6 6 6 6" />,
  "chevron-right": <path d="m9.5 6 6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m19.8 19.8-3.3-3.3" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  upload: (
    <>
      <path d="M12 15.5v-11M7 9l5-5 5 5" />
      <path d="M4.5 20h15" />
    </>
  ),
  download: (
    <>
      <path d="M12 4.5v11M7 11l5 5 5-5" />
      <path d="M4.5 20h15" />
    </>
  ),
  pencil: (
    <>
      <path d="m14.5 5.5 4 4" />
      <path d="M12.7 7.3 4.5 15.5v4h4l8.2-8.2a2.83 2.83 0 0 0-4-4Z" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.5h5V7" />
      <path d="m6.5 7 1 13.5h9l1-13.5M10 11v6M14 11v6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M2.5 12S6 5.8 12 5.8a9.7 9.7 0 0 1 4.5 1.2M21.5 12S18 18.2 12 18.2a9.6 9.6 0 0 1-4.4-1.2" />
      <path d="m4 4 16 16" />
    </>
  ),
  "more-v": (
    <>
      <circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  x: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  warning: (
    <>
      <path d="M12 3.5 2.5 20.5h19Z" />
      <path d="M12 10v4.5M12 17.8v.01" />
    </>
  ),
  external: (
    <>
      <path d="M14 4.5h5.5V10M19.5 4.5 11 13" />
      <path d="M19.5 14v5.5h-15v-15H10" />
    </>
  ),
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
};

export function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Buttons
 * ──────────────────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "subtle" | "outline" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    "bg-[#1D4ED8] text-white hover:bg-[#1A44BE] focus-visible:outline-[#1D4ED8]",
  subtle:
    "bg-white text-[#1F2A44] border border-[#E7EAF0] hover:bg-slate-50 focus-visible:outline-[#1D4ED8]",
  outline:
    "bg-white text-[#1D4ED8] border border-[#1D4ED8]/40 hover:bg-blue-50 focus-visible:outline-[#1D4ED8]",
  danger:
    "bg-white text-red-600 border border-red-200 hover:bg-red-50 focus-visible:outline-red-500",
};

export function Button({
  variant = "subtle",
  icon,
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: IconName;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[variant]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Cards / badges / form controls
 * ──────────────────────────────────────────────────────────────────────── */

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-[#E7EAF0] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${className}`}
    >
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && (
              <h2 className="text-[15px] font-bold text-[#1F2A44]">{title}</h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Ring badge: tinted pill with a colored dot, e.g. "● Adopt". */
export function RingBadge({ ring }: { ring: RingDefinition }) {
  const color = ring.colors.blip;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
      style={{ backgroundColor: `${color}1A`, color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {ring.label.charAt(0) + ring.label.slice(1).toLowerCase()}
    </span>
  );
}

export function MovementGlyph({
  status,
  color = NAVY,
  size = 16,
}: {
  status: MovementStatus;
  color?: string;
  size?: number;
}) {
  const r = 7;
  const common = {
    fill: color,
    stroke: "#FFFFFF",
    strokeWidth: 1,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="-10 -10 20 20"
      aria-hidden="true"
      className="shrink-0"
    >
      {status === "no-change" && <circle r={r} {...common} />}
      {status === "moved-up" && (
        <polygon points={trianglePointsUp(r * 1.2)} {...common} />
      )}
      {status === "moved-down" && (
        <polygon points={trianglePointsDown(r * 1.2)} {...common} />
      )}
      {status === "new" && <polygon points={starPoints(r * 1.3)} {...common} />}
    </svg>
  );
}

export const MOVEMENT_LABELS: Record<MovementStatus, string> = {
  "no-change": "No change",
  "moved-up": "Moved up",
  "moved-down": "Moved down",
  new: "New",
};

export function MovementBadge({ status }: { status: MovementStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1F2A44]">
      <MovementGlyph status={status} />
      {MOVEMENT_LABELS[status]}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5.5 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] ${
        checked ? "bg-[#1D4ED8]" : "bg-slate-300"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all ${
          checked ? "left-5" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export const INPUT_BASE =
  "rounded-lg border border-[#E7EAF0] bg-white px-3 py-1.5 text-[13px] text-[#1F2A44] placeholder:text-slate-400 focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20";

export const INPUT_CLASS = `w-full ${INPUT_BASE}`;

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap gap-1 rounded-lg border border-[#E7EAF0] bg-slate-50 p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors ${
            value === option.value
              ? "bg-white text-[#1D4ED8] shadow-sm"
              : "text-slate-500 hover:text-[#1F2A44]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="absolute inset-0 bg-slate-900/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md rounded-xl border border-[#E7EAF0] bg-white p-5 shadow-xl">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-[#1F2A44]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-[#1F2A44]"
          >
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="text-[13px] text-slate-600">{children}</div>
        <footer className="mt-5 flex justify-end gap-2">{footer}</footer>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon: IconName;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon name={icon} size={20} />
      </span>
      <p className="text-sm font-semibold text-[#1F2A44]">{title}</p>
      <p className="max-w-[260px] text-xs text-slate-500">{body}</p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Formatters
 * ──────────────────────────────────────────────────────────────────────── */

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
