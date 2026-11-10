// `pnpm dev:phone`: builds the web app and serves it to the phone on the home network over HTTPS
// (camera, WebXR and the service worker need a secure context). See docs/dev-setup.md "Phone (M5)".
//
//   pnpm dev:phone              build + HTTPS preview on 0.0.0.0:5443, prints the LAN URLs
//   pnpm dev:phone --usb        build + HTTP preview on 127.0.0.1:5443 + `adb reverse` (phone uses http://localhost)
//   pnpm dev:phone --no-build   reuse apps/web/dist
//   pnpm dev:phone --port 5444
//
// HTTPS uses a local CA made with OpenSSL (Git for Windows ships it) in apps/web/.cert/: the server
// certificate is re-issued when the PC's LAN addresses change. The CA certificate is published at
// /pagina-viva-ca.crt so it can be installed on the phone (then no certificate warning, and the
// service worker / PWA install work). The API server stays on 127.0.0.1 behind the Vite proxy.
//
// LAN access token (scripts/lan.ts, docs/security.md): a new random one at each start. The phone opens the
// printed link once (it sets a cookie); without it the API answers other devices 401. The PC needs none.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { X509Certificate, randomBytes } from "node:crypto";
import dgram from "node:dgram";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { caConfig, caIsConstrained, findOpenssl, leafSan } from "./dev-ca.ts";
import { newLanToken, UNLOCK_PATH } from "./lan.ts";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const certDir = fileURLToPath(new URL("../.cert/", import.meta.url));
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const CA_FILE = "pagina-viva-ca.crt";

const args = process.argv.slice(2).filter((a) => a !== "--");
const usb = args.includes("--usb");
const build = !args.includes("--no-build");
const portArg = args.indexOf("--port");
const port = portArg >= 0 ? Number(args[portArg + 1]) : 5443;
const apiUrl = process.env.PAGINAVIVA_API_URL ?? "http://127.0.0.1:8787";

// ---------- LAN addresses ----------

/** Adapters that are never the home network (Hyper-V/WSL, VirtualBox, VPNs, Docker…). */
const VIRTUAL = /vethernet|virtualbox|vmware|wsl|hyper-v|docker|tailscale|zerotier|hamachi|nordlynx|openvpn|wireguard|loopback|bluetooth|npcap/i;

/** Local address of the default route: connecting a UDP socket sends nothing. */
function defaultRouteAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    s.on("error", () => resolve(null));
    s.connect(53, "1.1.1.1", () => {
      try {
        resolve(s.address().address);
      } catch {
        resolve(null);
      } finally {
        s.close();
      }
    });
  });
}

interface Lan {
  address: string;
  name: string;
  score: number;
}

async function lanAddresses(): Promise<Lan[]> {
  const route = await defaultRouteAddress();
  const out: Lan[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
      const virtual = VIRTUAL.test(name);
      let score = virtual ? -50 : 20;
      if (a.address === route && !virtual) score += 100; // not a VPN's default route
      if (a.address.startsWith("192.168.")) score += 10;
      if (a.address.startsWith("192.168.56.")) score -= 30; // VirtualBox host-only default
      if (/^10\./.test(a.address)) score += 5;
      out.push({ address: a.address, name, score });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

// ---------- Certificates (OpenSSL) ----------

function ensureCertificates(addresses: string[]): { key: string; cert: string; ca: string } {
  mkdirSync(certDir, { recursive: true });
  const p = (f: string) => certDir + f;
  const openssl = findOpenssl();
  if (!openssl) {
    throw new Error(
      "OpenSSL non trovato (di solito arriva con Git for Windows). Usa `pnpm dev:phone --usb` oppure installa Git for Windows.",
    );
  }
  const run = (a: string[]) => execFileSync(openssl, a, { stdio: ["ignore", "ignore", "pipe"] });

  if (!existsSync(p("ca.key")) || !existsSync(p("ca.crt"))) {
    writeFileSync(p("ca.cnf"), caConfig(os.hostname()).join("\n"));
    run(["req", "-x509", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", p("ca.key"), "-out", p("ca.crt"), "-days", "825", "-config", p("ca.cnf")]);
    console.log("  Creata la CA locale: apps/web/.cert/ca.crt");
  } else if (!caIsConstrained(openssl, p("ca.crt"))) {
    console.log("  ATTENZIONE: la CA locale (apps/web/.cert/ca.crt) è senza vincoli di nome e potrebbe firmare qualsiasi sito.");
    console.log("  Cancella apps/web/.cert/ca.key e ca.crt, riavvia e reinstalla il certificato sul telefono (docs/security.md).");
  }
  // DER copy for Android's certificate installer.
  run(["x509", "-in", p("ca.crt"), "-outform", "DER", "-out", p(CA_FILE)]);

  const san = leafSan(addresses);
  const fresh = (() => {
    if (!existsSync(p("server.crt")) || !existsSync(p("server.key"))) return false;
    if (!existsSync(p("server.san")) || readFileSync(p("server.san"), "utf8") !== san) return false;
    const crt = new X509Certificate(readFileSync(p("server.crt")));
    return new Date(crt.validTo).getTime() - Date.now() > 30 * 86400_000;
  })();
  if (!fresh) {
    writeFileSync(
      p("server.cnf"),
      [
        "[req]",
        "prompt = no",
        "distinguished_name = dn",
        "[dn]",
        "CN = Pagina Viva dev server",
        "[v3_leaf]",
        "basicConstraints = critical, CA:FALSE",
        "keyUsage = critical, digitalSignature, keyEncipherment",
        "extendedKeyUsage = serverAuth",
        "subjectKeyIdentifier = hash",
        "authorityKeyIdentifier = keyid:always",
        `subjectAltName = ${san}`,
      ].join("\n"),
    );
    run(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", p("server.key"), "-out", p("server.csr"), "-config", p("server.cnf")]);
    run([
      "x509", "-req", "-in", p("server.csr"), "-CA", p("ca.crt"), "-CAkey", p("ca.key"),
      "-set_serial", `0x${randomBytes(12).toString("hex")}`, "-days", "397",
      "-extfile", p("server.cnf"), "-extensions", "v3_leaf", "-out", p("server.crt"),
    ]);
    writeFileSync(p("server.san"), san);
    console.log(`  Certificato del server emesso per: ${san}`);
  }
  return { key: p("server.key"), cert: p("server.crt"), ca: p(CA_FILE) };
}

// ---------- Helpers ----------

function waitForPort(host: string, p: number, timeoutMs = 30_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const s = net.connect(p, host);
      s.once("connect", () => {
        s.destroy();
        resolve(true);
      });
      s.once("error", () => {
        s.destroy();
        if (Date.now() > until) resolve(false);
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

async function apiStatus(): Promise<string> {
  try {
    const res = await fetch(new URL("/api/health", apiUrl), { signal: AbortSignal.timeout(2000) });
    const j = (await res.json()) as { mode?: string };
    return `attivo su ${apiUrl} (modalità ${j.mode})`;
  } catch {
    return `NON raggiungibile su ${apiUrl}: avvialo con \`pnpm dev:server\` (servono le foto, non gli esempi)`;
  }
}

function findAdb(): string | null {
  return spawnSync("adb", ["version"], { stdio: "ignore" }).status === 0 ? "adb" : null;
}

// ---------- Main ----------

const lans = await lanAddresses();
const env: NodeJS.ProcessEnv = { ...process.env };
let caFile: string | null = null;
const token = newLanToken();
if (!usb) {
  env.PAGINAVIVA_LAN_TOKEN = token;
  const certs = ensureCertificates(lans.map((l) => l.address));
  env.PAGINAVIVA_HTTPS_KEY = certs.key;
  env.PAGINAVIVA_HTTPS_CERT = certs.cert;
  caFile = certs.ca;
}

if (build) {
  console.log("\n  Compilo l'app (vite build)…");
  const t = Date.now();
  const r = spawnSync(process.execPath, [viteBin, "build", "--logLevel", "warn"], { cwd: webDir, env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log(`  Fatto in ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
if (caFile) copyFileSync(caFile, `${webDir}dist/${CA_FILE}`);

const host = usb ? "127.0.0.1" : "0.0.0.0";
const preview = spawn(process.execPath, [viteBin, "preview", "--host", host, "--port", String(port), "--strictPort"], {
  cwd: webDir,
  env,
  stdio: ["ignore", "ignore", "inherit"],
});
preview.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => preview.kill());

if (!(await waitForPort("127.0.0.1", port))) {
  console.error(`  Il server non è partito sulla porta ${port} (è già occupata?).`);
  preview.kill();
  process.exit(1);
}

const line = "  " + "─".repeat(66);
console.log(`\n${line}`);
if (usb) {
  const adb = findAdb();
  let ok = false;
  if (adb) {
    const r = spawnSync(adb, ["reverse", `tcp:${port}`, `tcp:${port}`], { encoding: "utf8" });
    ok = r.status === 0;
    if (!ok) console.log(`  adb reverse non riuscito: ${(r.stderr || r.stdout).trim()}`);
  } else console.log("  adb non trovato: installa Android platform-tools, oppure usa chrome://inspect → Port forwarding.");
  console.log(`  AnimaPage via USB${ok ? " (adb reverse attivo)" : ""}. Sul telefono apri:\n`);
  console.log(`      http://localhost:${port}/\n`);
} else {
  const best = lans[0];
  const others = lans.slice(1).filter((l) => l.score >= 0); // hide Hyper-V/WSL/VPN adapters
  const link = (address: string) => `https://${address}:${port}${UNLOCK_PATH}?t=${token}`;
  console.log("  AnimaPage sulla rete di casa. Sul telefono (stessa Wi-Fi) apri una volta questo link di accesso");
  console.log("  (contiene il codice di questa sessione, che cambia a ogni avvio):\n");
  console.log(best ? `      ${link(best.address)}      (${best.name})\n` : "      (nessun indirizzo di rete trovato)\n");
  if (others.length) console.log(`  Altri indirizzi del PC, se quello sopra non va:\n${others.map((o) => `      ${link(o.address)}   (${o.name})`).join("\n")}\n`);
  if (best) console.log(`  Certificato da installare sul telefono (una volta sola):\n      https://${best.address}:${port}/${CA_FILE}\n`);
  console.log(`  Sul PC: https://localhost:${port}/   ·   aggiungi ?debug=1 per FPS e draw call`);
}
console.log(`  API: ${await apiStatus()}`);
console.log(`  Se il telefono non si collega: Windows deve considerare la rete «Privata» e consentire Node.js`);
console.log(`  nel firewall (vedi docs/dev-setup.md, «Phone (M5)»). Ctrl+C per fermare.`);
console.log(line);
