// Types for the generated lib/ops.gen.js (see scripts/bundle-ops.mjs).
export interface TablesApiLike { [k: string]: any }
export declare function runForOps(tables: TablesApiLike, params: unknown, platform?: Record<string, unknown>): Promise<{ facts: Record<string, unknown> } | { error: { code: string; message: string; details?: unknown } }>;
export declare function createDb(tables: TablesApiLike, orgId?: string | null): any;
export declare function unknownNumbers(text: string, sources: string[]): number[];
