// Server pipeline: analyze -> enrich -> generate. Implemented from M2 onwards.
export type Mode = "live" | "mock";

export function readMode(env: Record<string, string | undefined>): Mode {
  return env.PAGINAVIVA_MODE === "live" ? "live" : "mock";
}
