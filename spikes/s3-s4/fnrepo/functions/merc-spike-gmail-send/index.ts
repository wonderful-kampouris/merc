// Spike S3 (WP-SPK-02): can a standalone Function send Gmail as the rep through a
// per-user Integration Hub connection? Never sends to a real address: the
// recipient is forced to the reserved, undeliverable TLD ".invalid".
// Fixed set of spike connections; the caller picks one by index, never by free text.
const CONNECTIONS = ["merc-spike-gmail-peruser-send", "merc-spike-gmail-service"];

async function userFunction(context: FunctionContext): Promise<Result> {
  const mode = String(context.data.mode ?? "profile"); // "profile" | "send"
  const caller = context.metadata.user
    ? { id: context.metadata.user.id, email: context.metadata.user.email }
    : null;
  const CONNECTION = CONNECTIONS[Number(context.data.conn ?? 0)] ?? CONNECTIONS[0];
  const out: Record<string, any> = { caller, mode, connection: CONNECTION };

  try {
    if (mode === "send") {
      const res = await context.integrations.call(CONNECTION, "google_workspace_gmail_message_send", {
        to: ["merc-spike-noreply@example.invalid"],
        subject: "merc spike S3 test (undeliverable)",
        body: "Spike S3 test. Recipient is on the reserved .invalid TLD and cannot be delivered.",
      });
      out.ok = true;
      out.result = res;
    } else {
      const res = await context.integrations.call(CONNECTION, "google_workspace_profile_get", {});
      out.ok = true;
      out.result = res;
    }
  } catch (err) {
    out.ok = false;
    out.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
  console.log(JSON.stringify(out));
  return out;
}
