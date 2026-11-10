// Procedural geometry of the diorama: primitive shapes, dot-matrix text, ladder, placeholder, glow texture.
// Every builder returns an object whose base sits at y = 0 and is centred in x/z (bulbs: centred on 0).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Shape } from "@pv/scene-spec";
import { glyphDots, GLYPH_ROWS, textLayout } from "./font.ts";
import { buildClock, type ClockObj } from "./clock.ts";

export type CanvasFactory = ((w: number, h: number) => HTMLCanvasElement) | undefined;

export const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, ...extra });

/** Soft radial dot, for sparks and halos. Null in Node (no canvas). */
export function glowTexture(cc: CanvasFactory): THREE.Texture | null {
  if (!cc) return null;
  const c = cc(64, 64);
  const g = c.getContext("2d");
  if (!g) return null;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.35, "rgba(255,255,255,0.55)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Box from a to b (a beam), `t` thick. */
function beam(a: THREE.Vector3, b: THREE.Vector3, t: number, m: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(t, len, t), m);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

/** Red A-frame step ladder, `h` tall, front (with rungs) towards +z. */
export function buildLadder(h: number): { obj: THREE.Group; mats: THREE.Material[] } {
  const red = mat("#d8382c");
  const grey = mat("#8f969c");
  const g = new THREE.Group();
  const top = 0.2;
  for (const sx of [-1, 1]) {
    g.add(beam(new THREE.Vector3(sx * 0.3, 0, 0.5), new THREE.Vector3(sx * top, h, 0.04), 0.07, red));
    g.add(beam(new THREE.Vector3(sx * 0.3, 0, -0.5), new THREE.Vector3(sx * top, h, -0.04), 0.07, red));
  }
  for (let y = 0.35; y < h - 0.1; y += 0.35) {
    const f = y / h;
    const w = 0.3 + (top - 0.3) * f;
    const z = 0.5 * (1 - f) + 0.04 * f;
    const rung = new THREE.Mesh(new THREE.BoxGeometry(w * 2, 0.04, 0.14), grey);
    rung.position.set(0, y, z);
    g.add(rung);
  }
  const cap = new THREE.Mesh(new THREE.BoxGeometry(top * 2 + 0.1, 0.06, 0.24), red);
  cap.position.set(0, h, 0);
  g.add(cap);
  return { obj: g, mats: [red, grey] };
}

/** Translucent box standing in for a model that is missing or not loaded (Node). */
export function buildPlaceholder(size: [number, number, number]): { obj: THREE.Group; mats: THREE.Material[] } {
  const [w, h, d] = size.map((v) => Math.max(v, 0.05)) as [number, number, number];
  const m = mat("#b9a6e8", { transparent: true, opacity: 0.75 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  box.position.y = h / 2;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: "#5b4a8f" }));
  edges.position.y = h / 2;
  const g = new THREE.Group();
  g.name = "placeholder";
  g.add(box, edges);
  return { obj: g, mats: [m] };
}

/** Merged dot-matrix geometry of `text`, letters `height` tall. */
export function textGeometry(text: string, height: number, depth?: number): THREE.BufferGeometry {
  const cell = height / GLYPH_ROWS;
  const d = depth ?? cell * 0.8;
  const dot = cell * 0.8;
  const { left } = textLayout(text);
  const parts: THREE.BufferGeometry[] = [];
  [...text].forEach((ch, i) => {
    for (const [c, r] of glyphDots(ch)) {
      const b = new THREE.BoxGeometry(dot, dot, d);
      b.translate((left[i]! + c + 0.5) * cell, (r + 0.5) * cell, 0);
      parts.push(b);
    }
  });
  if (!parts.length) return new THREE.BufferGeometry();
  const geo = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return geo;
}

export interface ShapeObj {
  obj: THREE.Object3D;
  mats: THREE.Material[];
  /** Mesh whose geometry is replaced when a text item changes text. */
  textMesh?: THREE.Mesh;
  plate?: THREE.Mesh;
  halo?: THREE.Mesh;
  /** Wire tube (geometry rebuilt by the engine). */
  wireMesh?: THREE.Mesh;
  /** Clock: hands/display set from the time. */
  clock?: ClockObj;
}

export function buildShape(shape: Shape, cc: CanvasFactory): ShapeObj {
  switch (shape.shape) {
    case "box": {
      const m = mat(shape.color);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...shape.size), m);
      mesh.position.y = shape.size[1] / 2;
      return { obj: mesh, mats: [m] };
    }
    case "cylinder": {
      const m = mat(shape.color);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(shape.radiusTop ?? shape.radius, shape.radius, shape.height, shape.sides ?? 20), m);
      mesh.position.y = shape.height / 2;
      return { obj: mesh, mats: [m] };
    }
    case "cone": {
      const m = mat(shape.color);
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(shape.radius, shape.height, 20), m);
      mesh.position.y = shape.height / 2;
      return { obj: mesh, mats: [m] };
    }
    case "sphere": {
      const m = mat(shape.color);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(shape.radius, 20, 14), m);
      mesh.position.y = shape.radius;
      return { obj: mesh, mats: [m] };
    }
    case "bulb": {
      const m = mat(shape.color, { emissive: shape.color });
      return { obj: new THREE.Mesh(new THREE.SphereGeometry(shape.radius, 16, 12), m), mats: [m] };
    }
    case "text": {
      const g = new THREE.Group();
      const m = mat(shape.color);
      const textMesh = new THREE.Mesh(textGeometry(shape.text, shape.height, shape.depth), m);
      g.add(textMesh);
      const mats: THREE.Material[] = [m];
      const out: ShapeObj = { obj: g, mats, textMesh };
      const cell = shape.height / GLYPH_ROWS;
      if (shape.plate) {
        const pm = mat(shape.plate);
        out.plate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), pm);
        mats.push(pm);
        g.add(out.plate);
      }
      const tex = shape.neon === false ? null : glowTexture(cc);
      if (tex) {
        const hm = new THREE.MeshBasicMaterial({ color: shape.color, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
        out.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hm);
        out.halo.position.z = -(shape.depth ?? cell * 0.8) * 0.6;
        g.add(out.halo);
      }
      layoutText(out, shape.text, shape.height, shape.depth);
      return out;
    }
    case "patch": {
      const [w, d] = shape.size;
      const m = mat(shape.color);
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), m);
      base.position.y = 0.01;
      g.add(base);
      const mats: THREE.Material[] = [m];
      if (shape.pattern) {
        const pm = mat(shape.patternColor ?? "#f4f1e8");
        const geo = patternGeometry(shape.pattern, w, d);
        if (geo) {
          const pat = new THREE.Mesh(geo, pm);
          pat.position.y = 0.02;
          g.add(pat);
          mats.push(pm);
        }
      }
      return { obj: g, mats };
    }
    case "clock": {
      const clock = buildClock(shape, cc);
      return { obj: clock.obj, mats: clock.mats, clock };
    }
    case "wire": {
      const m = mat(shape.color ?? "#26282b");
      const wireMesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
      wireMesh.frustumCulled = false;
      return { obj: wireMesh, mats: [m], wireMesh };
    }
  }
}

/** Replaces the text geometry and resizes plate and halo. */
export function layoutText(o: ShapeObj, text: string, height: number, depth?: number): void {
  if (!o.textMesh) return;
  o.textMesh.geometry.dispose();
  o.textMesh.geometry = textGeometry(text, height, depth);
  const cell = height / GLYPH_ROWS;
  const w = textLayout(text).width * cell;
  const d = depth ?? cell * 0.8;
  if (o.plate) {
    o.plate.scale.set(w + 2 * cell, height + 2 * cell, d * 0.5);
    o.plate.position.set(0, height / 2, -d * 0.8);
  }
  if (o.halo) {
    o.halo.scale.set(w + 6 * cell, height + 6 * cell, 1);
    o.halo.position.y = height / 2;
  }
}

function patternGeometry(pattern: "zebra" | "dashes" | "tiles", w: number, d: number): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  const strip = (cx: number, cz: number, sx: number, sz: number) => parts.push(new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2).translate(cx, 0, cz));
  if (pattern === "zebra") {
    // Stripes across the longer side, like a pedestrian crossing.
    const along = w >= d;
    const len = along ? w : d;
    const n = Math.max(1, Math.floor(len / 1.0));
    for (let i = 0; i < n; i++) {
      const c = -len / 2 + (i + 0.5) * (len / n);
      if (along) strip(c, 0, 0.5, d * 0.85);
      else strip(0, c, w * 0.85, 0.5);
    }
  } else if (pattern === "dashes") {
    const along = w >= d;
    const len = along ? w : d;
    for (let c = -len / 2 + 1; c < len / 2 - 0.5; c += 3) {
      if (along) strip(c + 0.75, 0, 1.5, 0.15);
      else strip(0, c + 0.75, 0.15, 1.5);
    }
  } else {
    for (let x = -w / 2 + 1; x < w / 2; x += 1) strip(x, 0, 0.04, d);
    for (let z = -d / 2 + 1; z < d / 2; z += 1) strip(0, z, w, 0.04);
  }
  if (!parts.length) return null;
  const geo = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return geo;
}

/** Sagging cable through a and b (parabola), as a thin tube. */
export function wireGeometry(a: THREE.Vector3, b: THREE.Vector3, sag: number, thickness: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const p = a.clone().lerp(b, f);
    p.y -= sag * 4 * f * (1 - f);
    pts.push(p);
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, thickness / 2, 5, false);
}
