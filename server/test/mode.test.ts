import { describe, expect, it } from "vitest";
import { readMode } from "../src/index.ts";

describe("readMode", () => {
  it("defaults to mock so everything runs without network or keys", () => {
    expect(readMode({})).toBe("mock");
    expect(readMode({ PAGINAVIVA_MODE: "live" })).toBe("live");
  });
});
