// Text-channel layout for tool scripts (WhatsApp / typed chat). Voice keeps the spoken script_text.
// Rule A: every name and number is copied from the tool's display_text; nothing is computed or rounded here.
type Ctx = any;
type Lang = "el" | "en";

/** True when the rep types (WhatsApp or chat), false on voice. */
export function isTextChannel(ctx: Ctx): boolean {
  const c = ctx?.metadata?.communication ?? {};
  const type = String(c.type ?? "").toLowerCase();
  const adapter = String(c.metadata?.chat_adapter ?? ctx?.metadata?.chat_adapter ?? "").toLowerCase();
  return type === "chat" || type.includes("whatsapp") || adapter === "whatsapp";
}

interface Item { item_type?: string; position?: number; display_text?: string }

const L = {
  en: { day: "Your day", stops: "Stops", promises: "Promises due", campaign: "Campaign", targets: "Targets", alerts: "Alerts", other: "Also", next: (s: string) => `Reply *1* to start with ${s}, or *call me* for a voice brief.`, nextNone: "Reply *call me* for a voice brief." },
  el: { day: "Η μέρα σου", stops: "Στάσεις", promises: "Υποσχέσεις", campaign: "Καμπάνια", targets: "Στόχοι", alerts: "Ειδοποιήσεις", other: "Επίσης", next: (s: string) => `Γράψε *1* για να ξεκινήσουμε με ${s}, ή *πάρε με* για φωνητικό brief.`, nextNone: "Γράψε *πάρε με* για φωνητικό brief." },
};

const DOW = { en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], el: ["Κυρ", "Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ"] };
const MON = { en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], el: ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"] };
function dayLabel(date: unknown, lang: Lang): string | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T12:00:00Z`);
  return `${DOW[lang][d.getUTCDay()]} ${d.getUTCDate()} ${MON[lang][d.getUTCMonth()]}`;
}

/** "Stop 1: Café Miltos (Open issue: grinder noise)" -> { name, why }. */
function stopParts(t: string): { name: string; why: string | null } {
  const m = t.match(/^[^:]*?\d+\s*:\s*(.+?)\s*\((.+)\)\s*$/) ?? t.match(/^[^:]*?\d+\s*:\s*(.+)$/);
  if (!m) return { name: t, why: null };
  return { name: m[1].trim(), why: m[2] ? m[2].trim() : null };
}
const afterColon = (t: string) => { const i = t.indexOf(":"); return i >= 0 && i < 40 ? t.slice(i + 1).trim() : t; };
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "Target revenue: 1633 of 18000 EUR (9%), 15 days left" -> "Revenue: 1633 of 18000 EUR (9%)" + "15 days left". */
function targetParts(t: string): { line: string; left: string | null } {
  const m = t.match(/^\s*\S+\s+(.+?):\s*(.+?)(?:,\s*([^,]*\d[^,]*))?\s*$/);
  if (!m) return { line: t, left: null };
  return { line: `${cap(m[1])}: ${m[2]}`, left: m[3]?.trim() ?? null };
}

/** WhatsApp-friendly briefing built from briefing items. Returns null when there is nothing to lay out. */
export function briefingChatText(result: any, lang: Lang): string | null {
  const items: Item[] = Array.isArray(result?.items) ? [...result.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : [];
  if (!items.length) return null;
  const t = L[lang];
  const by = (k: string) => items.filter((i) => i.item_type === k && i.display_text);
  const known = new Set(["stop", "promise_due", "campaign", "target_progress", "alert"]);
  const greet = String(result?.script_text ?? "").match(/^(?:Hi|Hey|Hello|Γεια σου|Καλημέρα)\s+([^!,.\s]+)/i)?.[1];
  const day = dayLabel(result?.date, lang);
  const out: string[] = [`*${t.day}${day ? ` · ${day}` : ""}*${greet ? ` — ${greet}` : ""}`];

  const stops = by("stop");
  if (stops.length) {
    out.push("", `*${t.stops} (${stops.length})*`);
    stops.forEach((s, i) => { const p = stopParts(s.display_text!); out.push(`${i + 1}. *${p.name}*${p.why ? ` — ${p.why}` : ""}`); });
  }
  const section = (title: string, rows: string[]) => { if (rows.length) out.push("", `*${title}*`, ...rows.map((r) => `• ${r}`)); };
  section(t.promises, by("promise_due").map((i) => afterColon(i.display_text!)));
  section(t.alerts, by("alert").map((i) => i.display_text!));
  section(t.campaign, by("campaign").map((i) => afterColon(i.display_text!)));
  const targets = by("target_progress").map((i) => targetParts(i.display_text!));
  if (targets.length) {
    const lefts = [...new Set(targets.map((x) => x.left).filter(Boolean))];
    const shared = lefts.length === 1 && targets.every((x) => x.left) ? lefts[0] : null;
    section(`${t.targets}${shared ? ` (${shared})` : ""}`, targets.map((x) => (shared || !x.left ? x.line : `${x.line}, ${x.left}`)));
  }
  section(t.other, items.filter((i) => !known.has(String(i.item_type)) && i.display_text).map((i) => i.display_text!));
  out.push("", stops.length ? t.next(stopParts(stops[0].display_text!).name) : t.nextNone);
  return out.join("\n");
}

/** Tool-result rewrite for text channels: the model sends script_text as is, so give it the text layout. */
export function forTextChannel(tool: string, res: any, lang: Lang): any {
  if (!res || typeof res !== "object" || "error" in res) return res;
  if (tool === "get_briefing") {
    // Handlers answer { result: {...} }; accept the bare shape too.
    const inner = res.result && typeof res.result === "object" ? res.result : res;
    const text = briefingChatText(inner, lang);
    if (!text) return res;
    // Only one script in the result: the model must send this layout, not a spoken paragraph.
    const out = { ...inner, script_text: text, format: "whatsapp_message: send script_text exactly as written, with its line breaks, *bold* and numbering. Do not rephrase it into sentences." };
    return inner === res ? out : { ...res, result: out };
  }
  return res;
}
