// Catalog models: GLB loading (browser), normalisation to the catalog size, per-item instances.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

export interface LoadedModel {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  box: THREE.Box3;
}

/**
 * Loads each GLB once. Failures (missing file, bad data) are logged and give null: the item then shows a
 * placeholder. `enabled` is false in Node, where GLB textures cannot be decoded: every model is a placeholder.
 */
export async function loadModels(files: string[], load: (path: string) => Promise<ArrayBuffer>, enabled: boolean): Promise<Map<string, LoadedModel | null>> {
  const out = new Map<string, LoadedModel | null>();
  if (!enabled) {
    for (const f of files) out.set(f, null);
    return out;
  }
  const loader = new GLTFLoader();
  await Promise.all(
    [...new Set(files)].map(async (file) => {
      try {
        const gltf = await loader.parseAsync(await load(file), "");
        gltf.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        if (box.isEmpty()) throw new Error("empty model");
        out.set(file, { scene: gltf.scene, clips: gltf.animations, box });
      } catch (e) {
        console.warn(`[diorama] model ${file} unavailable, using a placeholder:`, e);
        out.set(file, null);
      }
    }),
  );
  return out;
}

export interface ModelInstance {
  obj: THREE.Group;
  mats: THREE.Material[];
  mixer?: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
}

/** A clone of `model` scaled so that its height is `height`, base on y = 0, centred in x/z, with its own materials. */
export function instantiate(model: LoadedModel, height: number, tint?: string): ModelInstance {
  const root = cloneSkinned(model.scene);
  const size = model.box.getSize(new THREE.Vector3());
  const center = model.box.getCenter(new THREE.Vector3());
  const k = height / Math.max(size.y, 1e-6);
  const norm = new THREE.Group();
  norm.scale.setScalar(k);
  norm.position.set(-center.x * k, -model.box.min.y * k, -center.z * k);
  norm.add(root);
  const obj = new THREE.Group();
  obj.add(norm);

  const mats: THREE.Material[] = [];
  const tintColor = tint ? new THREE.Color(tint) : null;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
    const clone = (m: THREE.Material) => {
      const c = m.clone() as THREE.MeshStandardMaterial;
      if (tintColor && c.color) c.color.multiply(tintColor);
      // Kenney materials are matte; a metallic surface would render black without an environment map.
      if (c.metalness !== undefined) c.metalness = Math.min(c.metalness, 0.1);
      mats.push(c);
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
  });

  const actions = new Map<string, THREE.AnimationAction>();
  let mixer: THREE.AnimationMixer | undefined;
  if (model.clips.length) {
    mixer = new THREE.AnimationMixer(root);
    for (const c of model.clips) actions.set(c.name, mixer.clipAction(c));
  }
  return { obj, mats, ...(mixer ? { mixer } : {}), actions };
}
