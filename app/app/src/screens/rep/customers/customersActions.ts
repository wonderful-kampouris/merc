import type { FunctionResponseMap, OrderSummary } from "../../../contracts";
import type { MercClient } from "../../../lib/client";
import { contactRequest, reorderLines, type ContactDraft } from "./customersModel";

type Call = Pick<MercClient, "call">;

/** Set a problem's status (problem-update); returns the problem id. */
export async function updateProblem(client: Call, problemId: string, status: "in_progress" | "resolved"): Promise<string> {
  const r = await client.call("problem-update", { problem_id: problemId, status });
  return r.problem_id;
}

/** Create a contact on the account (contact-upsert). */
export async function addContact(client: Call, accountId: string, draft: ContactDraft): Promise<string> {
  const r = await client.call("contact-upsert", contactRequest(accountId, draft));
  return r.contact_id;
}

/**
 * Repeat a previous order as a DRAFT (order-upsert). Confirming stays an explicit rep step with the customer
 * (fn:order-upsert notes), so this screen never sends status "confirmed".
 */
export async function repeatOrderAsDraft(client: Call, accountId: string, order: OrderSummary): Promise<FunctionResponseMap["order-upsert"]["order"]> {
  const r = await client.call("order-upsert", { order_id: null, account_id: accountId, status: "draft", lines: reorderLines(order) });
  return r.order;
}

/** Apply a problem status change to the card locally (resolved problems leave the open list). */
export function withProblemStatus<C extends { open_problems: FunctionResponseMap["visit-card-get"]["open_problems"] }>(card: C, problemId: string, status: string): C {
  return {
    ...card,
    open_problems: card.open_problems.flatMap((p) => (p.problem_id !== problemId ? [p] : status === "resolved" ? [] : [{ ...p, status }])),
  };
}
