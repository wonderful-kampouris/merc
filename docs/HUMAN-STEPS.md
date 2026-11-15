# Steps that need a person

## Submission (code freeze today 18:00)
0a. ✅ **Repo pushed** to https://github.com/wonderful-kampouris/merc (private). Re-publish any time with `scripts/publish.sh` (clean export, no nested .git/node_modules); run it one last time just before 18:00. **You:** make it public or add the organizers, per the submission rules: `gh repo edit wonderful-kampouris/merc --visibility public --accept-visibility-change-consequences`.
0b. **Record the demo video** (J1 + J3 + J4, under 3 minutes) and fill in the project details form.
0c. **Pitch**: 3 minutes; use `docs/demo/` once WP-DEMO-01 lands.

# From the Wave 0+1 run (2026-11-15)

Agents cannot do these unattended. Each one unblocks a requirement. Platform is the `hackathon` tenant, dev workspace `7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`.

## Blocks the demo (do first)
1. **Merc phone number +18455133803.** The Wonderful side is done: number, ACL `merc-twilio-signaling`, inbound domain `delta`, outbound trunk `delta-hackathon`, routing to Merc Buddy, and `MERC_BUDDY_NUMBER`. **Still needed:** sign in to the Twilio account that owns the DID so the Elastic SIP trunk can be created. The values are in `docs/guides/telephony-whatsapp.md` section A. Then make one test call to the number.
2. **Service account `merc-platform-api`** with `agents:edit` and `communications:edit` in the dev workspace. Needed to start calls and relay decisions (S7, S8).
3. **API key secret `MERC_CHAT_API_KEY`** with Chat/Create and Communications/View, plus secret `MERC_INTERNAL_CALL_KEY` (any random 32+ bytes). Needed for the buddy's rep identity (REQ-BUD-002).
4. **Test Gmail OAuth.** Connect a test Gmail on the per-user connection: `.../integrations/hub/connections/3e6f759e-4ad3-45a7-b362-21aa0ed09faf/connect`. Then run the S3 probe in `docs/spikes/S3-S4.md`. Needed for "yes, send it" (REQ-APR-002).
5. **Model profile `merc-transcribe`** (gemini-2.5-flash) created in the UI. The CLI returned HTTP 500.
6. **Demo users.** Invite nikos, eleni, thanasis, maria, giorgos and dimitra. Put their Wonderful user ids in `infra/seed/wuid.json` and re-run the seed loader. Grant app roles with `wful apps access-grant --app merc --user <email> --role rep|manager`.

## Twilio side for +18455133803 (owner of the number: you got it via the Greek sandbox / Wonderful SIP)
T1. ~~Twilio trunk setup~~ DONE 2026-11-15: subaccount greek, trunk team-delta, secure trunking, origination, DID attached, termination delta-hackathon + ACL delta-wonderful-outbound (3.125.129.30/32).
T2. Outbound to Greece works (test call 2026-11-15). Still to do: call +18455133803 from your phone to test inbound. Before setting global `MERC_CHANNELS_LIVE` = true, make sure every `app_user.phone` in the dev seed is a team member's real phone (P0 below), otherwise the callbacks cron may dial seed numbers.

## WhatsApp (you set it up in FSM). Please answer, then do the steps
W1. **Where is it?** Which tenant/workspace holds the WhatsApp connection (WABA), and what is the number? It has to be the `hackathon` tenant that runs merc-buddy; one WABA cannot be connected to two tenants. If it lives in another tenant (e.g. an FSM tenant), tell me and we pick: move it, or add a second number to a WABA connected here.
W2. **Assign the number to merc-buddy** (agent channel settings -> WhatsApp). If the UI refuses because merc-buddy is a voice agent, tell me. WP-BUD-03 then adds a chat twin `merc-buddy-chat` with the same tools.
W3. **Template `merc_buddy_ping`** (Utility, el + en, one variable). Texts are in the guide, section B.3. Meta approval can take 24-48 h, so submit it now. Without it the buddy can only reply inside the 24 h window after the rep writes first.
W3b. **Templates `merc_previsit_brief` and `merc_debrief_confirm`** (Utility, el + en) with quick-reply buttons: brief = Call me / Useful / Not useful; confirmation = Correct / Fix / Brief did not help (REQ-MTG-009). Submit now. For the demo, Nikos's phone sends Merc a WhatsApp message in the morning; that opens the 24 h window, so free-form interactive messages work even before approval.
W4. Set the global variable `MERC_WHATSAPP_CONNECTION` to the connection name.
W5. **Send me:** the number, the connection name, the template status, and whether a voice agent can hold the number.

## Phone checks
P0. Put each teammate's real mobile (E.164) on their demo user (`app_user.phone` in `infra/seed`, or tell me and I'll set it). Phone and WhatsApp identify the rep by this number only. Run the 5 checks in the guide, section C.
7. Open the spike App on iOS Safari and Android Chrome, sign in, start a voice call, talk in Greek and English (S2). Optionally re-enable captcha on the spike key to test Turnstile on a real device.
8. Open `.../apps/merc?mock=1` on a phone and screenshot Today, Record and Approvals (REQ-APP-002).
9. One real test call to a team phone with the S7 probe once steps 1 and 2 are done. Record one real 40 s Greek debrief and re-run the transcription probe.

## Nice to have
10. Request a GEMI Open Data api_key at opendata.businessportal.gr and store it as `DIRECTORY_API_KEY` (header `api_key`).
11. Run `npm login --auth-type=web --scope=@wonderful --registry=https://default.api.greece-hackathon.sb.wonderful.ai/api/npm/` so `@wonderful/chat` installs from npm.
12. Show "© OpenStreetMap contributors" and GEMI credit where prospect data appears.
13. Put the demo workspace id (Team Delta) in `infra/deploy/environments.json` when you are ready to promote.

## Open product questions
- Do reps sign in to Wonderful on their phones (SSO/MFA), or should the demo use the share link? (OPEN-17)
- Do the demo reps have Google Workspace accounts or personal Gmail? Workspace allows a service-account fallback for sending.
- Phone caller id can be spoofed. Is a number match OK for the demo (OPEN-20), or do you want a 4-digit PIN before external actions on inbound calls?
- Spike cleanup: the spike apps, agents and functions prefixed `merc-spike-` and `merc-deploy-smoke` can be deleted after the phone tests.
