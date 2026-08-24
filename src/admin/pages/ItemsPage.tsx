import { useMemo, useRef, useState } from "react";
import type {
  MovementStatus,
  QuadrantId,
  RingId,
} from "../../components/TechRadar/types";
import { CategoryIcon } from "../../components/TechRadar/CategoryIcon";
import { useAdmin } from "../store";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  INPUT_BASE,
  INPUT_CLASS,
  Modal,
  MovementBadge,
  MovementGlyph,
  MOVEMENT_LABELS,
  RingBadge,
  Toggle,
  fmtDateTime,
} from "../ui";

const PAGE_SIZE = 10;

type SortKey = "number" | "name" | "updatedAt";

export function ItemsPage() {
  const {
    state,
    patchBlip,
    addBlip,
    duplicateBlip,
    deleteBlips,
    bulkPatch,
    select,
    navigate,
    importJsonFile,
  } = useAdmin();
  const { config, meta } = state.snapshot;
  const ringById = useMemo(
    () => new Map(config.rings.map((r) => [r.id, r])),
    [config.rings],
  );
  const quadrantById = useMemo(
    () => new Map(config.quadrants.map((q) => [q.id, q])),
    [config.quadrants],
  );

  const [search, setSearch] = useState("");
  const [ringFilter, setRingFilter] = useState<"all" | RingId>("all");
  const [quadFilter, setQuadFilter] = useState<"all" | QuadrantId>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | MovementStatus>("all");
  const [sortKey, setSortKey] = useState<SortKey>("number");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [kebabId, setKebabId] = useState<string | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = config.blips.filter(
      (b) =>
        (query === "" || b.name.toLowerCase().includes(query)) &&
        (ringFilter === "all" || b.ring === ringFilter) &&
        (quadFilter === "all" || b.quadrant === quadFilter) &&
        (statusFilter === "all" || b.status === statusFilter),
    );
    const dir = sortAsc ? 1 : -1;
    rows.sort((a, b) => {
      if (sortKey === "number") return (a.number - b.number) * dir;
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
      return (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "") * dir;
    });
    return rows;
  }, [config.blips, search, ringFilter, quadFilter, statusFilter, sortKey, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );
  const detailsBlip = detailsId
    ? (config.blips.find((b) => b.id === detailsId) ?? null)
    : null;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const toggleChecked = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allPageChecked =
    pageRows.length > 0 && pageRows.every((b) => checked.has(b.id));

  const editInRadar = (id: string) => {
    select(id);
    navigate("editor");
  };

  /* Analytics */
  const ringCounts = config.rings.map((ring) => ({
    ring,
    count: config.blips.filter((b) => b.ring === ring.id).length,
  }));
  const quadCounts = config.quadrants.map((quadrant) => ({
    quadrant,
    count: config.blips.filter((b) => b.quadrant === quadrant.id).length,
  }));
  const maxQuad = Math.max(1, ...quadCounts.map((q) => q.count));
  const statusOrder: MovementStatus[] = ["moved-up", "moved-down", "new", "no-change"];
  const statusCounts = statusOrder.map((status) => ({
    status,
    count: config.blips.filter((b) => b.status === status).length,
  }));
  const total = config.blips.length;

  return (
    <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-6">
        <Card
          title="Items"
          subtitle="Create, edit and organize radar items"
          actions={
            <>
              <input
                ref={importRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importJsonFile(file);
                  e.target.value = "";
                }}
              />
              <Button icon="upload" onClick={() => importRef.current?.click()}>
                Import JSON
              </Button>
              <Button variant="primary" icon="plus" onClick={() => setShowAdd(true)}>
                Add Item
              </Button>
            </>
          }
        >
          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Icon
                name="search"
                size={15}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Search items…"
                aria-label="Search items"
                className={`${INPUT_BASE} w-52 pl-8`}
              />
            </div>
            <select
              value={ringFilter}
              onChange={(e) => {
                setRingFilter(e.target.value as "all" | RingId);
                setPage(0);
              }}
              aria-label="Filter by ring"
              className={`${INPUT_BASE} w-auto`}
            >
              <option value="all">All Rings</option>
              {config.rings.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <select
              value={quadFilter}
              onChange={(e) => {
                setQuadFilter(e.target.value as "all" | QuadrantId);
                setPage(0);
              }}
              aria-label="Filter by quadrant"
              className={`${INPUT_BASE} w-auto`}
            >
              <option value="all">All Quadrants</option>
              {config.quadrants.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as "all" | MovementStatus);
                setPage(0);
              }}
              aria-label="Filter by movement"
              className={`${INPUT_BASE} w-auto`}
            >
              <option value="all">All Movements</option>
              {statusOrder.map((s) => (
                <option key={s} value={s}>
                  {MOVEMENT_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          {/* Bulk actions */}
          {checked.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#1D4ED8]/25 bg-blue-50/60 px-3 py-2 text-[13px]">
              <span className="font-semibold">{checked.size} selected</span>
              <Button
                icon="eye-off"
                onClick={() => bulkPatch([...checked], { hidden: true })}
              >
                Hide
              </Button>
              <Button
                icon="eye"
                onClick={() => bulkPatch([...checked], { hidden: false })}
              >
                Show
              </Button>
              <select
                aria-label="Move selected to ring"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    bulkPatch([...checked], { ring: e.target.value as RingId });
                    e.target.value = "";
                  }
                }}
                className={`${INPUT_BASE} w-auto`}
              >
                <option value="" disabled>
                  Move to ring…
                </option>
                {config.rings.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <Button variant="danger" icon="trash" onClick={() => setDeleteIds([...checked])}>
                Delete
              </Button>
              <button
                type="button"
                className="ml-auto text-[12px] font-semibold text-slate-500 hover:text-[#1F2A44]"
                onClick={() => setChecked(new Set())}
              >
                Clear selection
              </button>
            </div>
          )}

          {/* Table */}
          {filtered.length === 0 ? (
            <EmptyState
              icon="search"
              title="No items match"
              body="Try clearing the search or filters, or add a new item."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[#E7EAF0] text-[11px] font-bold uppercase tracking-[0.05em] text-slate-400">
                    <th className="py-2 pr-2">
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={allPageChecked}
                        onChange={() =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            if (allPageChecked)
                              pageRows.forEach((b) => next.delete(b.id));
                            else pageRows.forEach((b) => next.add(b.id));
                            return next;
                          })
                        }
                      />
                    </th>
                    <SortHeader label="ID" active={sortKey === "number"} asc={sortAsc} onClick={() => toggleSort("number")} />
                    <SortHeader label="Name" active={sortKey === "name"} asc={sortAsc} onClick={() => toggleSort("name")} />
                    <th className="px-2 py-2">Ring</th>
                    <th className="px-2 py-2">Quadrant</th>
                    <th className="px-2 py-2">Movement</th>
                    <th className="px-2 py-2">Visible</th>
                    <SortHeader label="Updated" active={sortKey === "updatedAt"} asc={sortAsc} onClick={() => toggleSort("updatedAt")} />
                    <th className="px-2 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((blip) => {
                    const ring = ringById.get(blip.ring);
                    const quadrant = quadrantById.get(blip.quadrant);
                    const isDetails = detailsId === blip.id;
                    return (
                      <tr
                        key={blip.id}
                        onClick={() => setDetailsId(blip.id)}
                        className={`cursor-pointer border-b border-[#F0F2F6] transition-colors ${
                          isDetails ? "bg-blue-50/70" : "hover:bg-slate-50"
                        } ${blip.hidden ? "opacity-50" : ""}`}
                      >
                        <td className="py-2.5 pr-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${blip.name}`}
                            checked={checked.has(blip.id)}
                            onChange={() => toggleChecked(blip.id)}
                          />
                        </td>
                        <td className="px-2 py-2.5 tabular-nums text-slate-500">
                          #{blip.number}
                        </td>
                        <td className="px-2 py-2.5 font-semibold">{blip.name}</td>
                        <td className="px-2 py-2.5">
                          {ring && <RingBadge ring={ring} />}
                        </td>
                        <td className="px-2 py-2.5 text-slate-600">
                          {quadrant?.label}
                        </td>
                        <td className="px-2 py-2.5">
                          <MovementBadge status={blip.status} />
                        </td>
                        <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <Toggle
                            checked={!blip.hidden}
                            onChange={(visible) =>
                              patchBlip(blip.id, { hidden: !visible })
                            }
                            label={`Toggle visibility of ${blip.name}`}
                          />
                        </td>
                        <td className="px-2 py-2.5 text-slate-500">
                          {fmtDateTime(blip.updatedAt)}
                        </td>
                        <td
                          className="relative px-2 py-2.5 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            aria-label={`Edit ${blip.name} in radar editor`}
                            onClick={() => editInRadar(blip.id)}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[#1D4ED8]"
                          >
                            <Icon name="pencil" size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label={`More actions for ${blip.name}`}
                            aria-expanded={kebabId === blip.id}
                            onClick={() =>
                              setKebabId(kebabId === blip.id ? null : blip.id)
                            }
                            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[#1F2A44]"
                          >
                            <Icon name="more-v" size={15} />
                          </button>
                          {kebabId === blip.id && (
                            <>
                              <div
                                className="fixed inset-0 z-10"
                                onClick={() => setKebabId(null)}
                                aria-hidden="true"
                              />
                              <div className="absolute right-2 top-10 z-20 w-40 rounded-lg border border-[#E7EAF0] bg-white py-1 text-left shadow-lg">
                                <KebabItem
                                  icon="copy"
                                  label="Duplicate"
                                  onClick={() => {
                                    duplicateBlip(blip.id);
                                    setKebabId(null);
                                  }}
                                />
                                <KebabItem
                                  icon={blip.hidden ? "eye" : "eye-off"}
                                  label={blip.hidden ? "Show on radar" : "Hide from radar"}
                                  onClick={() => {
                                    patchBlip(blip.id, { hidden: !blip.hidden });
                                    setKebabId(null);
                                  }}
                                />
                                <KebabItem
                                  icon="trash"
                                  label="Delete"
                                  danger
                                  onClick={() => {
                                    setDeleteIds([blip.id]);
                                    setKebabId(null);
                                  }}
                                />
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-slate-500">
            <span>
              Showing {filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1}
              {"–"}
              {Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)} of{" "}
              {filtered.length} items
            </span>
            <div className="ml-auto flex items-center gap-1">
              <PageButton
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                ariaLabel="Previous page"
              >
                <Icon name="chevron-left" size={14} />
              </PageButton>
              {Array.from({ length: pageCount }, (_, i) => (
                <PageButton
                  key={i}
                  active={i === safePage}
                  onClick={() => setPage(i)}
                  ariaLabel={`Page ${i + 1}`}
                >
                  {i + 1}
                </PageButton>
              ))}
              <PageButton
                disabled={safePage === pageCount - 1}
                onClick={() => setPage(safePage + 1)}
                ariaLabel="Next page"
              >
                <Icon name="chevron-right" size={14} />
              </PageButton>
            </div>
          </div>
        </Card>

        {/* Analytics row */}
        <div className="grid gap-6 md:grid-cols-3">
          <Card title="Items by Ring">
            <div className="flex items-center gap-5">
              <Donut
                segments={ringCounts.map(({ ring, count }) => ({
                  color: ring.colors.blip,
                  value: count,
                }))}
                total={total}
              />
              <ul className="space-y-1.5 text-[12px]">
                {ringCounts.map(({ ring, count }) => (
                  <li key={ring.id} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: ring.colors.blip }}
                    />
                    <span className="font-semibold">{ring.label}</span>
                    <span className="text-slate-400">
                      {count} ({total === 0 ? 0 : Math.round((count / total) * 100)}%)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card title="Items by Quadrant">
            <ul className="space-y-2.5">
              {quadCounts.map(({ quadrant, count }) => (
                <li key={quadrant.id} className="text-[12px]">
                  <div className="mb-1 flex justify-between">
                    <span className="font-semibold">{quadrant.label}</span>
                    <span className="text-slate-400">{count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-[#1D4ED8]"
                      style={{ width: `${(count / maxQuad) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title={`Movements (${meta.version})`}>
            <ul className="space-y-2.5 text-[13px]">
              {statusCounts.map(({ status, count }) => (
                <li key={status} className="flex items-center gap-2.5">
                  <MovementGlyph status={status} />
                  <span className="font-semibold">{MOVEMENT_LABELS[status]}</span>
                  <span className="ml-auto text-slate-400">
                    {count} ({total === 0 ? 0 : Math.round((count / total) * 100)}%)
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {/* ── Item Details panel ─────────────────────────────────────────── */}
      {detailsBlip && (
        <>
          <div
            className="fixed inset-0 z-30 bg-slate-900/20 2xl:hidden"
            onClick={() => setDetailsId(null)}
            aria-hidden="true"
          />
          <aside
            aria-label={`Details for ${detailsBlip.name}`}
            className="fixed inset-y-0 right-0 z-40 w-[320px] overflow-y-auto border-l border-[#E7EAF0] bg-white p-5 shadow-xl 2xl:static 2xl:z-auto 2xl:w-auto 2xl:rounded-xl 2xl:border 2xl:shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
          >
            <div className="mb-3 flex items-start justify-between">
              <h3 className="text-[15px] font-bold">Item Details</h3>
              <button
                type="button"
                onClick={() => setDetailsId(null)}
                aria-label="Close details"
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            {(() => {
              const ring = ringById.get(detailsBlip.ring);
              const quadrant = quadrantById.get(detailsBlip.quadrant);
              return (
                <div className="space-y-4 text-[13px]">
                  <div>
                    {ring && <RingBadge ring={ring} />}
                    <p className="mt-2 text-lg font-bold">{detailsBlip.name}</p>
                    <p className="text-[11px] text-slate-400">
                      ID: #{detailsBlip.number}
                      {detailsBlip.hidden ? " · Hidden from radar" : ""}
                    </p>
                  </div>

                  <div>
                    <DetailLabel>Quadrant</DetailLabel>
                    <p className="flex items-center gap-2 font-medium">
                      {quadrant && (
                        <svg
                          width={16}
                          height={16}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-slate-500"
                          aria-hidden="true"
                        >
                          <CategoryIcon.Glyph icon={quadrant.icon} />
                        </svg>
                      )}
                      {quadrant?.label}
                    </p>
                  </div>

                  <div>
                    <DetailLabel>Since Version</DetailLabel>
                    <p className="font-medium">{detailsBlip.since || "—"}</p>
                  </div>

                  {detailsBlip.owner && (
                    <div>
                      <DetailLabel>Owner</DetailLabel>
                      <p className="font-medium">{detailsBlip.owner}</p>
                    </div>
                  )}

                  <div>
                    <DetailLabel>Description</DetailLabel>
                    <p className="leading-relaxed text-slate-600">
                      {detailsBlip.description || "No description yet."}
                    </p>
                  </div>

                  <div>
                    <DetailLabel>Movement</DetailLabel>
                    <ul className="space-y-2">
                      {detailsBlip.since && detailsBlip.since !== meta.version && (
                        <li className="flex items-center gap-2 text-slate-500">
                          <span className="h-2 w-2 rounded-full bg-slate-300" />
                          <span className="tabular-nums">{detailsBlip.since}</span>
                          <span>Added to radar</span>
                        </li>
                      )}
                      <li className="flex items-center gap-2">
                        <MovementGlyph status={detailsBlip.status} size={14} />
                        <span className="tabular-nums">{meta.version}</span>
                        <span className="font-medium">
                          {MOVEMENT_LABELS[detailsBlip.status]}
                        </span>
                        <span className="ml-auto rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-[#1D4ED8]">
                          Current
                        </span>
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2 border-t border-[#F0F2F6] pt-4">
                    <Button
                      variant="outline"
                      icon="pencil"
                      className="w-full justify-center"
                      onClick={() => editInRadar(detailsBlip.id)}
                    >
                      Edit Item
                    </Button>
                    <Button
                      variant="danger"
                      icon="trash"
                      className="w-full justify-center border-transparent"
                      onClick={() => setDeleteIds([detailsBlip.id])}
                    >
                      Delete Item
                    </Button>
                  </div>
                </div>
              );
            })()}
          </aside>
        </>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {deleteIds && (
        <Modal
          title={deleteIds.length === 1 ? "Delete item?" : `Delete ${deleteIds.length} items?`}
          onClose={() => setDeleteIds(null)}
          footer={
            <>
              <Button onClick={() => setDeleteIds(null)}>Cancel</Button>
              <Button
                variant="danger"
                icon="trash"
                onClick={() => {
                  deleteBlips(deleteIds);
                  setChecked((prev) => {
                    const next = new Set(prev);
                    deleteIds.forEach((id) => next.delete(id));
                    return next;
                  });
                  if (detailsId && deleteIds.includes(detailsId)) setDetailsId(null);
                  setDeleteIds(null);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          The selected {deleteIds.length === 1 ? "item" : "items"} will be removed
          from the draft radar. Publishing afterwards makes the removal live.
        </Modal>
      )}

      {showAdd && <AddItemModal onClose={() => setShowAdd(false)} onAdd={addBlip} />}
    </div>
  );
}

/* ── Small local components ─────────────────────────────────────────────── */

function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">
      {children}
    </p>
  );
}

function SortHeader({
  label,
  active,
  asc,
  onClick,
}: {
  label: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
}) {
  return (
    <th className="px-2 py-2">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-[0.05em] ${
          active ? "text-[#1D4ED8]" : "hover:text-[#1F2A44]"
        }`}
      >
        {label}
        {active && (
          <Icon name="chevron-down" size={11} className={asc ? "rotate-180" : ""} />
        )}
      </button>
    </th>
  );
}

function PageButton({
  children,
  onClick,
  active = false,
  disabled = false,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-current={active ? "page" : undefined}
      className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[12px] font-semibold transition-colors disabled:opacity-40 ${
        active
          ? "bg-[#1D4ED8] text-white"
          : "border border-[#E7EAF0] bg-white text-slate-500 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function KebabItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: "copy" | "eye" | "eye-off" | "trash";
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] font-medium ${
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-600 hover:bg-slate-50"
      }`}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

function Donut({
  segments,
  total,
}: {
  segments: Array<{ color: string; value: number }>;
  total: number;
}) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let start = 0;
  return (
    <svg width={110} height={110} viewBox="0 0 110 110" aria-hidden="true">
      <g transform="rotate(-90 55 55)">
        {segments.map((segment, index) => {
          const length =
            total === 0 ? 0 : (segment.value / total) * circumference;
          const dashOffset = -start;
          start += length;
          return (
            <circle
              key={index}
              cx={55}
              cy={55}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={13}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={dashOffset}
            />
          );
        })}
      </g>
      <text
        x={55}
        y={51}
        textAnchor="middle"
        className="fill-[#1F2A44] text-xl font-bold"
      >
        {total}
      </text>
      <text x={55} y={67} textAnchor="middle" className="fill-slate-400 text-[10px]">
        Total
      </text>
    </svg>
  );
}

function AddItemModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (name: string, ring: RingId, quadrant: QuadrantId) => void;
}) {
  const { state } = useAdmin();
  const { config } = state.snapshot;
  const [name, setName] = useState("");
  const [ring, setRing] = useState<RingId>("adopt");
  const [quadrant, setQuadrant] = useState<QuadrantId>("infrastructure");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed, ring, quadrant);
    onClose();
  };

  return (
    <Modal
      title="Add Item"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="plus" disabled={!name.trim()} onClick={submit}>
            Create item
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="e.g. Vector Databases"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Ring">
          <select
            value={ring}
            onChange={(e) => setRing(e.target.value as RingId)}
            className={INPUT_CLASS}
          >
            {config.rings.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quadrant">
          <select
            value={quadrant}
            onChange={(e) => setQuadrant(e.target.value as QuadrantId)}
            className={INPUT_CLASS}
          >
            {config.quadrants.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-[11px] text-slate-400">
          The new item is created with "New" status and placed automatically by
          the scatter algorithm. It opens in the Radar Editor.
        </p>
      </div>
    </Modal>
  );
}
