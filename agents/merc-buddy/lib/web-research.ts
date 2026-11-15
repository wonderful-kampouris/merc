// research_store: public web facts about one shop, so the buddy can brief the rep before a visit.
// Firecrawl (search + scrape, markdown) when secret FIRECRAWL_API_KEY exists; otherwise a keyless fallback:
// DuckDuckGo HTML search + plain fetch of the best page with HTML->text. Every fact keeps its source URL.
// Never reads maps or review/delivery platforms (same list as fn:dossier-save, REQ-PRS-005, "no map scraping").
// Reads no CRM data, so it needs no Merc identity. Seed websites on *.example.* are placeholders and are skipped.

export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<any> }>;
export interface WebDeps { secrets?: { get(name: string): unknown } | null; fetch: FetchLike; now?: () => Date }

export const NAME_SCRAPER = "FIRECRAWL_API_KEY";
export const FIRECRAWL = "https://api.firecrawl.dev/v1";
export const DDG = "https://html.duckduckgo.com/html/";
export const MAX_PAGE_CHARS = 2500;
export const MAX_SNIPPET_CHARS = 240;
export const MAX_SOURCES = 5;
export const MAX_PAGES = 2;
export const MAX_TRIES = 4;
export const MIN_PAGE_CHARS = 200;
const UA = "Mozilla/5.0 (compatible; merc-buddy/0.1; field-sales visit prep)";

export const BLOCKED_SOURCES = [
  "google.", "goo.gl", "maps.apple.", "bing.com/maps", "waze.com", "here.com", "tripadvisor.", "yelp.", "foursquare.",
  "facebook.com/pages/reviews", "trustpilot.", "efood.gr", "e-food.gr", "food.gr/delivery", "wolt.com", "box.gr", "restaurantguru.", "citymaps.gr", "wanderlog.",
];
/** Pages that need a login or a JS app to read; fine as a link, useless to fetch. */
const UNREADABLE = ["instagram.com", "facebook.com", "tiktok.com", "x.com", "twitter.com", "linkedin.com"];

export interface Source { title: string; url: string; snippet: string }
export interface ResearchOut {
  query: string; via: "firecrawl" | "web"; retrieved_at: string;
  sources: Source[];
  pages: Array<{ url: string; content: string; truncated: boolean }>;
  note: string;
}
type Err = { error: { code: string; message: string; details?: unknown } };
const err = (code: string, message: string, details?: unknown): Err => ({ error: { code, message, ...(details === undefined ? {} : { details }) } });

const hostOf = (url: string): string => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };

/** Reason a URL may not be used, or null. */
export function blockedReason(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return "not a URL"; }
  if (!/^https?:$/.test(u.protocol)) return "not http(s)";
  const host = u.hostname.toLowerCase();
  const full = host.replace(/^www\./, "") + u.pathname.toLowerCase();
  if (host.startsWith("maps.") || /\/maps(\/|$)/.test(u.pathname.toLowerCase())) return "maps service";
  if (/(^|\.)example\.[a-z.]+$/.test(host) || host.endsWith(".example") || host === "localhost") return "placeholder site";
  const hit = BLOCKED_SOURCES.find((b) => full.includes(b) || host.includes(b));
  return hit ? `blocked source ${hit.replace(/\.$/, "")}` : null;
}
const readable = (url: string) => !blockedReason(url) && !/\.(pdf|jpe?g|png|webp|docx?|xlsx?|zip)(\?|$)/i.test(url) && !UNREADABLE.some((d) => hostOf(url) === d || hostOf(url).endsWith(`.${d}`));

export function decodeEntities(s: string): string {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&euro;/g, "€").replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&(rsaquo|raquo);/g, "›").replace(/&(lsaquo|laquo);/g, "‹")
    .replace(/&(ndash|mdash);/g, "-").replace(/&[a-z]{2,8};/gi, " ");
}
export function htmlToText(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|iframe|head)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr|li|h[1-6])[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ");
  return decodeEntities(s).split("\n").map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim()).filter((l) => l.length > 1).join("\n");
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Parse DuckDuckGo's HTML results page. */
export function parseDdg(html: string): Source[] {
  const out: Source[] = [];
  const chunks = html.split(/(?=<a[^>]*class="result__a")/).slice(1);
  for (const c of chunks) {
    const a = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(c);
    if (!a) continue;
    const sn = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/.exec(c);
    let href = decodeEntities(a[1]!);
    const uddg = /[?&]uddg=([^&]+)/.exec(href);
    if (uddg) href = decodeURIComponent(uddg[1]!);
    if (href.startsWith("//")) href = `https:${href}`;
    if (!/^https?:\/\//.test(href) || hostOf(href).endsWith("duckduckgo.com")) continue;
    out.push({ url: href, title: clip(htmlToText(a[2] ?? "").replace(/\n/g, " "), 120), snippet: clip(htmlToText(sn?.[1] ?? "").replace(/\n/g, " "), MAX_SNIPPET_CHARS) });
  }
  return out;
}

const hasSecret = (d: WebDeps) => { try { const v = d.secrets?.get(NAME_SCRAPER); return v !== null && v !== undefined && v !== ""; } catch { return false; } };

async function fcScrape(d: WebDeps, url: string): Promise<string | null> {
  const r = await d.fetch(`${FIRECRAWL}/scrape`, { method: "POST", secretName: NAME_SCRAPER, headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 20000 }) });
  if (!r.ok) return null;
  const j = await r.json();
  return String(j?.data?.markdown ?? "") || null;
}
async function fcSearch(d: WebDeps, query: string): Promise<Array<Source & { markdown?: string }> | null> {
  const r = await d.fetch(`${FIRECRAWL}/search`, { method: "POST", secretName: NAME_SCRAPER, headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, limit: 8, scrapeOptions: { formats: ["markdown"], onlyMainContent: true } }) });
  if (!r.ok) return null;
  const j = await r.json();
  const rows: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j?.data?.web) ? j.data.web : [];
  return rows.filter((x) => typeof x?.url === "string").map((x) => ({
    url: x.url, title: clip(String(x.title ?? x.metadata?.title ?? ""), 120),
    snippet: clip(String(x.description ?? x.metadata?.description ?? "").replace(/\s+/g, " "), MAX_SNIPPET_CHARS), markdown: x.markdown ? String(x.markdown) : undefined,
  }));
}
async function webSearch(d: WebDeps, query: string): Promise<Source[]> {
  const r = await d.fetch(`${DDG}?q=${encodeURIComponent(query)}&kl=gr-el`, { method: "GET", headers: { "user-agent": UA, accept: "text/html" } });
  if (!r.ok) throw new Error(`search answered HTTP ${r.status}`);
  return parseDdg(await r.text());
}
async function webPage(d: WebDeps, url: string): Promise<string | null> {
  const r = await d.fetch(url, { method: "GET", headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
  if (!r.ok) return null;
  const body = await r.text();
  if (body.startsWith("%PDF")) return null;
  return htmlToText(body) || null;
}

/** Research one shop: search the public web, read its best page (own website first). */
export async function researchStore(d: WebDeps, p: { query?: string | null; website?: string | null }): Promise<ResearchOut | Err> {
  const query = String(p.query ?? "").trim();
  let website = String(p.website ?? "").trim() || null;
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (website && blockedReason(website)) website = null; // placeholder seed site, maps or review platform
  if (!query && !website) return err("invalid", "give the shop name and area (query), or its website");
  const retrieved_at = (d.now?.() ?? new Date()).toISOString();
  const useFc = hasSecret(d);
  try {
    let found: Array<Source & { markdown?: string }> = [];
    if (query) found = (useFc ? await fcSearch(d, query) : null) ?? await webSearch(d, query);
    const seen = new Set<string>();
    const sources = found.filter((s) => !blockedReason(s.url) && !seen.has(s.url) && seen.add(s.url)).slice(0, MAX_SOURCES);
    // Pages to read: the given website first, then readable results (the shop's own site usually ranks first).
    // Sites behind a bot wall (HTTP 403) or JS-only shells give no text: move on to the next one.
    const targets = [...new Set([website, ...sources.filter((s) => readable(s.url)).map((s) => s.url)].filter(Boolean) as string[])].slice(0, MAX_TRIES);
    const pages: ResearchOut["pages"] = [];
    for (const url of targets) {
      if (pages.length >= MAX_PAGES) break;
      let content = found.find((s) => s.url === url)?.markdown ?? null;
      if (!content && useFc) content = await fcScrape(d, url).catch(() => null);
      if (!content) content = await webPage(d, url).catch(() => null);
      if (content && content.length >= MIN_PAGE_CHARS) pages.push({ url, content: clip(content, MAX_PAGE_CHARS), truncated: content.length > MAX_PAGE_CHARS });
    }
    if (!sources.length && !pages.length) return err("not_found", `nothing public found for "${query || website}"; ask the rep for the exact name, area or website`);
    return {
      query: query || website!, via: useFc ? "firecrawl" : "web", retrieved_at,
      sources: sources.map(({ title, url, snippet }) => ({ title, url, snippet })),
      pages,
      note: "Public web, not CRM data. Use it only if the results clearly are this shop (name and area match); otherwise say you found nothing reliable. Say where a fact comes from (their website, a news page). Never quote prices or numbers that are not in this text.",
    };
  } catch (e) {
    return err("upstream_failed", `web research failed: ${(e as Error)?.message ?? e}`);
  }
}

export const depsOf = (ctx: any): WebDeps => ({ secrets: ctx?.secrets ?? null, fetch: ((u: string, i?: any) => fetch(u, i)) as FetchLike });
