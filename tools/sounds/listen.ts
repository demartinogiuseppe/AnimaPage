// Local listening page for the sound candidates (dev tool, text in Italian). Binds 127.0.0.1 only.
// Usage: pnpm sounds:listen   then open http://127.0.0.1:5175
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CANDIDATES_DIR, isMain, type CandidateRow, type Decisions } from "./common.ts";

export const LISTEN_PORT = 5175;
const SAFE = /^[a-z0-9-]+$/;

const PAGE = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ascolto suoni</title>
<style>
body{font:18px system-ui,sans-serif;margin:0;background:#fffaf0;color:#222}
header{display:flex;gap:16px;align-items:center;padding:12px 20px;background:#2b5d8a;color:#fff;position:sticky;top:0}
header h1{font-size:22px;margin:0;flex:1}
button{font:inherit;border:0;border-radius:12px;padding:10px 18px;cursor:pointer}
#next{background:#ffd34d}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;padding:20px}
.card{background:#fff;border:3px solid #ddd;border-radius:16px;padding:14px}
.card.keep{border-color:#2e9d4f}.card.discard{border-color:#c0392b;opacity:.55}
.play{display:block;width:100%;height:90px;font-size:44px;background:#e8f1fa;margin-bottom:10px}
.row{display:flex;gap:8px}.row button{flex:1}
.keepb{background:#bfe8c9}.discb{background:#f4c4be}
.meta{font-size:13px;color:#555;margin-top:8px;word-break:break-word}
</style></head><body>
<header><h1 id="title">Ascolto suoni</h1><span id="counter"></span><button id="next">Tema successivo</button></header>
<main id="cards"></main>
<script>
let state=[],cur=0;
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e};
async function load(){state=await (await fetch('/api/state')).json();render()}
function render(){
  const t=state[cur];const main=document.getElementById('cards');main.textContent='';
  if(!t){document.getElementById('title').textContent='Nessun candidato: esegui prima sounds:process';return}
  document.getElementById('title').textContent='Tema: '+t.theme+' ('+(cur+1)+' di '+state.length+')';
  const done=t.rows.filter(r=>t.decisions[r.file]).length;
  document.getElementById('counter').textContent='Decisi '+done+' di '+t.rows.length;
  for(const r of t.rows){
    const d=t.decisions[r.file];const card=el('div','card'+(d?' '+d:''));
    const a=new Audio('/audio/'+r.file);
    const p=el('button','play','\\u25B6');p.setAttribute('aria-label','Ascolta');p.onclick=()=>{a.currentTime=0;a.play()};
    const k=el('button','keepb','Tieni'),x=el('button','discb','Scarta');
    k.onclick=()=>decide(t,r,'keep');x.onclick=()=>decide(t,r,'discard');
    const row=el('div','row');row.append(k,x);
    card.append(el('strong','',r.group+' \\u2022 '+r.dur+' s'),p,row,el('div','meta',r.author+' \\u2022 '+r.licence+' \\u2022 picco '+r.peakDb+' dB \\u2022 rms '+r.rmsDb+' dB'));
    main.append(card);
  }
}
async function decide(t,r,v){
  await fetch('/api/decision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({theme:t.theme,file:r.file,decision:v})});
  t.decisions[r.file]=v;render();
}
document.getElementById('next').onclick=()=>{cur=(cur+1)%Math.max(state.length,1);render()};
load();
</script></body></html>`;

interface ThemeState {
  theme: string;
  rows: CandidateRow[];
  decisions: Decisions;
}

function readState(dir: string): ThemeState[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((n) => /^([a-z0-9-]+)\.json$/.exec(n)?.[1])
    .filter((t): t is string => !!t)
    .sort()
    .map((theme) => {
      const rows = (JSON.parse(readFileSync(join(dir, `${theme}.json`), "utf8")) as CandidateRow[]).filter((r) => !r.reason && r.file);
      const decPath = join(dir, `${theme}.decisions.json`);
      return { theme, rows, decisions: existsSync(decPath) ? (JSON.parse(readFileSync(decPath, "utf8")) as Decisions) : {} };
    })
    .filter((t) => t.rows.length > 0);
}

/** Starts the server on 127.0.0.1 (port 0 = any, for tests). */
export function startServer(dir: string, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const send = (code: number, type: string, body: string | Buffer): void => {
      res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    const host = (req.headers.host ?? "").split(":")[0];
    if (host !== "127.0.0.1" && host !== "localhost") return send(403, "text/plain", "forbidden");
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/") return send(200, "text/html; charset=utf-8", PAGE);
    if (req.method === "GET" && url.pathname === "/api/state") {
      try {
        return send(200, "application/json", JSON.stringify(readState(dir)));
      } catch (e) {
        return send(500, "text/plain", `cannot read the candidate sheets: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const audio = /^\/audio\/([a-z0-9-]+)\/([a-z0-9-]+\.ogg)$/.exec(url.pathname);
    if (req.method === "GET" && audio) {
      const file = join(dir, audio[1]!, audio[2]!);
      return existsSync(file) ? send(200, "audio/ogg", readFileSync(file)) : send(404, "text/plain", "not found");
    }
    if (req.method === "POST" && url.pathname === "/api/decision") {
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return send(415, "text/plain", "json only");
      const origin = req.headers.origin;
      const bound = (server.address() as AddressInfo | null)?.port;
      if (origin !== undefined && origin !== `http://127.0.0.1:${bound}` && origin !== `http://localhost:${bound}`) return send(403, "text/plain", "forbidden");
      let body = "";
      req.on("data", (c: Buffer) => {
        body += c.toString();
        if (body.length > 10_000) req.destroy();
      });
      req.on("end", () => {
        try {
          const { theme, file, decision } = JSON.parse(body) as { theme: string; file: string; decision: string };
          const known = readState(dir).find((t) => t.theme === theme)?.rows.some((r) => r.file === file);
          if (!SAFE.test(theme) || !known || (decision !== "keep" && decision !== "discard")) return send(400, "text/plain", "bad request");
          const decPath = join(dir, `${theme}.decisions.json`);
          const dec: Decisions = existsSync(decPath) ? (JSON.parse(readFileSync(decPath, "utf8")) as Decisions) : {};
          dec[file] = decision;
          writeFileSync(decPath, JSON.stringify(dec, null, 2) + "\n");
          send(200, "application/json", "{}");
        } catch {
          send(400, "text/plain", "bad request");
        }
      });
      return;
    }
    send(404, "text/plain", "not found");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (isMain(import.meta.url)) {
  await startServer(CANDIDATES_DIR, LISTEN_PORT);
  console.log(`Ascolto suoni: http://127.0.0.1:${LISTEN_PORT}  (Ctrl+C per chiudere)`);
}
