# Phone and WhatsApp for merc-buddy

Merc's buddy is one agent with four ways in and out (REQ-BUD-012..016):

| Channel | Direction | How | Rep identity |
|---|---|---|---|
| Browser voice | rep -> buddy | Chat SDK in the Rep App | Signed token from `fn:merc-chat-token` |
| Phone | rep -> buddy | Rep calls `MERC_BUDDY_NUMBER` (Wonderful SIP customer number on a Twilio trunk), routed to merc-buddy | `communication.fromNumber` = `app_user.phone` |
| Phone | buddy -> rep | `fn:buddy-call-start` -> `POST /v1/agents/outbound {from: MERC_BUDDY_NUMBER, to: rep phone}` | `communication.toNumber` = `app_user.phone` |
| WhatsApp | both | Merc WhatsApp number assigned to merc-buddy; buddy pings with template `merc_buddy_ping` | `communication.fromNumber` = `app_user.phone` |

Identity code: `shared/core/src/me.ts` (`channelNumberFromTool`, `normalizePhone`). An unknown number, or one that matches two users, gets no data.

The same customer number is also the caller id for merc-approver (the manager call in J3). One number, one trunk, both agents.

## A. Telephony (Twilio <-> Wonderful SIP)

**Live values (set up 2026-11-15):**

| Item | Value | Status |
|---|---|---|
| DID / customer number | `+18455133803` | Added in Wonderful, routed to **Merc Buddy** (dev workspace) |
| Wonderful IP ACL | `merc-twilio-signaling` (8 Twilio regional /30 signalling ranges) | Done |
| Wonderful inbound domain | `delta` -> `delta-default.sip.greece-hackathon.sb.wonderful.ai` (TLS, SRTP required) | Done |
| Wonderful outbound trunk | `delta-hackathon` -> `delta-hackathon.pstn.twilio.com:5061;transport=tls`, caller id +18455133803, SRTP | Done (Twilio termination URI must match) |
| Global variable | `MERC_BUDDY_NUMBER = "+18455133803"` | Done |
| Twilio Elastic SIP trunk | Subaccount `greek (api.sb.wonderful.ai)`, trunk `team-delta` (TKa6fe0fcc…). Secure Trunking on (TLS 5061 + SRTP); origination `sip:delta-default.sip.greece-hackathon.sb.wonderful.ai:5061;transport=tls` (prio 10, weight 10); DID +18455133803 attached; termination `delta-hackathon.pstn.twilio.com` with IP ACL `delta-wonderful-outbound` = 3.125.129.30/32 | Done. **Outbound verified 2026-11-15 10:46 UTC**: call 9ed4dbc0 from +18455133803 to a Greek mobile (+30 69…) rang, Merc Buddy answered in Greek ("Γεια σου, εδώ Merc. Τι κάνουμε;"), ended by callee after 11 s. Greece is allowed for outbound. Inbound not yet test-called |

Telephony config is tenant-wide and shared with the other teams (alpha, gamma, omega). Only touch `merc-*` / `delta*` entries.

Source: Aris's runbook in Slack #hackathon-gr-nov26. Values below are for Merc on the `hackathon` tenant, dev workspace `7b52cbc0-...`.

Wonderful network info (from `wful --profile hackathon telephony sip network-info`, read 2026-11-15):

| Direction | Traffic | Addresses |
|---|---|---|
| To Wonderful | Signaling | 3.68.243.203, 63.180.75.14 (TLS 5061) |
| To Wonderful | Media | 3.124.84.255, 18.196.243.255, 52.57.60.16, 52.57.195.2, 52.29.23.161, 54.93.157.132 (UDP 30000-40000) |
| From Wonderful | Signaling | **3.125.129.30** |
| From Wonderful | Media | same 6 media addresses |

### A1. Number
1. In Twilio, use a **separate subaccount** for Merc. Buy a DID (Greek if available, else any voice-capable number).
2. In Wonderful: Resources -> Telephony -> Wonderful SIP -> **Customer Numbers** -> add the DID in E.164.

### A2. Inbound (rep calls Merc)
1. Wonderful SIP -> **Inbound domains** -> create a public domain (e.g. `delta-merc.sip.greece-hackathon.sb.wonderful.ai`). Attach the customer number, an IP ACL with Twilio's signalling IPs, TLS signalling, SRTP.
2. Twilio -> Elastic SIP Trunking -> create trunk `merc`. Enable **Secure Trunking**.
3. Origination URI: `sip:<your-domain>:5061;transport=tls`.
4. **Attach the DID to the trunk** (Aris: "for inbound don't forget to attach number to the trunk").
5. In Wonderful, route the customer number to **merc-buddy**.

### A3. Outbound (buddy calls rep, approver calls manager)
1. On the same Twilio trunk -> Termination: set a Termination URI (e.g. `delta-merc.pstn.twilio.com`).
2. Termination -> IP Access Control List: add **3.125.129.30/32**, plus each media IP as /32 if Twilio asks. Never 255.255.255.255/1.
3. Wonderful SIP -> **SIP Trunk (Outbound)**: Customer SBC address `delta-merc.pstn.twilio.com:5061;transport=tls` (no `sip:` prefix). Enable SRTP. Leave TLS server name empty.
4. Add the same customer number under **Outbound Caller IDs**. Attach it to merc-buddy and merc-approver.
5. Set the global variable `MERC_BUDDY_NUMBER` to the DID (E.164) in the dev workspace.

### A4. Troubleshooting
| Symptom | Cause |
|---|---|
| "no outbound SIP trunk configured" | The From number is not an Outbound Caller ID on the trunk. |
| Twilio error 32201 | The source IP is not in the termination ACL. Add 3.125.129.30/32. |
| Inbound rings nothing | The DID is not attached to the Twilio trunk, or the customer number is not routed to merc-buddy. |
| Call connects, no audio | Media IPs or SRTP mismatch between the trunk and the domain. |

## B. WhatsApp

Per the Wonderful docs (manage/channels/whatsapp): Meta Embedded Signup links a WABA; each WhatsApp number is assigned to exactly one agent; outbound needs an approved template; free text only within 24 h of the rep's last message.

The team set WhatsApp up in FSM. Still needed (see HUMAN-STEPS):
1. Which tenant/workspace holds that WABA connection. It must be the tenant that runs merc-buddy; one WABA cannot serve two tenants.
2. Assign the number to **merc-buddy**. If the UI only allows chat agents, tell us and WP-BUD-03 adds a chat twin `merc-buddy-chat` with the same tools.
3. Create and approve the template **`merc_buddy_ping`** (category Utility) in `el` and `en`:
   - el: `Merc: {{1}}. Απάντησε εδώ ή κάλεσέ με.`
   - en: `Merc: {{1}}. Reply here or call me back.`
4. Set the global variable `MERC_WHATSAPP_CONNECTION` to the connection name.

## C. Test (team phones only)
1. Put each team member's mobile in `app_user.phone` (E.164) for their demo user. Re-run the seed loader.
2. Call `MERC_BUDDY_NUMBER` from Nikos's phone: the buddy should greet Nikos by name and read today's first stop.
3. Call from an unknown phone: "Merc doesn't know this number."
4. In the app or by voice: "call me in 2 minutes" -> the phone rings from `MERC_BUDDY_NUMBER`.
5. WhatsApp "τι έχω σήμερα;" to the Merc number -> today's stops.
