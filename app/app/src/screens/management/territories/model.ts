import type { FunctionRequestMap } from "../../../contracts";
import { seedRows } from "../../../contracts";
import { isObj, isUuid, objArr, optStr, shortId, str, strArr, type Obj } from "../settings/kit";

export interface Rep {
  id: string;
  name: string;
}
export interface Territory {
  id: string;
  name: string;
  manager_id: string | null;
  default_rep_id: string | null;
  postal_codes: string[];
  reps: Rep[];
}

/** `["15231"]` or `[{postal_code:"15231"}]`. */
function postalCodes(o: Obj): string[] {
  const raw = o.postal_codes;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => (typeof x === "string" ? x : isObj(x) ? str(x, "postal_code") : "")).filter(Boolean);
}

/** `reps: [{id|user_id, full_name|name}]` or bare `rep_ids`. */
function reps(o: Obj): Rep[] {
  const out = objArr(o.reps)
    .map((r) => ({ id: str(r, "id") || str(r, "user_id"), name: str(r, "full_name") || str(r, "name") }))
    .filter((r) => r.id);
  for (const id of strArr(o, "rep_ids") ?? []) if (!out.some((r) => r.id === id)) out.push({ id, name: "" });
  return out;
}

export function parseTerritories(items: Obj[]): Territory[] {
  return items
    .filter((o) => str(o, "id") && str(o, "name"))
    .map((o) => ({
      id: str(o, "id"),
      name: str(o, "name"),
      manager_id: optStr(o, "manager_id"),
      default_rep_id: optStr(o, "default_rep_id"),
      postal_codes: postalCodes(o),
      reps: reps(o),
    }));
}

/**
 * Mock mode only: territories-list mocks carry no postal codes or reps, so fill them from the seed
 * (territory_postal_code, territory_rep, app_user) to make the screen demonstrable.
 */
export function enrichFromSeed(ts: Territory[]): Territory[] {
  const users = new Map(seedRows("app_user").map((u) => [String(u.id), String(u.full_name ?? "")]));
  const pcs = seedRows("territory_postal_code");
  const trs = seedRows("territory_rep");
  return ts.map((t) => ({
    ...t,
    postal_codes: t.postal_codes.length ? t.postal_codes : pcs.filter((r) => r.territory_id === t.id).map((r) => String(r.postal_code)),
    reps: (t.reps.length ? t.reps : trs.filter((r) => r.territory_id === t.id).map((r) => ({ id: String(r.user_id), name: "" }))).map((r) => ({
      ...r,
      name: r.name || users.get(r.id) || "",
    })),
  }));
}

/** Every rep seen in any territory (members and default reps), once, sorted by name. */
export function repOptions(ts: Territory[]): Rep[] {
  const m = new Map<string, string>();
  for (const t of ts) {
    for (const r of t.reps) if (!m.get(r.id)) m.set(r.id, r.name);
    if (t.default_rep_id && !m.has(t.default_rep_id)) m.set(t.default_rep_id, "");
  }
  return [...m].map(([id, name]) => ({ id, name: name || shortId(id) })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Greek postal codes are 5 digits; accepts commas, spaces, new lines and `152 31`-style spacing is not split. */
export function parsePostalCodes(text: string): { valid: string[]; invalid: string[] } {
  const parts = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (/^\d{5}$/.test(p)) {
      if (!valid.includes(p)) valid.push(p);
    } else invalid.push(p);
  }
  return { valid, invalid };
}

export interface TerritoryForm {
  territory_id: string | null;
  name: string;
  postal_text: string;
  rep_ids: string[];
  default_rep_id: string | null;
  manager_id: string | null;
}

export const emptyTerritoryForm = (): TerritoryForm => ({ territory_id: null, name: "", postal_text: "", rep_ids: [], default_rep_id: null, manager_id: null });
export const formFromTerritory = (t: Territory): TerritoryForm => ({
  territory_id: t.id, name: t.name, postal_text: t.postal_codes.join(", "), rep_ids: t.reps.map((r) => r.id),
  default_rep_id: t.default_rep_id, manager_id: t.manager_id,
});

export type TerritoryProblem = "name" | "postal" | "default_rep";
export function validateTerritory(f: TerritoryForm): TerritoryProblem[] {
  const out: TerritoryProblem[] = [];
  if (!f.name.trim()) out.push("name");
  const pc = parsePostalCodes(f.postal_text);
  if (pc.invalid.length) out.push("postal");
  if (f.default_rep_id && !f.rep_ids.includes(f.default_rep_id)) out.push("default_rep");
  return out;
}

export function toTerritoryUpsert(f: TerritoryForm): FunctionRequestMap["territory-upsert"] {
  return {
    territory_id: f.territory_id,
    name: f.name.trim(),
    manager_id: f.manager_id,
    default_rep_id: f.default_rep_id,
    postal_codes: parsePostalCodes(f.postal_text).valid,
    rep_ids: f.rep_ids,
  };
}

export interface TransferForm {
  from_rep_id: string | null;
  to_rep_id: string | null;
  all_accounts: boolean;
  account_text: string;
  reason: string;
}
export const emptyTransfer = (): TransferForm => ({ from_rep_id: null, to_rep_id: null, all_accounts: true, account_text: "", reason: "" });

export type TransferProblem = "from" | "to" | "same" | "accounts" | "account_ids";
export function validateTransfer(f: TransferForm): TransferProblem[] {
  const out: TransferProblem[] = [];
  if (!f.from_rep_id) out.push("from");
  if (!f.to_rep_id) out.push("to");
  if (f.from_rep_id && f.from_rep_id === f.to_rep_id) out.push("same");
  if (!f.all_accounts) {
    const ids = f.account_text.split(/[\s,;]+/).filter(Boolean);
    if (!ids.length) out.push("accounts");
    else if (!ids.every(isUuid)) out.push("account_ids");
  }
  return out;
}

export function toTransfer(f: TransferForm): FunctionRequestMap["assignments-transfer"] {
  return {
    from_rep_id: f.from_rep_id!,
    to_rep_id: f.to_rep_id!,
    account_ids: f.all_accounts ? [] : [...new Set(f.account_text.split(/[\s,;]+/).filter(Boolean))],
    all_accounts: f.all_accounts,
    reason: f.reason.trim() || null,
  };
}
