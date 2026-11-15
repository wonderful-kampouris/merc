// Evidence checks for REQ-DEB-004 and REQ-CORE-003 (Rule A): every extracted
// item quotes the utterance, and every number it carries appears in its quote.
// Pure functions, no regex unicode property escapes (runner-safe).

const isLetter = (c: string) => c.toLowerCase() !== c.toUpperCase();
const isDigit = (c: string) => c >= "0" && c <= "9";

// Explicit accent map: the Functions runtime has no String.prototype.normalize,
// so Node and the runner must take the same path.
const ACCENTS: Record<string, string> = {};
const addMap = (from: string, to: string) => { for (let i = 0; i < from.length; i++) ACCENTS[from[i]] = to[i]; };
addMap("άέήίόύώϊΐϋΰς", "αεηιουωιιυυσ");
addMap("àáâãäåèéêëìíîïòóôõöùúûüñçýÿ", "aaaaaaeeeeiiiiooooouuuuncyy");

/** Lowercase, strip accents/diacritics, final sigma -> sigma, punctuation -> space, collapse spaces. */
export function normalizeText(s: string): string {
  const lower = s.toLowerCase();
  let out = "";
  for (const ch of lower) {
    const c = ACCENTS[ch] ?? ch;
    if (c >= "\u0300" && c <= "\u036f") continue; // stray combining marks
    out += isLetter(c) || isDigit(c) ? c : " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

/** True when the evidence is a whole-word substring of the utterance after normalization. */
export function evidenceInUtterance(evidence: string | null | undefined, utterance: string): boolean {
  const e = normalizeText(evidence ?? "");
  if (!e) return false;
  return ` ${normalizeText(utterance)} `.includes(` ${e} `);
}

const UNITS: Record<string, number> = {
  // English
  zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, dozen: 12, half: 0.5,
  // Greek (normalized: no accents, final sigma as σ)
  μηδεν: 0, ενα: 1, ενασ: 1, μια: 1, μιασ: 1, ενοσ: 1, δυο: 2, τρια: 3, τρεισ: 3, τεσσερα: 4, τεσσερισ: 4, πεντε: 5, εξι: 6,
  επτα: 7, εφτα: 7, οκτω: 8, οχτω: 8, εννια: 9, εννεα: 9, δεκα: 10, εντεκα: 11, δωδεκα: 12, δεκατρια: 13, δεκατρεισ: 13,
  δεκατεσσερα: 14, δεκατεσσερισ: 14, δεκαπεντε: 15, δεκαεξι: 16, δεκαεπτα: 17, δεκαεφτα: 17, δεκαοκτω: 18, δεκαοχτω: 18,
  δεκαεννια: 19, δεκαεννεα: 19, εικοσι: 20, τριαντα: 30, σαραντα: 40, πενηντα: 50, εξηντα: 60, εβδομηντα: 70, ογδοντα: 80,
  ενενηντα: 90, εκατο: 100, εκατον: 100, διακοσια: 200, διακοσιεσ: 200, τριακοσια: 300, τετρακοσια: 400, πεντακοσια: 500,
  εξακοσια: 600, επτακοσια: 700, οκτακοσια: 800, εννιακοσια: 900, χιλια: 1000, χιλιεσ: 1000, ντουζινα: 12, μισο: 0.5, μιση: 0.5, μισοσ: 0.5,
};
const MULT: Record<string, number> = { hundred: 100, thousand: 1000, χιλιαδεσ: 1000, million: 1e6, εκατομμυριο: 1e6, εκατομμυρια: 1e6 };
const JOIN = new Set(["and", "και"]);

/**
 * Every number a text mentions: digits ("12", "1,5", "1.500"), percents, and
 * English/Greek number words including simple compounds ("είκοσι πέντε" = 25).
 * Each run yields its combined value and each word's own value.
 */
export function extractNumbers(text: string): number[] {
  const out = new Set<number>();
  const re = /\d+(?:[.,]\d+)*/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const raw = m[0];
    const groups = raw.split(/[.,]/);
    out.add(Number(groups[0]));
    if (groups.length === 2) out.add(Number(`${groups[0]}.${groups[1]}`));
    if (groups.length >= 2 && groups.slice(1).every((g) => g.length === 3)) out.add(Number(groups.join("")));
    if (groups.length > 2 && !groups.slice(1).every((g) => g.length === 3)) out.add(Number(groups.join("")));
  }
  const words = normalizeText(text).split(" ");
  let total = 0, cur = 0, inRun = false;
  const flush = () => { if (inRun) out.add(total + cur); total = 0; cur = 0; inRun = false; };
  for (const w of words) {
    if (w in UNITS && !(w === "a" || w === "an")) { cur += UNITS[w]; out.add(UNITS[w]); inRun = true; }
    else if (w in MULT) { cur = (cur || 1) * MULT[w]; if (MULT[w] >= 1000) { total += cur; cur = 0; } out.add(MULT[w]); inRun = true; }
    else if (inRun && JOIN.has(w)) continue;
    else flush();
  }
  flush();
  return [...out].filter((n) => Number.isFinite(n));
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * Does `value` appear in `text`? Sign is ignored ("15% less" backs -15) and
 * `*_minor` money is also accepted in major units (150000 minor = "1500").
 */
export function numberInText(value: number, text: string, opts: { minor?: boolean } = {}): boolean {
  const found = extractNumbers(text);
  const want = [Math.abs(value)];
  if (opts.minor) want.push(Math.abs(value) / 100);
  return want.some((w) => found.some((f) => close(f, w)));
}

/** Paths (relative to `item`) of numeric fields whose value is not in the evidence quote. */
export function numbersNotInEvidence(item: unknown, evidence: string, path = ""): string[] {
  const bad: string[] = [];
  const walk = (v: unknown, p: string, key: string) => {
    if (typeof v === "number") { if (!numberInText(v, evidence, { minor: key.endsWith("_minor") })) bad.push(p); }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}/${i}`, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "evidence") walk(x, `${p}/${k}`, k);
  };
  walk(item, path, "");
  return bad;
}

/** Numbers mentioned in `text` that none of `sources` mentions (for "numbers only from facts" rules). */
export function unknownNumbers(text: string, sources: string[]): number[] {
  const allowed = sources.reduce<number[]>((acc, src) => acc.concat(extractNumbers(src)), []);
  return extractNumbers(text).filter((n) => !allowed.some((a) => close(a, n)));
}
