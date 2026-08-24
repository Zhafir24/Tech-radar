import { useState } from "react";
import { useAdmin, type PageId } from "./store";
import { Button, Icon, Modal, fmtDate, fmtDateTime, type IconName } from "./ui";
import pnmLogo from "./assets/pnm-logo.svg";
import { DashboardPage } from "./pages/DashboardPage";
import { ItemsPage } from "./pages/ItemsPage";
import { EditorPage } from "./pages/EditorPage";
import { ConfigPage } from "./pages/ConfigPage";

const PAGE_TITLES: Record<PageId, { title: string; subtitle: string }> = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Radar status, publish state and item distribution",
  },
  items: {
    title: "Manage Radar",
    subtitle: "Create, edit and organize radar items",
  },
  editor: {
    title: "Radar Editor",
    subtitle: "Live preview — click a blip to edit it",
  },
  config: {
    title: "Configuration",
    subtitle: "Rings, quadrants, appearance and publishing",
  },
};

export function AdminApp() {
  const { state, unpublished, navigate, publish, discard, dismissToast } =
    useAdmin();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { meta } = state.snapshot;
  const heading = PAGE_TITLES[state.page];

  return (
    <div className="flex min-h-screen bg-[#F5F7FB] font-sans text-[#1F2A44]">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-[#E7EAF0] bg-white transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Admin navigation"
      >
        <div className="px-5 pb-2 pt-5">
          <img
            src={pnmLogo}
            alt="PNM — Permodalan Nasional Madani"
            className="h-10 w-auto"
          />
          <p className="mt-1.5 text-sm font-semibold">Tech Radar</p>
          <p className="text-xs text-slate-400">Admin Console</p>
        </div>

        <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3">
          <NavItem page="dashboard" icon="home" label="Dashboard" />
          <p className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
            Radar Management
          </p>
          <NavItem page="items" icon="list" label="Items" />
          <NavItem page="editor" icon="radar" label="Radar Editor" />
          <NavItem page="config" icon="sliders" label="Configuration" />
          <p className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
            Workspace
          </p>
          <StubNavItem icon="chart" label="Reports" />
          <StubNavItem icon="doc" label="Changelog" />
          <StubNavItem icon="users" label="Users" />
          <StubNavItem icon="gear" label="Settings" />
          <StubNavItem icon="plug" label="Integrations" />
        </nav>

        <div className="m-3 rounded-xl border border-[#E7EAF0] bg-[#F8FAFD] p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
              Radar Version
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                meta.publishState === "published"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {meta.publishState === "published" ? "Active" : "Draft"}
            </span>
          </div>
          <p className="mt-1 text-xl font-bold">{meta.version}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {meta.publishedAt
              ? `Published on ${fmtDate(meta.publishedAt)}`
              : "Not published yet"}
          </p>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-[#E7EAF0] bg-white px-6 py-4">
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Icon name="menu" size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{heading.title}</h1>
            <p className="truncate text-xs text-slate-500">{heading.subtitle}</p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span
              className={`hidden rounded-full px-2.5 py-1 text-[11px] font-bold sm:inline-block ${
                unpublished
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {unpublished ? "Unpublished changes" : "Published"}
            </span>
            <span className="hidden items-center gap-2 rounded-lg border border-[#E7EAF0] px-3 py-1.5 text-[13px] font-medium md:inline-flex">
              <Icon name="calendar" size={15} className="text-slate-400" />
              {meta.version} (Current)
            </span>
            <span className="relative rounded-md p-1.5 text-slate-500">
              <Icon name="bell" size={18} />
              {unpublished && (
                <span
                  className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#1D4ED8]"
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1D4ED8] text-sm font-bold text-white">
                A
              </span>
              <span className="hidden text-left leading-tight xl:block">
                <span className="block text-[13px] font-semibold">Admin User</span>
                <span className="block text-[11px] text-slate-400">Super Admin</span>
              </span>
            </span>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-6 py-6">
          {state.page === "dashboard" && <DashboardPage />}
          {state.page === "items" && <ItemsPage />}
          {state.page === "editor" && <EditorPage />}
          {state.page === "config" && <ConfigPage />}
        </main>

        {/* ── Save / publish bar ─────────────────────────────────────── */}
        {unpublished && (
          <div className="sticky bottom-0 z-20 border-t border-[#E7EAF0] bg-white/95 px-6 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="h-2 w-2 rounded-full bg-amber-500"
                aria-hidden="true"
              />
              <p className="text-[13px] font-medium">
                Unpublished changes
                {state.lastSavedAt && (
                  <span className="ml-2 font-normal text-slate-400">
                    Draft autosaved {fmtDateTime(state.lastSavedAt)}
                  </span>
                )}
              </p>
              <div className="ml-auto flex items-center gap-2">
                <Button onClick={() => setConfirmDiscard(true)}>
                  Discard draft
                </Button>
                <Button variant="primary" icon="check" onClick={publish}>
                  Publish
                </Button>
              </div>
            </div>
          </div>
        )}

        <footer className="bg-[#1D4ED8] py-3 text-center text-[13px] text-white">
          © 2026 PNM Tech Radar. All rights reserved.
        </footer>
      </div>

      {/* ── Toasts ──────────────────────────────────────────────────── */}
      <div
        className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-72 flex-col gap-2"
        aria-live="polite"
      >
        {state.toasts.map((toastItem) => (
          <div
            key={toastItem.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border bg-white p-3 text-[13px] shadow-lg ${
              toastItem.kind === "error"
                ? "border-red-200"
                : toastItem.kind === "success"
                  ? "border-emerald-200"
                  : "border-[#E7EAF0]"
            }`}
            role="status"
          >
            <Icon
              name={
                toastItem.kind === "error"
                  ? "warning"
                  : toastItem.kind === "success"
                    ? "check"
                    : "bell"
              }
              size={15}
              className={
                toastItem.kind === "error"
                  ? "mt-0.5 text-red-500"
                  : toastItem.kind === "success"
                    ? "mt-0.5 text-emerald-600"
                    : "mt-0.5 text-slate-400"
              }
            />
            <p className="flex-1">{toastItem.message}</p>
            <button
              type="button"
              onClick={() => dismissToast(toastItem.id)}
              aria-label="Dismiss notification"
              className="text-slate-300 hover:text-slate-500"
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>

      {confirmDiscard && (
        <Modal
          title="Discard draft?"
          onClose={() => setConfirmDiscard(false)}
          footer={
            <>
              <Button onClick={() => setConfirmDiscard(false)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  discard();
                  setConfirmDiscard(false);
                }}
              >
                Discard changes
              </Button>
            </>
          }
        >
          All unpublished edits will be lost and the draft will be restored to
          the last published version. This cannot be undone.
        </Modal>
      )}
    </div>
  );

  function NavItem({
    page,
    icon,
    label,
  }: {
    page: PageId;
    icon: IconName;
    label: string;
  }) {
    const active = state.page === page;
    return (
      <button
        type="button"
        onClick={() => {
          navigate(page);
          setSidebarOpen(false);
        }}
        aria-current={active ? "page" : undefined}
        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${
          active
            ? "bg-[#1D4ED8] text-white"
            : "text-slate-600 hover:bg-slate-100 hover:text-[#1F2A44]"
        }`}
      >
        <Icon name={icon} size={16} />
        {label}
      </button>
    );
  }
}

/** Non-functional nav entry — present in the reference mockup only. */
function StubNavItem({ icon, label }: { icon: IconName; label: string }) {
  const { toast } = useAdmin();
  return (
    <button
      type="button"
      onClick={() => toast("info", `"${label}" is not part of this mockup`)}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-slate-400 hover:bg-slate-50"
    >
      <Icon name={icon} size={16} />
      {label}
      <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">
        Soon
      </span>
    </button>
  );
}
