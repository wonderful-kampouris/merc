// The V2 tool runtime has no String.prototype.normalize (task 15ae47a2: "String(...).toLowerCase().normalize is not a
// function" from the shared normName in fn:candidate-dedupe/fn:dossier-save). This installs a small NFD/NFC fallback
// ONLY when the runtime lacks it: precomposed Latin-1/Latin-A and Greek tonos/dialytika letters -> base + combining
// mark (NFD), which is all the shared handlers need (they strip U+0300-U+036F right after). NFC/NFKC return the input.
const MARK: Record<string, string> = { "`": "̀", "'": "́", "^": "̂", "~": "̃", ":": "̈", o: "̊", ",": "̧", v: "̌" };
const TABLE: Array<[string, string, string]> = [
  // [precomposed chars, base letter, mark keys (one per char, in order)]
  ["àáâãäå", "a", "`'^~:o"], ["ÀÁÂÃÄÅ", "A", "`'^~:o"], ["èéêë", "e", "`'^:"], ["ÈÉÊË", "E", "`'^:"],
  ["ìíîï", "i", "`'^:"], ["ÌÍÎÏ", "I", "`'^:"], ["òóôõö", "o", "`'^~:"], ["ÒÓÔÕÖ", "O", "`'^~:"],
  ["ùúûü", "u", "`'^:"], ["ÙÚÛÜ", "U", "`'^:"], ["ýÿ", "y", "':"], ["Ý", "Y", "'"], ["ñ", "n", "~"], ["Ñ", "N", "~"],
  ["ç", "c", ","], ["Ç", "C", ","], ["š", "s", "v"], ["Š", "S", "v"], ["č", "c", "v"], ["Č", "C", "v"],
  ["ά", "α", "'"], ["έ", "ε", "'"], ["ή", "η", "'"], ["ί", "ι", "'"], ["ό", "ο", "'"], ["ύ", "υ", "'"], ["ώ", "ω", "'"],
  ["Ά", "Α", "'"], ["Έ", "Ε", "'"], ["Ή", "Η", "'"], ["Ί", "Ι", "'"], ["Ό", "Ο", "'"], ["Ύ", "Υ", "'"], ["Ώ", "Ω", "'"],
  ["ϊ", "ι", ":"], ["ϋ", "υ", ":"], ["Ϊ", "Ι", ":"], ["Ϋ", "Υ", ":"],
];
const NFD: Record<string, string> = { "ΐ": "ΐ", "ΰ": "ΰ" };
for (const [chars, base, marks] of TABLE) {
  const list = [...chars];
  list.forEach((ch, i) => { const k = marks.length === 1 ? marks : marks[i]!; NFD[ch] = base + MARK[k === "š" ? "v" : k]!; });
}
// "šč" share one mark key; fix their bases explicitly.
NFD["č"] = "č"; NFD["Č"] = "Č";

export function decompose(s: string): string {
  let out = "";
  for (const ch of s) out += NFD[ch] ?? ch;
  return out;
}

export function installNormalizeFallback(target: { prototype: any } = String): boolean {
  let works = false;
  try { const fn = target.prototype.normalize; works = typeof fn === "function" && fn.call("é", "NFD").length === 2; } catch { works = false; }
  if (works) return false;
  Object.defineProperty(target.prototype, "normalize", {
    configurable: true, writable: true,
    value: function normalize(this: unknown, form?: string) {
      const s = String(this);
      return form === "NFD" || form === "NFKD" ? decompose(s) : s;
    },
  });
  return true;
}

installNormalizeFallback();
