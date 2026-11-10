// Cartoon shading for the storybook theatre: a two-tone toon material and an inverted-hull outline whose
// width is in screen pixels. The content carries userData.inkSelf, so the China styler never touches it.
import * as THREE from "three";

export const OUTLINE_COLOUR = "#1f1a17";
/** Outline width, in pixels at a 1280x800 drawing buffer; multiplied by the pixel ratio. */
export const OUTLINE_PX = 2.5;

let gradient: THREE.DataTexture | null = null;

/** The shared 2-tone ramp (shade, light). Built once. */
export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([150, 255]), 2, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export function toonMaterial(colour: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color: colour, gradientMap: toonGradient(), ...(map ? { map } : {}) });
}

const VS = /* glsl */ `
uniform float uWidth;
uniform vec2 uRes;
#include <common>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vec4 mvPosition = mv;
  #include <clipping_planes_vertex>
  vec3 vn = normalize(mat3(modelViewMatrix) * objectNormal);
  vec4 clip = projectionMatrix * mv;
  vec2 dir = (projectionMatrix * vec4(vn, 0.0)).xy;
  float len = length(dir);
  if (len > 1e-5) clip.xy += dir / len * uWidth * clip.w * 2.0 / uRes;
  gl_Position = clip;
}`;
const FS = /* glsl */ `
uniform vec3 uColor;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(uColor, 1.0);
}`;

const outlineMats = new Map<number, THREE.ShaderMaterial>();
const size = new THREE.Vector2();

function outlineMaterial(px: number): THREE.ShaderMaterial {
  let m = outlineMats.get(px);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { uWidth: { value: px }, uRes: { value: new THREE.Vector2(1280, 800) }, uColor: { value: new THREE.Color(OUTLINE_COLOUR) } },
      vertexShader: VS,
      fragmentShader: FS,
      side: THREE.BackSide,
      fog: false,
      clipping: true,
    });
    outlineMats.set(px, m);
  }
  return m;
}

/**
 * Adds a dark inverted-hull outline as a child of `mesh` (userData.outline). `px` is the width at a 1280x800
 * drawing buffer, scaled with the renderer's pixel ratio. Skinned meshes get a skinned hull that follows the bones.
 */
export function addOutline(mesh: THREE.Mesh, px: number): void {
  const mat = outlineMaterial(px);
  const skinned = mesh as THREE.SkinnedMesh;
  let hull: THREE.Mesh;
  if (skinned.isSkinnedMesh) {
    const sh = new THREE.SkinnedMesh(mesh.geometry, mat);
    sh.bind(skinned.skeleton, skinned.bindMatrix);
    sh.frustumCulled = false;
    hull = sh;
  } else {
    hull = new THREE.Mesh(mesh.geometry, mat);
  }
  hull.userData.outline = true;
  hull.raycast = () => {};
  hull.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(size);
    mat.uniforms.uRes!.value.copy(size);
    mat.uniforms.uWidth!.value = px * renderer.getPixelRatio();
  };
  mesh.add(hull);
}
