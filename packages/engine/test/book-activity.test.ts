// Prevedi → Prova → Dimostra → Timbro state machine, stamp persistence, style preference, ink key rule.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Activity } from "@pv/scene-spec";
import { ActivityState, readStyle, resolveStyle, sceneKey, StampStore, writeStyle } from "../src/book/activity.ts";
import { isKeyMaterial, isKeyObject, KEY_EMISSIVE } from "../src/book/ink.ts";

const act: Activity = {
  predict: { q: "Che cosa succede?", options: ["A", "B", "C"], answer: 1 },
  test: { prompt: "Guarda.", params: ["a"] },
  prove: { text: "Perché sì.", sourceIds: [] },
  stamp: "Esploratore",
};

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

describe("ActivityState", () => {
  it("goes predict -> test -> prove -> revealed -> stamped, judging the prediction only under the flap", () => {
    const st = new ActivityState(act);
    expect(st.phase).toBe("predict");
    expect(st.blocksPlayback).toBe(true);
    expect(st.finishTest()).toBe(false);
    expect(st.choose(7)).toBe(false);
    expect(st.choose(2)).toBe(true);
    expect(st.phase).toBe("test");
    expect(st.choice).toBe(2);
    expect(st.correct).toBeNull(); // no right/wrong before the flap
    expect(st.blocksPlayback).toBe(false);
    expect(st.choose(1)).toBe(false); // the prediction is kept
    expect(st.lift()).toBe(false);
    expect(st.finishTest()).toBe(true);
    expect(st.phase).toBe("prove");
    expect(st.collect()).toBe(false);
    expect(st.lift()).toBe(true);
    expect(st.correct).toBe(false);
    expect(st.collect()).toBe(true);
    expect(st.phase).toBe("stamped");
    expect(st.collect()).toBe(false); // earned once
  });

  it("knows a right prediction and can be redone", () => {
    const st = new ActivityState(act);
    st.choose(1);
    st.finishTest();
    st.lift();
    expect(st.correct).toBe(true);
    st.restart();
    expect(st.phase).toBe("predict");
    expect(st.choice).toBeNull();
  });

  it("starts as done when the stamp was earned before", () => {
    const st = new ActivityState(act, true);
    expect(st.phase).toBe("stamped");
    expect(st.blocksPlayback).toBe(false);
  });
});

describe("StampStore", () => {
  it("persists stamps per lesson and survives a reload", () => {
    const s = memStore();
    const a = new StampStore(s);
    expect(a.has("L1", "c1")).toBe(false);
    a.add("L1", "c1", "Esploratore");
    a.add("L2", "c1", "Altro");
    const b = new StampStore(s);
    expect(b.load("L1")).toEqual({ c1: "Esploratore" });
    expect(b.has("L2", "c1")).toBe(true);
    expect(b.has("L1", "c2")).toBe(false);
  });

  it("StampStore.clear removes only that scene", () => {
    const s = memStore();
    const st = new StampStore(s);
    st.add("a", "c1", "T");
    st.add("b", "c1", "T");
    st.clear("a");
    expect(st.has("a", "c1")).toBe(false);
    expect(st.has("b", "c1")).toBe(true);
    expect(s.m.has("pv.stamps.a")).toBe(false);
    expect(s.m.has("pv.stamps.b")).toBe(true);
  });

  it("ignores broken or blocked storage", () => {
    const bad = { getItem: () => "{not json", setItem: () => {} };
    expect(new StampStore(bad).load("x")).toEqual({});
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const st = new StampStore(blocked);
    st.add("x", "c", "T");
    expect(st.has("x", "c")).toBe(true); // kept for this page
    expect(new StampStore(null).load("x")).toEqual({});
  });

  it("derives a stable lesson key", () => {
    const spec = { title: "Campania", page: { subject: "Geografia", topic: "La Campania" } };
    expect(sceneKey(spec)).toBe(sceneKey({ ...spec }));
    expect(sceneKey(spec)).not.toBe(sceneKey({ ...spec, title: "Lazio" }));
  });
});

describe("style toggle", () => {
  it("the user's choice wins over the scene default, colour otherwise", () => {
    expect(resolveStyle(null, undefined)).toBe("color");
    expect(resolveStyle(null, "ink")).toBe("ink");
    expect(resolveStyle("color", "ink")).toBe("color");
    expect(resolveStyle("garbage", "ink")).toBe("ink");
  });

  it("persists the choice", () => {
    const s = memStore();
    expect(readStyle(s)).toBeNull();
    writeStyle("ink", s);
    expect(readStyle(s)).toBe("ink");
    expect(resolveStyle(readStyle(s), "color")).toBe("ink");
  });
});

describe("china style key elements", () => {
  it("keeps glowing, additive and userData.key materials in colour", () => {
    expect(isKeyMaterial(new THREE.MeshLambertMaterial({ color: 0xff0000 }))).toBe(false);
    expect(isKeyMaterial(new THREE.MeshLambertMaterial({ emissive: new THREE.Color(KEY_EMISSIVE * 2, 0, 0) }))).toBe(true);
    expect(isKeyMaterial(new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 0.05 }))).toBe(false);
    expect(isKeyMaterial(new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending }))).toBe(true);
    const m = new THREE.MeshBasicMaterial();
    m.userData.key = true;
    expect(isKeyMaterial(m)).toBe(true);
  });

  it("finds userData.key on the object or an ancestor inside the root", () => {
    const root = new THREE.Group();
    const g = new THREE.Group();
    const mesh = new THREE.Mesh();
    root.add(g);
    g.add(mesh);
    expect(isKeyObject(mesh, root)).toBe(false);
    g.userData.key = true;
    expect(isKeyObject(mesh, root)).toBe(true);
    g.userData.key = false;
    root.userData.key = true; // the root itself does not count
    expect(isKeyObject(mesh, root)).toBe(false);
  });
});
