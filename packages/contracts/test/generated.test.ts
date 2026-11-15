import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const contracts = join(root, "../../spec/contracts");
const types = readFileSync(join(root, "src/generated/types.ts"), "utf8");
const pascal = (s: string) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
const list = (d: string) => readdirSync(join(contracts, d)).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
const has = (name: string) => new RegExp(`export (interface|type) ${name}\\b`).test(types);

describe("generated types cover every contract", () => {
  it("functions: request + response", () => {
    const files = list("functions");
    expect(files.length).toBeGreaterThan(0);
    expect(types.match(/^\/\*\* [A-Z]+ /gm)?.length).toBe(files.length);
    for (const f of files) {
      const slug = f.replace(/\.json$/, "");
      expect(has(`${pascal(slug)}Request`), slug).toBe(true);
      expect(has(`${pascal(slug)}Response`), slug).toBe(true);
    }
  });
  it("_defs", () => {
    const defs = Object.keys(JSON.parse(readFileSync(join(contracts, "_defs.json"), "utf8")).$defs);
    for (const d of defs) expect(has(d === "Error" ? "ApiError" : d), d).toBe(true);
  });
  it("events and llm", () => {
    for (const f of list("events")) expect(has(`${pascal(JSON.parse(readFileSync(join(contracts, "events", f), "utf8")).type)}Payload`), f).toBe(true);
    for (const f of list("llm")) {
      const n = pascal(JSON.parse(readFileSync(join(contracts, "llm", f), "utf8")).name);
      expect(has(`${n}LlmInput`) && has(`${n}LlmOutput`), f).toBe(true);
    }
  });
  it("is in sync with spec/contracts (regenerate with `pnpm build`)", () => {
    const schemas = readFileSync(join(root, "src/generated/schemas.ts"), "utf8");
    for (const f of list("functions")) expect(schemas.includes(`"slug":"${f.replace(/\.json$/, "")}"`), f).toBe(true);
  });
});
