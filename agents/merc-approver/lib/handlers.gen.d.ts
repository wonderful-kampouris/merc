// Types for lib/handlers.gen.js (generated bundle of shared/handlers/src). Hand-kept; signatures match the handlers.
import type { Impl, Principal, UserPrincipal } from "../shared_lib/utils/merc_core/index";
export interface ApproverDeps { api?: { post: (path: string, opts?: { body?: unknown }) => Promise<unknown> } | null; now?: () => number; log?: (level: string, msg: string, extra?: unknown) => void }
export declare function makeApproverBrief(deps?: ApproverDeps): Impl<"approver-brief", Principal>;
export declare function makeApprovalDecide(deps?: ApproverDeps): Impl<"approval-decide", UserPrincipal>;
export declare function makeManagerCallOutcome(deps?: ApproverDeps): Impl<"manager-call-outcome", Principal>;
export declare function spokenBrief(lang: string, x: { requester: string; account: string; requested: number; limit: number; lines: Array<{ name: string; quantity: number; unit: string }> }): string;
