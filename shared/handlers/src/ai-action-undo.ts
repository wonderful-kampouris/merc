// fn:ai-action-undo (contracts/functions/ai-action-undo.json, REQ-CORE-006): undo one applied AI action.
// The engine (shared/autonomy undo) restores the before snapshot exactly and deletes rows the action created.
// Scope owner: only the user the AI acted for (or an admin) can undo it.
import { defineFunction, type Impl } from "../../core/src/index";
import { undo } from "../../autonomy/src/index";

export function makeImpl(deps: { now?: () => number } = {}): Impl<"ai-action-undo"> {
  return async ({ req, db, me }) => undo(db, me, req.ai_action_id, { now: deps.now?.() });
}
export const impl = makeImpl();

/** Wonderful Function entry (functions/ai-action-undo/index.ts calls this). */
export const handle = defineFunction("ai-action-undo", impl);
