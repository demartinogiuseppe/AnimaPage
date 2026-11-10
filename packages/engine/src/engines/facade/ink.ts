// Line-drawing kit of the façade theatre: paper-white surfaces, grey poché on cut (back) faces, dark
// fine lines and muted red overlays. The look is the same in the Colori and China styles (the app's
// InkStyler skips everything under a group marked `userData.inkSelf`).
//
// Geometry is baked in building-local coordinates, so the section is a uniform on the vertex
// `position` and not a three.js clipping plane. The materials still set `clipping: true` and include
// the clipping chunks, so the stage's page-edge planes keep working on them.
import * as THREE from "three";

/** The one place for line weight and colours (variant C of the China-style comparison: light lines). */
export const FACADE_LINE = {
  ink: 0x6b625a,
  overlay: 0xb03a2e,
  paper: 0xfbfaf6,
  poche: 0x8f897d,
  silhouettePx: 1.0,
  creaseDeg: 20,
  fineAlpha: 0.25,
} as const;

/** A plane that discards nothing: dot(position, 0) - 1 is never above 0. */
const SECTION_OFF = new THREE.Vector4(0, 0, 0, -1);

const SECTION_PARS = /* glsl */ `
uniform vec4 uSection;
varying vec3 vLocal;`;

const PAPER_VS = /* glsl */ `
${SECTION_PARS}
#include <clipping_planes_pars_vertex>
void main() {
  vLocal = position;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}`;

// The paper's vertex shader for solids (they have normals). `uLift` (building metres, 0 = off) is a depth bias on back faces:
// their vertices move that far towards the eye along the view ray, so looking down on a horizontal cut the underside of a cut
// solid (the poché) wins over the top of whatever it rests on (a wall sinks a few centimetres into its plinth, a column's
// pieces touch). Only the plan view sets it. The cut test (vLocal) uses the position as it is, never the moved one.
const PAPER_SOLID_VS = /* glsl */ `
${SECTION_PARS}
uniform float uLift;
#include <clipping_planes_pars_vertex>
void main() {
  vLocal = position;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  if (uLift > 0.0) {
    vec3 toEye = normalize(-mvPosition.xyz);
    if (dot(normalize(mat3(modelViewMatrix) * normal), toEye) < 0.0) mvPosition.xyz += toEye * uLift * length(modelViewMatrix[0].xyz);
  }
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}`;

const PAPER_FS = /* glsl */ `
uniform vec3 uPaper;
uniform vec3 uPoche;
uniform float uAlpha;
${SECTION_PARS}
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  if (dot(vec4(vLocal, 1.0), uSection) > 0.0) discard;
  gl_FragColor = vec4(gl_FrontFacing ? uPaper : uPoche, uAlpha);
  #include <colorspace_fragment>
}`;

// Same screen-space inverted hull as OUTLINE_VS in book/ink.ts.
const HULL_VS = /* glsl */ `
uniform float uWidth;
uniform vec2 uRes;
${SECTION_PARS}
#include <clipping_planes_pars_vertex>
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 mvPosition = mv;
  #include <clipping_planes_vertex>
  vec3 vn = normalize(mat3(modelViewMatrix) * normal);
  vec4 clip = projectionMatrix * mv;
  vec2 dir = (projectionMatrix * vec4(vn, 0.0)).xy;
  float len = length(dir);
  if (len > 1e-5) clip.xy += dir / len * uWidth * clip.w * 2.0 / uRes;
  gl_Position = clip;
}`;

const LINE_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
${SECTION_PARS}
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  if (dot(vec4(vLocal, 1.0), uSection) > 0.0) discard;
  gl_FragColor = vec4(uColor, uAlpha);
  #include <colorspace_fragment>
}`;

export class FacadeInk {
  readonly paper: THREE.ShaderMaterial;
  readonly hull: THREE.ShaderMaterial;
  readonly lines: THREE.ShaderMaterial;
  readonly fine: THREE.ShaderMaterial;
  readonly overlay: THREE.ShaderMaterial;
  private readonly section = SECTION_OFF.clone();
  private readonly faders: THREE.ShaderMaterial[] = [];

  constructor() {
    this.paper = new THREE.ShaderMaterial({
      uniforms: { uPaper: { value: new THREE.Color(FACADE_LINE.paper) }, uPoche: { value: new THREE.Color(FACADE_LINE.poche) }, uAlpha: { value: 1 }, uSection: { value: this.section }, uLift: { value: 0 } },
      vertexShader: PAPER_SOLID_VS,
      fragmentShader: PAPER_FS,
      side: THREE.DoubleSide,
      clipping: true,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.hull = new THREE.ShaderMaterial({
      uniforms: {
        uWidth: { value: FACADE_LINE.silhouettePx },
        uRes: { value: new THREE.Vector2(1, 1) },
        uColor: { value: new THREE.Color(FACADE_LINE.ink) },
        uAlpha: { value: 1 },
        uSection: { value: this.section },
      },
      vertexShader: HULL_VS,
      fragmentShader: LINE_FS,
      side: THREE.BackSide,
      clipping: true,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: 6,
      polygonOffsetUnits: 6,
    });
    this.lines = this.lineMaterial(FACADE_LINE.ink, 1);
    this.fine = this.lineMaterial(FACADE_LINE.ink, FACADE_LINE.fineAlpha);
    this.overlay = this.lineMaterial(FACADE_LINE.overlay, 1);
  }

  private lineMaterial(color: number, alpha: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha }, uSection: { value: this.section } },
      vertexShader: PAPER_VS,
      fragmentShader: LINE_FS,
      clipping: true,
      fog: false,
      transparent: alpha < 1,
    });
  }

  /**
   * A copy of the paper or hull material that shares every uniform with it but `uAlpha`, so one part can fade
   * in on its own while the rest keeps the shared look. Disposed with the ink.
   */
  fader(of: "paper" | "hull"): THREE.ShaderMaterial {
    const src = this[of];
    const m = src.clone();
    m.uniforms = { ...src.uniforms, uAlpha: { value: 1 } };
    m.transparent = true;
    this.faders.push(m);
    return m;
  }

  /** Discard what lies on the positive side of the plane (building-local); null shows everything. */
  setSection(plane: THREE.Plane | null): void {
    if (plane) this.section.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    else this.section.copy(SECTION_OFF);
  }

  /** Plan-only depth bias on back faces, building metres along the view ray (see PAPER_SOLID_VS); 0 = off. */
  setLift(metres: number): void {
    this.paper.uniforms.uLift!.value = metres;
  }

  /** `width`/`height` are the drawing-buffer size (like InkFrame); the hull width scales with pixelRatio. */
  setResolution(width: number, height: number, pixelRatio: number): void {
    this.hull.uniforms.uWidth!.value = FACADE_LINE.silhouettePx * pixelRatio;
    (this.hull.uniforms.uRes!.value as THREE.Vector2).set(width, height);
  }

  dispose(): void {
    for (const m of [this.paper, this.hull, this.lines, this.fine, this.overlay, ...this.faders]) m.dispose();
  }
}

/** Paper surface, silhouette hull and (unless `crease` is false) crease lines for one solid. */
export function addInked(group: THREE.Group, geometry: THREE.BufferGeometry, ink: FacadeInk, opts: { crease?: boolean } = {}): void {
  const parts: THREE.Object3D[] = [new THREE.Mesh(geometry, ink.paper), new THREE.Mesh(geometry, ink.hull)];
  if (opts.crease !== false) parts.push(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, FACADE_LINE.creaseDeg), ink.lines));
  for (const p of parts) p.name = geometry.name;
  group.add(...parts);
}

/** Faint line segments (paving joints and the like); `positions` holds pairs of xyz points. */
export function addFineLines(group: THREE.Group, positions: Float32Array, ink: FacadeInk): void {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  group.add(new THREE.LineSegments(g, ink.fine));
}
