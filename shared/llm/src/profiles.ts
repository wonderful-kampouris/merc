import type { ProfileKey } from "./contracts.js";

/**
 * Tenant Model Profile ids on the dev workspace (created by WP-CORE-02,
 * definitions in shared/llm/profiles/*.json, `pnpm profiles` recreates them).
 * The runtime resolves a profile by tenant UUID or static key, so code passes the UUID.
 */
export const PROFILE_IDS: Record<ProfileKey, string> = {
  "merc-extract": "4d548312-3a1f-40fd-a14f-88af46e06ac7",
  "merc-write": "55503487-1105-4ad5-95d2-d648ce85642d",
  "merc-decide": "adc91487-5cd7-4ee3-8074-771235ade9c1",
};

/** Profile reference to pass to ModelProfiles.*: the tenant UUID when known, else the value itself. */
export function profileRef(keyOrId: string): string {
  return (PROFILE_IDS as Record<string, string>)[keyOrId] ?? keyOrId;
}
