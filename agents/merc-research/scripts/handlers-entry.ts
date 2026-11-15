// Entry for lib/handlers.gen.js: the shared Merc handlers the merc-research tools call (REQ-CORE-004, rule B).
// Source of truth: shared/handlers/src (WP-PRS-01). Regenerate with `node scripts/bundle-handlers.mjs`.
export { handle as candidateGet } from "../../../shared/handlers/src/candidate-get";
export { handle as dossierSave, sourceProblem, FACT_TYPES } from "../../../shared/handlers/src/dossier-save";
export { normDomain, normVat } from "../../../shared/handlers/src/candidate-dedupe";
