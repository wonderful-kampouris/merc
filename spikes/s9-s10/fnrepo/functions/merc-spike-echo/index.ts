import { callerFrom, sumLines } from "../_merc_spike_lib/core";

// WP-SPK-05 spike: echo nested JSON body and the platform-provided caller identity.
async function userFunction(context: FunctionContext): Promise<Result> {
  const data: any = (context as any).data ?? {};
  const meta: any = (context as any).metadata ?? {};
  const lines = Array.isArray(data.lines) ? data.lines : [];
  return {
    data_keys: Object.keys(data),
    data_types: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? "array" : typeof v])),
    lines_echo: lines,
    nested_obj_echo: data.meta ?? null,
    total_minor: sumLines(lines),
    spoofed_caller_in_body: data.caller ?? null,
    caller: callerFrom(meta),
    metadata_keys: Object.keys(meta),
    has_app_authorization: meta.appAuthorization != null,
    app_authorization_keys: meta.appAuthorization ? Object.keys(meta.appAuthorization) : [],
    raw_body_len: typeof meta.rawBody === "string" ? meta.rawBody.length : null,
    tenant_id: meta.tenantId ?? null,
    workspace_id: meta.workspaceId ?? null,
  };
}
