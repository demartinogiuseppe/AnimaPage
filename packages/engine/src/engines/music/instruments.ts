// Simplified procedural instrument models (about 2.4 units tall, standing on y = 0, facing +z),
// plus the schematic harmonic spectrum and loudness envelope of each, for the "wave" panel.
// Spectra and envelopes are illustrative (relative amplitudes), not measurements.
import * as THREE from "three";
import type { MusicInstrument } from "@pv/scene-spec";
import { box, mat, mesh } from "./draw.ts";

/** Relative amplitudes of harmonics 1..8 (schematic: flute almost pure, clarinet odd harmonics, violin ~1/n). */
export const SPECTRA: Record<MusicInstrument, readonly number[]> = {
  piano: [1, 0.55, 0.35, 0.25, 0.15, 0.1, 0.06, 0.04],
  flute: [1, 0.22, 0.07, 0.03, 0, 0, 0, 0],
  violin: [1, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.12],
  clarinet: [1, 0.04, 0.6, 0.03, 0.35, 0.02, 0.2, 0.02],
  xylophone: [1, 0, 0.05, 0.35, 0, 0, 0, 0.08],
  guitar: [1, 0.7, 0.45, 0.3, 0.25, 0.15, 0.1, 0.05],
  bell: [1, 0.6, 0.5, 0.4, 0.5, 0.3, 0.3, 0.2],
};

/** Loudness 0..1 at `tau` seconds after the note starts, for a note lasting `len` seconds. */
export function envelope(instr: MusicInstrument, tau: number, len: number): number {
  if (tau < 0) return 0;
  const release = tau > len ? Math.exp(-(tau - len) * 14) : 1;
  const attack = (a: number) => Math.min(1, tau / a);
  switch (instr) {
    case "piano":
      return attack(0.01) * Math.exp(-tau * 1.6) * release;
    case "guitar":
      return attack(0.005) * Math.exp(-tau * 2.2) * release;
    case "xylophone":
      return attack(0.003) * Math.exp(-tau * 6);
    case "bell":
      return attack(0.003) * Math.exp(-tau * 0.9);
    case "violin":
      return attack(0.12) * 0.9 * release;
    default:
      return attack(0.05) * 0.85 * release;
  }
}

const WOOD = "#8a4b22";
const SILVER = "#c9ced6";

export function instrumentModel(id: MusicInstrument): THREE.Group {
  const g = new THREE.Group();
  g.name = `instrument:${id}`;
  switch (id) {
    case "piano": {
      const body = mat("#2b2522", { roughness: 0.35 });
      g.add(box(2.3, 1.7, 0.75, 0, 1.25, -0.2, body));
      g.add(box(2.3, 0.12, 0.62, 0, 1.0, 0.45, body));
      g.add(box(2.1, 0.08, 0.5, 0, 1.1, 0.45, mat("#f6f3ea")));
      for (let k = 0; k < 15; k++) if (![2, 6, 9, 13].includes(k)) g.add(box(0.07, 0.05, 0.3, -0.98 + k * 0.14, 1.16, 0.32, mat("#111111")));
      for (const x of [-1.05, 1.05]) g.add(box(0.12, 0.95, 0.12, x, 0.47, 0.55, body));
      break;
    }
    case "flute": {
      const metal = mat(SILVER, { metalness: 0.8, roughness: 0.25 });
      const tube = mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 16), metal);
      tube.rotation.z = Math.PI / 2;
      tube.position.set(0, 1.6, 0);
      g.add(tube);
      for (let k = 0; k < 6; k++) g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10).translate(-0.3 + k * 0.22, 1.67, 0), mat("#222222")));
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10).translate(-1.0, 1.67, 0), mat("#222222")));
      for (const x of [-0.8, 0.8]) g.add(box(0.06, 1.55, 0.06, x, 0.78, 0, mat("#6b6f75")));
      g.add(box(2.0, 0.06, 0.4, 0, 0.03, 0, mat("#6b6f75")));
      break;
    }
    case "violin":
    case "guitar": {
      const violin = id === "violin";
      const s = violin ? 1 : 1.25;
      const wood = mat(violin ? WOOD : "#d8a35d", { roughness: 0.4 });
      const lower = mesh(new THREE.SphereGeometry(0.5 * s, 24, 16), wood);
      lower.scale.set(1, 1.05, 0.28);
      lower.position.set(0, 0.95, 0);
      const upper = mesh(new THREE.SphereGeometry(0.4 * s, 24, 16), wood);
      upper.scale.set(1, 1.0, 0.28);
      upper.position.set(0, 0.95 + 0.72 * s, 0);
      g.add(lower, upper);
      g.add(box(0.14, 1.1 * s, 0.1, 0, 0.95 + 1.45 * s, 0.05, mat(violin ? "#1d1a18" : "#5a3a1e")));
      if (violin) {
        g.add(mesh(new THREE.SphereGeometry(0.1, 12, 8).translate(0, 0.95 + 2.05 * s, 0.05), wood));
        for (const x of [-0.18, 0.18]) g.add(box(0.03, 0.22, 0.03, x, 1.12, 0.15, mat("#1d1a18")));
      } else g.add(mesh(new THREE.CircleGeometry(0.2, 24).translate(0, 1.55, 0.115), mat("#2a1c10")));
      for (let k = 0; k < (violin ? 4 : 6); k++) {
        const n = violin ? 4 : 6;
        const x = (k - (n - 1) / 2) * 0.03;
        g.add(box(0.01, 1.9 * s, 0.01, x, 0.85 + 1.0 * s, 0.13, mat("#e8e2d0")));
      }
      g.add(box(0.5, 0.06, 0.5, 0, 0.03, 0, mat("#6b6f75")));
      g.add(box(0.06, 0.5, 0.06, 0, 0.3, -0.1, mat("#6b6f75")));
      break;
    }
    case "clarinet": {
      const black = mat("#1a1a1c", { roughness: 0.3 });
      g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.0, 16).translate(0, 1.45, 0), black));
      g.add(mesh(new THREE.CylinderGeometry(0.09, 0.25, 0.4, 20, 1, true).translate(0, 0.3, 0), black));
      g.add(mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.25, 12).translate(0, 2.55, 0), black));
      const metal = mat(SILVER, { metalness: 0.8, roughness: 0.25 });
      for (let k = 0; k < 5; k++) g.add(mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 16).rotateX(Math.PI / 2).translate(0, 0.8 + k * 0.35, 0), metal));
      break;
    }
    case "xylophone": {
      const frame = mat("#5b4a3a");
      for (const z of [-0.35, 0.35]) g.add(box(2.6, 0.08, 0.08, 0, 0.9, z, frame));
      for (const [x, z] of [[-1.2, -0.35], [1.2, -0.35], [-1.2, 0.35], [1.2, 0.35]] as const) g.add(box(0.08, 0.9, 0.08, x, 0.45, z, frame));
      const colors = ["#e53935", "#fb8c00", "#f2c200", "#43a047", "#00a3b4", "#3949ab", "#8e24aa", "#e53935"];
      colors.forEach((c, k) => g.add(box(0.24, 0.07, 1.0 - k * 0.07, -1.05 + k * 0.3, 0.98, 0, mat(c, { roughness: 0.35 }))));
      for (const s of [-1, 1]) {
        const stick = box(0.04, 0.04, 0.8, 0.6 * s, 1.25, 0.6, mat("#b9925f"));
        stick.rotation.x = -0.5;
        g.add(stick, mesh(new THREE.SphereGeometry(0.08, 10, 8).translate(0.6 * s, 1.07, 0.27), mat("#d63a3a")));
      }
      break;
    }
    case "bell": {
      const frame = mat("#5b4a3a");
      g.add(box(1.8, 0.1, 0.1, 0, 2.45, 0, frame));
      for (const x of [-0.85, 0.85]) g.add(box(0.1, 2.45, 0.1, x, 1.22, 0, frame));
      const gold = mat("#d6a536", { metalness: 0.75, roughness: 0.3 });
      const profile = [[0.02, 0], [0.3, 0.02], [0.33, 0.12], [0.27, 0.35], [0.22, 0.6], [0.16, 0.72], [0.02, 0.76]].map(([x, y]) => new THREE.Vector2(x!, y!));
      for (const [x, s] of [[-0.45, 0.8], [0.05, 1], [0.5, 0.65]] as const) {
        const bell = mesh(new THREE.LatheGeometry(profile, 24), gold);
        bell.scale.setScalar(s);
        bell.position.set(x, 2.35 - 0.76 * s - 0.15, 0);
        g.add(bell, box(0.02, 0.15, 0.02, x, 2.33, 0, frame));
      }
      break;
    }
  }
  return g;
}

/** Bass drum (beats row): red shell, white skins facing +z. */
export function drumModel(): THREE.Group {
  const g = new THREE.Group();
  g.name = "instrument:drum";
  const shell = mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.55, 32).rotateX(Math.PI / 2).translate(0, 0.85, 0), mat("#c62828", { roughness: 0.4 }));
  const skin = mesh(new THREE.CircleGeometry(0.72, 32).translate(0, 0.85, 0.28), mat("#f4efe6"));
  skin.name = "skin";
  const rim = mat("#d0d4da", { metalness: 0.7, roughness: 0.3 });
  g.add(shell, skin);
  for (const z of [-0.28, 0.28]) g.add(mesh(new THREE.TorusGeometry(0.75, 0.03, 6, 32).translate(0, 0.85, z), rim));
  for (const x of [-0.5, 0.5]) g.add(box(0.06, 0.4, 0.06, x, 0.2, 0, rim));
  return g;
}

/** Metronome: wooden pyramid with a swinging arm (`arm` pivots at its bottom). */
export function metronomeModel(): { group: THREE.Group; arm: THREE.Group } {
  const group = new THREE.Group();
  group.name = "metronome";
  const body = mesh(new THREE.CylinderGeometry(0.12, 0.5, 1.4, 4).rotateY(Math.PI / 4).translate(0, 0.7, 0), mat(WOOD, { roughness: 0.45 }));
  body.scale.set(1, 1, 0.7);
  group.add(body);
  const arm = new THREE.Group();
  arm.position.set(0, 0.25, 0.3);
  arm.add(box(0.035, 1.25, 0.03, 0, 0.62, 0, mat(SILVER, { metalness: 0.8, roughness: 0.2 })));
  arm.add(box(0.16, 0.16, 0.06, 0, 0.95, 0, mat("#d6a536", { metalness: 0.6, roughness: 0.3 })));
  group.add(arm);
  return { group, arm };
}
