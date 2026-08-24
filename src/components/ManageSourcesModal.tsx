import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * "Manage sources" dialog.
 *
 * Talks to the local /api endpoints mounted by scripts/api/sources-api.mjs
 * via the Vite dev plugin. These endpoints only exist during `npm run dev`;
 * a deployed static site has no backend and this dialog gracefully reports
 * that when it fails to load.
 */

interface SourcesConfig {
  builtIn: Record<string, { enabled: boolean }>;
  custom: Array<{ id: string; name: string; url: string; enabled: boolean }>;
}

interface ScrapeState {
  running: boolean;
  lastExitCode: number | null;
  lastError: string | null;
  tail: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

const BUILT_IN_DISPLAY: Record<string, string> = {
  "dev.to": "dev.to",
  "github-trending": "GitHub Trending",
  thehackernews: "The Hacker News",
  infoq: "InfoQ",
  lobsters: "Lobste.rs",
};

interface Props {
  onClose: () => void;
  /** Called after a rescrape finishes so the parent can refresh the radar. */
  onAfterScrape: () => void | Promise<void>;
}

export function ManageSourcesModal({ onClose, onAfterScrape }: Props) {
  const [config, setConfig] = useState<SourcesConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [scrape, setScrape] = useState<ScrapeState | null>(null);
  const pollRef = useRef<number | null>(null);
  const notifiedFinishedAt = useRef<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/sources", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfig(await res.json());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadScrapeState = useCallback(async () => {
    try {
      const res = await fetch("/api/scrape", { cache: "no-store" });
      if (res.ok) setScrape(await res.json());
    } catch {
      /* silent — polling only */
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadScrapeState();
  }, [loadConfig, loadScrapeState]);

  // Poll scrape state while a run is active so the tail updates live.
  useEffect(() => {
    if (!scrape?.running) {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current === null) {
      pollRef.current = window.setInterval(() => {
        void loadScrapeState();
      }, 1200);
    }
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [scrape?.running, loadScrapeState]);

  // Once a scrape finishes, notify parent so the radar reloads its data.
  useEffect(() => {
    if (!scrape) return;
    if (scrape.running) return;
    if (!scrape.finishedAt) return;
    if (notifiedFinishedAt.current === scrape.finishedAt) return;
    notifiedFinishedAt.current = scrape.finishedAt;
    void onAfterScrape();
  }, [scrape, onAfterScrape]);

  // ESC to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const enabledCount = useMemo(() => {
    if (!config) return 0;
    const b = Object.values(config.builtIn).filter((v) => v.enabled).length;
    const c = config.custom.filter((v) => v.enabled).length;
    return b + c;
  }, [config]);

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      setBusyId(id);
      setActionError(null);
      try {
        const res = await fetch(
          `/api/sources/${encodeURIComponent(id)}/toggle`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled }),
          },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        await loadConfig();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [loadConfig],
  );

  const removeCustom = useCallback(
    async (id: string) => {
      setBusyId(id);
      setActionError(null);
      try {
        const res = await fetch(`/api/sources/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        await loadConfig();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [loadConfig],
  );

  const addCustom = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!newUrl.trim()) {
        setActionError("Please enter a website URL.");
        return;
      }
      setAdding(true);
      setActionError(null);
      try {
        const res = await fetch("/api/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName.trim(), url: newUrl.trim() }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setNewName("");
        setNewUrl("");
        await loadConfig();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setAdding(false);
      }
    },
    [newName, newUrl, loadConfig],
  );

  const startScrape = useCallback(async () => {
    setActionError(null);
    try {
      const res = await fetch("/api/scrape", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadScrapeState();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [loadScrapeState]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Manage sources"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-[15px] font-bold text-[#1F2A44]">
              Manage sources
            </h2>
            <p className="text-[11.5px] text-slate-500">
              {config
                ? `${enabledCount} enabled · changes take effect on next scrape`
                : "Loading…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <XIcon />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 text-[13px]">
          {loadError && (
            <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">
              <strong>Backend unreachable.</strong> {loadError}. This tool
              needs the local dev server (<code>npm run dev</code>) running.
              It cannot manage sources on a deployed static site.
            </div>
          )}
          {actionError && (
            <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">
              {actionError}
            </div>
          )}

          {config && (
            <>
              {/* Built-in sources */}
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                  Built-in sources
                </h3>
                <ul className="mt-2 divide-y divide-slate-100 rounded border border-slate-200">
                  {Object.entries(config.builtIn).map(([id, v]) => (
                    <li
                      key={id}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <span className="flex-1 font-medium text-slate-800">
                        {BUILT_IN_DISPLAY[id] ?? id}
                      </span>
                      <Toggle
                        enabled={v.enabled}
                        busy={busyId === id}
                        onChange={(next) => toggle(id, next)}
                      />
                    </li>
                  ))}
                </ul>
              </div>

              {/* Custom sources */}
              <div className="mt-5">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                  Custom websites
                </h3>
                {config.custom.length === 0 ? (
                  <p className="mt-2 rounded border border-dashed border-slate-200 px-3 py-3 text-slate-500">
                    No custom websites yet. Add one below.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-slate-100 rounded border border-slate-200">
                    {config.custom.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center gap-3 px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-slate-800">
                            {c.name}
                          </div>
                          <div className="truncate text-[11.5px] text-slate-500">
                            {c.url}
                          </div>
                        </div>
                        <Toggle
                          enabled={c.enabled}
                          busy={busyId === c.id}
                          onChange={(next) => toggle(c.id, next)}
                        />
                        <button
                          type="button"
                          onClick={() => removeCustom(c.id)}
                          disabled={busyId === c.id}
                          aria-label={`Remove ${c.name}`}
                          className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                        >
                          <TrashIcon />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Add form — URL is the only required input.
                    Name is optional; if omitted, the backend derives it
                    from the URL hostname. */}
                <form
                  onSubmit={addCustom}
                  className="mt-3 rounded border border-slate-200 bg-slate-50/60 p-3"
                >
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Website URL
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      required
                      placeholder="e.g. arstechnica.com/information-technology"
                      className="flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-[13px] focus:border-[#1F2A44] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={adding || !newUrl.trim()}
                      className="rounded bg-emerald-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {adding ? "Adding…" : "Add"}
                    </button>
                  </div>
                  <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Name <span className="font-normal normal-case text-slate-400">(optional — we'll use the domain if left blank)</span>
                  </label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    maxLength={60}
                    placeholder="e.g. Ars Technica"
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-[13px] focus:border-[#1F2A44] focus:outline-none"
                  />
                </form>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Paste any website URL. We auto-detect the site's feed if
                  it has one, otherwise scrape the homepage for article
                  links. Sites that render entirely in JavaScript may yield
                  0 items.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <div className="min-w-0 flex-1 text-[12px] text-slate-600">
            {scrape?.running ? (
              <span className="flex items-center gap-2">
                <Spinner /> Scraping…
                {scrape.tail.length > 0 && (
                  <span className="truncate text-slate-500">
                    · {scrape.tail[scrape.tail.length - 1]}
                  </span>
                )}
              </span>
            ) : scrape?.finishedAt ? (
              <span>
                Last run{" "}
                {scrape.lastExitCode === 0 ? (
                  <span className="text-emerald-700">succeeded</span>
                ) : (
                  <span className="text-red-700">
                    failed (exit {scrape.lastExitCode})
                  </span>
                )}
              </span>
            ) : (
              <span className="text-slate-500">Idle</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-[#1F2A44] hover:bg-slate-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={startScrape}
            disabled={scrape?.running || !!loadError}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {scrape?.running ? "Running…" : "Rescrape now"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── small components ─────────────────── */

function Toggle({
  enabled,
  busy,
  onChange,
}: {
  enabled: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={busy}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        enabled ? "bg-emerald-500" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function XIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
