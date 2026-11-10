// Deterministic particle streams (magma, lava, ash, rain, vapour...) and band prisms for the block.
import * as THREE from "three";
import { hash } from "../../util/math.ts";
import { Polyline } from "./util.ts";

export interface StreamStyle {
  color: string;
  size: number;
  /** Units per second along the path. */
  speed: number;
  /** Random sideways offset (units); `grow` multiplies it towards the end of the path. */
  spread: number;
  grow?: number;
  /** Stretch along y (rain streaks). */
  stretch?: number;
}

export const FLOW_STYLES: Record<string, Omit<StreamStyle, "speed">> = {
  magma: { color: "#e2401c", size: 0.09, spread: 0.08 },
  lava: { color: "#ff6a1a", size: 0.1, spread: 0.06 },
  water: { color: "#2f7fd1", size: 0.07, spread: 0.06 },
  vapour: { color: "#cfe9ff", size: 0.08, spread: 0.5 },
  rain: { color: "#3d8fd1", size: 0.045, spread: 0.6, stretch: 3 },
  ash: { color: "#6d6a66", size: 0.2, spread: 0.15, grow: 6 },
  sediment: { color: "#c9a46a", size: 0.07, spread: 0.08 },
};

/** Particles flowing along a polyline: particle i is at ((tau * speed + i * L / n) mod L). Pure in tau. */
export class Stream {
  readonly mesh: THREE.InstancedMesh;
  readonly path: Polyline;
  private readonly jitter: THREE.Vector3[];
  private readonly mtx = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(pts: THREE.Vector3[], count: number, readonly style: StreamStyle, seed = 1) {
    this.path = new Polyline(pts);
    this.mat = new THREE.MeshBasicMaterial({ color: style.color, transparent: true });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.userData.key = true;
    this.jitter = Array.from({ length: count }, (_, i) =>
      new THREE.Vector3(hash(i, seed) - 0.5, hash(i, seed + 1) - 0.5, hash(i, seed + 2) - 0.5).multiplyScalar(2 * style.spread),
    );
  }

  /** tau: seconds since the stream started (negative = not yet); pres: 0..1 fade. */
  update(tau: number, pres: number): void {
    const show = tau >= 0 && pres > 0.001;
    this.mesh.visible = show;
    if (!show) return;
    this.mat.opacity = pres;
    const L = Math.max(1e-6, this.path.length);
    const n = this.jitter.length;
    const { size, speed, grow = 1, stretch = 1 } = this.style;
    for (let i = 0; i < n; i++) {
      const raw = tau * speed - (i * L) / n;
      if (raw < 0) {
        // The stream fills up from the source: particles not yet emitted stay hidden.
        this.mtx.makeScale(0, 0, 0);
      } else {
        const d = raw % L;
        const k = 1 + (grow - 1) * (d / L);
        this.path.at(d, this.tmp).addScaledVector(this.jitter[i]!, k);
        const s = size * (grow > 1 ? 0.6 + 0.6 * (d / L) : 1);
        this.mtx.makeScale(s, s * stretch, s).setPosition(this.tmp);
      }
      this.mesh.setMatrixAt(i, this.mtx);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/**
 * A layer of the block between two profiles top(x) >= bottom(x), as a prism through the block depth
 * (front, back, top, bottom faces and end walls). Samples where the band is empty collapse onto the
 * nearest non-empty one. `eps` widens it slightly so stacked bands never z-fight.
 */
export class Band {
  readonly geo = new THREE.BufferGeometry();
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;

  constructor(
    private readonly xs: number[],
    private readonly halfZ: number,
    private readonly eps: number,
    readonly mat: THREE.MeshStandardMaterial,
  ) {
    const n = xs.length;
    this.pos = new Float32Array((8 * n + 8) * 3);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    const idx: number[] = [];
    const strip = (a: number, b: number) => {
      // Vertices a+i (row 1) and b+i (row 2), i = 0..n-1.
      for (let i = 0; i < n - 1; i++) idx.push(a + i, b + i, a + i + 1, a + i + 1, b + i, b + i + 1);
    };
    strip(0, n); // front: top row, bottom row
    strip(3 * n, 2 * n); // back (reversed winding)
    strip(5 * n, 4 * n); // top: back row, front row
    strip(6 * n, 7 * n); // bottom
    const w = 8 * n;
    idx.push(w, w + 1, w + 2, w + 2, w + 1, w + 3, w + 4, w + 6, w + 5, w + 5, w + 6, w + 7);
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, mat);
  }

  /** Returns false when the band is empty everywhere (mesh hidden). */
  set(top: (x: number) => number, bottom: (x: number) => number): boolean {
    const n = this.xs.length;
    const T: number[] = [];
    const B: number[] = [];
    let first = -1;
    let last = -1;
    for (let i = 0; i < n; i++) {
      const x = this.xs[i]!;
      const t = top(x);
      const b = bottom(x);
      T.push(t);
      B.push(Math.min(t, b));
      if (t - b > 1e-4) {
        if (first < 0) first = i;
        last = i;
      }
    }
    this.mesh.visible = first >= 0;
    if (first < 0) return false;
    const Z = this.halfZ + this.eps;
    const p = this.pos;
    const put = (v: number, x: number, y: number, z: number) => {
      p[v * 3] = x;
      p[v * 3 + 1] = y;
      p[v * 3 + 2] = z;
    };
    const xEnd = (i: number) => (i === 0 ? -this.eps : i === n - 1 ? this.eps : 0);
    for (let i = 0; i < n; i++) {
      const j = Math.min(last, Math.max(first, i));
      const x = this.xs[j]! + xEnd(j);
      const t = T[j]!;
      const b = B[j]!;
      put(i, x, t, Z);
      put(n + i, x, b, Z);
      put(2 * n + i, x, t, -Z);
      put(3 * n + i, x, b, -Z);
      put(4 * n + i, x, t, Z);
      put(5 * n + i, x, t, -Z);
      put(6 * n + i, x, b, Z);
      put(7 * n + i, x, b, -Z);
    }
    const w = 8 * n;
    for (const [k, j] of [
      [0, first],
      [4, last],
    ] as const) {
      const x = this.xs[j]! + xEnd(j);
      put(w + k, x, T[j]!, Z);
      put(w + k + 1, x, B[j]!, Z);
      put(w + k + 2, x, T[j]!, -Z);
      put(w + k + 3, x, B[j]!, -Z);
    }
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    return true;
  }
}
