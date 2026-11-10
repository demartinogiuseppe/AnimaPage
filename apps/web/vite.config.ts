import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { lanGuard, lanToken, UNLOCK_PATH } from "./scripts/lan.ts";
import { writeSceneIndex } from "./scripts/scene-index.ts";

// The AnimaPage server (server/src/http/main.ts). The app calls it through this proxy,
// so no CORS is needed and the phone only has to reach the Vite server. xfwd: the server sees the
// device's address (X-Forwarded-For), for its per-device upload limit (docs/security.md).
const API = process.env.PAGINAVIVA_API_URL ?? "http://127.0.0.1:8787";
const proxy = { "/api": { target: API, xfwd: true }, "/cache": { target: API, xfwd: true } };

// HTTPS for the phone (camera, WebXR, service worker): `pnpm dev:phone` (scripts/phone.ts) creates a
// local CA + server certificate and passes their paths here. Unset = plain HTTP (desktop dev).
const keyFile = process.env.PAGINAVIVA_HTTPS_KEY;
const certFile = process.env.PAGINAVIVA_HTTPS_CERT;
const https = keyFile && certFile ? { key: readFileSync(keyFile), cert: readFileSync(certFile) } : undefined;

// LAN mode (scripts/lan.ts, docs/security.md): `pnpm dev:phone` hands over its token; PAGINAVIVA_LAN=1 makes
// `pnpm dev:web` listen on the LAN too, with a fresh token. Otherwise localhost only (Vite's default).
const LAN_TOKEN = lanToken(process.env);
const lanMode: Plugin = {
  name: "pv-lan",
  configureServer(server) {
    if (!LAN_TOKEN) return;
    server.middlewares.use(lanGuard(LAN_TOKEN, { secure: !!https }));
    const printUrls = server.printUrls.bind(server);
    server.printUrls = () => {
      printUrls();
      for (const url of server.resolvedUrls?.network ?? [])
        console.log(`  LAN access link (open it once on the other device): ${url.replace(/\/$/, "")}${UNLOCK_PATH}?t=${LAN_TOKEN}`);
    };
  },
  configurePreviewServer(server) {
    if (LAN_TOKEN) server.middlewares.use(lanGuard(LAN_TOKEN, { secure: !!https }));
  },
};

// Never served by the dev server (its /@fs/ route reaches the whole repo): Vite's own defaults, plus the
// private photos, the server's data and caches, the ledger and the local CA.
const FS_DENY = [".env", ".env.*", "*.{crt,pem,key,p12,pfx,cer,der}", ".npmrc", ".yarnrc.yml", "**/.git/**", "**/fixtures/pages/**", "**/server/data/**", "**/server/.cache/**", "**/ledger.jsonl", "**/.cert/**"];

// scenes/index.json, the list of example scenes on the home (scripts/scene-index.ts): written at
// dev-server start and `vite build`, rewritten in dev whenever a scene file is added, changed or removed.
const SCENES_DIR = fileURLToPath(new URL("../../fixtures/public/scenes", import.meta.url));
// PAGINAVIVA_ALL_EXAMPLES=1 lists every scene instead of only the ten default examples.
const ALL_EXAMPLES = process.env.PAGINAVIVA_ALL_EXAMPLES === "1";
const sceneIndex: Plugin = {
  name: "pv-scene-index",
  buildStart() {
    writeSceneIndex(SCENES_DIR, { all: ALL_EXAMPLES });
  },
  configureServer(server) {
    server.watcher.add(SCENES_DIR);
    const update = (file: string) => {
      if (file.endsWith(".scene.json")) writeSceneIndex(SCENES_DIR, { all: ALL_EXAMPLES });
    };
    server.watcher.on("add", update).on("change", update).on("unlink", update);
  },
};

// The runtime of the exported lesson (fixtures/public/export/runtime.{js,css}, scripts/build-export-runtime.ts),
// which "Esporta" inlines: rebuilt at dev-server start and at `vite build` (also the one of `pnpm dev:phone`),
// so it is never missing or stale. pnpm pre-scripts (predev/prebuild) are disabled in this repo. A child
// process: the script runs its own Vite build (configFile: false) on import.
const WEB_DIR = fileURLToPath(new URL(".", import.meta.url));
let exportRuntimeBuilt = false;
const exportRuntime: Plugin = {
  name: "pv-export-runtime",
  buildStart() {
    if (exportRuntimeBuilt) return; // once per run, not once per environment
    exportRuntimeBuilt = true;
    execFileSync(process.execPath, ["--import", "tsx", "scripts/build-export-runtime.ts"], { cwd: WEB_DIR, stdio: "inherit" });
  },
};

const APP_VERSION =(JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")) as { version: string }).version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  // Scenes (fixtures/public/scenes) and geo assets (fixtures/public/geo) are served as static files.
  // Page photos (fixtures/pages) are deliberately NOT under this folder.
  publicDir: "../../fixtures/public",
  server: { host: LAN_TOKEN ? true : undefined, proxy, https, fs: { deny: FS_DENY } },
  preview: { proxy, https },
  // three.js alone is ~600 kB minified; engines are already split into lazy chunks.
  build: { chunkSizeWarningLimit: 1000 },
  plugins: [
    lanMode,
    sceneIndex,
    exportRuntime,
    // The local CA published by `pnpm dev:phone` (dist/pagina-viva-ca.crt): Android's installer wants this type.
    {
      name: "pv-ca-cert-type",
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split("?")[0]?.endsWith(".crt")) res.setHeader("Content-Type", "application/x-x509-ca-cert");
          next();
        });
      },
    },
    // Service worker + manifest on `vite build` only (no service worker in `vite` dev).
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script",
      includeManifestIcons: false, // already matched by workbox.globPatterns
      manifest: {
        name: "AnimaPage",
        short_name: "AnimaPage",
        description: "Fotografa una pagina: diventa una lezione animata in 3D, con voce, fonti e domande.",
        lang: "it",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#ecebe6",
        theme_color: "#ecebe6",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell + the small data the demo scenes need. Models and sounds (~17 MB) are cached
        // on first use instead (runtimeCaching below), so the first visit stays light.
        // woff2: the KaTeX fonts of the Accademico formulas (D24), ~300 kB; browsers never need the woff/ttf fallbacks.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}", "scenes/*.json", "geo/**/*"],
        globIgnores: ["models/**", "audio/**", "export/**", "**/*.crt"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // A new build takes over at the next page load (the plain registerSW.js never sends SKIP_WAITING).
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: "index.html",
        // Never answer API calls, server-built geodata or the CA download with the app shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/cache\//, /\.crt$/],
        runtimeCaching: [
          // The lesson archive (list and lessons opened once) also offline: network first, then the copy.
          // GET only (Workbox's default), so renames/deletes and photo uploads (/api/pages) are never cached.
          {
            urlPattern: ({ url, request }) => request.method === "GET" && /^\/api\/lessons(?:\/[^/]+)?$/.test(url.pathname),
            handler: "NetworkFirst",
            options: { cacheName: "pv-lessons", networkTimeoutSeconds: 5, expiration: { maxEntries: 200 } },
          },
          {
            urlPattern: /\/(?:models|audio)\/[^?]+\.(?:glb|ogg)$/,
            handler: "CacheFirst",
            options: { cacheName: "pv-assets", expiration: { maxEntries: 300 } },
          },
          // The rest of /api (photos, jobs, scenes) and /cache always go to the network.
        ],
      },
    }),
  ],
});
