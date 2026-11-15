import { describe, expect, it } from "vitest";
import { cronIds, envOf, plan, verify } from "../src/apply.ts";
import { allBodies, watchSlug } from "../src/monitors.ts";
import { WATCH_KEYS } from "../src/watches.ts";

const ids = Object.fromEntries(WATCH_KEYS.map((k, i) => [watchSlug(k), `id-${i}`]));
const rec = [{ kind: "email" as const, value: "ops@merc.test" }];

describe("apply", () => {
  it("only dev or demo, never a default", () => {
    expect(() => envOf("")).toThrow(/no default/);
    expect(envOf("dev").workspace).toBe("7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464");
  });
  it("reads merc-watch cron ids only", () => {
    expect(cronIds(() => JSON.stringify([{ id: "a", slug: "merc-watch-debrief-latency" }, { id: "b", slug: "previsit-briefs-due" }]))).toEqual({ "merc-watch-debrief-latency": "a" });
  });
  it("matches by name: update existing, create missing, refuse duplicates", () => {
    const bodies = allBodies(ids, rec);
    const p = plan(bodies, [{ id: "m1", name: "merc-debrief-latency" }, { id: "x", name: "someone-elses" }]);
    expect(p.find((x) => x.name === "merc-debrief-latency")).toMatchObject({ action: "update", id: "m1" });
    expect(p.filter((x) => x.action === "create")).toHaveLength(bodies.length - 1);
    expect(() => plan(bodies, [{ id: "1", name: "merc-function-errors" }, { id: "2", name: "merc-function-errors" }])).toThrow(/more than one/);
  });
  it("verify flags a read-back that differs from what was sent", () => {
    const b = allBodies(ids, rec)[0]!;
    const got = { ...b, trigger_conditions: { children: [{ comparison_operator: "GreaterThan", value: b.trigger_conditions.children[0]!.value, children: [] }], operator: "Or" } };
    expect(verify(b, got)).toEqual([]);
    expect(verify(b, { ...got, metric: "ToolFailure", recipients: [] })).toEqual([expect.stringContaining("metric"), "recipients"]);
  });
});
