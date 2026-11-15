// Accent folding that also works in the agent tool runtime, which has no String.prototype.normalize
// (the same handler code runs there as a tool and on Node as a Function, REQ-CORE-004).
const FOLD: Record<string, string> = {};
const add = (to: string, from: string) => { for (const ch of from) FOLD[ch] = to; };
add("a", "àáâãäåāăą"); add("A", "ÀÁÂÃÄÅĀĂĄ"); add("c", "çćč"); add("C", "ÇĆČ"); add("e", "èéêëēėęě"); add("E", "ÈÉÊËĒĖĘĚ");
add("i", "ìíîïīį"); add("I", "ÌÍÎÏĪĮ"); add("n", "ñńň"); add("N", "ÑŃŇ"); add("o", "òóôõöøō"); add("O", "ÒÓÔÕÖØŌ");
add("u", "ùúûüūů"); add("U", "ÙÚÛÜŪŮ"); add("y", "ýÿ"); add("Y", "ÝŸ"); add("s", "śšş"); add("S", "ŚŠŞ"); add("z", "źżž"); add("Z", "ŹŻŽ");
add("α", "ά"); add("Α", "Ά"); add("ε", "έ"); add("Ε", "Έ"); add("η", "ή"); add("Η", "Ή"); add("ι", "ίϊΐ"); add("Ι", "ΊΪ");
add("ο", "ό"); add("Ο", "Ό"); add("υ", "ύϋΰ"); add("Υ", "ΎΫ"); add("ω", "ώ"); add("Ω", "Ώ");
const hasNormalize = typeof "".normalize === "function";

/** Remove diacritics (Latin + Greek tonos/dialytika). Uses NFD when the runtime has it, else a fixed table. */
export function stripAccents(s: string): string {
  const str = String(s ?? "");
  if (hasNormalize) return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
  let out = "";
  for (const ch of str) out += FOLD[ch] ?? ch;
  return out.replace(/[̀-ͯ]/g, "");
}
