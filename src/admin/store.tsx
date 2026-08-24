import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BlipDefinition,
  QuadrantId,
  RingId,
} from "../components/TechRadar/types";
import {
  DRAFT_KEY,
  PUBLISHED_KEY,
  clearSnapshot,
  defaultSnapshot,
  loadSnapshot,
  parseSnapshot,
  saveSnapshot,
  type RadarMeta,
  type RadarSnapshot,
} from "../components/TechRadar/persistence";

/* ────────────────────────────────────────────────────────────────────────
 * State model
 * ──────────────────────────────────────────────────────────────────────── */

export type PageId = "dashboard" | "items" | "editor" | "config";

export interface ToastItem {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

interface AdminState {
  snapshot: RadarSnapshot;
  selectedId: string | null;
  page: PageId;
  toasts: ToastItem[];
  lastSavedAt: string | null;
}

type Action =
  | { type: "patch-blip"; id: string; patch: Partial<BlipDefinition> }
  | { type: "add-blip"; blip: BlipDefinition }
  | { type: "duplicate-blip"; id: string; newId: string }
  | { type: "delete-blips"; ids: string[] }
  | { type: "bulk-patch"; ids: string[]; patch: Partial<BlipDefinition> }
  | { type: "patch-ring"; id: RingId; label?: string; primary?: string; stroke?: string }
  | { type: "patch-quadrant"; id: QuadrantId; label: string }
  | { type: "patch-meta"; patch: Partial<RadarMeta> }
  | { type: "patch-blip-radius"; radius: number }
  | { type: "replace-snapshot"; snapshot: RadarSnapshot }
  | { type: "select"; id: string | null }
  | { type: "navigate"; page: PageId }
  | { type: "toast-add"; toast: ToastItem }
  | { type: "toast-remove"; id: number }
  | { type: "saved"; at: string };

function nowIso(): string {
  return new Date().toISOString();
}

function reducer(state: AdminState, action: Action): AdminState {
  const { snapshot } = state;
  const { config } = snapshot;

  switch (action.type) {
    case "patch-blip": {
      const blips = config.blips.map((blip) => {
        if (blip.id !== action.id) return blip;
        const next: BlipDefinition = {
          ...blip,
          ...action.patch,
          updatedAt: nowIso(),
        };
        // Changing ring or quadrant invalidates a manual position — the
        // scatter algorithm re-places the blip in its new segment.
        const movedSegment =
          (action.patch.ring !== undefined && action.patch.ring !== blip.ring) ||
          (action.patch.quadrant !== undefined &&
            action.patch.quadrant !== blip.quadrant);
        if (movedSegment && action.patch.angle === undefined) {
          next.angle = undefined;
          next.radiusFraction = undefined;
        }
        return next;
      });
      return {
        ...state,
        snapshot: { ...snapshot, config: { ...config, blips } },
      };
    }

    case "add-blip":
      return {
        ...state,
        selectedId: action.blip.id,
        snapshot: {
          ...snapshot,
          config: { ...config, blips: [...config.blips, action.blip] },
        },
      };

    case "duplicate-blip": {
      const source = config.blips.find((b) => b.id === action.id);
      if (!source) return state;
      const maxNumber = Math.max(0, ...config.blips.map((b) => b.number));
      const copy: BlipDefinition = {
        ...source,
        id: action.newId,
        number: maxNumber + 1,
        name: `${source.name} (copy)`,
        angle: undefined,
        radiusFraction: undefined,
        updatedAt: nowIso(),
      };
      return {
        ...state,
        selectedId: copy.id,
        snapshot: {
          ...snapshot,
          config: { ...config, blips: [...config.blips, copy] },
        },
      };
    }

    case "delete-blips": {
      const remove = new Set(action.ids);
      return {
        ...state,
        selectedId:
          state.selectedId && remove.has(state.selectedId)
            ? null
            : state.selectedId,
        snapshot: {
          ...snapshot,
          config: {
            ...config,
            blips: config.blips.filter((b) => !remove.has(b.id)),
          },
        },
      };
    }

    case "bulk-patch": {
      const ids = new Set(action.ids);
      const blips = config.blips.map((blip) =>
        ids.has(blip.id)
          ? { ...blip, ...action.patch, updatedAt: nowIso() }
          : blip,
      );
      return {
        ...state,
        snapshot: { ...snapshot, config: { ...config, blips } },
      };
    }

    case "patch-ring": {
      const rings = config.rings.map((ring) =>
        ring.id === action.id
          ? {
              ...ring,
              label: action.label ?? ring.label,
              colors: {
                ring: action.stroke ?? ring.colors.ring,
                label: action.primary ?? ring.colors.label,
                blip: action.primary ?? ring.colors.blip,
              },
            }
          : ring,
      );
      return {
        ...state,
        snapshot: { ...snapshot, config: { ...config, rings } },
      };
    }

    case "patch-quadrant": {
      const quadrants = config.quadrants.map((quadrant) =>
        quadrant.id === action.id
          ? { ...quadrant, label: action.label }
          : quadrant,
      );
      return {
        ...state,
        snapshot: { ...snapshot, config: { ...config, quadrants } },
      };
    }

    case "patch-meta":
      return {
        ...state,
        snapshot: { ...snapshot, meta: { ...snapshot.meta, ...action.patch } },
      };

    case "patch-blip-radius":
      return {
        ...state,
        snapshot: {
          ...snapshot,
          config: {
            ...config,
            blipStyle: { ...config.blipStyle, radius: action.radius },
          },
        },
      };

    case "replace-snapshot":
      return { ...state, snapshot: action.snapshot, selectedId: null };

    case "select":
      return { ...state, selectedId: action.id };

    case "navigate":
      return { ...state, page: action.page };

    case "toast-add":
      return { ...state, toasts: [...state.toasts, action.toast] };

    case "toast-remove":
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.id),
      };

    case "saved":
      return { ...state, lastSavedAt: action.at };
  }
}

function initState(): AdminState {
  const snapshot =
    loadSnapshot(DRAFT_KEY) ?? loadSnapshot(PUBLISHED_KEY) ?? defaultSnapshot();
  return {
    snapshot,
    selectedId: null,
    page: "items",
    toasts: [],
    lastSavedAt: null,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Context
 * ──────────────────────────────────────────────────────────────────────── */

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

/** Serializable projection used to detect unpublished changes. */
function comparable(snapshot: RadarSnapshot): string {
  return JSON.stringify({
    config: snapshot.config,
    title: snapshot.meta.title,
    version: snapshot.meta.version,
  });
}

export interface AdminContextValue {
  state: AdminState;
  /** True when the draft differs from the last published snapshot. */
  unpublished: boolean;
  patchBlip: (id: string, patch: Partial<BlipDefinition>) => void;
  addBlip: (name: string, ring: RingId, quadrant: QuadrantId) => void;
  duplicateBlip: (id: string) => void;
  deleteBlips: (ids: string[]) => void;
  bulkPatch: (ids: string[], patch: Partial<BlipDefinition>) => void;
  patchRing: (
    id: RingId,
    patch: { label?: string; primary?: string; stroke?: string },
  ) => void;
  patchQuadrant: (id: QuadrantId, label: string) => void;
  patchMeta: (patch: Partial<RadarMeta>) => void;
  patchBlipRadius: (radius: number) => void;
  select: (id: string | null) => void;
  navigate: (page: PageId) => void;
  publish: () => void;
  discard: () => void;
  resetToDefaults: () => void;
  exportJson: () => void;
  exportCsv: () => void;
  importJsonFile: (file: File) => void;
  toast: (kind: ToastItem["kind"], message: string) => void;
  dismissToast: (id: number) => void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error("useAdmin must be used inside <AdminProvider>");
  return value;
}

function download(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);
  const [publishStamp, setPublishStamp] = useState(0);
  const toastId = useRef(0);
  const firstRender = useRef(true);

  /* Autosave the draft (debounced) whenever the snapshot changes. */
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      if (saveSnapshot(DRAFT_KEY, state.snapshot)) {
        dispatch({ type: "saved", at: nowIso() });
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [state.snapshot]);

  const toast = useCallback((kind: ToastItem["kind"], message: string) => {
    const id = ++toastId.current;
    dispatch({ type: "toast-add", toast: { id, kind, message } });
    setTimeout(() => dispatch({ type: "toast-remove", id }), 3500);
  }, []);

  const unpublished = useMemo(() => {
    const published = loadSnapshot(PUBLISHED_KEY);
    if (!published) return true;
    return comparable(published) !== comparable(state.snapshot);
    // publishStamp forces re-evaluation right after a publish.
  }, [state.snapshot, publishStamp]);

  const value = useMemo<AdminContextValue>(() => {
    const patchBlip: AdminContextValue["patchBlip"] = (id, patch) =>
      dispatch({ type: "patch-blip", id, patch });

    const uniqueId = (base: string): string => {
      const existing = new Set(state.snapshot.config.blips.map((b) => b.id));
      let id = base;
      let counter = 2;
      while (existing.has(id)) id = `${base}-${counter++}`;
      return id;
    };

    return {
      state,
      unpublished,
      patchBlip,

      addBlip: (name, ring, quadrant) => {
        const maxNumber = Math.max(
          0,
          ...state.snapshot.config.blips.map((b) => b.number),
        );
        const blip: BlipDefinition = {
          id: uniqueId(slugify(name)),
          number: maxNumber + 1,
          name,
          ring,
          quadrant,
          status: "new",
          since: state.snapshot.meta.version,
          updatedAt: nowIso(),
        };
        dispatch({ type: "add-blip", blip });
        dispatch({ type: "navigate", page: "editor" });
        toast("success", `"${name}" created — placed in the ${ring} ring`);
      },

      duplicateBlip: (id) => {
        const source = state.snapshot.config.blips.find((b) => b.id === id);
        if (!source) return;
        dispatch({ type: "duplicate-blip", id, newId: uniqueId(`${source.id}-copy`) });
        toast("success", `Duplicated "${source.name}"`);
      },

      deleteBlips: (ids) => {
        dispatch({ type: "delete-blips", ids });
        toast("info", ids.length === 1 ? "Item deleted" : `${ids.length} items deleted`);
      },

      bulkPatch: (ids, patch) => dispatch({ type: "bulk-patch", ids, patch }),

      patchRing: (id, patch) => dispatch({ type: "patch-ring", id, ...patch }),
      patchQuadrant: (id, label) => dispatch({ type: "patch-quadrant", id, label }),
      patchMeta: (patch) => dispatch({ type: "patch-meta", patch }),
      patchBlipRadius: (radius) => dispatch({ type: "patch-blip-radius", radius }),

      select: (id) => dispatch({ type: "select", id }),
      navigate: (page) => dispatch({ type: "navigate", page }),

      publish: () => {
        const published: RadarSnapshot = {
          config: state.snapshot.config,
          meta: {
            ...state.snapshot.meta,
            publishState: "published",
            publishedAt: nowIso(),
          },
        };
        if (!saveSnapshot(PUBLISHED_KEY, published)) {
          toast("error", "Publish failed — browser storage unavailable");
          return;
        }
        dispatch({ type: "patch-meta", patch: published.meta });
        setPublishStamp((s) => s + 1);
        toast("success", "Published — the public radar is now up to date");
      },

      discard: () => {
        const restored =
          loadSnapshot(PUBLISHED_KEY) ?? defaultSnapshot();
        dispatch({ type: "replace-snapshot", snapshot: restored });
        saveSnapshot(DRAFT_KEY, restored);
        toast("info", "Draft discarded — restored the published version");
      },

      resetToDefaults: () => {
        const fresh = defaultSnapshot();
        dispatch({ type: "replace-snapshot", snapshot: fresh });
        clearSnapshot(DRAFT_KEY);
        clearSnapshot(PUBLISHED_KEY);
        setPublishStamp((s) => s + 1);
        toast("info", "Radar reset to the built-in defaults");
      },

      exportJson: () => {
        download(
          `tech-radar-${state.snapshot.meta.version}.json`,
          "application/json",
          JSON.stringify(state.snapshot, null, 2),
        );
        toast("success", "JSON exported");
      },

      exportCsv: () => {
        const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
        const rows = [
          "number,name,ring,quadrant,status,hidden,since,owner,description",
          ...state.snapshot.config.blips.map((b) =>
            [
              String(b.number),
              esc(b.name),
              b.ring,
              b.quadrant,
              b.status,
              String(b.hidden ?? false),
              b.since ?? "",
              esc(b.owner ?? ""),
              esc(b.description ?? ""),
            ].join(","),
          ),
        ];
        download(
          `tech-radar-items-${state.snapshot.meta.version}.csv`,
          "text/csv",
          rows.join("\n"),
        );
        toast("success", "CSV exported");
      },

      importJsonFile: (file) => {
        void file.text().then((text) => {
          const parsed = parseSnapshot(text);
          if (!parsed) {
            toast("error", "Import failed — not a valid radar snapshot");
            return;
          }
          dispatch({ type: "replace-snapshot", snapshot: parsed });
          toast("success", `Imported "${parsed.meta.title}" (${parsed.config.blips.length} items)`);
        });
      },

      toast,
      dismissToast: (id) => dispatch({ type: "toast-remove", id }),
    };
  }, [state, unpublished, toast]);

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}
