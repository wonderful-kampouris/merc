// fn:retention-purge (contracts/functions/retention-purge.json, REQ-DEB-011): nightly cron (30 2 * * *).
// Per org: every voice_log of the org's reps recorded more than organization.recording_retention_days ago that
// still has an audio_ref gets its stored audio deleted (context.storage) and audio_ref set to null.
// Transcripts are kept. A storage delete that fails (other than "not found") keeps the ref so the next run retries.
// dry_run=true only counts. Response: processed = voice logs examined, created = 0, details = per-org summary.
import { defineCron, invalid, type FunctionContext, type Impl, type Principal } from "../../core/src/index";
import type { StorageLike } from "./voice-log-upload";

export const SLUG = "retention-purge" as const;
const DAY_MS = 86_400_000;

export interface PurgeDeps { storage: Pick<StorageLike, "delete"> | null; now?: () => number }
const isNotFound = (e: unknown) => /not[-_ ]?found|404|does not exist/i.test(String((e as { message?: unknown })?.message ?? e));

export function makeImpl(deps: PurgeDeps): Impl<"retention-purge", Principal> {
  return async ({ req, db, me }) => {
    const dryRun = req.dry_run === true;
    const days = Number(me.org.recording_retention_days);
    if (!Number.isFinite(days) || days < 0) throw invalid("organization.recording_retention_days must be a non-negative number");
    const cutoff = new Date((deps.now?.() ?? Date.now()) - days * DAY_MS).toISOString();
    // voice_log has no org_id: scope through the org's users (db.app_user is org-filtered).
    const repIds = (await db.app_user.all()).map((u) => u.id);
    const rows = repIds.length ? await db.voice_log.all({ rep_id: repIds, audio_ref: { op: "is_not_null" }, recorded_at: { op: "lt", value: cutoff } }) : [];
    const failed: Array<{ voice_log_id: string; error: string }> = [];
    let purged = 0;
    if (!dryRun) {
      for (const r of rows) {
        const ref = r.audio_ref;
        if (!ref) continue;
        if (!deps.storage) { failed.push({ voice_log_id: r.id, error: "context.storage unavailable: audio not deleted, ref kept" }); continue; }
        try { await deps.storage.delete(ref); }
        catch (e) {
          if (!isNotFound(e)) { failed.push({ voice_log_id: r.id, error: String((e as Error)?.message ?? e).slice(0, 300) }); continue; }
        }
        await db.voice_log.update(r.id, { audio_ref: null });
        purged++;
      }
    }
    return {
      processed: rows.length,
      created: 0,
      details: { retention_days: days, cutoff, dry_run: dryRun, purged, would_purge: dryRun ? rows.length : 0, failed },
    };
  };
}

export type PurgeContext = FunctionContext & { storage?: Pick<StorageLike, "delete"> | null };
/** Cron entry: once per organization with a system principal (shared/core defineCron). */
export const handle = (context: PurgeContext) => defineCron(SLUG, makeImpl({ storage: context.storage ?? null }))(context);
