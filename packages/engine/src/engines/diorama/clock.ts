// Clock part (scene-spec clock.ts): an upright dial facing +z, bottom-centred at y = 0, with hour and
// minute hands set from the time (the hour hand moves with the minutes), and/or a digital display.
// Shared by the diorama items and the stage props. `set(minutes)` is all update() needs: pure.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CLOCK_DEFAULT_RADIUS, clockHands, clockMinutes, clockSize, formatClock, type ClockShape } from "@pv/scene-spec";
import type { CanvasFactory } from "./shapes.ts";

export interface ClockObj {
  obj: THREE.Group;
  mats: THREE.Material[];
  hourHand: THREE.Object3D | null;
  minuteHand: THREE.Object3D | null;
  /** Shows a time, minutes after midnight (any real number). */
  set(minutes: number): void;
  /** Last time set (tests, anchors). */
  readonly minutes: number;
}

const lambert = (color: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color });

/** A hand: a tapered blade from the centre upwards (12 o'clock), turned around z by the engine. */
function hand(length: number, width: number, z: number, m: THREE.Material, name: string): THREE.Group {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -length * 0.14);
  shape.lineTo(width / 2, -length * 0.14);
  shape.lineTo(width * 0.32, length);
  shape.lineTo(-width * 0.32, length);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width * 0.35, bevelEnabled: false });
  const mesh = new THREE.Mesh(geo, m);
  const g = new THREE.Group();
  g.name = name;
  g.position.z = z;
  g.add(mesh);
  return g;
}

function digitalTexture(cc: CanvasFactory): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture } | null {
  if (!cc) return null;
  const canvas = cc(256, 96);
  const g = canvas.getContext("2d");
  if (!g) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { canvas, g, tex };
}

export function buildClock(shape: ClockShape, cc: CanvasFactory): ClockObj {
  const r = shape.radius ?? CLOCK_DEFAULT_RADIUS;
  const face = shape.face ?? "analog";
  const [, height, depth] = clockSize(shape);
  const g = new THREE.Group();
  g.name = "clock";
  const mats: THREE.Material[] = [];
  const handsColor = shape.hands ?? "#1d2026";
  const handMat = lambert(handsColor);
  mats.push(handMat);
  let hourHand: THREE.Group | null = null;
  let minuteHand: THREE.Group | null = null;
  let digital: ReturnType<typeof digitalTexture> = null;
  let shown = "";

  if (face !== "digital") {
    const dial = new THREE.Group();
    dial.position.y = r;
    g.add(dial);
    const faceMat = lambert(shape.color ?? "#f8f5ec");
    const rimMat = lambert("#3a3d44");
    mats.push(faceMat, rimMat);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, depth * 0.6, 48).rotateX(Math.PI / 2), faceMat);
    body.position.z = depth * 0.3;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.055, 8, 48), rimMat);
    rim.position.z = depth * 0.62;
    dial.add(body, rim);
    // Ticks: 12 long hour marks, 48 short minute marks (geometry, so the ink style outlines them).
    const ticks: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 60; i++) {
      const hour = i % 5 === 0;
      const len = r * (hour ? 0.16 : 0.06);
      const w = r * (hour ? 0.045 : 0.018);
      const a = (i / 60) * Math.PI * 2;
      const rr = r * 0.86 - len / 2;
      ticks.push(new THREE.PlaneGeometry(w, len).rotateZ(-a).translate(Math.sin(a) * rr, Math.cos(a) * rr, 0));
    }
    const tickGeo = mergeGeometries(ticks)!;
    for (const t of ticks) t.dispose();
    const tickMesh = new THREE.Mesh(tickGeo, handMat);
    tickMesh.position.z = depth * 0.61;
    dial.add(tickMesh);
    // Numerals 1..12 on a transparent disc (needs a canvas: none in Node tests).
    if (cc) {
      const size = 512;
      const canvas = cc(size, size);
      const c2 = canvas.getContext("2d");
      if (c2) {
        c2.clearRect(0, 0, size, size);
        c2.fillStyle = handsColor;
        c2.textAlign = "center";
        c2.textBaseline = "middle";
        c2.font = `600 ${size * 0.095}px system-ui,"Segoe UI",Roboto,Arial,sans-serif`;
        for (let n = 1; n <= 12; n++) {
          const a = (n / 12) * Math.PI * 2;
          const rr = size * 0.5 * 0.62;
          c2.fillText(String(n), size / 2 + Math.sin(a) * rr, size / 2 - Math.cos(a) * rr + size * 0.004);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const nm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
        mats.push(nm);
        const numerals = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, 2 * r), nm);
        numerals.name = "numerals";
        numerals.position.z = depth * 0.612;
        dial.add(numerals);
      }
    }
    // Hands: hour short and wide, minute long and thin, a cap on top. Key: coloured in the ink style.
    hourHand = hand(r * 0.5, r * 0.11, depth * 0.64, handMat, "hour-hand");
    minuteHand = hand(r * 0.78, r * 0.07, depth * 0.68, handMat, "minute-hand");
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.06, r * 0.06, depth * 0.1, 16).rotateX(Math.PI / 2), handMat);
    cap.position.z = depth * 0.74;
    const hands = new THREE.Group();
    hands.name = "hands";
    hands.userData.key = true;
    hands.add(hourHand, minuteHand, cap);
    dial.add(hands);
  }

  if (face !== "analog") {
    // Digital display: a dark box with the time; under the hands for "both", the whole clock for "digital".
    const w = face === "digital" ? 2 * r : r * 0.9;
    const h = face === "digital" ? height : r * 0.32;
    const y = face === "digital" ? h / 2 : r * 0.55;
    // "both": a thin window on the dial, under the hands (they pass over it, as on a real clock).
    const z = face === "digital" ? depth : depth * 0.614;
    const boxMat = lambert("#23262c");
    mats.push(boxMat);
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, face === "digital" ? depth : depth * 0.02), boxMat);
    box.position.set(0, y, face === "digital" ? depth / 2 : depth * 0.6);
    g.add(box);
    digital = digitalTexture(cc);
    if (digital) {
      const sm = new THREE.MeshBasicMaterial({ map: digital.tex, transparent: true, depthWrite: false });
      mats.push(sm);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, h * 0.8), sm);
      screen.name = "digital";
      screen.userData.key = true;
      screen.position.set(0, y, z + depth * 0.01);
      g.add(screen);
    }
  }

  let current = clockMinutes(shape.time);
  const obj: ClockObj = {
    obj: g,
    mats,
    hourHand,
    minuteHand,
    get minutes() {
      return current;
    },
    set(minutes: number) {
      current = minutes;
      const a = clockHands(minutes);
      // Clockwise seen from the front (+z) = negative rotation about z.
      if (hourHand) hourHand.rotation.z = (-a.hour * Math.PI) / 180;
      if (minuteHand) minuteHand.rotation.z = (-a.minute * Math.PI) / 180;
      if (digital) {
        const text = formatClock(minutes, shape.hours ?? 24);
        if (text !== shown) {
          shown = text;
          const { g: c2, canvas, tex } = digital;
          c2.clearRect(0, 0, canvas.width, canvas.height);
          c2.fillStyle = "#7df0a6";
          c2.textAlign = "center";
          c2.textBaseline = "middle";
          c2.font = `700 ${canvas.height * 0.72}px ui-monospace,"Cascadia Mono",Consolas,monospace`;
          c2.fillText(text, canvas.width / 2, canvas.height * 0.54);
          tex.needsUpdate = true;
        }
      }
    },
  };
  obj.set(current);
  return obj;
}
