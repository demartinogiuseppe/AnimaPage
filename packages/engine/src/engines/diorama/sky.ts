// Sky gradient, sun and ambient light as a function of the hour of the day.
import * as THREE from "three";
import { lerp, rng } from "../../util/math.ts";
import { darkness } from "./state.ts";

interface Key {
  h: number;
  top: string;
  bottom: string;
  sun: string;
  /** Sun and hemisphere intensities (0..1, scaled by the engine). */
  sunI: number;
  hemiI: number;
}

const KEYS: Key[] = [
  { h: 0, top: "#0a0f2c", bottom: "#1c2350", sun: "#7f9cff", sunI: 0, hemiI: 0.32 },
  { h: 4.5, top: "#0d1436", bottom: "#28305e", sun: "#7f9cff", sunI: 0, hemiI: 0.34 },
  { h: 6, top: "#3a5c9e", bottom: "#f3a988", sun: "#ffb27a", sunI: 0.35, hemiI: 0.6 },
  { h: 7.5, top: "#5d9fe0", bottom: "#f6dcc0", sun: "#ffe2b8", sunI: 0.75, hemiI: 0.85 },
  { h: 12, top: "#4f9be0", bottom: "#d5ecfa", sun: "#fff4e0", sunI: 1, hemiI: 1 },
  { h: 16.5, top: "#5a9cdc", bottom: "#ece2c6", sun: "#ffe7c2", sunI: 0.85, hemiI: 0.9 },
  { h: 18.5, top: "#4a5b9a", bottom: "#f59658", sun: "#ff9a55", sunI: 0.45, hemiI: 0.65 },
  { h: 20, top: "#1d275a", bottom: "#4b4a7c", sun: "#9a8cff", sunI: 0.05, hemiI: 0.42 },
  { h: 21.5, top: "#0a0f2c", bottom: "#1c2350", sun: "#7f9cff", sunI: 0, hemiI: 0.32 },
  { h: 24, top: "#0a0f2c", bottom: "#1c2350", sun: "#7f9cff", sunI: 0, hemiI: 0.32 },
];

export interface SkyState {
  top: THREE.Color;
  bottom: THREE.Color;
  sun: THREE.Color;
  sunI: number;
  hemiI: number;
  dark: number;
  /** Unit vector towards the sun (east = +x in the morning, west in the evening). */
  sunDir: THREE.Vector3;
}

const ca = new THREE.Color();
const cb = new THREE.Color();

export function skyAt(hour: number, out: SkyState): SkyState {
  const h = ((hour % 24) + 24) % 24;
  let k = 1;
  while (k < KEYS.length - 1 && KEYS[k]!.h < h) k++;
  const a = KEYS[k - 1]!;
  const b = KEYS[k]!;
  const f = b.h > a.h ? Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h))) : 0;
  const mix = (x: string, y: string, o: THREE.Color) => o.copy(ca.set(x)).lerp(cb.set(y), f);
  mix(a.top, b.top, out.top);
  mix(a.bottom, b.bottom, out.bottom);
  mix(a.sun, b.sun, out.sun);
  out.sunI = lerp(a.sunI, b.sunI, f);
  out.hemiI = lerp(a.hemiI, b.hemiI, f);
  out.dark = darkness(h);
  // Sun arc from east (6h) over the south side (+z, towards the default camera) to west (18h).
  const ang = ((Math.min(Math.max(h, 5), 19) - 6) / 12) * Math.PI;
  out.sunDir.set(Math.cos(ang), Math.max(0.15, Math.sin(ang)), 0.55).normalize();
  return out;
}

export const newSkyState = (): SkyState => ({
  top: new THREE.Color(),
  bottom: new THREE.Color(),
  sun: new THREE.Color(),
  sunI: 0,
  hemiI: 0,
  dark: 0,
  sunDir: new THREE.Vector3(),
});

/** Gradient dome (shader, two colours) plus stars that fade in at night. */
export function buildSkyDome(radius: number): { dome: THREE.Mesh; stars: THREE.Points; uniforms: { top: { value: THREE.Color }; bottom: { value: THREE.Color } } } {
  const uniforms = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 16),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: "varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader:
        "uniform vec3 top; uniform vec3 bottom; varying float vY; void main(){ float f = smoothstep(-0.05, 0.6, vY); gl_FragColor = vec4(mix(bottom, top, f), 1.0);\n#include <colorspace_fragment>\n}",
    }),
  );
  dome.renderOrder = -10;
  const r = rng(424242);
  const n = 260;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const az = r() * Math.PI * 2;
    const el = 0.12 + r() * 1.35;
    pos.set([Math.cos(az) * Math.cos(el) * radius * 0.95, Math.sin(el) * radius * 0.95, Math.sin(az) * Math.cos(el) * radius * 0.95], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: "#ffffff", size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  stars.renderOrder = -9;
  return { dome, stars, uniforms };
}
