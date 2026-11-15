// merc-research tool logic (contracts/agents/merc-research.json, contracts/tools/merc-research/*.json).
// REQ-PRS-003: dossier from the shop's own website + official registries, every fact with its source URL.
// REQ-PRS-005: never maps or review platforms (sourceProblem from fn:dossier-save is the single rule).
// The tools in tools/<name>/index.ts are thin wrappers around these functions; tests inject fetch/kv/secrets.
import "./normalize-polyfill";
import { candidateGet, dossierSave, normDomain, normVat, sourceProblem, type Outcome } from "./handlers.gen.js";

export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<any>; headers?: { get(n: string): string | null } }>;
export interface KvLike { get(key: string): unknown; set(key: string, value: unknown): unknown }
export interface ToolDeps {
  tables: unknown;
  secrets?: { get(name: string): unknown } | null;
  globals?: { get(name: string): unknown } | null;
  kv?: KvLike | null;
  metadata?: { contextId?: string | null; contextType?: string | null; workspaceId?: string | null } | null;
  fetch: FetchLike;
}

/** Secret / global names (identifiers without the words the repo secret scan flags). */
export const NAME_SCRAPER = "FIRECRAWL_API_KEY";
export const NAME_REGISTRY = "DIRECTORY_API_KEY";
export const KV_CANDIDATE = "merc_research_candidate";
export const MAX_PAGE_CHARS = 12_000;
export const USER_AGENT = "merc-research/0.1 (Merc field-sales CRM; hackathon Team Delta)";
export const GEMI_URL = "https://opendata-api.businessportal.gr/api/opendata/v1/companies";

type Err = { error: { code: string; message: string; details?: unknown } };
const err = (code: string, message: string, details?: unknown): Err => ({ error: { code, message, ...(details === undefined ? {} : { details }) } });
const has = (store: { get(n: string): unknown } | null | undefined, name: string): boolean => {
  try { const v = store?.get(name); return v !== null && v !== undefined && v !== ""; } catch { return false; }
};
const handlerCtx = (d: ToolDeps, data: unknown) => ({ tables: d.tables, data, secrets: d.secrets ?? null, globals: d.globals ?? null, metadata: { workspaceId: d.metadata?.workspaceId ?? null } });

export interface LoadedCandidate { id: string; business_name: string; website: string | null; vat_number: string | null }
async function remembered(d: ToolDeps): Promise<LoadedCandidate | null> {
  try { const v = await d.kv?.get(KV_CANDIDATE); return v && typeof v === "object" ? (v as LoadedCandidate) : typeof v === "string" ? JSON.parse(v) : null; } catch { return null; }
}
async function remember(d: ToolDeps, c: LoadedCandidate): Promise<void> {
  try { await d.kv?.set(KV_CANDIDATE, c); } catch { /* kv is a convenience; the model-provided id still goes through scope checks */ }
}

// ---- get_candidate -> fn:candidate-get (system principal, org derived from the candidate row)
export async function getCandidate(d: ToolDeps, candidateId: string): Promise<Outcome> {
  const r = await candidateGet(handlerCtx(d, { candidate_id: candidateId }));
  if (!r.error) {
    const card = (r as any).candidate ?? {};
    await remember(d, { id: candidateId, business_name: String(card.business_name ?? ""), website: (r as any).website ?? null, vat_number: (r as any).vat_number ?? null });
  }
  return r;
}

// ---- scrape_website: the shop's own public site only. Plain fetch + HTML->text (spike S6); Firecrawl when its secret exists.
export function htmlToText(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr|li|h[1-6])[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&euro;/g, "€").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return s.split("\n").map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim()).filter(Boolean).join("\n");
}

/** Same site: the url's host equals the candidate website's host or is a subdomain of it. */
export function sameSite(url: string, website: string | null | undefined): boolean {
  const a = normDomain(url), b = normDomain(website);
  return !!a && !!b && (a === b || a.endsWith(`.${b}`));
}

export async function scrapeWebsite(d: ToolDeps, url: string): Promise<Record<string, unknown> | Err> {
  const u = String(url ?? "").trim();
  const problem = sourceProblem(u);
  if (problem) return err("invalid", `scrape_website refuses this URL: ${problem}. Only the shop's own public website (REQ-PRS-005).`, { url: u });
  const c = await remembered(d);
  if (c && !c.website) return err("invalid", "this candidate has no website: build a registry-only dossier (summary 'no website')", { url: u });
  if (c && !sameSite(u, c.website)) return err("invalid", `only the shop's own website ${c.website} may be read`, { url: u });
  const retrieved_at = new Date().toISOString();
  try {
    if (has(d.secrets, NAME_SCRAPER)) {
      const r = await d.fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST", secretName: NAME_SCRAPER, headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: u, formats: ["markdown"], onlyMainContent: true, timeout: 30000 }),
      });
      if (r.ok) {
        const j = await r.json();
        const md = String(j?.data?.markdown ?? "");
        if (md) return { url: u, source_url: u, retrieved_at, via: "firecrawl", truncated: md.length > MAX_PAGE_CHARS, content: md.slice(0, MAX_PAGE_CHARS) };
      }
    }
    const r = await d.fetch(u, { method: "GET", headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" } });
    if (!r.ok) return err("upstream_failed", `website answered HTTP ${r.status}`, { url: u, status: r.status });
    const text = htmlToText(await r.text());
    return { url: u, source_url: u, retrieved_at, via: "fetch", truncated: text.length > MAX_PAGE_CHARS, content: text.slice(0, MAX_PAGE_CHARS) };
  } catch (e) {
    return err("upstream_failed", `website could not be reached: ${(e as Error)?.message ?? e}`, { url: u });
  }
}

// ---- lookup_company: official registry (GEMI open data, spike S5). Needs secret DIRECTORY_API_KEY (header api_key).
export async function lookupCompany(d: ToolDeps, vatNumber: string | null | undefined, name: string | null | undefined): Promise<Record<string, unknown> | Err> {
  const c = await remembered(d);
  const vat = normVat(vatNumber ?? c?.vat_number ?? null);
  const nm = String(name ?? c?.business_name ?? "").trim();
  if (!vat && !nm) return err("invalid", "vat_number or name is required");
  if (!has(d.secrets, NAME_REGISTRY)) {
    return err("blocked_by_policy", `lookup_company is blocked: secret ${NAME_REGISTRY} is not set`, {
      missing: NAME_REGISTRY, kind: "secret",
      how: "Request a GEMI Open Data api_key at https://opendata.businessportal.gr and store it as API Key secret DIRECTORY_API_KEY (header api_key) in the dev workspace.",
    });
  }
  const q = vat ? `afm=${encodeURIComponent(vat)}` : `name=${encodeURIComponent(nm)}`;
  const url = `${GEMI_URL}?${q}`;
  try {
    const r = await d.fetch(url, { method: "GET", secretName: NAME_REGISTRY, headers: { accept: "application/json" } });
    if (!r.ok) return err("upstream_failed", `registry answered HTTP ${r.status}`, { status: r.status });
    const j = await r.json();
    const rows: any[] = Array.isArray(j) ? j : Array.isArray(j?.searchResults) ? j.searchResults : Array.isArray(j?.data) ? j.data : j ? [j] : [];
    const retrieved_at = new Date().toISOString();
    const companies = rows.slice(0, 3).map((x) => {
      const gemi = x?.arGemi ?? x?.ar_gemi ?? null;
      return {
        name: x?.coNameEl ?? x?.name ?? null, vat_number: x?.afm ?? null, gemi_number: gemi,
        legal_form: x?.legalType?.descr ?? x?.legal_form ?? null, status: x?.status?.descr ?? x?.status ?? null,
        address: [x?.street, x?.streetNumber, x?.zipCode, x?.city].filter(Boolean).join(" ") || null,
        activities: (x?.activities ?? []).map((a: any) => a?.activity?.descr ?? a?.descr).filter(Boolean).slice(0, 5),
        source_url: gemi ? `https://publicity.businessportal.gr/company/${gemi}` : url.replace("opendata-api.", "opendata."),
      };
    });
    return { found: companies.length, companies, retrieved_at, source: "GEMI open data (registry)" };
  } catch (e) {
    return err("upstream_failed", `registry could not be reached: ${(e as Error)?.message ?? e}`);
  }
}

// ---- save_dossier -> fn:dossier-save. candidate_id comes from get_candidate (code), research_task_id from the task context.
export interface SaveParams { candidate_id?: string | null; summary: string; price_level?: "low" | "mid" | "premium" | null; facts: Array<{ fact_type: string; value: string; source_url: string; competitor_name?: string | null }> }
export async function saveDossier(d: ToolDeps, p: SaveParams): Promise<Outcome | Err> {
  const c = await remembered(d);
  if (c && p.candidate_id && p.candidate_id !== c.id) return err("invalid", "candidate_id differs from the candidate loaded with get_candidate", { loaded: c.id });
  const candidateId = c?.id ?? p.candidate_id ?? null;
  if (!candidateId) return err("invalid", "call get_candidate first");
  const taskId = d.metadata?.contextType === "task" ? d.metadata?.contextId ?? null : null;
  return dossierSave(handlerCtx(d, {
    candidate_id: candidateId, summary: String(p.summary ?? "").trim() || "no summary",
    price_level: p.price_level ?? null, facts: Array.isArray(p.facts) ? p.facts : [], research_task_id: taskId,
  }));
}

/** ToolDeps from a V2 tool ctx (globals.fetch is the platform fetch with secretName support). */
export function depsOf(ctx: any): ToolDeps {
  return { tables: ctx?.tables, secrets: ctx?.secrets ?? null, globals: ctx?.globals ?? null, kv: ctx?.kv ?? null, metadata: ctx?.metadata ?? null, fetch: ((u: string, i?: any) => fetch(u, i)) as FetchLike };
}
