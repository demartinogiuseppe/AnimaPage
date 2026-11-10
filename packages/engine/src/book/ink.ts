// "China" style (decision D12): paper-white models with black ink outlines, colour only on key elements.
//
// No post-processing: before each render the styler swaps non-key materials for a paper material
// and restores them right after, so engines keep animating their own materials (opacity, emissive)
// untouched. Outlines are inverted hulls (back faces pushed out in screen space) plus crease lines
// for small meshes, kept in an overlay group that mirrors the engine meshes' world matrices.
//
// Key convention for engines: set `object.userData.key = true` on an object (or an ancestor inside
// the engine root) to keep its colours in china style. The styler also keeps:
// - materials that glow (emissive above KEY_EMISSIVE), i.e. what engines highlight right now;
// - additive materials (light, sparks, glows);
// - small meshes at the anchors of the pins highlighted by the current sentence;
// - lines, points and sprites (flows, rays, particles, labels).
import * as THREE from "three";

export const KEY_EMISSIVE = 0.12;
/** Outline width in CSS pixels. */
export const OUTLINE_PX = 1;
/** Warm grey ink (variant C chosen by the user on 2026-11-09: light lines, the scene must not look heavy). */
export const INK_HEX = 0x6b625a;
const INK = new THREE.Color(INK_HEX);
/** Crease lines are secondary: drawn at this opacity under the silhouette. */
const CREASE_ALPHA = 0.25;
const PAPER = new THREE.Color(0xf6f4ef);
/** Faint wash of the original colour on paper (keeps sea and land apart on a map without colouring it). */
const WASH = 0.08;
/** Meshes above this many triangles get no crease lines (terrains, dense models). */
const EDGES_MAX_TRIANGLES = 4000;
/** Only sharp edges get crease lines (low-poly models would otherwise fill with lines). */
const CREASE_DEG = 70;

type AnyMat = THREE.Material & {
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  flatShading?: boolean;
  color?: THREE.Color;
};

/** True when a material must keep its colours in china style. Pure. */
export function isKeyMaterial(m: THREE.Material): boolean {
  const a = m as AnyMat;
  if (m.userData?.key === true) return true;
  if (m.blending === THREE.AdditiveBlending) return true;
  if (a.emissive) {
    const e = Math.max(a.emissive.r, a.emissive.g, a.emissive.b) * (a.emissiveIntensity ?? 1);
    if (e > KEY_EMISSIVE) return true;
  }
  return false;
}

/** userData.key on the object or an ancestor, up to (excluding) `stop`. */
export function isKeyObject(o: THREE.Object3D, stop: THREE.Object3D | null): boolean {
  for (let x: THREE.Object3D | null = o; x && x !== stop; x = x.parent) if (x.userData?.key === true) return true;
  return false;
}

/** userData.inkSelf on the object or an ancestor, up to (excluding) `stop`: the content draws its own lines. */
export function isInkSelf(o: THREE.Object3D, stop: THREE.Object3D | null): boolean {
  for (let x: THREE.Object3D | null = o; x && x !== stop; x = x.parent) if (x.userData?.inkSelf === true) return true;
  return false;
}

const OUTLINE_VS = /* glsl */ `
uniform float uWidth;
uniform vec2 uRes;
#include <clipping_planes_pars_vertex>
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 mv = modelViewMatrix * p;
  vec4 mvPosition = mv;
  #include <clipping_planes_vertex>
  vec3 vn = normalize(mat3(modelViewMatrix) * n);
  vec4 clip = projectionMatrix * mv;
  vec2 dir = (projectionMatrix * vec4(vn, 0.0)).xy;
  float len = length(dir);
  if (len > 1e-5) clip.xy += dir / len * uWidth * clip.w * 2.0 / uRes;
  gl_Position = clip;
}`;
const OUTLINE_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(uColor, uOpacity);
}`;

function posVersion(g: THREE.BufferGeometry): number {
  const a = g.getAttribute("position") as THREE.BufferAttribute & { data?: { version: number } };
  return a.data ? a.data.version : a.version;
}

function outlineMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uWidth: { value: 2 }, uRes: { value: new THREE.Vector2(1, 1) }, uColor: { value: INK.clone() }, uOpacity: { value: 1 } },
    vertexShader: OUTLINE_VS,
    fragmentShader: OUTLINE_FS,
    side: THREE.BackSide,
    fog: false,
    clipping: true,
  });
}

function paperMaterial(): THREE.MeshLambertMaterial {
  const p = new THREE.MeshLambertMaterial({ color: PAPER, fog: false });
  // Textured surfaces (labels, printed decals): dark ink stays dark, everything else turns to paper.
  p.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      #ifdef USE_MAP
        float pvLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(vec3(0.08), diffuse, smoothstep(0.14, 0.42, pvLum));
      #endif`,
    );
  };
  p.customProgramCacheKey = () => "pv-paper";
  return p;
}

interface Entry {
  /** Thin or particle-like geometry (rays, tubes, flow particles): no outline while it is key, or the ink hides the colour. */
  slim: boolean;
  hull: THREE.Mesh | null;
  hullMat: THREE.ShaderMaterial | null;
  edges: THREE.LineSegments | null;
  edgeMat: THREE.LineBasicMaterial | null;
  seen: number;
}

interface EdgeCache {
  edges: THREE.EdgesGeometry | null;
  version: number;
}

export interface InkFrame {
  /** World positions of the pins highlighted right now (their nearby small meshes become key). */
  keyPoints: readonly THREE.Vector3[];
  /** Content bounding radius in world units. */
  radius: number;
  /** Drawing-buffer size and pixel ratio (outline width). */
  width: number;
  height: number;
  pixelRatio: number;
}

export class InkStyler {
  /** Add to the scene at identity: hulls and crease lines live here. */
  readonly overlay = new THREE.Group();
  enabled = false;
  /** Clipping planes for the materials the styler creates (the page edges). */
  clipping: THREE.Plane[] | null = null;

  private papers = new WeakMap<THREE.Material, THREE.MeshLambertMaterial>();
  /** Outline width in CSS pixels (thinner in the Accademico presentation). */
  outlinePx = OUTLINE_PX;
  private allPapers: THREE.Material[] = [];
  private entries = new Map<THREE.Mesh, Entry>();
  private edgeCache = new WeakMap<THREE.BufferGeometry, EdgeCache>();
  private allEdges: THREE.BufferGeometry[] = [];
  private swapped: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
  private frameNo = 0;
  private sphere = new THREE.Sphere();

  constructor(private root: THREE.Object3D) {
    this.overlay.matrixAutoUpdate = false;
    this.overlay.name = "pv-ink-overlay";
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.overlay.visible = on;
  }

  /** Call after the engine update and matrix update, right before rendering. */
  begin(f: InkFrame): void {
    if (!this.enabled) return;
    const n = ++this.frameNo;
    const width = this.outlinePx * f.pixelRatio;
    this.root.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const first = mats[0];
      if (!first || isInkSelf(mesh, this.root)) return;
      const key = isKeyObject(mesh, this.root) || mats.some(isKeyMaterial) || this.nearKeyPoint(mesh, f);
      if (!key) {
        this.swapped.push([mesh, mesh.material]);
        mesh.material = Array.isArray(mesh.material) ? mats.map((m) => this.paperOf(m)) : this.paperOf(first);
      }
      const e = this.entryOf(mesh);
      e.seen = n;
      const op = first.transparent ? first.opacity : 1;
      const show = first.visible && op > 0.04 && !(key && e.slim);
      if (e.hull && e.hullMat) {
        e.hull.visible = show;
        if (show) {
          e.hull.matrixWorld.copy(mesh.matrixWorld);
          const im = mesh as unknown as THREE.InstancedMesh;
          if (im.isInstancedMesh) (e.hull as THREE.InstancedMesh).count = im.count;
          const u = e.hullMat.uniforms;
          u.uWidth!.value = width;
          (u.uRes!.value as THREE.Vector2).set(f.width, f.height);
          u.uOpacity!.value = op;
          e.hullMat.transparent = op < 0.999;
          e.hullMat.depthWrite = op >= 0.999;
        }
      }
      if (e.edges && e.edgeMat) {
        e.edges.visible = show && this.edgesValid(mesh.geometry);
        if (e.edges.visible) {
          e.edges.matrixWorld.copy(mesh.matrixWorld);
          e.edgeMat.opacity = op * CREASE_ALPHA;
          e.edgeMat.transparent = true;
        }
      }
    });
    for (const e of this.entries.values()) {
      if (e.seen === n) continue;
      if (e.hull) e.hull.visible = false;
      if (e.edges) e.edges.visible = false;
    }
  }

  /** Call right after rendering: gives the engines their materials back. */
  end(): void {
    for (const [mesh, m] of this.swapped) mesh.material = m;
    this.swapped.length = 0;
  }

  dispose(): void {
    this.end();
    for (const e of this.entries.values()) {
      e.hullMat?.dispose();
      e.edgeMat?.dispose();
    }
    this.entries.clear();
    for (const m of this.allPapers) m.dispose();
    for (const g of this.allEdges) g.dispose();
    this.overlay.removeFromParent();
  }

  private paperOf(m: THREE.Material): THREE.Material {
    let p = this.papers.get(m);
    if (!p) {
      p = paperMaterial();
      p.clippingPlanes = this.clipping;
      this.papers.set(m, p);
      this.allPapers.push(p);
    }
    const a = m as AnyMat;
    p.color.copy(PAPER);
    if (a.color) p.color.lerp(a.color, WASH);
    p.transparent = m.transparent;
    p.opacity = m.opacity;
    p.side = m.side;
    p.depthWrite = m.depthWrite;
    p.depthTest = m.depthTest;
    p.alphaTest = m.alphaTest;
    p.visible = m.visible;
    p.polygonOffset = m.polygonOffset;
    p.polygonOffsetFactor = m.polygonOffsetFactor;
    p.polygonOffsetUnits = m.polygonOffsetUnits;
    const map = a.map ?? null;
    const alphaMap = a.alphaMap ?? null;
    const flat = a.flatShading ?? false;
    if (p.map !== map || p.alphaMap !== alphaMap || p.flatShading !== flat) {
      p.map = map;
      p.alphaMap = alphaMap;
      p.flatShading = flat;
      p.needsUpdate = true;
    }
    return p;
  }

  private entryOf(mesh: THREE.Mesh): Entry {
    let e = this.entries.get(mesh);
    if (e) return e;
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const size = g.boundingBox ? g.boundingBox.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1);
    const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
    // Curved tubes (function graphs, rivers) span a large box but are thin in one dimension.
    const slim =
      (mesh as unknown as THREE.InstancedMesh).isInstancedMesh || dims[2]! <= 0 || dims[1]! / dims[2]! < 0.12 || dims[0]! / dims[2]! < 0.04;
    e = { slim, hull: null, hullMat: null, edges: null, edgeMat: null, seen: 0 };
    if (g.getAttribute("normal")) {
      e.hullMat = outlineMaterial();
      e.hullMat.clippingPlanes = this.clipping;
      const im = mesh as unknown as THREE.InstancedMesh;
      if (im.isInstancedMesh) {
        const h = new THREE.InstancedMesh(g, e.hullMat, im.count);
        h.instanceMatrix = im.instanceMatrix;
        h.frustumCulled = false;
        e.hull = h;
      } else {
        e.hull = new THREE.Mesh(g, e.hullMat);
      }
      e.hull.matrixAutoUpdate = false;
      e.hull.matrixWorldAutoUpdate = false;
      e.hull.renderOrder = mesh.renderOrder;
      this.overlay.add(e.hull);
    }
    const im = mesh as unknown as THREE.InstancedMesh;
    const tris = (g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0)) / 3;
    if (!im.isInstancedMesh && tris > 0 && tris <= EDGES_MAX_TRIANGLES) {
      let c = this.edgeCache.get(g);
      if (!c) {
        const edges = new THREE.EdgesGeometry(g, CREASE_DEG);
        this.allEdges.push(edges);
        c = { edges, version: posVersion(g) };
        this.edgeCache.set(g, c);
      }
      if (c.edges) {
        e.edgeMat = new THREE.LineBasicMaterial({ color: INK, fog: false, clippingPlanes: this.clipping });
        e.edges = new THREE.LineSegments(c.edges, e.edgeMat);
        e.edges.matrixAutoUpdate = false;
        e.edges.matrixWorldAutoUpdate = false;
        this.overlay.add(e.edges);
      }
    }
    this.entries.set(mesh, e);
    return e;
  }

  /** Crease lines are computed once: geometry animated by the engine loses them (the hull still follows). */
  private edgesValid(g: THREE.BufferGeometry): boolean {
    const c = this.edgeCache.get(g);
    if (!c?.edges) return false;
    if (posVersion(g) !== c.version) {
      c.edges = null;
      return false;
    }
    return true;
  }

  private nearKeyPoint(mesh: THREE.Mesh, f: InkFrame): boolean {
    if (f.keyPoints.length === 0) return false;
    const g = mesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingSphere) return false;
    const s = this.sphere.copy(g.boundingSphere).applyMatrix4(mesh.matrixWorld);
    if (s.radius > f.radius * 0.3) return false;
    return f.keyPoints.some((p) => p.distanceTo(s.center) < s.radius * 1.3 + f.radius * 0.03);
  }
}
