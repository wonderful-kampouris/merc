import { describe, expect, it } from "vitest";
import { mockClient, screenOf } from "../settings/testkit";
import { draftOf, emptyForm, formFromCampaign, formFromDraft, parseCampaigns, parseFunnel, pct, toUpsert, validateForm } from "./model";

const TODAY = "2026-11-15";
const P = "b28bc378-ec47-55d6-a414-b09ac0dacc3d";

describe("campaigns model", () => {
  it("REQ-CMP-001: a draft fills the form and keeps resolved names", () => {
    const f = formFromDraft(
      { title: "Espresso Nuovo to cafés", message: "Push the new blend", starts_on: "2026-11-16", ends_on: "2026-11-22", product_ids: [P], product_names: ["Espresso Nuovo Blend 1kg"], territory_names: ["North", "Center"], category_names: ["Café"] },
      "Push Espresso Nuovo to cafés in North and Center this week",
      TODAY,
    );
    expect(f).toMatchObject({ title: "Espresso Nuovo to cafés", starts_on: "2026-11-16", ends_on: "2026-11-22", product_ids: [P], status: "draft" });
    expect(f.names.territories).toEqual(["North", "Center"]);
    expect(validateForm(f)).toEqual([]);
  });
  it("an empty draft falls back to the manager's words and this week", () => {
    const f = formFromDraft({}, "  Push Freddo to bakeries  ", TODAY);
    expect(f.title).toBe("Push Freddo to bakeries");
    expect(f.message).toBe("Push Freddo to bakeries");
    expect([f.starts_on, f.ends_on]).toEqual([TODAY, "2026-11-21"]);
  });
  it("validates", () => {
    expect(validateForm(emptyForm(TODAY))).toEqual(["title", "message"]);
    expect(validateForm({ ...emptyForm(TODAY), title: "a", message: "b", ends_on: "2026-11-01" })).toEqual(["order"]);
    expect(validateForm({ ...emptyForm(TODAY), title: "a", message: "b", starts_on: "" })).toEqual(["dates"]);
  });
  it("edits only campaigns whose links came back", () => {
    const [noLinks, withLinks] = parseCampaigns([
      { id: "c1", title: "A", status: "active" },
      { id: "c2", title: "B", status: "weird", product_ids: [P], territory_ids: [], category_ids: [], rep_ids: [] },
      { title: "no id" },
    ]);
    expect(formFromCampaign(noLinks!)).toBeNull();
    expect(withLinks!.status).toBe("draft");
    expect(toUpsert(formFromCampaign(withLinks!)!)).toMatchObject({ campaign_id: "c2", product_ids: [P] });
  });
  it("funnel percentages and rep rows", () => {
    const f = parseFunnel({ shown: 40, pitched: 10, ordered: 4, by_rep: [{ full_name: "Nikos", shown: 20, pitched: 5, ordered: 2 }, {}] });
    expect(f.byRep).toEqual([{ name: "Nikos", shown: 20, pitched: 5, ordered: 2 }]);
    expect(pct(f.ordered, f.shown)).toBe(10);
    expect(pct(1, 0)).toBe(0);
  });
  it("full flow against the contract mocks with only the screen's functions", async () => {
    const { client, calls } = mockClient(screenOf("/mgmt/campaigns"));
    expect(parseCampaigns((await client.call("campaigns-list", {})).items as never).length).toBeGreaterThan(0);
    const r = await client.call("campaign-draft-from-text", { text: "Push Espresso Nuovo to cafés in North and Center this week" });
    const form = formFromDraft(draftOf(r), "Push Espresso Nuovo to cafés in North and Center this week", TODAY);
    expect(r.unresolved.length).toBeGreaterThan(0);
    const saved = await client.call("campaign-upsert", toUpsert(form));
    expect(saved.campaign_id).toMatch(/-/);
    await client.call("campaign-funnel", { campaign_id: saved.campaign_id });
    expect(calls).toEqual(["campaigns-list", "campaign-draft-from-text", "campaign-upsert", "campaign-funnel"]);
  });
});
