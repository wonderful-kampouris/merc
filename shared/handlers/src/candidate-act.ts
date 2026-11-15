// fn:candidate-act (contracts/functions/candidate-act.json, REQ-PRS-006). App and buddy act_on_candidate.
//   add_to_route: account (prospect, source prospecting) from the candidate, its dossier moved to the account, and a
//                 planned visit for the rep (default today in the org timezone, so it shows in this week's plan).
//   assign:       assigned_rep_id = rep_id, default the territory's default_rep_id (territory from the postal code).
//   dismiss:      status dismissed.
// Acting for another rep needs team scope (manager/admin). A duplicate of an existing account is not converted again.
import { assertTeam, conflict, defineFunction, invalid, today, type Db, type Impl, type Row, type UserPrincipal } from "../../core/src/index";
import { candidateCard, dossierOf, requireCandidate, territoryOfPostal } from "./candidate-get";
import { normVat } from "./candidate-dedupe";

async function requireRep(db: Db, me: UserPrincipal, repId: string): Promise<Row<"app_user">> {
  if (repId !== me.id) assertTeam(me, repId, "rep");
  const u = await db.app_user.get(repId);
  if (!u || u.status !== "active") throw invalid("rep is not an active Merc user", { rep_id: repId });
  return u;
}

async function addToRoute(db: Db, me: UserPrincipal, c: Row<"candidate">, s: Row<"prospect_search">, repIdIn: string | null, dateIn: string | null) {
  const day = dateIn ?? today(me.org);
  if (day < today(me.org)) throw invalid("date is in the past", { date: day });
  if (c.status === "duplicate" && c.matched_account_id) throw conflict("candidate is a duplicate of an existing account", { account_id: c.matched_account_id });
  if (c.status === "dismissed") throw invalid("candidate was dismissed");
  const territoryId = await territoryOfPostal(db, c.postal_code);
  const terr = territoryId ? await db.territory.get(territoryId) : null;
  const repId = repIdIn ?? (me.role === "rep" ? me.id : c.assigned_rep_id ?? terr?.default_rep_id ?? me.id);
  await requireRep(db, me, repId);

  let account = c.converted_account_id ? await db.account.get(c.converted_account_id) : null;
  if (!account) {
    account = await db.account.insert({
      name: c.business_name, account_type: "prospect", category_id: s.category_id ?? null,
      vat_number: normVat(c.vat_number) ?? c.vat_number ?? null, street: c.street ?? null, postal_code: c.postal_code ?? null,
      lat: c.lat ?? null, lng: c.lng ?? null, phone: c.phone ?? null, website: c.website ?? null,
      territory_id: territoryId, owner_rep_id: repId, source: "prospecting",
    } as any);
  }
  const dossier = await dossierOf(db, c);
  if (dossier && dossier.account_id !== account.id) await db.dossier.update(dossier.id, { account_id: account.id });
  let visit = (await db.visit.all({ account_id: account.id, rep_id: repId, status: "planned", planned_date: day }))[0] ?? null;
  if (!visit) {
    visit = await db.visit.insert({ account_id: account.id, rep_id: repId, origin: repId === me.id ? "manual" : "manager", planned_date: day, status: "planned", purpose: "First visit: new prospect from prospecting" } as any);
  }
  const updated = await db.candidate.update(c.id, { status: "added", converted_account_id: account.id, assigned_rep_id: repId });
  return { candidate: await candidateCard(db, updated), account_id: account.id, visit_id: visit.id };
}

export const impl: Impl<"candidate-act"> = async ({ req, db, me }) => {
  const { candidate: c, search } = await requireCandidate(db, me, req.candidate_id);
  if (req.action === "add_to_route") return addToRoute(db, me, c, search, req.rep_id ?? null, req.date ?? null);
  if (req.action === "assign") {
    const terr = await territoryOfPostal(db, c.postal_code);
    const repId = req.rep_id ?? (terr ? (await db.territory.get(terr))?.default_rep_id ?? null : null);
    if (!repId) throw invalid("no rep_id given and the candidate's territory has no default rep");
    await requireRep(db, me, repId);
    const updated = await db.candidate.update(c.id, { assigned_rep_id: repId });
    return { candidate: await candidateCard(db, updated), account_id: c.converted_account_id ?? null, visit_id: null };
  }
  if (c.status === "added") throw conflict("candidate is already on the route", { account_id: c.converted_account_id });
  const updated = await db.candidate.update(c.id, { status: "dismissed" });
  return { candidate: await candidateCard(db, updated), account_id: null, visit_id: null };
};

/** Wonderful Function entry (functions/candidate-act/index.ts). */
export const handle = defineFunction("candidate-act", impl);
