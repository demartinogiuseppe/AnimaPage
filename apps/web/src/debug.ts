// Debug overlay for phone tests: `?debug=1` (kept for the browser tab until `?debug=0`).
// Shows FPS, draw calls and triangles per frame, canvas size, pixel ratio, antialiasing, GPU, and
// whether the page can use camera / service worker / WebXR AR.
//
// The renderer lives inside the player (packages/engine), which does not expose it, so draw calls are
// counted at the WebGL context level (drawArrays/drawElements and their instanced variants).
// `?dpr=1.5` caps window.devicePixelRatio as seen by scripts, to measure the effect of a lower
// render resolution before asking the engine to change its cap (it reads devicePixelRatio at startup).

const KEY = "pv.debug";

export function debugEnabled(params: URLSearchParams): boolean {
  try {
    const d = params.get("debug");
    if (d === "1") sessionStorage.setItem(KEY, params.get("dpr") ?? "");
    if (d === "0") sessionStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) !== null;
  } catch {
    return params.get("debug") === "1";
  }
}

export function installDebugOverlay(): void {
  const dprCap = Number(sessionStorage.getItem(KEY) || NaN);
  const realDpr = window.devicePixelRatio || 1;
  if (dprCap > 0) Object.defineProperty(window, "devicePixelRatio", { get: () => Math.min(realDpr, dprCap), configurable: true });

  let calls = 0;
  let tris = 0;
  const GL_TRIANGLES = 4;
  const GL_TRIANGLE_STRIP = 5;
  const GL_TRIANGLE_FAN = 6;
  const triCount = (mode: number, count: number, instances = 1) =>
    (mode === GL_TRIANGLES ? count / 3 : mode === GL_TRIANGLE_STRIP || mode === GL_TRIANGLE_FAN ? Math.max(0, count - 2) : 0) * instances;
  const protos = [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype].filter(Boolean) as object[];
  for (const p of protos) {
    const proto = p as Record<string, (...a: number[]) => unknown>;
    const wrap = (name: string, count: (a: number[]) => number) => {
      const orig = proto[name];
      if (!orig) return;
      proto[name] = function (this: unknown, ...a: number[]) {
        calls++;
        tris += count(a);
        return orig.apply(this, a);
      };
    };
    wrap("drawArrays", (a) => triCount(a[0]!, a[2]!));
    wrap("drawElements", (a) => triCount(a[0]!, a[1]!));
    wrap("drawArraysInstanced", (a) => triCount(a[0]!, a[2]!, a[3]!));
    wrap("drawElementsInstanced", (a) => triCount(a[0]!, a[1]!, a[4]!));
  }

  const box = document.createElement("pre");
  box.className = "pv-debug";
  box.setAttribute("aria-hidden", "true");
  document.body.append(box);

  let xr = "…";
  const nav = navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } };
  if (!nav.xr) xr = "no navigator.xr";
  else nav.xr.isSessionSupported("immersive-ar").then((ok) => (xr = ok ? "immersive-ar OK" : "immersive-ar no"), () => (xr = "errore"));

  let gpu = "";
  const glInfo = (c: HTMLCanvasElement) => {
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!gpu) gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).slice(0, 48);
    return `AA ${gl.getContextAttributes()?.antialias ? "on" : "off"} (samples ${gl.getParameter(gl.SAMPLES)})`;
  };

  let frames = 0;
  let last = performance.now();
  const tick = (now: number) => {
    frames++;
    if (now - last >= 1000) {
      const fps = (frames * 1000) / (now - last);
      const canvas = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const sw = !("serviceWorker" in navigator) ? "n/d" : navigator.serviceWorker.controller ? "attivo" : "non attivo";
      box.textContent = [
        `FPS ${fps.toFixed(0)}  draw ${Math.round(calls / frames)}  tri ${Math.round(tris / frames).toLocaleString()}`,
        canvas ? `canvas ${canvas.width}×${canvas.height}  ${glInfo(canvas)}` : "canvas —",
        `DPR ${window.devicePixelRatio}${dprCap > 0 ? ` (reale ${realDpr})` : ""}  viewport ${innerWidth}×${innerHeight}`,
        gpu ? `GPU ${gpu}` : "",
        `sicuro ${window.isSecureContext ? "sì" : "NO"}  SW ${sw}  XR ${xr}`,
      ]
        .filter(Boolean)
        .join("\n");
      frames = 0;
      calls = 0;
      tris = 0;
      last = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
