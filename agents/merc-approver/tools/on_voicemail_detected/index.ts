// Trigger tool for the merc-approver contract trigger "OnVoicemailDetected -> report_call_outcome(voicemail)".
// Leaves ONLY the safe line (REQ-DSC-008: no %, no customer), reports voicemail (-> async), then ends the call.
import { s, w } from "@wonderful/types/schema";
import { onVoicemail } from "../../lib/approver";

export default w.tool({
  name: "on_voicemail_detected",
  description: "Runs automatically when the outbound call reaches voicemail. Not for the model.",
  trigger: "OnVoicemailDetected",
  params: s.object({ source: s.string().optional().describe("Detector that fired: transcript or audio") }),
  handler: async (ctx) => onVoicemail(ctx as any),
});
