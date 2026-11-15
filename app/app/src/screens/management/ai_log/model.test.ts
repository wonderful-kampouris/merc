import { describe, expect, it } from "vitest";
import { mockClient, screenOf } from "../settings/testkit";
import { defaultFilters, pageCount, statusCounts, toQuery } from "./model";

describe("mgmt ai log model", () => {
  it("builds the query, leaving empty filters out", () => {
    expect(toQuery(defaultFilters())).toEqual({ page: 1, limit: 20 });
    expect(toQuery({ status: "applied", from: "2026-11-01", to: "2026-11-15", page: 2 })).toEqual({
      page: 2, limit: 20, status: "applied", from: "2026-11-01T00:00:00Z", to: "2026-11-15T23:59:59Z",
    });
  });
  it("pages and counts", () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(41, 20)).toBe(3);
    const line = { ai_action_id: "a", action_type: "create_note", action_class: "internal" as const, summary: "s", undoable: true };
    expect(statusCounts([{ ...line, status: "applied" }, { ...line, status: "applied" }, { ...line, status: "undone" }])).toEqual({ suggested: 0, applied: 2, undone: 1, rejected: 0 });
  });
  it("calls ai-actions-list only (no undo on the management screen)", async () => {
    const { client, calls } = mockClient(screenOf("/mgmt/ai-log"));
    const r = await client.call("ai-actions-list", toQuery({ ...defaultFilters(), status: "applied", from: "2026-11-01" }));
    expect(r.items.length).toBeGreaterThan(0);
    await expect(client.call("ai-action-undo" as never, {} as never)).rejects.toMatchObject({ code: "forbidden" });
    expect(calls).toEqual(["ai-actions-list", "ai-action-undo"]);
  });
});
