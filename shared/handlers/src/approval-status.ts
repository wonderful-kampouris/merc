// fn:approval-status (contracts/functions/approval-status.json, REQ-DSC-005 polling, REQ-APR-001):
// one approval as an ApprovalCard for its requester or approver (admin: any in the org). Read-only.
import { defineFunction, type Impl } from "../../core/src/index";
import { approvalCard, requireVisibleApproval } from "./approvals-list";

export const impl: Impl<"approval-status"> = async ({ req, db, me }) => ({ approval: await approvalCard(db, await requireVisibleApproval(db, me, req.approval_id)) });

export const handle = defineFunction("approval-status", impl);
