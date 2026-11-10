# Dev setup

Verified on 2026-11-03 (Windows 10 Pro).

| Tool | Version | How verified |
|---|---|---|
| Node.js | 24.15.0 | `node --version` |
| pnpm | 9.15.0 | `pnpm --version` |
| TypeScript | 7.0.2 | `npx tsc --version` |
| Claude Code CLI | 2.1.304 | `claude --version`; `claude --help` lists `-p/--print`, `--output-format`, `--json-schema`, `--model` |

Library versions were taken from `npm view <pkg> version` on the same date: three 0.187.0, zod 4.6.7, vite 8.3.5, vite-plugin-pwa 2.0.0, fastify 5.12.8, vitest 5.1.0, @playwright/test 1.64.1.
Added 2026-11-06 (D24): katex 0.19.1 (`npm view katex version`; `@pv/engine`, loaded lazily by the Accademico presentation).

## Commands

```sh
pnpm install
pnpm test        # typecheck (tsc --noEmit) + vitest; this is the local CI
pnpm dev:web     # Vite dev server for apps/web
pnpm export:e2e  # lesson export check: every reference scene exported and opened offline in headless Chrome
pnpm --filter @pv/web export-runtime   # build the export runtime by hand (vite does it once per start)
```

Lesson export (D27): see [export.md](export.md). After changing player or engine code, restart `pnpm dev:web`, so new exports carry the new runtime.

For the phone (HTTPS, camera, WebXR, PWA) use `pnpm dev:phone`: see [Phone (M5)](#phone-m5) below.

## Running server + web app (photo flow)

Two processes, two terminals:

```sh
pnpm --filter @pv/server dev   # API server, http://127.0.0.1:8787 (tsx watch src/http/main.ts)
pnpm dev:web                   # Vite, http://localhost:5173 — proxies /api and /cache to the server
```

Open the web app, tap **Scatta una foto** / **Carica una foto** (or paste one). The photo is shown for
confirmation (**Crea la lezione** / **Cambia foto**, Enter / Esc); nothing is sent before that. The app then
uploads the photo, follows the progress over Server-Sent Events (the page summary appears and is read aloud),
opens the player on chapter 1 as soon as the streamed generation holds it (D22: the other chapters show as
"in preparazione" and join at the next chapter change), or on the whole lesson when it arrives. The ten default example lessons stay listed under **Esempi**.

- **Mock mode** (default, `PAGINAVIVA_MODE` unset or `mock`): no network, no CLI. Analysis replays
  `fixtures/llm/`, which only knows the photos in `fixtures/pages/` byte for byte: upload one of those.
  Any other photo ends with "In modalità di prova riconosco solo le pagine di esempio…".
- **Live mode**: `PAGINAVIVA_MODE=live` in `server/.env` (copy `server/.env.example`); analysis and
  generation use the Claude Code CLI (`PAGINAVIVA_LLM=claude-cli`), the PC must be logged in.

The server reads `server/.env` itself (`process.loadEnvFile`, Node ≥ 20.12; inline `# comments` are stripped).

| Variable | Default | Used by |
|---|---|---|
| `PAGINAVIVA_MODE` | `mock` | server: `live` \| `mock` |
| `PAGINAVIVA_PORT` | `8787` | server port |
| `PAGINAVIVA_HOST` | `127.0.0.1` | server bind address (the phone reaches it through Vite); a non-loopback address is refused unless `PAGINAVIVA_ALLOW_REMOTE=1` (docs/security.md) |
| `PAGINAVIVA_STORE_PHOTOS` | `false` | `true` keeps the processed (EXIF-free) JPEG in `server/.cache/photos/` |
| `PAGINAVIVA_LESSONS_DIR` | `server/data/lessons` | lesson archive (D18, git-ignored): one JSON per lesson made from a photo, never the photo |
| `PAGINAVIVA_LEDGER` | `server/ledger.jsonl` | ledger path |
| `PAGINAVIVA_MAX_PIPELINES` | `1` | photo pipelines running at once; one more upload gets `429` + `Retry-After` (docs/security.md) |
| `PAGINAVIVA_PAGES_PER_HOUR` | `60` | photo uploads per device (client address) per hour, then `429` |
| `PAGINAVIVA_I18N_MAX_CATALOGS` | `40` | translated UI catalogs kept in `server/data/i18n/`; beyond it, English |
| `PAGINAVIVA_API_URL` | `http://127.0.0.1:8787` | **Vite** (shell env, not `server/.env`): proxy target, for a server on another port |
| `PAGINAVIVA_ALL_EXAMPLES` | unset | **Vite** (shell env): `1` lists every scene under Esempi, not only the ten defaults (others open with `?scene=<name>` anyway) |
| `PAGINAVIVA_LAN` | unset | **Vite** (shell env): `1` makes `pnpm dev:web` listen on the LAN, with an access token (docs/security.md) |

Example on spare ports (as used for the M3/M4 browser check): in `server/`,
`PAGINAVIVA_PORT=8790 npx tsx src/http/main.ts`; in `apps/web/`,
`PAGINAVIVA_API_URL=http://127.0.0.1:8790 npx vite --port 5181 --strictPort`.

### HTTP API (server/src/http/app.ts)

| Route | Answer |
|---|---|
| `POST /api/pages` | multipart field `photo`, max 20 MB (+ `llm`, `locale`) → `202 { id }`; `415` not a photo (JPEG, PNG, WebP, HEIF, AVIF), `413` over 20 MB or 40 megapixels, `429` busy or too many uploads, `400` no file or invalid locale; needs the `X-AnimaPage: 1` header |
| `GET /api/i18n/:lang` | UI catalog of a language (D21): `200 { lang, messages }`, `202` being translated, `404` none (mock, unknown language, catalog limit); needs `X-AnimaPage: 1` |
| `GET /api/pages/:id/events` | `text/event-stream`: `progress` events (`{ phase, message, summary?, summaryLang? }`), maybe one `chapter` (`{ scene }`: the first chapter alone while the rest is generated, D22), then one `result` (`scene` \| `retake` \| `error`) and the stream ends; reconnecting replays the job |
| `GET /api/pages/:id/scene` | `200` SceneSpec, `202` still running, `422` retake/error, `404` unknown job |
| `GET /api/health` | `{ ok, mode }` |
| `GET /cache/geo/*` | `server/.cache/geo/` (geodata built on demand in live mode) |

Jobs live in memory (last 100). Photos are processed in memory and dropped when the job ends.

### Pipeline (server/src/pipeline/run.ts)

Photo → `preparePhoto` (sharp: EXIF rotation, longest side 2000 px, JPEG q85, metadata stripped) →
analyze → retake check (`readable` false, `retake` set or `confidence` < 0.5) → enrich ‖ geo (geo only
when `suggestedEngine` is `map`) → generate. Enrich or geo failures degrade to a page-only lesson;
analyze/generate failures end with an Italian message. Mock mode analyses the original upload bytes
(the recordings are keyed by them); live mode sends the processed JPEG.

Page cache: key = mode + SHA-256 of the processed JPEG (exact bytes; the perceptual hash of brief §4.8
is still open). Scene and retake results are cached, errors and `card` fallbacks are not. Live mode
also persists them in `server/.cache/pages/` (derived JSON, never the photo); mock mode keeps them in memory.

### Image size: measured effect (2026-11-03, Campania page, opus via CLI, one call each)

| Input | Upload | Input tokens | Time | Map heights read |
|---|---|---|---|---|
| original 4080×3072 | 2.86 MB | 8169 | 29.9 s | M. Cervati only |
| 2000×1506 | 0.50 MB | 8124 | 29.5 s | Vesuvio, M. Cervati, M. Miletto |
| 1600×1205 | 0.37 MB | 6788 | 30.5 s | none |

2000 px keeps the detail the model actually uses (same token count as the original) with a 6× smaller
upload; 1600 px loses small map labels. Time is dominated by the output (~4000 tokens), not the image.

## Phone (M5)

```sh
pnpm dev:server          # API on 127.0.0.1:8787 (unchanged; the phone never talks to it directly)
pnpm dev:phone           # vite build + HTTPS `vite preview` on 0.0.0.0:5443, prints the access links for the phone
pnpm dev:phone --usb     # HTTP preview on 127.0.0.1:5443 + `adb reverse tcp:5443 tcp:5443` (phone: http://localhost:5443)
pnpm dev:phone --no-build --port 5444
pnpm icons:web           # regenerate the PWA icons (apps/web/icons/icon.svg -> fixtures/public/icons/, sharp)
```

`apps/web/scripts/phone.ts` picks the LAN address from the default route (UDP `connect`, nothing is sent) and
ranks adapters (Hyper-V/WSL/VPN names hidden, VirtualBox `192.168.56.x` last). It serves a **production build**
through `vite preview` (same `/api` + `/cache` proxy as dev): the phone loads a few bundled files instead of
hundreds of dev modules, and the service worker exists only in a build. No HMR: rerun after code changes.
Build takes ~13 s on this PC.

LAN access token (docs/security.md): each start makes a new random token and prints the phone URL as an access
link, `https://<ip>:5443/api/lan?t=<token>`. Open it once on the phone: it sets an HttpOnly cookie and opens the
app. Without it `/api` and `/cache` answer other devices `401` (the app shows "Questo dispositivo non è
autorizzato…"); after a restart of `dev:phone` open the new link. The PC itself (`https://localhost:5443`) needs
no token. `pnpm dev:web` listens on localhost only; `PAGINAVIVA_LAN=1 pnpm dev:web` opts in to the LAN (HTTP, so
no camera on the phone) and prints its own access links.

### Secure context: options checked (2026-11-03)

Camera (`getUserMedia`), WebXR and service workers need a secure context: `https://` or `http://localhost`
([Google, WebXR AR requirements](https://developers.google.com/ar/develop/webxr/requirements): "delivered over
TLS" or "requested through localhost"; without TLS it suggests USB port forwarding).

| Option | Camera / WebXR | Service worker / PWA install | Cost |
| --- | --- | --- | --- |
| **Local CA (default)**: `dev:phone` makes `apps/web/.cert/ca.crt` + a server cert for the LAN IPs; the CA is installed once on the phone as a user CA | yes | yes | one-time CA install (Android asks for a screen lock) |
| Same HTTPS server, CA **not** installed: "Avanzate → Procedi" on the warning | expected yes (page is https); check `?debug=1` (`sicuro sì`, `XR immersive-ar OK`) | **no**: Chrome refuses to register a service worker when the certificate has an error ("An SSL certificate error occurred when fetching the script"), so no offline mode | none |
| `--usb`: `adb reverse` (adb 1.0.41, `adb --help`: `reverse [--no-rebind] REMOTE LOCAL`; on this PC via scrcpy) | yes (localhost) | yes | USB cable + USB debugging |
| `chrome://flags/#unsafely-treat-insecure-origin-as-secure` with `http://<ip>:5173` | reported to work (Chromium security-dev threads), unofficial | unclear | changes the browser's flags; not recommended |

Chrome on Android trusts CAs in the **user** certificate store (apps since Android 7 must opt in, Chrome does: the
mkcert README says Android apps must "enable user roots"; HTTP Toolkit reports Chrome as the browser that accepts
user-store CAs, with Certificate Transparency applied only to system-store roots). Not testable from the PC:
confirm on the phone (no warning, padlock, `?debug=1` shows `SW attivo`).

Certificates (OpenSSL 3.5.3 from Git for Windows; flags checked with `openssl req -help` / `openssl x509 -help`):
CA = `req -x509 -new -newkey rsa:2048 -nodes -days 825 -config` with `basicConstraints=critical,CA:TRUE,pathlen:0`,
`keyUsage=critical,keyCertSign,cRLSign` and, since 2026-11-10, critical `nameConstraints` (`DNS:localhost`, 127/8,
10/8, 172.16/12, 192.168/16: `scripts/dev-ca.ts`; a CA made before has none, `dev:phone` warns, docs/security.md);
server = CSR signed with `x509 -req -CA -CAkey -set_serial -days 397 -extfile -extensions` (`CA:FALSE`,
`serverAuth`, SAN `localhost`, `127.0.0.1` and every private LAN IPv4).
The server cert is re-issued when the address list changes or within 30 days of expiry. The CA is published as
DER at `/pagina-viva-ca.crt` (`Content-Type: application/x-x509-ca-cert`). Chain verified with Node `https.get`
and the `ca` option. `apps/web/.cert/` holds private keys: git-ignored; delete it to start over (then reinstall the CA on the
phone). Vite reads `PAGINAVIVA_HTTPS_KEY` / `PAGINAVIVA_HTTPS_CERT` (`server.https`, `preview.https`); unset = HTTP.

### Windows firewall

Observed on this PC (read-only: `Get-NetConnectionProfile`, `netsh advfirewall firewall show rule name=all dir=in`):
the home network (`Ethernet`, `iliadbox-…`) is **Private**; the inbound rules for `C:\program files\nodejs\node.exe`
**allow** TCP/UDP on Private and **block** on Public. The phone can connect while the network stays Private. If the
phone times out, in an **administrator** PowerShell (parameters checked with `Get-Command New-NetFirewallRule` /
`Get-Command Set-NetConnectionProfile`):

```powershell
Set-NetConnectionProfile -InterfaceAlias "Ethernet" -NetworkCategory Private
New-NetFirewallRule -DisplayName "AnimaPage telefono 5443" -Direction Inbound -Protocol TCP -LocalPort 5443 -Action Allow -Profile Private
```

A block rule on the same profile wins over an allow rule: on a Public network switch it to Private instead.

### PWA (vite-plugin-pwa 2.0.0: options read from its `dist/index.d.ts`; workbox-build 7.4.1 `build/types.d.ts`)

`generateSW`, `registerType: "autoUpdate"`, `injectRegister: "script"`, `skipWaiting` + `clientsClaim` (the plain
`registerSW.js` never sends `SKIP_WAITING`: without them a new build waited for every tab to close — seen in test).
Manifest: "AnimaPage", `lang: it`, standalone, `background_color`/`theme_color` `#ecebe6` (app background);
icons 192/512 + maskable 512 (open book with a spark, `apps/web/icons/icon.svg`). Caching:

- precache (42 files): JS, `index.html`, icons, `scenes/*.json`, `geo/**`;
- runtime `CacheFirst` (`pv-assets`, max 300 entries): `models/*.glb`, `audio/*.ogg` (~17 MB in total, cached on
  first use: open each demo once online to have it offline);
- never cached: `/api/**` (photos, jobs, generated scenes) and `/cache/**` have no route; the navigation fallback
  denylist excludes `/api/`, `/cache/` and `*.crt`.

Checked in Chrome (Pixel 7 emulation, `http://127.0.0.1`, mock API): SW active; the diorama demo reopened with the
network Offline (models from `pv-assets`); a photo upload offline ends with "Sei senza connessione…"
(`navigator.onLine` false) or "Non riesco a contattare il server…". No service worker in `vite` dev.

### Photo flow on the phone

- "Scatta una foto" = `<input type=file accept=image/* capture=environment>`: Chrome on Android opens the camera
  app; `environment` asks for the outward-facing camera ([MDN `capture`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture));
  some camera apps reopen the last-used lens. A tips screen comes first (until "Non mostrare più").
- Upload via `XMLHttpRequest` for `upload.onprogress` (bar + MB). Live mode only, photos ≥ 1.5 MB are scaled to
  2000 px (the server's size) with `createImageBitmap(file, {imageOrientation: "from-image"})` + canvas, JPEG 0.92.
  Measured with 4× CPU throttling on the fixtures: 4080×3072 2.86 MB → 2000×1506 0.61 MB in 0.40 s (3.16 → 0.65 MB
  in 0.34 s; 3.01 → 0.61 MB in 0.35 s): ~1 s less on Wi-Fi, and 50–200 MP photos stay under the 20 MB limit. Mock
  mode always sends the original bytes (its recordings are keyed by them).
- Timings: elapsed time on the progress screen; at the end "Pronta in 2:47 · invio 1,4 s · lettura … · fonti … ·
  scena …" (client-side, from SSE arrival times). The last 12 runs are listed on the home page ("Tempi delle ultime
  prove", `localStorage` key `pv.runs`).

### Performance overlay

`?debug=1` (kept for the tab until `?debug=0`): FPS, draw calls and triangles per frame (counted by wrapping the
WebGL `draw*` calls, because the player does not expose its renderer), canvas size, antialias/MSAA samples, DPR,
GPU, secure context, service worker, `immersive-ar` support. `&dpr=1.5` caps `window.devicePixelRatio` as seen by
scripts (the stage reads it at start) to measure a lower render resolution. Emulated Pixel 7 on the desktop GPU:
Campania 24 draw calls / 183k triangles; Troia 411 draw calls / 92k triangles; canvas 760×926 at the engine's DPR
cap of 2 (570×694 with `dpr=1.5`). Real phone numbers come from the M5 test.

## Languages (D21)

The app uses the first valid tag of the browser's languages (`navigator.languages`), or the one chosen in
**Impostazioni · Lingua** (stored as `pv.lang`; "Automatica" removes it). The tag travels with every photo as
the multipart field `locale` (strict BCP-47: `en-GB`, `ja`, `zh-Hant-TW`; anything else is a `400`).

| What | Where |
|---|---|
| Catalogs `it` (original texts), `en`, `es`, `fr`, `de`, `pt` | `packages/scene-spec/src/i18n/messages/` (`@pv/scene-spec/i18n`) |
| Locale helpers, number marks, reading time, engine labels | `packages/scene-spec/src/i18n/locale.ts`, `labels.ts` |
| Other languages: `GET /api/i18n/<lang>` → `200 { lang, messages }`, `202` while translating, `404` in mock mode | `server/src/i18n.ts` |
| Translated catalogs (one LLM call per language, validated) | `server/data/i18n/<lang>.json` (git-ignored with `server/data/`) |

- Italian prompts are unchanged byte for byte; another language adds one section to the analysis and
  generation prompts, its own page-cache key (`live-an-6.gen-6.check-1-<lang>-<sha>`) and `SceneSpec.lang`.
- To try a language in Chrome without changing the PC: Impostazioni · Lingua, or DevTools → Sensors → Locale.
- A translated catalog is refreshed by deleting its file; the app keeps a copy on the device (`pv.i18n.<lang>`
  in localStorage: clear the site data to fetch it again).
- No voice for the lesson's language on the device (Windows: Settings → Time & language → Speech → add
  voices): the player shows the text sentence by sentence with a notice instead of using another voice.

## Altri modelli AI

Di default ogni fase usa Claude (abbonamento, Claude Code CLI). Nell'app, **Impostazioni · Modello AI** (link sotto i temi nella home) permette di scegliere un modello diverso per *Lettura della foto*, *Creazione della scena* e *Controllo visivo*. L'elenco viene da `server/config/llm_providers.yaml`; un modello compare come non disponibile finché il programma non è installato o il server locale non è avviato. Le chiavi, se mai servissero, vanno **solo** in `server/.env` (nomi in `server/.env.example`). Dopo aver cambiato il file YAML riavvia il server. Dettagli tecnici: decisione D20, `docs/models.md`.

### Gemini (Gemini CLI, account Google)

1. Installazione (su questo PC c'è già la 0.63.0): `npm install -g @google/gemini-cli`. Per aggiornarla: `npm install -g @google/gemini-cli@latest`.
2. Accesso: in un terminale scrivi `gemini`, scegli **Login with Google** e completa l'accesso nel browser; poi esci con `/quit`.
3. Prova: `gemini -p "rispondi ok" -o json --skip-trust` deve stampare un JSON con `"response"`.

Attenzione: il 5/11/2026 il tuo account personale è stato **rifiutato** dalla CLI 0.63.0 (`IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals`, con l'invito a passare ad Antigravity). Prova ad aggiornare la CLI e a rifare l'accesso; se l'errore resta, con questo account Gemini via CLI non funziona. Alternativa: una chiave API di Google AI Studio nella voce `gemini-api` (commentata) di `llm_providers.yaml`, con `GEMINI_API_KEY=` in `server/.env`; controlla prima limiti e termini del piano gratuito.

### Modelli sul PC: Ollama o LM Studio

Con 8 GB di VRAM girano solo modelli piccoli (3–4 miliardi di parametri, quantizzati). Vanno discretamente per leggere la foto e per il controllo visivo; per **Creazione della scena** (uno schema JSON da 15–30 mila caratteri) la qualità sarà probabilmente bassa e spesso uscirà la scheda di riserva al posto della scena 3D. Consiglio: modello locale per *Lettura della foto* o *Controllo visivo*, Claude per *Creazione della scena*.

**Ollama**
1. Installa da https://ollama.com/download (Windows). Parte da solo in background su http://localhost:11434.
2. Scarica un modello che vede le immagini: `ollama pull gemma3:4b` (3,4 GB) oppure `ollama pull qwen2.5vl:3b` (3,2 GB).
3. In Impostazioni il modello diventa disponibile entro 15 secondi.

**LM Studio** (già installato su questo PC)
1. Cerca e scarica `google/gemma-3-4b` (supporta le immagini).
2. Avvia il server locale dalla scheda per sviluppatori di LM Studio (porta 1234) e carica il modello.
3. Se il nome del modello che LM Studio mostra è diverso, correggilo in `server/config/llm_providers.yaml` (voce `lmstudio`).
