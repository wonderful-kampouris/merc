import { describe, expect, it } from "vitest";
import { miltosCard } from "../today/testing/fixtures";
import { accountsRequest, contactRequest, problemActions, reorderLines, riskLevel, sourceLabel, splitReasons, spokenSeconds, usualOrder, validateContact } from "./customersModel";

describe("customers model", () => {
  it("builds accounts-list params from search and filter", () => {
    expect(accountsRequest("", "all")).toEqual({ limit: 50 });
    expect(accountsRequest("  miltos ", "customer")).toEqual({ limit: 50, q: "miltos", account_type: "customer" });
    expect(accountsRequest("", "at_risk")).toEqual({ limit: 50, at_risk: true });
  });

  it("derives Café Miltos's usual order: 12 kg Espresso Classico (REQ-CRD-001)", () => {
    const u = usualOrder(miltosCard().recent_orders);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ name: "Espresso Classico 1kg", quantity: 12, unit: "kg", orders: 3 });
    expect(usualOrder([])).toEqual([]);
  });

  it("bands the 0-100 risk score and splits pipe-separated reason codes", () => {
    expect(riskLevel(null)).toBe("none");
    expect(riskLevel(10)).toBe("low");
    expect(riskLevel(30)).toBe("medium");
    expect(riskLevel(60)).toBe("high");
    expect(splitReasons(["order_gap|competitor", " no_visit "])).toEqual(["order_gap", "competitor", "no_visit"]);
  });

  it("estimates the spoken summary length (max 30 s)", () => {
    expect(spokenSeconds(miltosCard().spoken_summary)).toBeLessThanOrEqual(30);
    expect(spokenSeconds(Array(100).fill("λέξη").join(" "))).toBe(40);
    expect(spokenSeconds("")).toBe(0);
  });

  it("repeats an order as list-price lines and offers problem transitions", () => {
    expect(reorderLines(miltosCard().recent_orders[0]!)).toEqual([{ product_id: "00000000-0000-4000-8000-000000000200", quantity: 12 }]);
    expect(problemActions("open")).toEqual(["in_progress", "resolved"]);
    expect(problemActions("in_progress")).toEqual(["resolved"]);
    expect(problemActions("resolved")).toEqual([]);
  });

  it("validates and builds a new contact", () => {
    expect(validateContact({ full_name: " ", role_title: "", phone: "" })).toEqual({ full_name: "nameRequired" });
    expect(validateContact({ full_name: "Eleni", role_title: "", phone: "12" })).toEqual({ phone: "phoneInvalid" });
    expect(validateContact({ full_name: "Eleni", role_title: "", phone: "+30 690 100 0000" })).toEqual({});
    expect(contactRequest("a", { full_name: " Eleni ", role_title: "", phone: "+30 690 100 0000" })).toEqual({ contact_id: null, account_id: "a", fields: { full_name: "Eleni", phone: "+306901000000" } });
  });

  it("labels sources by host", () => {
    expect(sourceLabel("https://www.instagram.com/cafe.avra/")).toBe("instagram.com");
    expect(sourceLabel("not a url")).toBe("not a url");
  });
});
