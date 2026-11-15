import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { canonicalRow, decode, restore, sameRow } from "../../autonomy/src/snapshot";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { groundedChannel, groundedDate, groundOutput, extractionInput, makeHandle, makeImpl, matchCompetitor, accountsMentioned, type DebriefDeps } from "../src/debrief-process";
import { inventedNumbers, factsFrom, type Golden } from "../../../evals/debrief/score";
import type { DebriefOutput } from "../../llm/src/index";
import { J1, empty, j1Output, IDS_J1 } from "../../../evals/debrief/j1";
const { PROBLEM, DEAL, CONTACT, CAMPAIGN, AROMA, NUOVO } = IDS_J1;

const NOW = Date.parse("2026-11-16T10:00:00Z"); // demo day (Monday), 12:00 in Athens

function deps(out: DebriefOutput | (() => DebriefOutput) | null, draftBody = "Καλησπέρα Μίλτο, ευχαριστώ για τη συνάντηση. Νίκος"): DebriefDeps & { calls: { extract: number; draft: number } } {
  const calls = { extract: 0, draft: 0 };
  return {
    calls, now: () => NOW,
    extract: async () => { calls.extract++; const v = typeof out === "function" ? out() : out; return v ? { ok: true, value: v, attempts: 1, profile: "fake", logs: [] } : { ok: false, error: { code: "upstream_failed", message: "model down" }, attempts: 2, profile: "fake", logs: [] }; },
    draftModel: () => ({ withStructuredOutput: () => ({ invoke: async () => { calls.draft++; return { subject: "Ευχαριστώ", body: draftBody }; } }) }),
  };
}
const run = (t: ReturnType<typeof kit>, who: "nikos" | "dimitra" | "eleni" | "thanasis", body: unknown, d: DebriefDeps, api?: unknown) =>
  makeHandle(d)(Object.assign(t.fnCtx(who, body), api ? { api } : {}) as never);

describe("fn:debrief-process", () => {
  it("contract: POST, gate voicelog.create, callers buddy+internal; request/response validate", () => {
    const c = JSON.parse(readFileSync(join(__dirname, "../../../spec/contracts/functions/debrief-process.json"), "utf8"));
    expect([c.method, c.gate, c.callers]).toEqual(["POST", "voicelog.create", ["buddy", "internal"]]);
    expect(validateRequest("debrief-process", { utterance: "x", account_id: IDS.miltos }).ok).toBe(true);
    expect(validateRequest("debrief-process", { utterance: "x", rep_id: IDS.nikos }).ok).toBe(false);
    expect(validateResponse("debrief-process", { status: "needs_confirmation", result: null, candidates: [], question: "q" }).ok).toBe(true);
  });

  it("J1 (REQ-DEB-002/005/006/007/008): note, problem update, promise task Thursday, deal update, signal, pitch, draft order, pending email approval", async () => {
    const t = kit();
    const d = deps(j1Output());
    const r = ok(await run(t, "nikos", { utterance: J1, account_id: IDS.miltos, conversation_id: "conv-1" }, d));
    expect(validateResponse("debrief-process", r).ok).toBe(true);
    expect(r.status).toBe("completed");
    const card = r.result!;
    const types = card.lines.map((l) => l.action_type);
    expect(types).toEqual(expect.arrayContaining(["create_note", "mark_visit_done", "update_problem", "update_deal", "create_task", "create_competitor_signal", "log_campaign_pitch", "create_draft_order", "send_email"]));
    expect(card.lines.filter((l) => l.action_class === "internal").every((l) => l.status === "applied" && l.undoable)).toBe(true);

    const task = (await t.db.task.all({ voice_log_id: card.voice_log_id }))[0]!;
    expect(task.is_customer_promise).toBe(true);
    expect(task.due_at).toBe("2026-11-19T07:00:00.000Z"); // the coming Thursday, 09:00 Athens
    const sig = (await t.db.competitor_signal.all({ voice_log_id: card.voice_log_id }))[0]!;
    expect([sig.competitor_id, sig.price_delta_pct]).toEqual([AROMA, -15]);
    expect((await t.db.campaign_exposure.all({ voice_log_id: card.voice_log_id }))[0]!.stage).toBe("pitched");
    expect((await t.db.problem.get(PROBLEM))!.status).toBe("in_progress");
    const deal = (await t.db.deal.get(DEAL))!;
    expect([deal.stage_code, deal.amount_minor]).toEqual(["won", 400000]);
    expect((await t.db.deal_stage_history.all({ deal_id: DEAL })).some((h) => h.to_stage_code === "won")).toBe(true);
    const order = (await t.db.sales_order.all({ voice_log_id: card.voice_log_id }))[0]!;
    expect(order.status).toBe("draft");
    expect((await t.db.order_line.all({ order_id: order.id }))[0]).toMatchObject({ product_id: NUOVO, quantity: 12, unit_price_minor: 2150 });

    // REQ-DEB-005: drafted, pending, never sent
    expect(card.pending_approvals).toHaveLength(1);
    const ap = card.pending_approvals[0]!;
    expect([ap.kind, ap.status, ap.recipient, ap.approver.id]).toEqual(["customer_message", "pending", "miltos@miltos.example.gr", IDS.nikos]);
    const m = (await t.db.message_approval.all({ approval_id: ap.approval_id }))[0]!;
    expect([m.sent_at ?? null, m.contact_id]).toEqual([null, CONTACT]);
    expect(card.lines.find((l) => l.action_type === "send_email")).toMatchObject({ status: "suggested", undoable: false, approval_id: ap.approval_id });

    const vl = (await t.db.voice_log.get(card.voice_log_id))!;
    expect([vl.status, vl.capture_mode, vl.account_id, vl.rep_id]).toEqual(["completed", "live_buddy", IDS.miltos, IDS.nikos]);
    expect(card.spoken_summary).toMatch(/^Έγινε: αποθήκευσα \d+ ενημερώσεις\./);
    expect(card.spoken_summary).toContain("περιμένει την έγκρισή σου");
    expect(d.calls).toEqual({ extract: 1, draft: 1 });
  });

  it("REQ-CORE-006: every applied action's snapshot undoes to byte-identical rows", async () => {
    const t = kit();
    const before = new Map<string, unknown>();
    for (const tb of ["problem", "deal", "visit"] as const) for (const r of await (t.db[tb] as any).all({ account_id: IDS.miltos })) before.set(`${tb}:${r.id}`, r);
    const r = ok(await run(t, "nikos", { utterance: J1, account_id: IDS.miltos }, deps(j1Output())));
    const actions = (await t.db.ai_action.all({ voice_log_id: r.result!.voice_log_id, status: "applied" })).sort((a, b) => Number(b.created_at) - Number(a.created_at));
    expect(actions.length).toBeGreaterThanOrEqual(8);
    for (const a of actions) await restore(t.db, decode(a.before_snapshot_json)!.rows, decode(a.after_snapshot_json)!.rows);
    for (const [k, row] of before) {
      const [tb, id] = k.split(":");
      const now = await (t.db as any)[tb!].get(id);
      expect(sameRow(now, row as any)).toBe(true);
      expect(canonicalRow(tb as any, now)).toEqual(canonicalRow(tb as any, row as any)); // strict: every column + created_at
    }
    for (const tb of ["task", "competitor_signal", "campaign_exposure", "sales_order", "activity"] as const) expect(await (t.db[tb] as any).all({ voice_log_id: r.result!.voice_log_id })).toHaveLength(0);
  });

  it("REQ-DEB-004 + REQ-CORE-003: planted hallucinations are dropped and asked; invented numbers become null + question", async () => {
    const t = kit();
    const out = j1Output();
    out.tasks.push({ title: "Τηλεφώνημα", due_at: null, is_customer_promise: false, evidence: "θα τον πάρω τηλέφωνο αύριο το πρωί" }); // not said
    out.deal_update.amount_minor = 550000; // "5.500" never said
    out.competitor_signals[0]!.price_delta_pct = -25; // said 15
    out.order_intent.lines[0]!.quantity = 30; // said twelve
    out.contacts.push({ existing_contact_id: null, full_name: "Γιάννης Κ.", role_title: "Barista", phone: "6999999999", email: null, is_decision_maker: false, evidence: "ο Γιάννης ο barista" }); // invented
    out.note = "Ο Μίλτος θέλει 50 κιλά."; // invented number in the note
    const r = ok(await run(t, "nikos", { utterance: J1, account_id: IDS.miltos }, deps(out)));
    const vlId = r.result!.voice_log_id;
    expect((await t.db.task.all({ voice_log_id: vlId })).map((x) => x.title)).toEqual(["Δείγματα Espresso Nuovo στον Μίλτο"]);
    expect((await t.db.deal.get(DEAL))!.amount_minor).toBe(380000); // unchanged seed value
    expect((await t.db.competitor_signal.all({ voice_log_id: vlId }))[0]!.price_delta_pct).toBeNull();
    expect(await t.db.contact.all({ account_id: IDS.miltos })).toHaveLength(1);
    expect(await t.db.sales_order.all({ voice_log_id: vlId })).toHaveLength(0); // quantity nulled -> no line -> asked
    const fields = r.result!.missing_fields.map((m) => m.field);
    expect(fields).toEqual(expect.arrayContaining(["/tasks/1", "/deal_update/amount_minor", "/competitor_signals/0/price_delta_pct", "/order_intent/lines/0/quantity", "/contacts/0"]));
    const note = (await t.db.activity.all({ voice_log_id: vlId }))[0]!.body!;
    expect(note).not.toContain("50");
  });

  it("non-numeric fields are grounded: unnamed channel, unknown competitor, foreign ids, bad stage are dropped and asked", async () => {
    const t = kit();
    const u = "Ήμουν στο Café Miltos. Η Kafea Express του έδωσε καλύτερη τιμή. Πες του ότι θα τον ενημερώσω για τις τιμές. Η συμφωνία προχωράει καλά.";
    const out: DebriefOutput = { ...empty(), note: "Επίσκεψη στο Café Miltos.",
      competitor_signals: [{ competitor_name: "Kafea Express", statement: "καλύτερη τιμή", price_delta_pct: null, evidence: "Η Kafea Express του έδωσε καλύτερη τιμή" }],
      deal_update: { deal_id: "00000000-0000-4000-8000-000000000000", new_deal_title: null, stage_code: "almost_won", amount_minor: null, next_step: "τιμές", expected_close_date: null, evidence: "Η συμφωνία προχωράει καλά" },
      follow_up: { intent: "Ενημέρωση για τιμές", channel: "viber", contact_name: null, evidence: "Πες του ότι θα τον ενημερώσω για τις τιμές" },
      campaigns_pitched: [{ campaign_id: "11111111-1111-4111-8111-111111111111", evidence: "Η συμφωνία προχωράει καλά" }],
    } as DebriefOutput;
    const r = ok(await run(t, "nikos", { utterance: u, account_id: IDS.miltos }, deps(out)));
    const card = r.result!;
    expect(card.pending_approvals).toHaveLength(0); // channel never named
    expect(card.lines.map((l) => l.action_type)).not.toContain("log_campaign_pitch");
    expect(card.missing_fields.map((m) => m.field)).toEqual(expect.arrayContaining(["/follow_up/channel", "/deal_update/stage_code"]));
    // "Kafea Express" is not "Kafea Plus": no signal with a guessed competitor
    expect(await t.db.competitor_signal.all({ voice_log_id: card.voice_log_id })).toHaveLength(0);
    // deal id was foreign -> mapped to the only open deal, stage dropped, next_step kept
    expect((await t.db.deal.get(DEAL))!).toMatchObject({ stage_code: "negotiation", next_step: "τιμές" });
  });

  it("unknown customer -> needs_confirmation with candidates; the follow-up call with voice_log_id + account_id completes", async () => {
    const t = kit();
    const u = "Ήμουν σε ένα καινούριο καφέ, μου είπε ότι θέλει δείγματα.";
    const d = deps(() => ({ ...empty(), note: "Νέο καφέ, θέλει δείγματα." } as DebriefOutput));
    const r1 = ok(await run(t, "nikos", { utterance: u, lat: 38.0227, lng: 23.7947 }, d));
    expect(r1.status).toBe("needs_confirmation");
    expect(r1.question).toBe("Για ποιον πελάτη ήταν αυτή η επίσκεψη;");
    expect(r1.candidates.length).toBeGreaterThan(0);
    expect(r1.candidates[0]).toMatchObject({ id: IDS.miltos, reason: expect.any(String) });
    expect(validateResponse("debrief-process", r1).ok).toBe(true);
    expect(d.calls.extract).toBe(0);
    const vl = (await t.db.voice_log.all({ rep_id: IDS.nikos, status: "needs_confirmation" }))[0]!;
    const r2 = ok(await run(t, "nikos", { voice_log_id: vl.id, account_id: IDS.miltos }, d));
    expect([r2.status, r2.result!.account.id]).toEqual(["completed", IDS.miltos]);
    // idempotent: the same voice log again returns the stored card, no second extraction or writes
    const r3 = ok(await run(t, "nikos", { voice_log_id: vl.id }, d));
    expect(r3.result!.lines.map((l) => l.ai_action_id)).toEqual(r2.result!.lines.map((l) => l.ai_action_id));
    expect(d.calls.extract).toBe(1);
  });

  it("a customer named in the utterance is resolved without asking", async () => {
    const t = kit();
    const r = ok(await run(t, "nikos", { utterance: "Πέρασα από το Café Miltos, όλα καλά." }, deps({ ...empty(), note: "Όλα καλά στο Café Miltos." } as DebriefOutput)));
    expect([r.status, r.result!.account.id]).toEqual(["completed", IDS.miltos]);
  });

  it("scope (REQ-CORE-009): another rep's voice log and an out-of-scope account are forbidden; spoofed caller ignored", async () => {
    const t = kit();
    const r = ok(await run(t, "nikos", { utterance: "Café Miltos ok", account_id: IDS.miltos }, deps(empty())));
    expect(errCode(await run(t, "dimitra", { voice_log_id: r.result!.voice_log_id }, deps(empty())))).toBe("forbidden");
    const center = (await t.db.account.all({ territory_id: IDS.center })).find((a) => a.owner_rep_id !== IDS.nikos)!;
    expect(errCode(await run(t, "nikos", { utterance: "x", account_id: center.id }, deps(empty())))).toBe("forbidden");
    const spoof = ok(await run(t, "nikos", { utterance: "Café Miltos ok", account_id: IDS.miltos, caller: { user_id: IDS.thanasis } }, deps(empty())));
    expect((await t.db.voice_log.get(spoof.result!.voice_log_id))!.rep_id).toBe(IDS.nikos);
    expect(errCode(await makeHandle(deps(empty()))(t.fnCtx(null, { utterance: "x" }) as never))).toBe("forbidden");
  });

  it("corrects_voice_log_id: undoes every applied line of the original and re-logs original + fix, no second visit", async () => {
    const t = kit();
    const first = ok(await run(t, "nikos", { utterance: J1, account_id: IDS.miltos }, deps(j1Output())));
    const firstId = first.result!.voice_log_id;
    const transcripts: string[] = [];
    const d = deps(j1Output());
    const extract = d.extract;
    d.extract = async (input: any, rules: any) => { transcripts.push(String(input.utterance ?? "")); return extract(input, rules); };
    const fix = ok(await run(t, "nikos", { utterance: "it was 10 kilos, not 12", corrects_voice_log_id: firstId }, d));
    expect(fix.status).toBe("completed");
    expect(fix.result!.account.id).toBe(IDS.miltos);
    expect(transcripts[0]).toContain(" Correction: it was 10 kilos, not 12");
    const old = await t.db.ai_action.all({ voice_log_id: firstId });
    expect(old.filter((a) => a.status === "applied").map((a) => a.action_type_code)).toEqual([]);
    expect(await t.db.task.all({ voice_log_id: firstId })).toHaveLength(0);
    expect(await t.db.task.all({ voice_log_id: fix.result!.voice_log_id })).toHaveLength(1);
    expect(errCode(await run(t, "dimitra", { utterance: "fix", corrects_voice_log_id: firstId }, deps(j1Output())))).toBe("forbidden");
  });

  it("exactly one of voice_log_id / utterance", async () => {
    const t = kit();
    expect(errCode(await run(t, "nikos", {}, deps(empty())))).toBe("validation_failed");
    expect(errCode(await run(t, "nikos", { utterance: "a", voice_log_id: IDS.miltos }, deps(empty())))).toBe("validation_failed");
  });

  it("model failure -> status failed, voice log failed with the error, nothing written", async () => {
    const t = kit();
    const r = ok(await run(t, "nikos", { utterance: "Café Miltos", account_id: IDS.miltos }, deps(null)));
    expect([r.status, r.result]).toEqual(["failed", null]);
    const vl = (await t.db.voice_log.all({ rep_id: IDS.nikos, status: "failed" }))[0]!;
    expect(vl.error).toContain("upstream_failed");
    expect(await t.db.ai_action.all({ voice_log_id: vl.id })).toHaveLength(0);
  });

  it("a draft that invents a number falls back to a facts-only template (Rule A)", async () => {
    const t = kit();
    const r = ok(await run(t, "nikos", { utterance: J1, account_id: IDS.miltos }, deps(j1Output(), "Μίλτο, σου κάνω 30% έκπτωση!")));
    expect(r.result!.pending_approvals[0]!.body).not.toContain("30");
  });

  it("pushes result_card.ready to rep:{id} and the manager's team channel (REQ-CORE-011); no api -> still completes", async () => {
    const t = kit();
    const posts: any[] = [];
    const api = { post: async (path: string, o: any) => { posts.push({ path, ...o.body }); return {}; } };
    const r = ok(await run(t, "nikos", { utterance: "Café Miltos ok", account_id: IDS.miltos }, deps(empty()), api));
    expect(posts.map((p) => p.channel)).toEqual([`rep:${IDS.nikos}`, `team:${IDS.eleni}`]);
    expect(posts[0]).toMatchObject({ path: "/v1/function-sockets/messages", data: { type: "result_card.ready", payload: { voice_log_id: r.result!.voice_log_id } } });
  });

  it("the buddy tool path runs the same impl with the signed claim", async () => {
    const t = kit();
    const r = ok(await runAsTool("debrief-process", makeImpl(deps(empty())), t.toolCtx("nikos"), { utterance: "Café Miltos ok", account_id: IDS.miltos }, t.key));
    expect((await t.db.voice_log.get(r.result!.voice_log_id))!.rep_id).toBe(IDS.nikos);
  });

  it("grounding helpers: dates from the quote, named channels, competitor and account matching", () => {
    expect(groundedDate("θα του φέρω δείγματα την Πέμπτη", "2026-11-16", "2026-11-26")).toBe("2026-11-19");
    expect(groundedDate("I'll call him tomorrow", "2026-11-16", null)).toBe("2026-11-17");
    expect(groundedDate("delivery on the 20th", "2026-11-16", "2026-11-20")).toBe("2026-11-20");
    expect(groundedDate("θα του φέρω δείγματα", "2026-11-16", "2026-11-19")).toBeNull();
    expect(groundedChannel("Στείλε του ένα μέιλ", "viber")).toBe("email");
    expect(groundedChannel("γράψε του στο Viber", "viber")).toBe("viber");
    expect(groundedChannel("πες του ότι θα τα πούμε", "email")).toBeNull();
    const comps = [{ name: "Aroma Delta" }, { name: "Kafea Plus" }];
    expect(matchCompetitor("Αρόμα", comps)?.name).toBe("Aroma Delta");
    expect(matchCompetitor("Aroma", comps)?.name).toBe("Aroma Delta");
    expect(matchCompetitor("Kafea Express", comps)).toBeNull();
    expect(accountsMentioned("ήμουν στο καφέ Μίλτος", [{ name: "Café Miltos" }, { name: "Café Avra" }]).map((a) => a.name)).toEqual(["Café Miltos"]);
  });

  it("functions/debrief-process/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "debrief-process", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("debrief-process"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});

describe("evals/debrief golden set, offline (REQ-DEB-004, REQ-CORE-003)", () => {
  const g = JSON.parse(readFileSync(join(__dirname, "../../../evals/debrief/golden.json"), "utf8")) as Golden;

  it("has >= 15 cases covering el, en, mixed, noise, half sentence, unknown customer and planted hallucinations", () => {
    expect(g.cases.length).toBeGreaterThanOrEqual(15);
    const tags = new Set(g.cases.flatMap((c) => c.tags)), langs = new Set(g.cases.map((c) => c.lang));
    for (const t of ["noise", "half", "unknown_customer", "hallucination"]) expect(tags.has(t)).toBe(true);
    expect([...langs].sort()).toEqual(["el", "en", "mixed"]);
    expect(g.default_plants.length).toBeGreaterThanOrEqual(4);
  });

  it("every planted hallucination is dropped or nulled in every case (100%)", async () => {
    const t = kit();
    const me = await t.principal("nikos");
    const account = (await t.db.account.get(IDS.miltos))!;
    let planted = 0, dropped = 0;
    for (const c of g.cases) {
      const x = await extractionInput(t.db, me, account, c.utterance, null, "2026-11-16");
      for (const p of g.default_plants) {
        const out = empty();
        out.language = c.lang === "en" ? "en" : "el";
        if (p.path === "deal_update") out.deal_update = p.item as never;
        else (out as any)[p.path].push(p.item);
        planted++;
        const { out: g2 } = groundOutput(out, x, c.utterance, "2026-11-16");
        const survived = p.path === "deal_update" ? !!(g2.deal_update.new_deal_title || g2.deal_update.amount_minor || g2.deal_update.stage_code) : (g2 as any)[p.path].length > 0;
        if (!survived) dropped++;
        else console.log(`survived in ${c.id}: ${JSON.stringify(p.item)}`);
        expect(g2.missing_fields.length).toBeGreaterThan(0); // asked about
      }
    }
    expect(dropped).toBe(planted);
  });

  it("the scorer flags invented numbers and accepts said ones", () => {
    const f = factsFrom({ status: "completed" }, [
      { action_type_code: "update_deal", status: "applied", payload_json: JSON.stringify({ patch: { amount_minor: 400000 } }) },
      { action_type_code: "create_competitor_signal", status: "applied", payload_json: JSON.stringify({ competitor_id: "x", price_delta_pct: -40 }) },
    ], (d) => d.slice(0, 10));
    expect(inventedNumbers(J1, f)).toEqual([{ field: "signals.0.delta", value: -40 }]);
  });
});
