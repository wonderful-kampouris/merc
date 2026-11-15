# Merc pitch video · the story (3:00)

One morning, one café, one rep. Everything shown is journey J5 from `spec/SPEC.md`, on the seed data, so every name, product and number on screen is real data from the system.

## Cast

| Who | Role in the story | On camera? |
|---|---|---|
| **Nikos Alexiou** | Field rep, Delta Foods & Coffee, Athens North. Hero. Hates typing in CRMs | Yes (a team member plays him, phone in hand, in a car) |
| **Merc** | The buddy (agent Merc Buddy Pro in Team Delta). Warm female English voice on the phone, WhatsApp messages, the app | Voice + phone screen |
| **Miltos Papadakis** | Owner of Café Miltos, a specialty café, customer for over a year. Grinder has been making noise | Only seen from behind / b-roll. **Merc never hears him** |
| **Eleni Markou** | Nikos's manager | Voice-over mention only (management screens are cut from freeze) |

## The world (seed facts the video uses)

- Café Miltos usually orders **12 kg** of espresso. Open problem: **"Grinder is making noise"**.
- Company rules in `product_guidance`:
  - **Push Espresso Nuovo Blend**: "Product of the month; forgiving on worn grinders, so it fixes shots at busy cafés."
  - **Avoid Frappé Instant**: "Specialty cafés see instant frappé as off-brand; it undercuts our premium espresso story."
  - Fallback push **Hot Chocolate**: "Winter seller at cafés from November; a new line with no new equipment."
- Company values in KB `merc-company`: *Fix before you sell. Honest promises. Quality over volume.*
- Visit at Café Miltos planned **10:45**. Brief at **10:15**. Post-visit prompt at **11:25**.

## The script

Everything is in English: voice-over (VO), Merc and Nikos. No subtitles needed. Merc answers a call with "Hey, Merc here. Next stop, or log a visit?"

### 0:00–0:20 · Hook: the problem
**Screen:** Nikos in his parked car at night, laptop on the steering wheel, typing CRM notes. Clock 18:30.
**VO:** "Field reps sell all day and type all evening. Or they don't type at all, and the CRM is empty. So the manager knows nothing and the next visit starts from zero."
**Cut to black, title:** *Merc · the CRM that fills itself.*

### 0:20–0:30 · Morning: Nikos opens the conversation
**Screen:** 07:50, Nikos WhatsApps Merc: "Morning! What's my day?" Merc replies with today's stops, Café Miltos first.
**VO:** "Nikos doesn't open a CRM. He talks to Merc on WhatsApp."
**System:** `merc-buddy-pro` on the WhatsApp channel, identity from his phone number. This message also opens the 24 h WhatsApp window, so later messages can carry buttons (OPEN-21).

### 0:30–0:55 · 10:15 · The brief arrives by itself
**Screen:** WhatsApp notification. The brief, max 6 bullets:
1. Why: routine visit, the grinder is still open.
2. Problem: grinder noise, due in 2 days. Fix it first.
3. Orders: usual 12 kg espresso.
4. **Push Espresso Nuovo**: forgiving on worn grinders, it fixes his shots.
5. **Avoid Frappé Instant**: off-brand for a specialty café.
6. How to talk: short, between peaks, one next step.
Buttons: **Call me**.
**VO:** "Thirty minutes before every visit, Merc tells him what matters. What to push, what to avoid, and why, in the company's own values."
**System (overlay, 3 short labels):**
- Cron `previsit-briefs-due` finds the 10:45 visit, creates one `visit_brief`.
- **Code** picks push/avoid from `product_guidance` + the open problem. The LLM only words it, using KB `merc-company`. It cannot add or swap a product.
- Every number comes from a table row (Rule A).

### 0:55–1:10 · "Call me" while driving
**Screen:** Nikos taps Call me, starts the car. Phone rings in seconds. Merc reads the brief, 45 s max (cut to ~10 s).
**VO:** "Driving? One tap and Merc calls him."
**System:** `buddy-call-start` → outbound call of the same `merc-buddy-pro`, tool `get_visit_brief`.

### 1:10–1:20 · The visit
**Screen:** b-roll, Nikos walks into the café, handshake with the owner, espresso machine. No phone out.
**VO:** "Then the meeting is his. Merc never records or listens to the customer."

### 1:20–1:50 · 11:25 · "How did it go?"
**Screen:** WhatsApp: "How did it go at Café Miltos?" Nikos calls back from the car and talks for ~30 s:
> "Miltos took 12 kilos of Nuovo, he liked it for the grinder. The grinder is still noisy, we're sending a technician on Thursday. Aroma offered him a better price, but he's not interested."
**Screen:** result card in the app fills line by line, each with ✓ and **Undo**: note, problem updated, task "technician Thursday", draft order 12 kg Nuovo, competitor signal Aroma.
**VO:** "Thirty seconds of talking becomes notes, a task, an order and a competitor signal. Every field is backed by his own words."
**System:**
- Cron `postvisit-prompts-due` prompts once (visit end + 10 min, no debrief yet).
- `debrief-process`: structured LLM extraction, each field carries an evidence quote that **code re-checks**.
- Autonomy engine: internal actions apply now with undo. Anything that leaves the company (emails) waits for approval.

### 1:50–2:15 · The summary and the Fix
**Screen:** within a minute, WhatsApp summary of the same lines. Buttons **Correct · Fix · Brief did not help**. Nikos taps **Fix** and says: "It was 10 kilos, not 12." The card updates: 12 kg line undone, 10 kg line logged.
**VO:** "People misspeak. So Merc always asks him to confirm. One tap, one sentence, fixed."
**System:**
- `debrief-confirm-send` builds the summary **in code** from the result card (no LLM).
- `ai-action-undo` on the wrong line, a corrected debrief linked to the original.
- `feedback-record` writes one `rep_feedback` row.

### 2:15–2:35 · The loop closes: Merc learns
**Screen:** split screen.
- Left: the correction becoming an eval case file in `evals/debrief/field/`.
- Right: next brief for Miltos. If Nikos had tapped "Brief did not help", Nuovo is not pushed again for 30 days and the next brief pushes **Hot Chocolate**.
**VO:** "Every correction becomes a test case, and every 'didn't help' changes the next brief. In code, not in a prompt. And Eleni, his manager, sees a CRM that is full and true, without chasing anyone."

### 2:35–3:00 · How it's built + close
**Screen:** fast montage: `spec/SPEC.md` scrolling, contracts index, PROGRESS.md board turning green, Wonderful platform pieces as logos/labels.
**VO:** "Merc runs entirely on Wonderful: voice agents, WhatsApp, Functions, Tables, Context Hub, Apps. We built it spec-first with coding agents in one weekend. A hundred-plus requirements, each with a check."
**End card:** *Merc · the CRM that fills itself. Team Delta.*

## Who does what in the system (one table for the judges)

| Moment | Trigger | Wonderful piece | What runs | What gets written |
|---|---|---|---|---|
| 07:50 "What's my day?" | Nikos | Agent `merc-buddy-pro`, WhatsApp channel | today/briefing tools | nothing new |
| 10:15 brief | Cron every 5 min | Function `previsit-briefs-due` | `visit-brief-get`: code picks products, LLM words them with KB `merc-company` | `visit_brief` |
| Call me | Nikos taps | Outbound call, `merc-buddy-pro` | tool `get_visit_brief` | call log |
| 11:25 prompt | Cron | Function `postvisit-prompts-due` | one prompt per visit | prompt sent |
| Debrief | Nikos calls back | `merc-buddy-pro` → `debrief-process` | LLM extraction + evidence check + autonomy engine | note, problem, task, draft order, competitor signal, `ai_action` (undoable) |
| Summary | Debrief done | Function `debrief-confirm-send` | bullets built in code | `debrief_confirmation` |
| Fix | Nikos taps + speaks | `merc-buddy-pro`, `ai-action-undo`, `feedback-record` | undo + corrected debrief | `rep_feedback`, eval case |
| Next brief | Next visit | same as 10:15 | feedback rules in code | different push product |

## Recording plan

**Record live, not mocked, wherever it works. Fake nothing that the README claims.**

1. Reset dev with the Miltos visit ~31 min ahead (WP-DEMO-01 owns `infra/demo`, not built yet: `reset-demo --next-visit-in 31`). If not ready, record the brief by running the cron by hand right after reseed.
2. Screen-record the real phone (WhatsApp + calls) and the app's Record/result-card screen.
3. Film the car, café and handshake as b-roll on a phone. Any café works; don't film a real owner's face without consent.
4. Use time cards ("10:15", "11:25") instead of waiting real time.
5. Record VO last, timed to the cut. Keep each beat within its slot; total under 3:00.

**Fallbacks, in order:** live WhatsApp → app screens if WhatsApp buttons are not live (REQ-MTG-009 falls back to the app) → recorded eval run output for the "learns" beat.

## Open risks before recording

- WhatsApp interactive buttons depend on OPEN-21 (templates or open 24 h window). The 07:50 message is there to open the window.
- Live phone audio for the buddy is still a human step (WP-SPK-01).
- WP-MTG-02, WP-BUD-03 and WP-E2E-05 are still building. Check their status before filming each beat.
- Pick who plays Nikos and who records the VO (both in English).
