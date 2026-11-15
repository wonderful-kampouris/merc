import { describe, expect, it } from "vitest";
import { MercApiError } from "../../../lib/client";
import { createFakeClient } from "../today/testing/fakeClient";
import { MILTOS, miltosCard } from "../today/testing/fixtures";
import { addContact, repeatOrderAsDraft, updateProblem, withProblemStatus } from "./customersActions";

describe("customers actions", () => {
  it("updates a problem through problem-update", async () => {
    const { client, calls } = createFakeClient("customers", { "problem-update": (p) => ({ problem_id: p.problem_id }) });
    const id = miltosCard().open_problems[0]!.problem_id;
    expect(await updateProblem(client, id, "resolved")).toBe(id);
    expect(calls).toEqual([{ slug: "problem-update", params: { problem_id: id, status: "resolved" } }]);
  });

  it("repeats an order only as a draft (confirmation stays with the rep)", async () => {
    const card = miltosCard();
    const { client, calls } = createFakeClient("customers", {
      "order-upsert": (p) => ({ order: { ...card.recent_orders[0]!, order_id: "00000000-0000-4000-8000-000000000999", status: p.status } }),
    });
    const o = await repeatOrderAsDraft(client, MILTOS, card.recent_orders[0]!);
    expect(o.status).toBe("draft");
    expect(calls[0]?.params).toMatchObject({ account_id: MILTOS, status: "draft", order_id: null });
  });

  it("adds a contact through contact-upsert", async () => {
    const { client, calls } = createFakeClient("customers", { "contact-upsert": () => ({ contact_id: "00000000-0000-4000-8000-000000000301" }) });
    await addContact(client, MILTOS, { full_name: "Eleni", role_title: "Barista", phone: "" });
    expect(calls[0]?.params).toEqual({ contact_id: null, account_id: MILTOS, fields: { full_name: "Eleni", role_title: "Barista" } });
  });

  it("cannot call functions outside the Customers screen list (REQ-APP-001)", async () => {
    const { client } = createFakeClient("customers", {});
    await expect(client.call("today-get", {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.call("today-get", {})).rejects.toBeInstanceOf(MercApiError);
  });

  it("removes resolved problems from the card and updates others", () => {
    const card = miltosCard();
    const id = card.open_problems[0]!.problem_id;
    expect(withProblemStatus(card, id, "resolved").open_problems).toHaveLength(0);
    expect(withProblemStatus(card, id, "in_progress").open_problems[0]?.status).toBe("in_progress");
  });
});
