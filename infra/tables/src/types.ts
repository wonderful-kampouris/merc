// Platform shape (POST /api/v1/custom-tables, verified by WP-SPK-05). Since WP-INF-03 the contract
// `create` blocks in spec/contracts/tables/<t>.json are exactly this shape and are applied as is.
export interface PlatformColumn {
  name: string;
  type: string;
  required: boolean;
  primary_key?: boolean;
  reference?: { table: string; on_delete?: string };
  enum_values?: string[];
  default_value?: unknown;
}
export interface PlatformIndex {
  name: string;
  columns: string[];
  unique?: boolean;
  type?: string;
}
export interface PlatformTable {
  name: string;
  schema: string;
  description?: string;
  columns: PlatformColumn[];
  indexes: PlatformIndex[];
}
/** A contract create block is the platform payload. */
export type ContractTable = PlatformTable;

export interface DeferredRef {
  table: string;
  column: string;
}
