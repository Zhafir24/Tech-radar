import { defineConfig, loadEnv, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// Local-only management API for the "Manage sources" widget. Mounted onto
// the Vite dev server so no extra process is needed. Not present in the
// production build — the deployed static site simply won't have /api/*.
import { handleSourcesApi } from "./scripts/api/sources-api.mjs";

const sourcesApiPlugin = (): PluginOption => ({
  name: "sources-api",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req as { url?: string }).url ?? "";
      if (url.startsWith("/api/sources") || url.startsWith("/api/scrape")) {
        // The handler works with vanilla node http req/res; the vite/connect
        // types are a superset. Safe to pass through.
        void handleSourcesApi(req as never, res as never);
        return;
      }
      next();
    });
  },
});

export default defineConfig(({ mode }) => {
  // VITE_RADAR_ONLY=true drops the admin console from the app entirely —
  // used by `npm run build:portable` to produce the radar-only bundle.
  // Read via loadEnv so a staged `.env` file is honoured, same as the
  // client-side `import.meta.env.VITE_RADAR_ONLY` check in src/App.tsx.
  // "." resolves against the current working directory inside loadEnv, so
  // this needs no @types/node for `process.cwd()`.
  const radarOnly = loadEnv(mode, ".", "").VITE_RADAR_ONLY === "true";

  // Multi-page app: public radar (index.html) + admin console (admin.html).
  // At deploy time the two entries can be hosted under separate domains
  // (e.g. radar.example.com / admin.example.com). Radar-only builds drop
  // the admin entry. Typed as Record<string, string> so the optional key
  // does not widen the union to include `undefined`.
  const input: Record<string, string> = { main: "index.html" };
  if (!radarOnly) input.admin = "admin.html";

  return {
    plugins: [react(), tailwindcss(), sourcesApiPlugin()],
    server: {
      watch: {
        // The scraper and the /api endpoints write to these paths. Vite's
        // default watcher would trigger a full HMR page reload on every
        // config toggle or rescrape — annoying and it wipes the modal state.
        // Excluding them stops the churn; the frontend re-fetches JSON via
        // the "Refresh" and rescrape flow instead.
        ignored: [
          "**/data/**",
          "**/public/radar-data.json",
          "**/public/radar-diagnostics.json",
          "**/serve.log",
        ],
      },
    },
    build: {
      rollupOptions: { input },
    },
  };
});
