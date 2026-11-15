# Recorded fallback video plan (WP-DEMO-01)

Live telephony and WhatsApp can fail on stage. The fallback is a recording of the same J5 run, cut into five clips that line up with the beats in [`demo-script.md`](demo-script.md). The operator can switch to a clip at any beat and back to live at the next.

## When to record

During the rehearsal right after promotion ([`promotion-runbook.md`](promotion-runbook.md) step 8). Use the demo workspace, the real phone (with the owner's consent) and the seed after `reset-demo.sh --env demo --next-visit-in 30 --live-phone-ok`. Record one clean run, then reset. Record a second take only if a beat failed.

## Capture setup

| Source | Tool | Output |
|---|---|---|
| Phone screen (WhatsApp, incoming call) | iPhone: QuickTime → New Movie Recording → the phone as camera. Android: `scrcpy --record`. | `phone.mov` |
| Call audio | The phone on speaker plus a lapel mic, or the platform call recording (Activities → the call) | `call.wav` |
| Rep App (Today, result card) | QuickTime screen recording of the app window | `app.mov` |
| Clock | System clock visible in the menu bar for both | lets the clips be synced |

## Shot list (clip = beat)

| Clip | Beat | Must show | Target length |
|---|---|---|---|
| 1 | Brief arrives | WhatsApp notification, then the full brief: grinder, 12 kg, push Espresso Nuovo, avoid Frappé Instant, the Call me button. Clock at visit − 30 min. | 15 s |
| 2 | Call me | The tap, the phone ringing within 30 s, Merc reading the first two bullets | 20 s |
| 3 | Debrief | "How did it go at Café Miltos?", the tap, Nikos talking (about 25 s, cut to 15 s), the result card filling line by line | 25 s |
| 4 | Summary and Fix | The WhatsApp summary with the same lines as the card, Fix, "It was 10 kilos, not 12", the card with the 12 kg line undone and 10 kg logged | 20 s |
| 5 | Merc learns | "Brief did not help", then next week's Miltos brief pushing **Hot Chocolate** | 15 s |

Clip 5 needs a second Miltos brief after the feedback. Right after clip 5's "Brief did not help" tap, run
`infra/demo/reset-demo.sh --env demo --keep-feedback --next-visit-in 30 --live-phone-ok`. It clears the run's brief,
debrief and orders, keeps the `brief_not_useful` row (the brief rule reads feedback by account, 30 days), and re-plans
the visit. The next cron tick sends a new brief that pushes **Hot Chocolate**: record it. **Then run a full reset**
(without `--keep-feedback`), or the next Miltos brief skips Nuovo for 30 days.

## Edit and deliver

- Cut the clips to the target lengths. Add 3-word captions that match the presenter lines, and no music under call audio.
- Export each clip as 1080p H.264 (`clip1-brief.mp4` … `clip5-learns.mp4`), plus one joined `j5-full.mp4` (about 1:45) as the last-resort full fallback.
- Keep them on the presenting laptop, open in a player with the next clip queued, and keep a copy on a USB stick. Do not commit them to the repo; video files are too large and show a real phone number.
- Blur the phone number in the call screen before export. The real number must not appear in the video.

## Switching rule on stage

If a live beat is more than 10 s late, the operator plays that beat's clip and the presenter keeps talking. The next beat tries live again only if its precondition is still true (for example, the debrief needs the call to have worked). Otherwise stay on video until the end of the loop.
