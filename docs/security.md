# Security

AnimaPage is a **local tool**: a web app and an API server that run on your own PC, used from that PC and, if you
want, from your phone on your home Wi-Fi. It is not a public web service. There are no user accounts and no
authentication beyond the LAN access token described below.

**Do not expose the server to the internet** (port forwarding, a public host, a tunnel) without putting your own
authentication in front of it.

## Threat model

What AnimaPage protects against:

| Threat | Protection |
|---|---|
| Other devices on the same network (school, office, guest Wi-Fi) using your API, your saved lessons or your AI quota | `pnpm dev:web` listens on localhost only. LAN mode is opt-in and needs an access token (below). |
| Web sites you visit while the server runs, sending requests to it (CSRF) | The API checks `Sec-Fetch-Site` and `Origin`, and needs an `X-AnimaPage: 1` header on every state-changing call and on `GET /api/i18n/*`. A form or `<img>` cannot send that header, and a cross-site `fetch` with it needs a CORS preflight, which the server never answers. |
| DNS rebinding (a web site whose domain is pointed at 127.0.0.1 to read the API) | The server answers only when `Host` is `localhost`, an IP literal or this PC's name. |
| Running up your AI subscription or API bill, or freezing the PC | At most 1 pipeline at a time, 60 uploads per device per hour, images up to 40 megapixels, a bounded number of UI translations (see [Caps](#caps)). |
| Text on a photographed page (prompt injection) steering the AI | The Claude CLI runs without tools, MCP servers, plugins or your personal settings. The Gemini CLI runs without extensions, MCP servers or tools (a deny-all policy). Neither CLI gets the server's other API keys. Generated text is shown as text only (no HTML); links are limited to http/https. A teacher should still review a lesson before using it. |
| A generated scene making browsers fetch other sites (tracking beacons, requests to your LAN) | 3D model paths must be local asset paths; the player and the export load assets only from the app's own origin; the visual check's headless Chrome runs sandboxed and may only reach the web app. |
| Someone using the local CA of `pnpm dev:phone` to impersonate web sites on your phone | A CA made since 2026-11-10 has name constraints: it can only sign certificates for `localhost` and private LAN addresses (see [Phone CA](#phone-ca)). |

What it does not protect against: anyone who can run programs on your PC or read your files (they can read
`server/.env`, the lesson archive and the CA key directly), or anyone on a network where you run LAN mode **and**
who has seen the access link.

## LAN mode and the access token

- `pnpm dev:web` and `pnpm dev:server` listen on localhost only. The API server refuses a non-loopback
  `PAGINAVIVA_HOST` unless you also set `PAGINAVIVA_ALLOW_REMOTE=1` (then you are on your own: no authentication).
- `pnpm dev:phone` (HTTPS) is LAN mode. `PAGINAVIVA_LAN=1 pnpm dev:web` is LAN mode too (plain HTTP).
- In LAN mode the web server makes a **new random token at every start** and prints an access link:
  `https://<pc-ip>:5443/api/lan?t=<token>`. Open it once on the phone. It sets an HttpOnly, SameSite=Strict
  cookie and opens the app. Without the cookie, `/api/*` and `/cache/*` answer other devices `401`. The app's own
  files (HTML, JS, the CA certificate) are served to everyone: they are the open-source code.
- Requests from the PC itself (loopback) never need the token, so desktop development and the tests are unchanged.
- After restarting `pnpm dev:phone`, open the new link on the phone (the old cookie no longer matches).
- The token is enforced by the Vite server (`apps/web/scripts/lan.ts`), which sees the device's real address; the
  API server stays on 127.0.0.1 behind it.

## Caps

| Cap | Default | Change it with (`server/.env`) |
|---|---|---|
| Photo pipelines running at once (each spawns AI CLI processes and a headless Chrome) | 1; one more upload gets `429` + `Retry-After: 30` | `PAGINAVIVA_MAX_PIPELINES` |
| Photo uploads per device (client address) per hour | 60, then `429` + `Retry-After` | `PAGINAVIVA_PAGES_PER_HOUR` |
| Upload size | 20 MB, one file, 4 short fields | `maxUploadBytes` in `server/src/http/app.ts` |
| Image size | 40 megapixels (`413`); only JPEG, PNG, WebP, HEIF, AVIF (`415`) | `MAX_INPUT_PIXELS` in `server/src/image.ts` |
| JSON request body | 1 MB (lesson renames: 2 KB) | `bodyLimit` in `server/src/http/app.ts` |
| UI catalogs translated by the AI (live mode only) | only languages and scripts that `Intl` knows, one translation at a time, at most 40 kept in `server/data/i18n/`; others stay English | `PAGINAVIVA_I18N_MAX_CATALOGS` |

The app shows these refusals as translated messages. Mock mode never calls an AI model.

## Phone CA

`pnpm dev:phone` creates a local certificate authority in `apps/web/.cert/` (git-ignored) and asks you to install
it on the phone. Its private key `ca.key` is not encrypted: keep the folder private (no cloud sync, do not zip the
project with it). A CA created since 2026-11-10 carries critical name constraints (`localhost`, 127/8, 10/8,
172.16/12, 192.168/16), so even a stolen key cannot sign certificates for other sites. A CA created before has none
and `dev:phone` prints a warning: delete `apps/web/.cert/ca.key` and `ca.crt`, restart `pnpm dev:phone` and install
the new certificate on the phone. Remove the old one from the phone (Android: Settings → Security → Encryption &
credentials → User credentials) when you stop testing.

## Privacy

- **Photos are sent to the AI provider you configured** (Anthropic through the Claude Code CLI by default, Google
  through the Gemini CLI, or the OpenAI-compatible API you set up) and are **not stored by AnimaPage**: the photo
  stays in memory, is re-encoded without EXIF/GPS before it is sent, and is written to disk only if you set
  `PAGINAVIVA_STORE_PHOTOS=true`. The Gemini CLI needs the image as a file: it is written to a temporary folder and
  deleted after the call (or by the next call, if the process was killed).
- Search terms taken from the page go to Wikipedia, Wikidata, Wikimedia Commons, YouTube (only with a key),
  OpenStreetMap Overpass, raw.githubusercontent.com and the AWS terrain tiles.
- Browser "online" voices (Chrome "Google …", Edge "… Online (Natural)") may send the narration text to Google or
  Microsoft.
- Saved lessons (`server/data/lessons/`) and the page cache (`server/.cache/`) hold the page's text; the cache file
  name contains the SHA-256 of the processed photo.

## Dependencies

Run `pnpm audit --prod` (and `pnpm audit`) before a release and turn on Dependabot or Renovate on the repository.
Status on 2026-11-10: no high or critical advisories; `--prod`: 2 moderate (glob, minimatch, both through
`@fastify/static`, whose glob is not reached by request input); dev only: 1 low (deepmerge, through
vite-plugin-pwa's build tooling).

## Known limits (not fixed)

- No Content-Security-Policy in the app or in exported lessons yet (defence in depth; the DOM code uses
  `textContent`/`setAttribute`, KaTeX runs with `trust: false`). An export CSP must be tested with OpenBoard first.
- Server-Sent Event connections are not capped per job; the pipeline and upload caps bound how many jobs exist.
- Lesson texts are written by the AI from an untrusted page: they can be wrong or misleading even though they are
  rendered as plain text. Review a lesson before showing it to a class.
- The Gemini CLI hardening (no extensions, no MCP servers, deny-all tool policy) was checked against the 0.63.0 CLI
  source and its option parsing, not with a live answer: Google no longer serves that client to personal accounts.
- The LAN access cookie lasts 30 days but stops matching at the next start of `pnpm dev:phone`.

## Reporting a vulnerability

Open a GitHub security advisory on the repository (or an issue without exploit details, asking for a contact).
