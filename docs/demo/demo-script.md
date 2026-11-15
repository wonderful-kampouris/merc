# J5 live demo: 3 minutes (WP-DEMO-01)

One rep, one café, one loop: the brief before the visit, "Call me", the spoken debrief, the summary with Fix, and "Brief did not help" changing the next brief. Every name and number on screen is seed data (`spec/contracts/seed`). The story and voice-over follow [`docs/pitch/STORY.md`](../pitch/STORY.md).

**Cast.** *Presenter* talks. *Nikos* (a team member) holds the phone; it is mirrored to the screen. *Operator* runs the laptop: the Rep App on screen, and the terminal off screen.

## T-15 to T-0: set up

| When | Who | Do | Check |
|---|---|---|---|
| T-15 | Operator | `infra/demo/reset-demo.sh --env demo --dry-run` | `summary ok`, 0 failures |
| T-12 | Operator | Open the Rep App as Nikos (Today: Café Miltos first). Open the result-card view. Mirror the phone. | Phone on Do Not Disturb, except WhatsApp and the Merc number |
| T-7 to T-5 | Operator | `infra/demo/reset-demo.sh --env demo --next-visit-in 30 --live-phone-ok` | Note the printed `sent by the cron tick at HH:MM`. **That tick is 0:25 in the script.** Start the pitch about 25 s before it. |
| T-1 | Nikos | Send "Morning! What's my day?" to Merc on WhatsApp | Opens the 24 h window, so the later messages can carry buttons |

If the tick will not line up, start anyway. When the brief arrives early, it is already in the WhatsApp thread at 0:25.

## The 3 minutes

| Time | Beat | On screen | Presenter says (short) | Fallback if late (> 10 s) |
|---|---|---|---|---|
| 0:00–0:20 | Hook | Title slide | "Field reps sell all day and type all evening, or never. Merc is the CRM that fills itself." | — |
| 0:20–0:45 | **Brief arrives** | Phone: WhatsApp brief, 6 or fewer bullets: grinder still open, usual 12 kg, **push Espresso Nuovo**, **avoid Frappé Instant**, button **Call me** | "30 minutes before every visit, Merc tells him what matters and why, in the company's own values. Code picks the products; the LLM only words them." | Video clip 1 (brief) |
| 0:45–1:10 | **Call me** | Nikos taps Call me. The phone rings in under 30 s, and Merc reads the brief (45 s or less; hang up after about 15 s). | "Driving? One tap and Merc calls him." | Video clip 2 (call) |
| 1:10–1:20 | The visit | Slide: "Merc never listens to the customer" | "The meeting is his. An hour later…" | — |
| 1:20–1:50 | **Debrief** | Nikos talks for about 25 s (Call me on the "How did it go at Café Miltos?" prompt if it is there, otherwise the app's voice button): *"Miltos took the usual 12 kilos of Espresso Classico. The grinder is still noisy, we send a technician Thursday. Aroma offered him a better price, he's not interested."* The result card fills: note, visit done, grinder in progress, task Thursday, draft order 12 kg Classico. | "Thirty seconds of talking becomes notes, a task, an order and a competitor signal, each backed by his own words." | Video clip 3 (debrief and card) |
| 1:50–2:15 | **Summary and Fix** | WhatsApp summary within 60 s, with the same lines as the card and the buttons Correct, Fix and Brief did not help. Nikos taps **Fix** and says *"It was 10 kilos, not 12."* The card shows the 12 kg line undone and 10 kg logged. | "People misspeak, so Merc always asks. One tap, one sentence, fixed." | No WhatsApp: the confirmation is in the app (degraded path). Or video clip 4. |
| 2:15–2:35 | **Merc learns** | Nikos taps **Brief did not help**. Cut to next week's Miltos brief: **push Hot Chocolate** instead of Nuovo. | "His feedback is data. Next week's brief changes, and the same feedback becomes an eval case." | Video clip 5 (next brief), always pre-recorded |
| 2:35–3:00 | Close | Architecture slide: Wonderful agents, Functions, Tables, crons, KB | "All of it on Wonderful: one agent, phone and WhatsApp, every number from a table row. The rep talked for 30 seconds and typed nothing." | — |

Beat 2:15–2:35 is always the recorded clip: a real "next week" brief needs a second visit a week later. The J5 e2e (`tests/e2e/j5`) proves the switch to Hot Chocolate in process, and its control run without the feedback still pushes Nuovo.

## After the demo (and between rehearsals)

```
infra/demo/reset-demo.sh --env demo --dry-run   # what the run left behind (J5 rows around Café Miltos)
infra/demo/reset-demo.sh --env demo             # deletes those rows, re-converges the seed (< 1 min)
```

The `brief_not_useful` row must go, or the next Miltos brief skips Nuovo for 30 days. The reset deletes it.

## What can go wrong

| Symptom | Likely cause | Do |
|---|---|---|
| No brief by the printed tick + 1 min | Cron disabled, or `visit_brief` already sent | `W tables row-list merc.visit_brief --json`, then reset and shift again. Meanwhile play clip 1. |
| Brief row `failed / whatsapp_not_configured` | `MERC_WHATSAPP_CONNECTION` missing | Show the brief in the app (Today → Café Miltos), and play clip 1 |
| "Call me" `failed / no_service_account` | Service account not pinned | Clip 2 |
| Card does not fill in 25 s | Debrief latency (p95 budget is 20 s) | Keep talking over it. Clip 3 is the backup. |
| Unexpected "How did it go?" messages | The seed's past visits of today are still planned, so the post-visit cron prompts each one once | Load the demo day in the morning, and always reset Miltos with `--next-visit-in` |
