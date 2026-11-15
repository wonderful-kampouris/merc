// Types for the generated bundle lib/handlers.gen.js (see scripts/handlers-entry.ts).
export interface HandlerContext { tables: unknown; data: unknown; secrets?: unknown; globals?: unknown; metadata?: unknown }
export type Outcome = Record<string, unknown> & { error?: { code: string; message: string; details?: unknown } };
export declare function candidateGet(context: HandlerContext): Promise<Outcome>;
export declare function dossierSave(context: HandlerContext): Promise<Outcome>;
export declare function sourceProblem(url: string | null | undefined): string | null;
export declare const FACT_TYPES: readonly string[];
export declare function normDomain(url: string | null | undefined): string | null;
export declare function normVat(v: string | null | undefined): string | null;
