// Player stylesheet, injected once by mountPlayer. Visual identity from the prototypes
// (docs/reference/analysis-troia.md App. B, analysis-campania.md App. B), with system fonts only:
// no web fonts are downloaded (privacy, brief §11).
export const PLAYER_CSS = /* css */ `
:root{
  --pv-bg:#ecebe6; --pv-surface:#fff; --pv-surface-2:#f4f2ee; --pv-ink:#2a211b; --pv-muted:#6c625a; --pv-line:#ddd7cf;
  --pv-clay:#9b4a22; --pv-clay-ink:#fff; --pv-aegean:#1f5d86; --pv-hl:#f6dfb0; --pv-ok:#2e7d46; --pv-bad:#b8392a;
  --pv-myth:#7a3fa0; --pv-hist:#1f6d5e; --pv-label-bg:rgba(255,255,255,.93); --pv-label-ink:#2a211b;
  --pv-font-display:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
  --pv-font-body:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --pv-font-mono:ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --pv-bg:#15120f; --pv-surface:#1f1a16; --pv-surface-2:#28211c; --pv-ink:#efe6dc; --pv-muted:#a99b8e; --pv-line:#3a3029;
    --pv-clay:#e07a48; --pv-clay-ink:#1d0f07; --pv-aegean:#6fb3e0; --pv-hl:#5b4320; --pv-ok:#66c987; --pv-bad:#ff7c6a;
    --pv-myth:#c49ae6; --pv-hist:#5fc7b0; color-scheme:dark;
  }
}
:root[data-theme="dark"]{
  --pv-bg:#15120f; --pv-surface:#1f1a16; --pv-surface-2:#28211c; --pv-ink:#efe6dc; --pv-muted:#a99b8e; --pv-line:#3a3029;
  --pv-clay:#e07a48; --pv-clay-ink:#1d0f07; --pv-aegean:#6fb3e0; --pv-hl:#5b4320; --pv-ok:#66c987; --pv-bad:#ff7c6a;
  --pv-myth:#c49ae6; --pv-hist:#5fc7b0; color-scheme:dark;
}
.pv-app,.pv-app *,.pv-app *::before,.pv-app *::after{box-sizing:border-box}
.pv-app{height:100%;display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:16px;padding-block:16px;
  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));
  background:var(--pv-pattern,none),var(--pv-bg);color:var(--pv-ink);font-family:var(--pv-font-body);font-size:16px;line-height:1.5}
.pv-app [hidden]{display:none !important}
.pv-app button{font:inherit;color:inherit}
.pv-app :is(button,summary,input,a):focus-visible{outline:3px solid var(--pv-clay);outline-offset:2px}
.pv-app.pv-nostage{grid-template-columns:minmax(0,720px);justify-content:center}
@media (max-width:860px){
  .pv-app{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(300px,52%) minmax(0,1fr);gap:12px;padding-block:12px}
  .pv-app.pv-nostage{grid-template-rows:minmax(0,1fr)}
}

/* ---------- Stage ---------- */
.pv-stage{position:relative;min-height:0;border-radius:22px;overflow:hidden;background:radial-gradient(120% 90% at 50% 35%,#dfe6ea,#c3d1d6);isolation:isolate}
.pv-stage canvas{display:block;width:100%;height:100%;touch-action:none}
.pv-labels{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2}
.pv-hud{position:absolute;left:12px;right:12px;top:12px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;pointer-events:none;z-index:6}
.pv-hud > *{pointer-events:auto}
.pv-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:var(--pv-surface);font-size:13px;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.pv-badge .dot{width:8px;height:8px;border-radius:50%;background:var(--pv-ok);position:relative}
.pv-badge .dot::after{content:"";position:absolute;inset:0;border-radius:50%;border:2px solid var(--pv-ok);animation:pv-live 2s ease-out infinite}
@keyframes pv-live{from{transform:scale(1);opacity:.8}to{transform:scale(2.6);opacity:0}}
.pv-badge b{font-family:var(--pv-font-mono);font-weight:500;font-size:12px}
.pv-kind{font-weight:700;font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:2px 8px;border-radius:999px;color:#fff;background:var(--pv-hist)}
.pv-kind.myth{background:#7a3fa0} .pv-kind.hist{background:#1f6d5e}
.pv-icon-btn{border:0;background:var(--pv-surface);border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.pv-status{position:absolute;left:50%;top:56px;transform:translateX(-50%);z-index:3;background:rgba(20,14,10,.72);color:#fff;
  padding:6px 14px;border-radius:999px;font-family:var(--pv-font-display);font-weight:600;letter-spacing:.06em;font-size:14px;white-space:nowrap;font-variant-numeric:tabular-nums}
.pv-pickbar{position:absolute;left:50%;top:56px;transform:translateX(-50%);z-index:4;background:var(--pv-clay);color:var(--pv-clay-ink);padding:8px 14px;border-radius:999px;
  font-weight:700;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.25);max-width:calc(100% - 24px);text-align:center;text-wrap:balance}
.pv-fail{position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;color:#3b3029;font-size:15px}
.pv-infocard{position:absolute;left:12px;bottom:70px;z-index:5;width:min(330px,calc(100% - 24px));background:var(--pv-surface);border-radius:16px;padding:14px 16px;box-shadow:0 8px 28px rgba(0,0,0,.25)}
.pv-infocard h4{margin:0;font-family:var(--pv-font-display);font-weight:800;font-size:18px;line-height:1.2}
.pv-infocard p{margin:6px 0 10px;font-size:15px}
.pv-row{display:flex;gap:8px;flex-wrap:wrap}

/* ---------- Timeline ---------- */
.pv-timeline{display:flex;align-items:center;gap:10px;background:var(--pv-surface);border-radius:999px;padding:6px 14px 6px 6px}
.pv-stage .pv-timeline{position:absolute;left:12px;right:12px;bottom:12px;z-index:4;box-shadow:0 2px 10px rgba(0,0,0,.18)}
.pv-narr-card .pv-timeline{margin-top:12px;background:var(--pv-surface-2);border:1px solid var(--pv-line)}
.pv-tl-play{width:38px;height:38px;border-radius:50%;border:0;background:var(--pv-clay);color:var(--pv-clay-ink);display:grid;place-items:center;cursor:pointer;flex:none}
.pv-app svg{width:16px;height:16px;fill:currentColor;flex:none}
.pv-tl-track{position:relative;flex:1;min-width:0;height:28px;display:flex;align-items:center}
.pv-tl-track input{width:100%;margin:0;accent-color:var(--pv-clay);position:relative;z-index:1;background:transparent}
.pv-tl-marks{position:absolute;left:8px;right:8px;top:50%;height:12px;transform:translateY(-50%);pointer-events:none}
.pv-tl-marks i{position:absolute;top:0;width:2px;height:12px;background:var(--pv-muted);opacity:.45;border-radius:1px}
.pv-tl-time{font-family:var(--pv-font-mono);font-size:12px;color:var(--pv-muted);font-variant-numeric:tabular-nums;flex:none}
.pv-tl-step{width:38px;height:38px;border-radius:50%;border:1px solid var(--pv-line);background:transparent;color:var(--pv-ink);display:grid;place-items:center;cursor:pointer;flex:none}
.pv-tl-step.off{visibility:hidden;pointer-events:none}

/* ---------- Pins ---------- */
.pv-pin{position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;white-space:nowrap;font-size:12.5px;line-height:1.2;color:var(--pv-label-ink);
  border:0;background:none;padding:0;font-family:var(--pv-font-body);will-change:transform}
.pv-pin[hidden]{display:none}
/* A storybook activity is live: a tap on a character under its label must reach the canvas. */
.pv-stage.pv-playing :is(.pv-pin,.pv-pin-dot){pointer-events:none}
.pv-pin .tag{display:inline-flex;align-items:center;gap:6px;background:var(--pv-label-bg);padding:3px 9px;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.3);font-weight:700}
.pv-pin .tag small{font-family:var(--pv-font-mono);font-weight:500;font-size:10.5px;color:#8a3d1a}
.pv-pin .stem{display:block;width:2px;height:12px;margin:0 auto;background:var(--pv-label-bg);box-shadow:0 1px 2px rgba(0,0,0,.25)}
.pv-pin .mk{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
.pv-pin.k-city .tag::before{content:"";width:7px;height:7px;border-radius:50%;background:#1d2b27}
.pv-pin.k-peak .tag::before{content:"";width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid #8f5f3c}
.pv-pin.k-note .tag{background:#2e7d32;color:#fff}
.pv-pin.k-note .tag small{color:#fff}
.pv-pin.k-data .tag{background:#d9502b;color:#fff}
.pv-pin.k-data .tag small{color:#fff}
.pv-pin.text{font-style:italic;font-weight:700;text-shadow:0 0 3px #fff,0 0 6px #fff;border-radius:6px}
.pv-pin.k-area{font-size:13.5px;color:#2d4a1f}
.pv-pin.k-sea{color:#1f5f93;letter-spacing:.12em;text-transform:uppercase;font-size:12px}
.pv-pin.k-region{color:#5d6562;letter-spacing:.16em;text-transform:uppercase;font-style:normal;font-size:11.5px}
.pv-pin.k-river{color:#1d5fae}
.pv-pin.k-island{color:#3b3029;font-size:12.5px}
.pv-pin.pulse .tag,.pv-pin.pulse.text{animation:pv-pulse 1.1s ease-in-out 2}
@keyframes pv-pulse{0%,100%{scale:1}50%{scale:1.22}}
.pv-picking .pv-pin .tag{outline:2px dashed var(--pv-clay);outline-offset:2px}
.pv-picking .pv-pin.text{outline:2px dashed var(--pv-clay);outline-offset:3px}
.pv-pin.right .tag,.pv-pin.right.text{outline:3px solid #2e7d46 !important;background:#e3f4e7}
.pv-pin.wrong{animation:pv-shake .4s}
/* Decluttered labels: leader lines, anchor dots, cluster bubbles ("+N"), occlusion. */
.pv-leader{position:absolute;left:0;top:0;height:1.5px;background:var(--pv-label-bg);box-shadow:0 0 1.5px rgba(0,0,0,.55);transform-origin:0 50%;pointer-events:none;will-change:transform}
.pv-pin-dot{position:absolute;left:0;top:0;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#fff;border:2px solid #2a211b;padding:0;pointer-events:auto;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.35);will-change:transform}
.pv-pin-dot::after{content:"";position:absolute;inset:-10px}
.pv-pin-dot.anchor{width:6px;height:6px;margin:-3px 0 0 -3px;border-width:1.5px;pointer-events:none;box-shadow:none}
.pv-pin-dot.anchor::after{display:none}
.pv-pin .more{position:absolute;top:-8px;right:-6px;background:var(--pv-clay);color:var(--pv-clay-ink);font:800 10.5px/1.4 var(--pv-font-body);border-radius:999px;padding:1px 6px;font-style:normal;letter-spacing:0;text-transform:none;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.pv-pin.cluster .tag{box-shadow:3px 3px 0 -1px var(--pv-label-bg),3px 3px 0 0 rgba(0,0,0,.25),0 1px 4px rgba(0,0,0,.3)}
.pv-pin.fanned{z-index:1}
.pv-pin.occluded{opacity:.45}
/* Numbered dots (progressive disclosure), callouts in the margins, small labels on flat content. */
.pv-pin-dot{display:grid;place-items:center;font:800 9.5px/1 var(--pv-font-body);color:#2a211b;width:18px;height:18px;margin:-9px 0 0 -9px}
.pv-pin-dot.anchor{font-size:0}
.pv-pin.callout .tag{box-shadow:0 1px 3px rgba(0,0,0,.25)}
.pv-pin.callout.occluded{opacity:1}
.pv-pin-dot:not(.anchor){line-height:14px;padding:0;text-align:center;display:block}
.pv-pin.on-content{font-size:11px}
.pv-pin.on-content .tag{background:rgba(255,255,255,.72);padding:2px 7px;box-shadow:0 1px 2px rgba(0,0,0,.2);backdrop-filter:blur(2px)}
.pv-labels-btn .lbl{color:var(--pv-muted)}
.pv-pinlist{list-style:decimal;display:grid;gap:4px;margin:0;padding-left:26px}
.pv-pinlist button{border:0;background:none;padding:2px 0;font:inherit;color:var(--pv-ink);cursor:pointer;text-align:left}
.pv-pinlist button:hover{text-decoration:underline}
.pv-pinlist small{color:var(--pv-muted)}
@media (max-width:520px){.pv-labels-btn .lbl{display:none}}
.pv-pin{transition:opacity .25s}
@media (max-width:520px){.pv-pin{font-size:11px}.pv-pin .tag{padding:2px 7px;gap:4px}.pv-pin .tag small{font-size:9.5px}}
.pv-ink .pv-leader{background:#141414;box-shadow:none;height:1.2px}
.pv-ink .pv-pin-dot{border-color:#141414}
@keyframes pv-shake{25%{margin-left:-6px}75%{margin-left:6px}}

/* ---------- Panel ---------- */
.pv-panel{min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:14px;padding-right:2px;scrollbar-width:thin}
.pv-panel > *{flex:none}
.pv-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
.pv-eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--pv-muted);font-weight:700}
.pv-app h1{margin:2px 0 0;font-family:var(--pv-font-display);font-weight:800;font-size:clamp(28px,3.6vw,38px);line-height:1.05;letter-spacing:.03em;color:var(--pv-clay)}
.pv-meander{height:10px;background:
  repeating-linear-gradient(90deg,var(--pv-clay) 0 2px,transparent 2px 14px),
  linear-gradient(var(--pv-clay),var(--pv-clay)) top/100% 2px no-repeat,
  linear-gradient(var(--pv-clay),var(--pv-clay)) bottom/100% 2px no-repeat;opacity:.55}
.pv-btn{border:0;border-radius:999px;padding:9px 16px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:8px;font-size:15px}
.pv-btn.primary{background:var(--pv-clay);color:var(--pv-clay-ink)}
.pv-btn.soft{background:var(--pv-surface-2);color:var(--pv-ink);border:1px solid var(--pv-line)}
.pv-btn.small{padding:6px 12px;font-size:14px}
.pv-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}
.pv-chips button{flex:none;border:1px solid var(--pv-line);background:var(--pv-surface);border-radius:999px;padding:6px 13px;cursor:pointer;font-size:14px;display:inline-flex;align-items:center;gap:6px}
.pv-chips button i{width:7px;height:7px;border-radius:50%;display:inline-block;background:var(--pv-hist)}
.pv-chips button i.myth{background:var(--pv-myth)}
.pv-chips button[aria-current="true"]{background:var(--pv-ink);border-color:var(--pv-ink);color:var(--pv-bg);font-weight:700}
.pv-chips-next{display:contents}
.pv-chips button.pv-pending{cursor:default;color:var(--pv-muted);border-style:dashed;background:transparent}
.pv-chips button.pv-pending i{background:var(--pv-muted);animation:pv-pending 1.6s ease-in-out infinite}
@keyframes pv-pending{50%{opacity:.25}}
.pv-card{background:var(--pv-surface);border:1px solid var(--pv-line);border-radius:18px;padding:16px 18px}
.pv-card h2{margin:0 0 8px;font-family:var(--pv-font-display);font-weight:800;font-size:22px;line-height:1.2;text-wrap:balance;letter-spacing:.02em}
.pv-kicker{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;font-family:var(--pv-font-mono);font-size:12px;color:var(--pv-muted)}
.pv-narr{margin:0;font-size:17px;line-height:1.6}
.pv-narr > span{border-radius:4px;transition:background .25s;cursor:pointer}
.pv-narr > span:hover{text-decoration:underline dotted;text-underline-offset:3px}
.pv-narr > span.on{background:var(--pv-hl)}
.pv-word{border-radius:4px;transition:background .12s,color .12s}
.pv-word.pv-word-on{background:var(--pv-ink);color:var(--pv-bg)}
.pv-story .pv-narr{font-size:26px;line-height:1.7}
.pv-story .pv-hud-r .pv-style,.pv-story .pv-labels-btn,.pv-story .pv-center,.pv-story .pv-deep,.pv-story .pv-pins-card{display:none}
.pv-speaker{font-family:var(--pv-font-display);font-weight:800;color:var(--pv-clay);font-variant:small-caps;letter-spacing:.03em}
.pv-src{font-family:var(--pv-font-mono);font-size:10.5px;color:var(--pv-aegean);text-decoration:none;margin-left:1px;padding:0 1px}
.pv-src:hover{text-decoration:underline}
.pv-ctrls{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
.pv-switch{display:inline-flex;align-items:center;gap:8px;font-size:14px;color:var(--pv-muted);margin-left:auto;cursor:pointer}
.pv-switch input{width:36px;height:20px;appearance:none;background:var(--pv-line);border-radius:999px;position:relative;cursor:pointer;margin:0}
.pv-switch input::after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .2s}
.pv-switch input:checked{background:var(--pv-clay)}
.pv-switch input:checked::after{left:18px}
.pv-switches{display:flex;gap:14px;flex-wrap:wrap;margin-left:auto}
.pv-switches .pv-switch{margin-left:0}
.pv-note{font-size:13px;color:var(--pv-muted);margin:8px 0 0}
details.pv-card{padding:0}
details.pv-card summary{list-style:none;cursor:pointer;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-family:var(--pv-font-display);font-weight:800;font-size:17px;letter-spacing:.03em}
details.pv-card summary::-webkit-details-marker{display:none}
details.pv-card summary::after{content:"+";font-size:22px;color:var(--pv-clay);line-height:1}
details.pv-card[open] summary::after{content:"–"}
.pv-body{padding:0 18px 16px}
.pv-body ul,.pv-body ol{margin:0 0 12px;padding-left:20px;display:grid;gap:8px}
.pv-body li::marker{color:var(--pv-clay)}
.pv-sources li{font-size:14.5px;scroll-margin:16px;border-radius:6px;transition:background .6s}
.pv-sources li.flash{background:var(--pv-hl)}
.pv-sources .meta{display:block;color:var(--pv-muted);font-size:13px}
.pv-sources a{color:var(--pv-aegean)}
.pv-video{display:grid;gap:8px;margin-bottom:14px}
.pv-video .meta{font-size:13px;color:var(--pv-muted)}
.pv-video .frame{aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#000}
.pv-video iframe{width:100%;height:100%;border:0;display:block}
.pv-quiz .qhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.pv-quiz h3{margin:0;font-family:var(--pv-font-display);font-weight:800;font-size:17px;letter-spacing:.03em}
.pv-quiz .prog{font-family:var(--pv-font-mono);font-size:12px;color:var(--pv-muted)}
.pv-quiz .q{font-size:17px;font-weight:700;margin:10px 0}
.pv-opts{display:grid;gap:8px}
.pv-opts button{text-align:left;border:1px solid var(--pv-line);background:var(--pv-surface-2);border-radius:12px;padding:10px 14px;cursor:pointer;font-size:15.5px}
.pv-opts button:hover:not(:disabled){border-color:var(--pv-clay)}
.pv-opts button.right{border-color:var(--pv-ok);background:color-mix(in srgb,var(--pv-ok) 16%,var(--pv-surface))}
.pv-opts button.wrong{border-color:var(--pv-bad);background:color-mix(in srgb,var(--pv-bad) 14%,var(--pv-surface))}
.pv-opts button:disabled{cursor:default}
.pv-pickhint{padding:10px 14px;border-radius:12px;background:var(--pv-surface-2);border:1px dashed var(--pv-clay);font-size:15px}
.pv-fb{margin:10px 0 0;font-size:15.5px}
.pv-fb b.ok{color:var(--pv-ok)} .pv-fb b.bad{color:var(--pv-bad)}
.pv-qnav{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}
.pv-foot{font-size:13px;color:var(--pv-muted);padding:0 4px 8px}
.pv-foot p{margin:0 0 6px}
/* ---------- Pop-up book: style switch (D12) ---------- */
.pv-hud-r{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.pv-style{display:inline-flex;align-items:center;gap:2px;background:var(--pv-surface);border-radius:999px;padding:3px;box-shadow:0 1px 3px rgba(0,0,0,.15);font-size:13px}
.pv-style > span{padding:0 6px 0 8px;color:var(--pv-muted);font-size:12px}
.pv-style button{border:0;background:none;border-radius:999px;padding:4px 10px;cursor:pointer;font-size:13px}
.pv-style button[aria-pressed="true"]{background:var(--pv-ink);color:var(--pv-bg);font-weight:700}
.pv-narr-card .pv-style{box-shadow:none;border:1px solid var(--pv-line);margin-top:10px}
.pv-stage{background:var(--pv-stage-bg,#7b5b40)}
.pv-panel .pv-themes{padding:2px 4px}
/* Close-ups: a paper margin around the stage keeps the "inside the book" feeling. */
.pv-pageframe{position:absolute;inset:0;pointer-events:none;z-index:1;opacity:0;border-radius:inherit;transition:opacity .3s;
  box-shadow:inset 0 0 0 10px #fbf6ea,inset 0 0 0 11.5px rgba(42,33,27,.45),inset 26px 0 34px -16px rgba(60,40,20,.4),inset 0 0 50px rgba(60,40,20,.2)}
/* Edges of the pages underneath, on the right side. */
.pv-pageframe::before{content:"";position:absolute;right:0;top:14px;bottom:14px;width:10px;border-radius:0 6px 6px 0;
  background:repeating-linear-gradient(90deg,#d9ccb2 0 1px,#fbf6ea 1px 3px)}
.pv-ink .pv-pageframe{box-shadow:inset 0 0 0 10px #fff,inset 0 0 0 11.5px #141414,inset 26px 0 34px -16px rgba(0,0,0,.2)}
.pv-ink .pv-pageframe::before{background:repeating-linear-gradient(90deg,#141414 0 1px,#fff 1px 3px)}
.pv-ink .pv-ink .pv-stage{background:#c3c7cc}

/* ---------- Free movement: on-screen pad (touch devices) and first-time hint ---------- */
.pv-movepad{position:absolute;right:10px;top:50%;transform:translateY(-50%);z-index:3;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.pv-movepad button{border:0;border-radius:50%;background:rgba(255,255,255,.62);color:#2a211b;width:38px;height:38px;font-size:15px;
  display:grid;place-items:center;padding:0;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.2);touch-action:none;-webkit-user-select:none;user-select:none}
.pv-movepad button:active{background:rgba(255,255,255,.95)}
.pv-movepad-toggle{font-size:17px !important}
.pv-movepad-grid{display:grid;grid-template-columns:repeat(3,38px);grid-template-areas:". f u" "l . r" ". b d";gap:4px}
.pv-movepad-grid .mv-forward{grid-area:f} .pv-movepad-grid .mv-back{grid-area:b} .pv-movepad-grid .mv-left{grid-area:l}
.pv-movepad-grid .mv-right{grid-area:r} .pv-movepad-grid .mv-up{grid-area:u} .pv-movepad-grid .mv-down{grid-area:d}
.pv-stage.pv-act-on .pv-movepad{display:none}
.pv-ink .pv-movepad button{background:rgba(255,255,255,.8);border:1.5px solid #141414;box-shadow:none}
.pv-hint{position:absolute;left:50%;top:52px;transform:translateX(-50%);z-index:5;display:flex;gap:10px;align-items:center;
  width:max-content;max-width:calc(100% - 24px);background:rgba(20,14,10,.82);color:#fff;border-radius:14px;padding:8px 10px 8px 14px;font-size:13.5px;line-height:1.35;
  box-shadow:0 6px 18px rgba(0,0,0,.25);animation:pv-card-in2 .4s ease-out}
.pv-hint .pv-btn{flex:none;background:#fff;color:#2a211b;border:0}
/* The first-use hint waits while an activity card (Prevedi, Dimostra) is open, so they never overlap. */
.pv-stage.pv-act-on .pv-hint{display:none}
@media (max-width:520px){.pv-hint{font-size:12px;top:48px}.pv-movepad button{width:34px;height:34px}.pv-movepad-grid{grid-template-columns:repeat(3,34px)}}

/* ---------- AR (player/xr, docs/m5/ar.md): the stage element is the WebXR DOM overlay ---------- */
/* The UA makes the overlay fullscreen with a transparent background; the canvas is not used while presenting. */
.pv-stage.pv-ar{border-radius:0;background:transparent !important}
.pv-stage.pv-ar canvas{visibility:hidden}
.pv-ar .pv-center,.pv-ar .pv-ar-btn,.pv-ar .pv-movepad,.pv-ar .pv-hint,.pv-ar .pv-pageframe{display:none !important}
.pv-ar .pv-hud{top:max(12px,env(safe-area-inset-top,0px))}
.pv-ar-touch{position:absolute;inset:0;z-index:1;touch-action:none}
.pv-arbar{position:absolute;right:10px;top:50%;transform:translateY(-50%);z-index:4;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.pv-arbar button{border:0;border-radius:999px;background:var(--pv-surface);color:var(--pv-ink);padding:8px 14px;min-height:40px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.pv-arbar button.exit{background:var(--pv-clay);color:var(--pv-clay-ink)}
.pv-arbar button:disabled{opacity:.45;cursor:default}
.pv-arbar-ch{display:flex;gap:6px}
.pv-arbar-ch button{width:44px;padding:0;font-size:22px;line-height:1}
.pv-ar-msg{position:absolute;left:50%;bottom:70px;transform:translateX(-50%);z-index:5;width:max-content;max-width:calc(100% - 32px);background:rgba(20,14,10,.8);color:#fff;
  border-radius:14px;padding:8px 14px;font-size:14px;line-height:1.35;text-align:center;pointer-events:none}
.pv-ar .pv-ar-msg{bottom:auto;top:calc(50% + 56px)}
/* Phones: the activity bottom sheet can reach mid-height, the bar goes under the HUD. */
@media (max-width:600px){.pv-arbar{top:calc(56px + env(safe-area-inset-top,0px));transform:none;right:8px;gap:6px}.pv-arbar button{min-height:36px;padding:6px 12px;font-size:13px}}
@media (max-width:520px){.pv-ar-btn .long{display:none}}

/* ---------- Prevedi → Prova → Dimostra (D13) ---------- */
.pv-act{--pv-paper:#fffdf7;--pv-pink:#141414;font-family:var(--pv-font-body)}
.pv-stage .pv-act{position:absolute;inset:0;pointer-events:none;z-index:4}
.pv-stage .pv-act > *{pointer-events:auto}
.pv-act-card{background:var(--pv-paper);color:#2a211b;border:1.5px solid #2a211b;border-radius:6px 6px 14px 14px;padding:14px 16px 16px;
  box-shadow:0 2px 0 #2a211b,0 14px 34px rgba(0,0,0,.28);max-width:460px;overflow:auto}
/* Desktop: the card is docked on the left, over the left page of the book (the stage shifts the picture). */
.pv-stage .pv-act-card{position:absolute;left:14px;top:calc(var(--pv-hud-h,50px) + 12px);width:min(330px,38%);max-height:calc(100% - var(--pv-hud-h,50px) - 86px);
  animation:pv-card-in .45s cubic-bezier(.2,.9,.3,1.2)}
@keyframes pv-card-in{from{transform:translateX(-18px) rotate(-1.5deg);opacity:0}}
.pv-act-head{gap:8px}
.pv-act-head .pv-act-step{margin-left:auto}
.pv-act-min{flex:none;width:26px;height:26px;border-radius:50%;border:1.5px solid #2a211b;background:#fff;cursor:pointer;display:grid;place-items:center;padding:0;color:#2a211b}
.pv-act-min span::before{content:"–";font-weight:800;font-size:15px;line-height:1}
.pv-act-card.min .pv-act-min span::before{content:"+"}
.pv-act-card.min{cursor:pointer;width:auto;max-width:min(330px,calc(100% - 24px))}
.pv-act-card.min > :not(.pv-act-head):not(.pv-act-q){display:none}
.pv-act-card.min .pv-act-q{margin:4px 0 0;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-act-card.min .pv-act-step{display:none}
.pv-nostage .pv-act-card{max-width:none}
.pv-act-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.pv-act-tag{font-weight:800;font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;padding:3px 10px;border-radius:4px;color:var(--pv-clay-ink);background:var(--pv-clay)}
.pv-act-tag.test,.pv-act-tag.prove{color:#fff}
.pv-act-tag.test{background:#1f5d86} .pv-act-tag.prove{background:#2e7d46}
.pv-act-step{font-family:var(--pv-font-mono);font-size:11.5px;color:#7a6d60}
.pv-act-q{margin:4px 0 10px;font-family:var(--pv-font-display);font-weight:800;font-size:19px;line-height:1.25;text-wrap:balance}
.pv-act-q.small{font-size:15px;font-weight:700;color:#5b5047}
.pv-act-opts{display:grid;gap:7px}
.pv-act-opt{display:flex;gap:10px;align-items:center;text-align:left;border:1.5px solid #2a211b;background:#fff;border-radius:10px;padding:8px 12px;cursor:pointer;font-size:15px;color:#2a211b}
.pv-act-opt i{font-style:normal;font-weight:800;font-family:var(--pv-font-mono);width:24px;height:24px;flex:none;border-radius:50%;display:grid;place-items:center;border:1.5px solid #2a211b;font-size:12px}
.pv-act-opt:hover{background:#f6dfb0}
.pv-act-hint{margin:10px 0 0;font-size:12.5px;color:#7a6d60}
.pv-act-ribbon{position:absolute;left:12px;right:12px;bottom:64px;background:var(--pv-paper);color:#2a211b;border:1.5px solid #2a211b;border-radius:12px;padding:8px 10px;
  box-shadow:0 8px 22px rgba(0,0,0,.22);display:grid;gap:8px;animation:pv-card-in2 .4s ease-out}
@keyframes pv-card-in2{from{transform:translateY(12px);opacity:0}}
.pv-nostage .pv-act-ribbon{position:static;margin:0}
.pv-act-line{display:flex;gap:10px;align-items:center}
.pv-act-line p{margin:0;flex:1;font-size:14.5px;line-height:1.35;font-weight:600}
.pv-act-sliders{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;border-top:1px dashed #b9ab9a;padding-top:8px}
.pv-act-try{font-weight:800;font-size:13px;color:#1f5d86}
.pv-act-slider{display:inline-flex;gap:8px;align-items:center;font-size:14px}
.pv-act-slider b{font-family:var(--pv-font-display);font-style:italic;font-size:17px}
.pv-act-slider input{width:120px;accent-color:#1f5d86}
.pv-act-slider output{font-family:var(--pv-font-mono);font-size:12.5px;min-width:3ch}
.pv-stage.pv-act-on canvas{filter:saturate(.9) brightness(.92)}
/* The flap (linguetta): a paper tongue folding up and away on a hinge at its top edge. */
.pv-flap-wrap{position:relative;perspective:900px;margin:6px 0 22px;min-height:118px}
.pv-flap-under{padding:12px 14px;border-radius:10px;background:#f4efe3;border:1px dashed #b9ab9a;min-height:118px}
.pv-act-verdict{margin:0 0 6px;font-size:15px}
.pv-act-verdict b.ok{color:#2e7d46} .pv-act-verdict b.bad{color:#b8392a}
.pv-act-proof{margin:0;font-size:15px;line-height:1.5}
.pv-flap{position:absolute;inset:0;border:1.5px solid #2a211b;border-radius:10px 10px 4px 4px;background:repeating-linear-gradient(135deg,#fffdf7 0 10px,#f7f1e3 10px 20px);
  cursor:grab;display:grid;place-items:center;transform-origin:50% 0;transform-style:preserve-3d;box-shadow:0 6px 0 -2px rgba(0,0,0,.18);color:#2a211b;padding:0 0 26px}
.pv-flap-face{display:grid;gap:2px;text-align:center}
.pv-flap-face b{font-family:var(--pv-font-display);font-size:18px}
.pv-flap-face span{font-size:13px;color:#7a6d60}
.pv-flap-tab{position:absolute;left:50%;bottom:-14px;transform:translateX(-50%);background:#9b4a22;color:#fff;font-weight:800;font-size:12.5px;
  padding:6px 14px 8px;border-radius:0 0 14px 14px;letter-spacing:.03em;box-shadow:0 3px 6px rgba(0,0,0,.25);white-space:nowrap;animation:pv-tab 1.6s ease-in-out infinite}
@keyframes pv-tab{0%,100%{translate:0 0}50%{translate:0 -4px}}
.pv-flap:hover .pv-flap-tab{background:#b8592c}
.pv-flap-wrap.open .pv-flap{animation:pv-flap-lift .8s cubic-bezier(.3,.1,.2,1) forwards;pointer-events:none}
.pv-flap-wrap.open.instant .pv-flap{animation-duration:0s}
@keyframes pv-flap-lift{0%{transform:rotateX(0)}18%{transform:rotateX(-14deg) translateY(-2px)}70%{transform:rotateX(-150deg);opacity:1}100%{transform:rotateX(-176deg);opacity:0;visibility:hidden}}
.pv-act-foot{display:flex;gap:14px;align-items:center;margin-top:12px}
.pv-act-foot:empty{display:none}
.pv-act-got{display:grid;gap:8px;justify-items:start}
.pv-act-got b{font-family:var(--pv-font-display);font-size:16px}
/* The stamp (timbro): red ink, always in colour (it is a key element in china style too). */
.pv-stamp{--c:#c0392b;width:88px;height:88px;flex:none;border-radius:50%;border:3px solid var(--c);box-shadow:inset 0 0 0 3px #fff,inset 0 0 0 5px var(--c);
  color:var(--c);display:grid;place-content:center;text-align:center;padding:10px;rotate:-9deg;font-family:var(--pv-font-display);line-height:1.05;
  background:radial-gradient(circle at 30% 35%,rgba(192,57,43,.06),transparent 60%)}
.pv-stamp small{font-family:var(--pv-font-body);font-size:8.5px;font-weight:800;letter-spacing:.2em;text-transform:uppercase}
.pv-stamp b{font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.02em;margin-top:2px;overflow-wrap:break-word;hyphens:auto}
.pv-stamp.landing{animation:pv-stamp .5s cubic-bezier(.5,0,.6,1.4) both}
@keyframes pv-stamp{0%{transform:scale(2.6);opacity:0;rotate:-28deg}65%{transform:scale(.9);opacity:1;rotate:-7deg}82%{transform:scale(1.04)}100%{transform:scale(1);rotate:-9deg}}
.pv-stamp.fresh{animation:pv-stamp .5s cubic-bezier(.5,0,.6,1.4) both .2s}
.pv-stamp.empty{--c:var(--pv-line);border-style:dashed;box-shadow:none;rotate:0deg;color:var(--pv-muted);background:none}
.pv-stamp.empty small{font-size:10.5px;letter-spacing:.02em;text-transform:none;font-weight:600}
.pv-stamp-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px}
.pv-stamps .pv-stamp{width:76px;height:76px}
.pv-stamps .pv-stamp b{font-size:9.5px}
.pv-stamps h3{margin:0;font-family:var(--pv-font-display);font-weight:800;font-size:17px;letter-spacing:.03em}
.pv-stamps .qhead{display:flex;justify-content:space-between;align-items:baseline}
.pv-stamps .prog{font-family:var(--pv-font-mono);font-size:12px;color:var(--pv-muted)}
/* ---------- Storybook touch activity: side card (desktop) / bottom sheet (phones), badges on the characters ---------- */
.pv-stage .pv-act-card.pv-play{top:auto;bottom:76px;width:min(300px,34%);max-height:calc(100% - 150px);padding:12px 16px 14px;text-align:center;
  border-radius:18px;border-width:2.5px;pointer-events:auto;z-index:5}
.pv-play.calm{animation:none}
.pv-play .pv-play-prompt{margin:0 0 8px;font-size:18px}
.pv-play-letter{box-sizing:border-box;width:104px;height:104px;margin:2px auto 8px;border-radius:50%;background:#facc15;border:3px solid #2a211b;display:grid;place-items:center;
  font-family:var(--pv-font-display);font-weight:800;font-size:72px;line-height:1;color:#2a211b;box-shadow:0 4px 0 #2a211b}
.pv-play-palette{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;justify-items:center;margin:2px 0 8px}
.pv-play-swatch{box-sizing:border-box;width:64px;height:64px;min-width:56px;min-height:56px;border-radius:50%;border:3px solid #2a211b;cursor:pointer;padding:0;box-shadow:0 3px 0 #2a211b;transition:transform .12s}
.pv-play-swatch[aria-pressed=true]{outline:4px solid #2a211b;outline-offset:3px;transform:scale(1.08)}
.pv-play.calm .pv-play-swatch{transition:none}
.pv-play-dots{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:4px}
.pv-play-dot{width:18px;height:18px;border-radius:50%;border:2.5px solid #2a211b;background:#fff}
.pv-play-dot.on{background:#22c55e}
.pv-play-win{display:grid;gap:8px;justify-items:center;margin:4px 0 8px}
.pv-play-win > b{font-family:var(--pv-font-display);font-size:24px}
.pv-play-marks{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3}
.pv-play-badge{position:absolute;left:0;top:0;min-width:42px;height:42px;padding:0 6px;box-sizing:border-box;border-radius:50%;background:#facc15;border:3px solid #2a211b;color:#2a211b;
  display:grid;place-items:center;font-family:var(--pv-font-display);font-weight:800;font-size:24px;line-height:1;box-shadow:0 3px 0 #2a211b;will-change:transform}
.pv-play-badge.pop{animation:pv-badge-pop .35s cubic-bezier(.3,1.6,.5,1) both}
@keyframes pv-badge-pop{from{scale:.2;opacity:0}}
/* Phone: a small bottom sheet that can be folded. */
@media (max-width:600px){
  /* Never taller than the space between the timeline and the top bar (the AR button lives there). */
  .pv-stage .pv-act-card{left:8px;right:8px;top:auto;bottom:56px;width:auto;max-width:none;max-height:min(58%,calc(100% - 112px));border-radius:14px 14px 8px 8px}
  .pv-stage .pv-act-card.min{right:auto}
  .pv-stage .pv-act-card.pv-play{left:4px;right:4px;bottom:66px;width:auto;max-height:min(46%,calc(100% - 120px));padding:8px 6px 10px}
  .pv-play .pv-play-prompt{font-size:15px;margin-bottom:4px}
  .pv-play-letter{width:64px;height:64px;font-size:44px;margin-bottom:4px}
  .pv-play-palette{grid-template-columns:repeat(3,56px);justify-content:center;gap:6px 14px}
  .pv-play-swatch{width:56px;height:56px}
  /* Below the stage (player.ts placePlay): in the flow, full width, compact; never over the scene. */
  .pv-act-card.pv-play.below{position:static;width:auto;max-width:none;max-height:none;margin:0 0 4px;padding:8px 10px 10px;border-radius:14px;text-align:center}
  .pv-act-opts{display:flex;flex-wrap:wrap}
  .pv-act-opt{flex:1 1 auto}
  @keyframes pv-card-in{from{transform:translateY(30px);opacity:0}}
}
@media (max-width:520px){
  .pv-stage .pv-act-card{bottom:56px;padding:8px 10px 10px}
  .pv-act-head{margin-bottom:2px}
  .pv-act-step{display:none}
  .pv-act-q{font-size:15px;margin:2px 0 6px}
  .pv-act-opts{gap:5px}
  .pv-act-opt{padding:4px 9px;font-size:13.5px;gap:8px}
  .pv-act-opt i{width:20px;height:20px;font-size:11px}
  .pv-flap-wrap,.pv-flap-under{min-height:96px}
  .pv-act-proof,.pv-act-verdict{font-size:14px}
  .pv-act-card .pv-stamp{width:72px;height:72px}
  .pv-act-hint{display:none}
  .pv-act-ribbon{bottom:58px;padding:6px 8px}
  .pv-act-line p{font-size:12.5px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .pv-act-slider input{width:90px}
  .pv-hud .pv-style > span{display:none}
  .pv-hud{flex-wrap:nowrap;left:8px;right:8px;top:8px;gap:6px}
  .pv-hud .pv-badge{min-width:0;overflow:hidden;white-space:nowrap;padding:5px 10px;font-size:12px}
  .pv-hud .pv-badge b{overflow:hidden;text-overflow:ellipsis}
  .pv-hud .pv-kind{display:none}
  .pv-hud-r{flex-wrap:nowrap;gap:6px;flex:none}
  .pv-hud .pv-style button{padding:3px 8px;font-size:12px}
  .pv-hud .pv-icon-btn{padding:5px 10px;font-size:12px}
  .pv-status{top:48px;font-size:12.5px;padding:4px 12px}
}

/* ---------- Card engine: CSS open book ---------- */
.pv-book2d{perspective:1400px}
.pv-b2-spread{display:grid;grid-template-columns:1fr 1fr;background:#6e2a1d;padding:8px 8px 10px;border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,.25);transform:rotateX(14deg);transform-origin:50% 100%}
.pv-b2-page{background:#fbf6ea;color:#2a211b;padding:18px 20px 30px;position:relative;min-height:260px;font-family:var(--pv-font-display);font-size:14.5px;line-height:1.45}
.pv-b2-page.left{border-radius:4px 0 0 4px;background:linear-gradient(90deg,#fbf6ea 82%,#e9dfc9)}
.pv-b2-page.right{border-radius:0 4px 4px 0;background:linear-gradient(90deg,#e9dfc9,#fbf6ea 18%)}
.pv-b2-header{font-family:var(--pv-font-body);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#7a6d60;border-bottom:1px solid #cdbfa8;padding-bottom:4px;margin-bottom:10px}
.pv-b2-heading{font-weight:800;font-size:19px;line-height:1.15;color:#9b4a22;margin-bottom:8px}
.pv-b2-formula{border:1.5px solid #2a211b;border-radius:8px;padding:8px;text-align:center;font-style:italic;font-weight:700;font-size:18px;margin:8px 0}
.pv-b2-page p{margin:0 0 6px}
.pv-b2-question{margin-top:10px;border:1.5px dashed #2a211b;border-radius:8px;padding:6px 10px;font-style:italic}
.pv-b2-question b{display:block;font-style:normal;font-family:var(--pv-font-body);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#9b4a22}
.pv-b2-folio{position:absolute;bottom:8px;font-size:12px;color:#7a6d60}
.pv-b2-page.left .pv-b2-folio{left:20px} .pv-b2-page.right .pv-b2-folio{right:20px}
.pv-bmark{font-family:var(--pv-font-mono);font-size:10px;color:#1f5d86;margin-left:2px}
@media (max-width:560px){.pv-b2-spread{grid-template-columns:1fr;transform:none}.pv-b2-page.right{display:none}.pv-b2-page.left{border-radius:4px;min-height:0}}

/* ---------- China (ink) style: black ink on white paper, colour only on key elements ---------- */
.pv-ink .pv-pin .tag{background:#fff;color:#141414;border:1.5px solid #141414;box-shadow:none}
.pv-ink .pv-pin .stem{background:#141414;box-shadow:none;width:1.5px}
.pv-ink .pv-pin .tag small{color:#555}
.pv-ink .pv-pin.text{color:#141414;text-shadow:0 0 3px #fff,0 0 6px #fff}
.pv-ink .pv-pin.k-note .tag,.pv-ink .pv-pin.k-data .tag{background:#fff;color:#141414}
.pv-ink .pv-pin.k-note .tag small,.pv-ink .pv-pin.k-data .tag small{color:#555}
.pv-ink .pv-pin.pulse .tag{animation:pv-pulse-ink 1.1s ease-in-out 2}
.pv-ink .pv-pin.pulse.text{animation:pv-pulse-ink-text 1.1s ease-in-out 2}
@keyframes pv-pulse-ink{0%,100%{scale:1}50%{scale:1.22;background:#d9502b;color:#fff}}
@keyframes pv-pulse-ink-text{0%,100%{scale:1}50%{scale:1.22;color:#d9502b}}
.pv-ink .pv-b2-spread{background:#fff;border:1.5px solid #141414;box-shadow:4px 6px 0 rgba(0,0,0,.12)}
.pv-ink .pv-b2-page{background:#fff !important;border:1.5px solid #141414}
.pv-ink .pv-b2-heading{color:#141414}
.pv-ink .pv-b2-formula{color:#d9502b}

/* ---------- Accademico (decision D24): sober presentation for university and adult readers ---------- */
.pv-app.pv-academic{
  --pv-bg:#eceef1; --pv-surface:#fff; --pv-surface-2:#f5f6f8; --pv-ink:#1b1f24; --pv-muted:#59626d; --pv-line:#d6dbe1;
  --pv-clay:#2c4a75; --pv-clay-ink:#fff; --pv-aegean:#2c5c99; --pv-hl:#e3eaf4; --pv-ok:#2d6a4f; --pv-bad:#a33a2b;
  --pv-myth:#5a4a88; --pv-hist:#3b5566; --pv-label-bg:rgba(255,255,255,.97); --pv-label-ink:#1b1f24; --pv-pattern:none;
  --pv-font-display:Charter,"Bitstream Charter","Iowan Old Style","Palatino Linotype",Georgia,serif;
  font-size:15px;line-height:1.45;color-scheme:light}
.pv-app.pv-academic.pv-dark{
  --pv-bg:#0f1216; --pv-surface:#181c22; --pv-surface-2:#1f242b; --pv-ink:#e4e7eb; --pv-muted:#98a2ad; --pv-line:#2b313a;
  --pv-clay:#8db1e4; --pv-clay-ink:#0c1420; --pv-aegean:#8db1e4; --pv-hl:#243246; --pv-ok:#7fcfa5; --pv-bad:#f08f80;
  --pv-hist:#7fa3b8; --pv-label-bg:rgba(24,28,34,.95); --pv-label-ink:#e4e7eb; color-scheme:dark}
.pv-academic .pv-stage{border-radius:6px;background:#f6f7f9;border:1px solid var(--pv-line)}
.pv-academic.pv-dark .pv-stage{background:#161a20}
.pv-academic .pv-pageframe,.pv-academic .pv-meander{display:none}
.pv-academic h1{font-weight:600;letter-spacing:0;font-size:clamp(22px,2.4vw,27px);line-height:1.15;color:var(--pv-ink)}
.pv-academic .pv-eyebrow{font-weight:600;letter-spacing:.08em}
.pv-academic .pv-card{border-radius:6px;padding:14px 16px}
.pv-academic .pv-card h2{font-weight:600;font-size:19px;letter-spacing:0}
.pv-academic details.pv-card summary{font-weight:600;font-size:15.5px;letter-spacing:0;padding:12px 16px}
.pv-academic .pv-quiz h3{font-weight:600;font-size:15.5px;letter-spacing:0}
.pv-academic .pv-btn{border-radius:4px;font-weight:600;font-size:14px}
.pv-academic .pv-btn.small{font-size:13.5px}
.pv-academic .pv-chips button{border-radius:4px;font-size:13.5px}
.pv-academic .pv-icon-btn,.pv-academic .pv-badge{border-radius:4px;box-shadow:none;border:1px solid var(--pv-line)}
.pv-academic .pv-badge .dot::after{animation:none}
.pv-academic .pv-kind{border-radius:3px;letter-spacing:.08em;background:var(--pv-hist)}
.pv-academic .pv-timeline{border-radius:6px}
.pv-academic .pv-stage .pv-timeline{box-shadow:none;border:1px solid var(--pv-line)}
.pv-academic .pv-tl-play,.pv-academic .pv-tl-step{border-radius:4px}
.pv-academic .pv-speaker{font-variant:normal;font-weight:600}
/* Labels: hairline boxes, regular weight, no colour fills, a quiet outline instead of the bounce. */
.pv-academic .pv-pin .tag{border-radius:3px;box-shadow:none;border:1px solid var(--pv-line);font-weight:500;padding:2px 7px}
.pv-academic .pv-pin.k-note .tag,.pv-academic .pv-pin.k-data .tag{background:var(--pv-label-bg);color:var(--pv-label-ink);border-left:3px solid var(--pv-clay)}
.pv-academic .pv-pin.k-note .tag small,.pv-academic .pv-pin.k-data .tag small,.pv-academic .pv-pin .tag small{color:var(--pv-muted)}
.pv-academic .pv-pin.text{text-shadow:0 0 2px var(--pv-label-bg),0 0 4px var(--pv-label-bg)}
.pv-academic .pv-pin.pulse .tag,.pv-academic .pv-pin.pulse.text{animation:none;outline:1.5px solid var(--pv-clay);outline-offset:1px}
.pv-academic .pv-leader{height:1px;box-shadow:none;background:var(--pv-muted)}
.pv-academic .pv-pin-dot{border-width:1.5px;box-shadow:none;background:var(--pv-label-bg);color:var(--pv-label-ink);border-color:var(--pv-label-ink)}
.pv-academic .pv-infocard{border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.18)}
.pv-academic .pv-infocard h4{font-weight:600}
.pv-academic .pv-status{border-radius:4px;font-family:var(--pv-font-body);letter-spacing:0;font-weight:500}
/* Activity cards: plain sheets, no paper texture, short fades instead of the springy entries. */
.pv-academic .pv-act{--pv-paper:var(--pv-surface)}
.pv-academic .pv-act-card,.pv-academic .pv-act-ribbon{color:var(--pv-ink);border:1px solid var(--pv-line);border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.14);animation:pv-acad-in .2s ease-out}
.pv-academic .pv-flap{border:1px solid var(--pv-line);border-radius:4px;background:var(--pv-surface-2)}
.pv-academic .pv-flap-tab{animation:none;border-radius:0 0 4px 4px;box-shadow:none}
.pv-academic .pv-flap-wrap.open .pv-flap{animation:pv-acad-out .25s ease-out forwards}
@keyframes pv-acad-in{from{opacity:0}}
@keyframes pv-acad-out{to{opacity:0;visibility:hidden}}
/* Key points (the printed page of the book, in the panel). */
.pv-keypoints .pv-kp-label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--pv-muted);font-weight:600}
.pv-keypoints h3{margin:4px 0 6px;font-family:var(--pv-font-display);font-weight:600;font-size:17px;line-height:1.25}
.pv-kp-formula{font-size:1.22em;padding:6px 0 8px;overflow-x:auto;overflow-y:hidden;text-align:center}
.pv-keypoints ul{margin:0;padding-left:18px;display:grid;gap:3px}
/* Card engine: flat sheets instead of the tilted book. */
.pv-academic .pv-b2-spread{background:var(--pv-line);box-shadow:none;transform:none;padding:1px;gap:1px;border-radius:6px}
.pv-academic .pv-b2-page,.pv-academic .pv-b2-page.left{background:var(--pv-surface);color:var(--pv-ink);font-family:var(--pv-font-body);border-radius:0}
.pv-academic .pv-b2-heading{color:var(--pv-ink);font-family:var(--pv-font-display);font-weight:600}
.pv-academic .pv-b2-formula{color:var(--pv-ink)}
/* KaTeX output inside labels and cards. */
.pv-tex .katex{font-size:1.08em;line-height:1.2}
.pv-pin .pv-tex .katex{font-size:1.12em}
@media (prefers-reduced-motion: reduce){.pv-app *{animation:none !important;transition:none !important}}
`;
