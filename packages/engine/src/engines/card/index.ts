// `card` engine: no 3D scene (brief §4.2). The player shows only narration, voice, videos and quizzes.
import * as THREE from "three";
import type { Engine } from "../../types.ts";

export function createCardEngine(): Engine {
  return {
    async build() {},
    update() {},
    resolveAnchor: () => false,
    bounds: () => ({ center: new THREE.Vector3(), radius: 1 }),
    dispose() {},
  };
}
