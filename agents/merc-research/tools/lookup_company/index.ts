// Contract: spec/contracts/tools/merc-research/lookup_company.json (integration:business-directory.company).
// GEMI open data registry with secret DIRECTORY_API_KEY; blocked_by_policy (naming the secret) until it is set.
import { s, w } from "@wonderful/types/schema";
import { depsOf, lookupCompany } from "../../lib/research";

export default w.tool({
  name: "lookup_company",
  description: "Official company data from the Greek business registry (GEMI): legal name, status, address, activities. Pass the VAT number when known, else the shop name. Defaults to the loaded candidate.",
  params: s.object({
    vat_number: s.string().optional().describe("Greek VAT (AFM), 9 digits"),
    name: s.string().optional().describe("Business name"),
  }),
  handler: async (ctx, { vat_number, name }) => lookupCompany(depsOf(ctx), vat_number ?? null, name ?? null),
});
