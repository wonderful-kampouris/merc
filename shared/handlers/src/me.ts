// fn:me (contracts/functions/me.json, REQ-CORE-002): the caller's Merc identity, resolved only from the platform.
import { defineFunction, meResponse, type Impl } from "../../core/src/index";

export const impl: Impl<"me"> = async ({ me }) => meResponse(me);

/** Wonderful Function entry (functions/me/index.ts calls this). */
export const handle = defineFunction("me", impl);
