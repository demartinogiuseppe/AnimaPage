// Procedural classical-orders kit for the art engine: columns (doric / ionic / corinthian),
// entablature, pediment, round arch and dome. Built once at build time, deterministic.
//
// Proportions (column height / lower diameter): doric 7, ionic 9, corinthian 10; flutes: doric 20
// meeting at sharp edges and no base, ionic and corinthian 24 separated by flat fillets, on a base.
// Sources: en.wikipedia "Classical order", "Ionic order", "Corinthian order"; it.wikipedia
// "Ordine dorico", "Ordine ionico" (accessed 2026-11-04). Capitals and mouldings are schematic.
import * as THREE from "three";
import type { ArtElement } from "@pv/scene-spec";

export const STONE = "#e7dfd0";
export const ORDER_RATIO = { doric: 7, ionic: 9, corinthian: 10 } as const;
const FLUTES = { doric: 20, ionic: 24, corinthian: 24 } as const;
const DEG = Math.PI / 180;

export function stoneMaterial(color: THREE.ColorRepresentation = STONE): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
}

/**
 * Fluted shaft from y = 0 to `height`, lower radius `r0`, tapering to 0.83 r0 at the top with a
 * slight swelling (entasis) around a third of the height. Flutes are carved by modulating the radius.
 */
export function shaftGeometry(order: keyof typeof FLUTES, r0: number, height: number): THREE.BufferGeometry {
  const n = FLUTES[order];
  const seg = n * 6;
  const rings = 24;
  const depth = 0.045;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const v = j / rings;
    const taper = 1 - 0.17 * v * v + 0.025 * Math.sin(Math.PI * Math.min(1, v * 1.5));
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const f = ((i % 6) / 6) as number; // position inside one flute, 0..1
      // doric: concave flutes meeting at an arris; ionic/corinthian: flat fillet on 20% of the width.
      const carve = order === "doric" ? Math.sin(Math.PI * f) : f < 0.2 ? 0 : Math.sin((Math.PI * (f - 0.2)) / 0.8);
      const r = r0 * taper * (1 - depth * carve);
      pos.push(Math.sin(th) * r, v * height, Math.cos(th) * r);
    }
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Attic-style base (plinth, torus, scotia, torus) as a lathe, height ~ r0. */
function baseGeometry(r0: number): THREE.BufferGeometry {
  const h = r0;
  const pts = [
    [0, 0],
    [1.42, 0],
    [1.42, 0.3],
    [1.32, 0.34],
    [1.36, 0.45],
    [1.25, 0.55],
    [1.12, 0.62],
    [1.18, 0.75],
    [1.12, 0.88],
    [1.02, 0.94],
    [1.0, 1],
    [0, 1],
  ].map(([x, y]) => new THREE.Vector2(x! * r0, y! * h));
  return new THREE.LatheGeometry(pts, 48);
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, y = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.y = y;
  return o;
}

/** A whole column, base on y = 0, total height `height` (base and capital included). */
export function buildColumn(order: keyof typeof ORDER_RATIO, height: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const d = height / ORDER_RATIO[order];
  const r0 = d / 2;
  const baseH = order === "doric" ? 0 : r0;
  const capH = order === "doric" ? r0 : order === "ionic" ? r0 * 0.75 : d * 1.1;
  const shaftH = height - baseH - capH;
  if (baseH > 0) g.add(mesh(baseGeometry(r0), mat));
  g.add(mesh(shaftGeometry(order, r0, shaftH), mat, baseH));
  const top = baseH + shaftH;
  const rTop = r0 * 0.83;
  if (order === "doric") {
    // necking ring, echinus (flaring cushion) and square abacus
    g.add(mesh(new THREE.CylinderGeometry(rTop * 1.02, rTop * 1.02, capH * 0.12, 40).translate(0, capH * 0.06, 0), mat, top));
    g.add(mesh(new THREE.CylinderGeometry(rTop * 1.38, rTop * 1.02, capH * 0.5, 40).translate(0, capH * 0.37, 0), mat, top));
    g.add(mesh(new THREE.BoxGeometry(rTop * 2.9, capH * 0.38, rTop * 2.9).translate(0, capH * 0.81, 0), mat, top));
  } else if (order === "ionic") {
    // echinus band, two volutes seen from the front (+z) and a thin abacus
    g.add(mesh(new THREE.CylinderGeometry(rTop * 1.12, rTop, capH * 0.35, 40).translate(0, capH * 0.18, 0), mat, top));
    g.add(mesh(new THREE.BoxGeometry(rTop * 3.0, capH * 0.35, rTop * 1.9).translate(0, capH * 0.52, 0), mat, top));
    for (const s of [-1, 1]) {
      const vol = new THREE.TorusGeometry(capH * 0.32, capH * 0.12, 10, 28).translate(0, 0, 0);
      const v = mesh(vol, mat, top + capH * 0.42);
      v.position.x = s * rTop * 1.38;
      v.scale.set(1, 1, 2.6);
      g.add(v);
    }
    g.add(mesh(new THREE.BoxGeometry(rTop * 3.0, capH * 0.18, rTop * 3.0).translate(0, capH * 0.91, 0), mat, top));
  } else {
    // bell with two rings of acanthus leaves, corner volutes and a concave-sided abacus (square here)
    g.add(mesh(new THREE.CylinderGeometry(rTop * 1.42, rTop, capH * 0.85, 40).translate(0, capH * 0.425, 0), mat, top));
    for (let row = 0; row < 2; row++) {
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = ((i + row * 0.5) / n) * Math.PI * 2;
        const leafH = capH * (row === 0 ? 0.42 : 0.62);
        const r = rTop * (row === 0 ? 1.08 : 1.2);
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(rTop * 0.32, leafH, 6), mat);
        leaf.position.set(Math.sin(a) * r, top + leafH / 2, Math.cos(a) * r);
        leaf.rotation.set(Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25);
        g.add(leaf);
      }
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const vol = new THREE.Mesh(new THREE.TorusGeometry(capH * 0.11, capH * 0.045, 8, 18), mat);
      vol.position.set(Math.sin(a) * rTop * 1.45, top + capH * 0.78, Math.cos(a) * rTop * 1.45);
      vol.rotation.y = a;
      g.add(vol);
    }
    g.add(mesh(new THREE.BoxGeometry(rTop * 3.1, capH * 0.15, rTop * 3.1).translate(0, capH * 0.925, 0), mat, top));
  }
  return g;
}

/** Horizontal placement between two ground points: centre, length and yaw (radians). */
function span(from: readonly [number, number], to: readonly [number, number]) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  return { cx: (from[0] + to[0]) / 2, cz: (from[1] + to[1]) / 2, len: Math.hypot(dx, dz), yaw: -Math.atan2(dz, dx) };
}

export interface BuiltElement {
  object: THREE.Object3D;
  /** Top centre (anchor) in the coordinates of the parent of `object` (the art world group). */
  top: THREE.Vector3;
  materials: THREE.MeshStandardMaterial[];
}

export function buildElement(e: ArtElement): BuiltElement {
  const mat = stoneMaterial(e.color);
  const g = new THREE.Group();
  g.name = `element:${e.id}`;
  const top = new THREE.Vector3();
  switch (e.type) {
    case "column": {
      g.add(buildColumn(e.order, e.height, mat));
      g.position.set(e.pos[0], 0, e.pos[1]);
      top.set(e.pos[0], e.height, e.pos[1]);
      break;
    }
    case "entablature": {
      const s = span(e.from, e.to);
      const h = e.height ?? e.depth * 0.8;
      const parts: [number, number, number][] = [
        [0, 0.38, 1], // architrave
        [0.38, 0.34, 0.98], // frieze
        [0.72, 0.28, 1.12], // cornice, projecting
      ];
      for (const [y0, hh, k] of parts) {
        g.add(mesh(new THREE.BoxGeometry(s.len * (k > 1 ? 1.04 : 1), h * hh, e.depth * k).translate(0, h * (y0 + hh / 2), 0), mat));
      }
      g.position.set(s.cx, e.y, s.cz);
      g.rotation.y = s.yaw;
      top.set(s.cx, e.y + h, s.cz);
      break;
    }
    case "pediment": {
      const s = span(e.from, e.to);
      const rise = (s.len / 2) * Math.tan((e.pitch ?? 13) * DEG);
      const shape = new THREE.Shape([new THREE.Vector2(-s.len / 2, 0), new THREE.Vector2(s.len / 2, 0), new THREE.Vector2(0, rise)]);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: e.depth, bevelEnabled: false }).translate(0, 0, -e.depth / 2);
      g.add(mesh(geo, mat));
      g.position.set(s.cx, e.y, s.cz);
      g.rotation.y = s.yaw;
      top.set(s.cx, e.y + rise, s.cz);
      break;
    }
    case "arch": {
      const r = e.span / 2;
      const pier = e.span * 0.28;
      const outerH = e.height + r + pier * 0.8;
      const W = r + pier;
      const shape = new THREE.Shape();
      shape.moveTo(-W, 0);
      shape.lineTo(W, 0);
      shape.lineTo(W, outerH);
      shape.lineTo(-W, outerH);
      shape.closePath();
      const hole = new THREE.Path();
      hole.moveTo(-r, 0);
      hole.lineTo(r, 0);
      hole.lineTo(r, e.height);
      hole.absarc(0, e.height, r, 0, Math.PI, false);
      hole.lineTo(-r, 0);
      shape.holes.push(hole);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: e.depth, bevelEnabled: false, curveSegments: 32 }).translate(0, 0, -e.depth / 2);
      g.add(mesh(geo, mat));
      g.position.set(e.pos[0], 0, e.pos[1]);
      g.rotation.y = (e.rot ?? 0) * DEG;
      top.set(e.pos[0], outerH, e.pos[1]);
      break;
    }
    case "dome": {
      const drum = e.drum ?? 0;
      if (drum > 0) g.add(mesh(new THREE.CylinderGeometry(e.radius, e.radius, drum, 48).translate(0, drum / 2, 0), mat));
      g.add(mesh(new THREE.SphereGeometry(e.radius, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat, drum));
      const lantern = e.radius * 0.18;
      g.add(mesh(new THREE.CylinderGeometry(lantern, lantern, lantern * 1.6, 16).translate(0, lantern * 0.8, 0), mat, drum + e.radius * 0.97));
      g.position.set(e.pos[0], e.y, e.pos[1]);
      top.set(e.pos[0], e.y + drum + e.radius + lantern * 1.6, e.pos[1]);
      break;
    }
  }
  return { object: g, top, materials: [mat] };
}
