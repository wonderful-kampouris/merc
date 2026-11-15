"""Deterministic demo seed (J1-J4). Dates are relative tokens resolved by the loader:
  "@D"        demo day (date)           "@D-12"  12 days before demo day
  "@D-3@09:30" datetime, local org time on that day
  "@wuid:<key>" Wonderful user id of the invited demo user <key>
"""
import random
import uuid

NS = uuid.UUID("6d1c3f0e-6a5b-4c1e-9e2a-7f3b2a1d0c99")
rnd = random.Random(42)


def uid(table, key):
    return str(uuid.uuid5(NS, f"{table}:{key}"))


def d(n):
    return "@D" if n == 0 else f"@D{n:+d}"


def dt(n, hhmm):
    return f"{d(n)}@{hhmm}"


ROWS = {}


def add(table, row):
    ROWS.setdefault(table, []).append(row)
    return row


# ---------------------------------------------------------------- lookups
for code, name in [("rep", "Sales rep"), ("manager", "Sales manager"), ("admin", "Admin / CEO")]:
    add("role", {"code": code, "name": name})
for i, (code, closed, won, p) in enumerate([("new", False, False, 0.1), ("qualified", False, False, 0.25),
                                             ("proposal", False, False, 0.5), ("negotiation", False, False, 0.7),
                                             ("won", True, True, 1.0), ("lost", True, False, 0.0)]):
    add("deal_stage", {"code": code, "name": code.title(), "sort_order": i + 1, "is_closed": closed, "is_won": won,
                       "probability": p})

ACTION_TYPES = [
    ("create_note", "internal", "auto"), ("create_task", "internal", "auto"), ("update_task", "internal", "auto"),
    ("create_problem", "internal", "auto"), ("update_problem", "internal", "auto"), ("create_deal", "internal", "auto"),
    ("update_deal", "internal", "auto"), ("create_competitor_signal", "internal", "auto"),
    ("update_account", "internal", "auto"), ("create_contact", "internal", "auto"), ("update_contact", "internal", "auto"),
    ("mark_visit_done", "internal", "auto"), ("log_campaign_pitch", "internal", "auto"),
    ("reschedule_visit", "internal", "auto"), ("add_candidate", "internal", "auto"),
    ("discount_within_limit", "internal", "auto"), ("mark_account_lost", "internal", "auto"),
    ("create_draft_order", "draft", "auto"),
    ("send_email", "external", "ask"), ("send_whatsapp", "external", "ask"), ("send_viber", "external", "ask"),
    ("book_meeting", "external", "ask"),
    ("convert_prospect", "structural", "ask"),
    ("delete_record", "destructive", "never"),
]
for code, cls, mode in ACTION_TYPES:
    add("action_type", {"code": code, "action_class": cls, "default_mode": mode, "description": code.replace("_", " ")})

ALERT_TYPES = [("going_quiet", "high", "Visit or call"), ("deal_stuck", "medium", "Follow-up email"),
               ("close_date_passed", "medium", "Update or close the deal"), ("promise_due", "high", "Reminder + draft"),
               ("competition_wave", "high", "Notify the manager"), ("visit_overdue", "medium", "Plan a visit"),
               ("rep_not_logging", "medium", "Check in with the rep"), ("approval_overdue", "high", "Decide the request")]
for code, sev, act in ALERT_TYPES:
    add("alert_type", {"code": code, "default_severity": sev, "suggested_action": act, "description": code.replace("_", " ")})
for code, name, prov in [("email", "Email", False), ("whatsapp", "WhatsApp", True), ("viber", "Viber", True),
                         ("call", "Phone call", False), ("meeting", "Meeting", False)]:
    add("channel", {"code": code, "name": name, "requires_provider_approval": prov})

POSTAL = {  # code: (city, region, lat, lng)
    "15231": ("Chalandri", "North", 38.0216, 23.7985), "15232": ("Chalandri", "North", 38.0251, 23.8034),
    "15233": ("Chalandri", "North", 38.0302, 23.8010), "15234": ("Chalandri", "North", 38.0190, 23.8102),
    "15124": ("Marousi", "North", 38.0500, 23.8070), "15125": ("Marousi", "North", 38.0440, 23.7960),
    "14561": ("Kifisia", "North", 38.0740, 23.8110), "10673": ("Kolonaki", "Center", 37.9780, 23.7440),
    "10674": ("Kolonaki", "Center", 37.9800, 23.7410), "12131": ("Peristeri", "Center", 38.0130, 23.6910),
    "17671": ("Kallithea", "South", 37.9550, 23.7020), "16674": ("Glyfada", "South", 37.8650, 23.7530),
    "18531": ("Piraeus", "South", 37.9420, 23.6470),
}
for code, (city, region, lat, lng) in POSTAL.items():
    add("postal_area", {"postal_code": code, "city": city, "region": region, "country_code": "GR", "lat": lat, "lng": lng})

# ---------------------------------------------------------------- organization & people
ORG = uid("organization", "delta-foods")
add("organization", {"id": ORG, "name": "Delta Foods & Coffee (demo)", "default_language": "el", "timezone": "Europe/Athens",
                     "currency": "EUR", "plan": "pilot", "briefing_time": "07:45", "approval_expiry_hours": 48,
                     "approval_sla_minutes": 60, "manager_call_enabled": True, "recording_retention_days": 30,
                     "icp_min_score": 60, "visits_per_day": 6, "lost_after_multiplier": 3, "baseline_start": d(-120),
                     "go_live_date": d(-30), "previsit_lead_minutes": 30, "postvisit_prompt_minutes": 10})

USERS = {  # key: (name, role, manager, phone)
    "thanasis": ("Thanasis Kyriakou", "admin", None, "+306900000001"),
    "eleni": ("Eleni Markou", "manager", "thanasis", "+306900000002"),
    "nikos": ("Nikos Alexiou", "rep", "eleni", "+306900000003"),
    "dimitra": ("Dimitra Pappa", "rep", "eleni", "+306900000004"),
    "maria": ("Maria Ioannou", "rep", "eleni", "+306900000005"),
    "giorgos": ("Giorgos Lazarou", "rep", "eleni", "+306900000006"),
}
U = {k: uid("app_user", k) for k in USERS}
for k, (name, role, mgr, phone) in USERS.items():
    add("app_user", {"id": U[k], "org_id": ORG, "wonderful_user_id": f"@wuid:{k}", "role_code": role,
                     "manager_id": U[mgr] if mgr else None, "full_name": name, "email": f"{k}@merc-demo.example",
                     "phone": phone, "preferred_language": "el", "voice_enabled": True, "status": "active"})

TERR = {"north": ("North", "nikos", ["15231", "15232", "15233", "15234", "15124", "15125", "14561"], ["nikos", "dimitra"]),
        "center": ("Center", "maria", ["10673", "10674", "12131"], ["maria"]),
        "south": ("South", "giorgos", ["17671", "16674", "18531"], ["giorgos"])}
T = {k: uid("territory", k) for k in TERR}
for k, (name, default_rep, codes, reps) in TERR.items():
    add("territory", {"id": T[k], "org_id": ORG, "manager_id": U["eleni"], "default_rep_id": U[default_rep], "name": name})
    for r in reps:
        add("territory_rep", {"id": uid("territory_rep", f"{k}:{r}"), "territory_id": T[k], "user_id": U[r]})
    for c in codes:
        add("territory_postal_code", {"id": uid("territory_postal_code", c), "territory_id": T[k], "postal_code": c})

CATS = {"cafe": ("Café", 7), "bakery": ("Bakery", 10), "mini_market": ("Mini market", 14), "restaurant": ("Restaurant", 10),
        "hotel": ("Hotel", 21)}
C = {k: uid("account_category", k) for k in CATS}
for k, (name, freq) in CATS.items():
    add("account_category", {"id": C[k], "org_id": ORG, "name": name, "default_visit_frequency_days": freq})

for role in ["rep", "manager", "admin"]:
    for code, cls, mode in ACTION_TYPES:
        add("ai_permission", {"id": uid("ai_permission", f"{role}:{code}"), "org_id": ORG, "role_code": role,
                              "action_type_code": code, "mode": mode})
RULES = {"going_quiet": (1.5, None), "deal_stuck": (14, None), "close_date_passed": (0, None), "promise_due": (1, None),
         "competition_wave": (3, 7), "visit_overdue": (1.0, None), "rep_not_logging": (2, None), "approval_overdue": (0, None)}
for code, (thr, win) in RULES.items():
    add("alert_rule", {"id": uid("alert_rule", code), "org_id": ORG, "alert_type_code": code, "threshold_value": thr,
                       "window_days": win, "enabled": True})
for crit, w in [("category_fit", 3), ("near_route", 2), ("size_activity", 2), ("replaceable_brands", 2), ("reviews_traffic", 1)]:
    add("icp_criterion", {"id": uid("icp_criterion", crit), "org_id": ORG, "criterion": crit, "weight": w})
for k in ["cafe", "bakery"]:
    add("icp_category", {"id": uid("icp_category", k), "org_id": ORG, "category_id": C[k]})

# ---------------------------------------------------------------- products & competitors
PCATS = {"coffee": "Coffee", "bakery_supplies": "Bakery supplies", "beverages": "Beverages", "consumables": "Consumables"}
PC = {k: uid("product_category", k) for k in PCATS}
for k, n in PCATS.items():
    add("product_category", {"id": PC[k], "org_id": ORG, "name": n})
PRODUCTS = [  # sku, name, cat, unit, price_cents
    ("ESP-CL-1", "Espresso Classico 1kg", "coffee", "kg", 1890), ("ESP-NEW-1", "Espresso Nuovo Blend 1kg", "coffee", "kg", 2150),
    ("ESP-DEC-1", "Espresso Decaf 1kg", "coffee", "kg", 2240), ("FIL-1", "Filter Coffee 1kg", "coffee", "kg", 1490),
    ("GRK-500", "Greek Coffee 500g", "coffee", "pack", 690), ("FRP-1", "Frappé Instant 1kg", "coffee", "kg", 1590),
    ("CHO-1", "Hot Chocolate 1kg", "beverages", "kg", 1290), ("TEA-50", "Tea Selection 50pcs", "beverages", "box", 790),
    ("SYR-VAN", "Vanilla Syrup 1L", "beverages", "litre", 890), ("SYR-CAR", "Caramel Syrup 1L", "beverages", "litre", 890),
    ("MLK-PLT", "Plant Milk Barista 1L", "beverages", "litre", 320), ("FLR-25", "Bread Flour 25kg", "bakery_supplies", "kg", 2450),
    ("YST-500", "Dry Yeast 500g", "bakery_supplies", "pack", 410), ("BTR-2", "Pastry Butter 2kg", "bakery_supplies", "kg", 1680),
    ("SES-1", "Sesame 1kg", "bakery_supplies", "kg", 540), ("CUP-8", "Paper Cups 8oz x1000", "consumables", "box", 3900),
    ("CUP-12", "Paper Cups 12oz x1000", "consumables", "box", 4600), ("LID-1000", "Lids x1000", "consumables", "box", 1900),
    ("SUG-ST", "Sugar Sticks x1000", "consumables", "box", 1250), ("NAP-1", "Napkins x2000", "consumables", "box", 1100),
]
P = {}
for sku, name, cat, unit, price in PRODUCTS:
    P[sku] = uid("product", sku)
    add("product", {"id": P[sku], "org_id": ORG, "category_id": PC[cat], "sku": sku, "name": name, "unit": unit,
                    "list_price_minor": price, "active": True})
COMP = {"aroma": "Aroma Delta", "bluebean": "BlueBean Roasters", "kafea": "Kafea Plus"}
CP = {k: uid("competitor", k) for k in COMP}
for k, n in COMP.items():
    add("competitor", {"id": CP[k], "org_id": ORG, "name": n})

# ---------------------------------------------------------------- accounts
def vat(i):
    return f"{800000000 + i * 7919:09d}"


ACCOUNTS = [  # key, name, type, cat, postal, owner, territory
    ("miltos", "Café Miltos", "customer", "cafe", "15231", "nikos", "north"),
    ("lofos", "Bistro Lofos", "customer", "cafe", "15124", "nikos", "north"),
    ("avra", "Café Avra", "prospect", "cafe", "15232", "nikos", "north"),
    ("elena_mm", "Mini Market Elena", "customer", "mini_market", "15233", "nikos", "north"),
    ("gonia", "Fournos Gonia", "prospect", "bakery", "15234", "nikos", "north"),
    ("artos", "Artos Chalandriou", "customer", "bakery", "15231", "nikos", "north"),
    ("zymi", "Zymi Bakery", "customer", "bakery", "15232", "nikos", "north"),
    ("pita", "Pita & Psomi", "customer", "bakery", "15233", "dimitra", "north"),
    ("stavros", "Fournos Stavrou", "customer", "bakery", "15234", "dimitra", "north"),
    ("glykia", "Glykia Gonia Bakery", "customer", "bakery", "15231", "nikos", "north"),
    ("kifisia_h", "Kifisia Garden Hotel", "customer", "hotel", "14561", "dimitra", "north"),
    ("plateia", "Café Plateia", "customer", "cafe", "15125", "nikos", "north"),
    ("dasos", "Dasos Coffee", "customer", "cafe", "14561", "dimitra", "north"),
    ("sofia_mm", "Mini Market Sofia", "customer", "mini_market", "15124", "nikos", "north"),
    ("lithos", "Lithos Taverna", "customer", "restaurant", "15125", "dimitra", "north"),
    ("aera", "Aera Café", "customer", "cafe", "15233", "nikos", "north"),
    ("ploumi", "Ploumi Brunch", "customer", "cafe", "15232", "dimitra", "north"),
    ("old_mill", "Old Mill Café", "lost", "cafe", "15124", "nikos", "north"),
    ("kolonaki_c", "Kolonaki Corner", "customer", "cafe", "10673", "maria", "center"),
    ("filos", "Filos Espresso Bar", "customer", "cafe", "10674", "maria", "center"),
    ("nefeli", "Nefeli Patisserie", "customer", "bakery", "10673", "maria", "center"),
    ("peri_mm", "Peristeri Market", "customer", "mini_market", "12131", "maria", "center"),
    ("astro", "Astro Bistro", "customer", "restaurant", "10674", "maria", "center"),
    ("ena", "Ena Coffee Lab", "customer", "cafe", "12131", "maria", "center"),
    ("hotel_lyk", "Lycabettus View Hotel", "customer", "hotel", "10673", "maria", "center"),
    ("thea", "Thea Café", "customer", "cafe", "10674", "maria", "center"),
    ("sporos", "Sporos Bakery", "customer", "bakery", "12131", "maria", "center"),
    ("piatsa", "Piatsa Restaurant", "customer", "restaurant", "10673", "maria", "center"),
    ("galazio", "Galazio Café", "customer", "cafe", "16674", "giorgos", "south"),
    ("limani", "Limani Taverna", "customer", "restaurant", "18531", "giorgos", "south"),
    ("kalli_mm", "Kallithea Mini Market", "customer", "mini_market", "17671", "giorgos", "south"),
    ("ammos", "Ammos Beach Bar", "customer", "cafe", "16674", "giorgos", "south"),
    ("bakery_p", "Piraeus Bakers", "customer", "bakery", "18531", "giorgos", "south"),
    ("glyfada_h", "Glyfada Bay Hotel", "customer", "hotel", "16674", "giorgos", "south"),
    ("kima", "Kima Coffee", "customer", "cafe", "17671", "giorgos", "south"),
    ("marina", "Marina Bistro", "customer", "restaurant", "18531", "giorgos", "south"),
    ("ftero", "Ftero Café", "customer", "cafe", "17671", "giorgos", "south"),
    ("vrachos", "Vrachos Bakery", "customer", "bakery", "16674", "giorgos", "south"),
    ("nisi", "Nisi Café", "prospect", "cafe", "15125", "nikos", "north"),
    ("anemos", "Anemos Deli", "prospect", "mini_market", "10674", "maria", "center"),
]
A = {}
ACC = {}
for i, (k, name, typ, cat, pc, owner, terr) in enumerate(ACCOUNTS):
    A[k] = uid("account", k)
    city, _, lat, lng = POSTAL[pc]
    row = add("account", {"id": A[k], "org_id": ORG, "name": name, "account_type": typ, "category_id": C[cat],
                          "vat_number": vat(i), "street": f"Odos {name.split()[0]} {10 + i}", "postal_code": pc,
                          "lat": round(lat + rnd.uniform(-0.004, 0.004), 6), "lng": round(lng + rnd.uniform(-0.004, 0.004), 6),
                          "phone": f"+30210{6000000 + i * 137:07d}", "email": f"info@{k.replace('_', '')}.example.gr",
                          "website": f"https://{k.replace('_', '')}.example.gr", "territory_id": T[terr],
                          "owner_rep_id": U[owner], "source": "import" if typ != "prospect" else "prospecting",
                          "customer_since": d(-400 + i) if typ != "prospect" else None,
                          "visit_frequency_days": None, "external_ref": f"ERP-{1000 + i}"})
    ACC[k] = (row, cat, typ, owner)
ACC["avra"][0]["website"] = "https://cafeavra.example.gr"

CONTACTS = {"miltos": [("Miltos Papadakis", "Owner", True)], "lofos": [("Katerina Lofou", "Owner", True), ("Petros Lofos", "Chef", False)],
            "avra": [("Yannis Avramidis", "Owner", True)], "elena_mm": [("Elena Georgiou", "Owner", True)],
            "gonia": [("Kostas Gonias", "Owner", True)]}
for k, (row, cat, typ, owner) in ACC.items():
    people = CONTACTS.get(k, [(f"{row['name'].split()[0]} Owner", "Owner", True)])
    for j, (n, role, dm) in enumerate(people):
        add("contact", {"id": uid("contact", f"{k}:{j}"), "account_id": A[k], "full_name": n, "role_title": role,
                        "phone": f"+30690{1000000 + len(ROWS.get('contact', [])) * 13:07d}",
                        "email": f"{n.split()[0].lower()}@{k.replace('_', '')}.example.gr", "is_decision_maker": dm,
                        "preferred_channel": "email"})

# ---------------------------------------------------------------- order history (6 months) + past visits
QUIET_NORTH = {"lofos": 12, "plateia": 19, "sofia_mm": 30, "aera": 14, "ploumi": 15, "dasos": 16, "lithos": 22}
BASKET = {"cafe": ["ESP-CL-1", "CUP-8", "SUG-ST", "SYR-VAN", "MLK-PLT"], "bakery": ["FLR-25", "YST-500", "BTR-2", "SES-1", "CUP-8"],
          "mini_market": ["GRK-500", "FRP-1", "TEA-50", "FIL-1"], "restaurant": ["ESP-CL-1", "NAP-1", "GRK-500", "CHO-1"],
          "hotel": ["ESP-CL-1", "TEA-50", "FIL-1", "CUP-12", "LID-1000"]}
PRICE = {sku: price for sku, _, _, _, price in PRODUCTS}
o_count = 0
for k, (row, cat, typ, owner) in ACC.items():
    if typ == "prospect":
        continue
    freq = CATS[cat][1]
    last = -QUIET_NORTH.get(k, rnd.randint(1, max(1, freq - 1)))
    if k == "miltos":
        last = -6
    if typ == "lost":
        last = -95
    day = last
    while day >= -180:
        o_count += 1
        oid = uid("sales_order", f"{k}:{day}")
        add("sales_order", {"id": oid, "account_id": A[k], "rep_id": U[owner], "status": "confirmed", "source": "erp",
                            "order_date": d(day), "external_ref": f"SO-{o_count:05d}"})
        for ln, sku in enumerate(rnd.sample(BASKET[cat], 2 if cat != "hotel" else 3)):
            qty = 12 if (k == "miltos" and sku == "ESP-CL-1") else rnd.choice([2, 3, 4, 5, 6, 8, 10])
            add("order_line", {"id": uid("order_line", f"{oid}:{ln}"), "order_id": oid, "line_no": ln + 1,
                               "product_id": P[sku], "quantity": qty, "unit_price_minor": PRICE[sku], "discount_pct": 0})
        day -= freq + rnd.randint(-1, 2)
    vday = last - 1
    while vday >= -120:
        add("visit", {"id": uid("visit", f"{k}:{vday}"), "account_id": A[k], "rep_id": U[owner], "origin": "manual",
                      "planned_date": d(vday), "status": "done", "purpose": "routine",
                      "completed_at": dt(vday, "11:00")})
        vday -= freq + rnd.randint(0, 3)

# ---------------------------------------------------------------- demo day plan for Nikos (J1)
PLAN = uid("visit_plan", "nikos:current")
add("visit_plan", {"id": PLAN, "rep_id": U["nikos"], "week_start": "@WEEK_START", "status": "accepted", "accepted_at": dt(-1, "18:30")})
# planned_start_at drives the meeting loop (REQ-MTG-001/005); infra/demo shifts Miltos to "now + 31 min" for a live run.
for pos, (k, purpose, start) in enumerate([("miltos", "Open issue: grinder noise; espresso deal", "10:45"),
                                            ("avra", "First visit, prospect pitch ready", "11:45"),
                                            ("lofos", "Hasn't ordered in 12 days; offer expires tomorrow", "15:00"),
                                            ("elena_mm", "Routine", "16:00"), ("gonia", "New prospect bakery", "17:00")]):
    add("visit", {"id": uid("visit", f"demo:{k}"), "account_id": A[k], "rep_id": U["nikos"], "plan_id": PLAN, "origin": "plan",
                  "planned_date": d(0), "route_position": pos + 1, "status": "planned", "purpose": purpose,
                  "planned_start_at": dt(0, start), "planned_duration_min": 30})

# ---------------------------------------------------------------- company guidance: what to push or avoid (REQ-MTG-003)
for key, sku, cat, stance, reason, prio, until in [
    ("nuovo_cafe", "ESP-NEW-1", "cafe", "push", "Product of the month; forgiving on worn grinders, so it fixes shots at busy cafés", 30, None),
    ("plantmilk_cafe", "MLK-PLT", "cafe", "push", "Plant milk demand is rising at cafés; pairs with the espresso order", 20, None),
    ("syrup_cafe", "SYR-VAN", "cafe", "push", "Easy add-on for cafés already buying our espresso", 10, None),
    ("chocolate_cafe", "CHO-1", "cafe", "push", "Winter seller at cafés from November; a new line with no new equipment", 15, None),
    ("decaf_all", "ESP-DEC-1", None, "avoid", "Out of stock until next week; do not promise a delivery date", 15, 6),
    ("frappe_cafe", "FRP-1", "cafe", "avoid", "Specialty cafés see instant frappé as off-brand; it undercuts our premium espresso story", 20, None),
    ("flour_bakery", "FLR-25", "bakery", "push", "Core bakery staple; win the flour and the rest of the order follows", 30, None),
    ("cups_bakery", "CUP-12", "bakery", "avoid", "Low margin for bakeries; offer it only if they ask", 10, None),
]:
    add("product_guidance", {"id": uid("product_guidance", key), "org_id": ORG, "product_id": P[sku], "category_id": C[cat] if cat else None,
                             "stance": stance, "reason": reason, "priority": prio, "valid_from": d(-30),
                             "valid_to": d(until) if until else None, "active": True})
for off, k in [(1, "artos"), (1, "zymi"), (2, "plateia"), (2, "aera"), (3, "glykia")]:
    add("visit", {"id": uid("visit", f"week:{k}"), "account_id": A[k], "rep_id": U["nikos"], "plan_id": PLAN, "origin": "plan",
                  "planned_date": d(off), "status": "planned", "purpose": "Routine"})

# ---------------------------------------------------------------- deals, problems, tasks, signals
DEALS = [("miltos", "Espresso 20kg monthly", "negotiation", 380000, 7, -2), ("lofos", "Q4 coffee offer", "proposal", 240000, 1, -9),
         ("avra", "Opening order", "qualified", 150000, 14, -3), ("plateia", "Syrups line", "proposal", 90000, -5, -12),
         ("aera", "Barista milk switch", "negotiation", 60000, 10, -20), ("kolonaki_c", "Espresso Nuovo trial", "proposal", 120000, 6, -2),
         ("galazio", "Summer season", "won", 310000, -40, -40), ("limani", "Coffee upgrade", "lost", 80000, -30, -30),
         ("artos", "Flour contract", "negotiation", 520000, 12, -4), ("kifisia_h", "Breakfast coffee", "qualified", 700000, 30, -6),
         ("filos", "Cups annual", "proposal", 180000, 9, -1), ("nefeli", "Butter supply", "new", 140000, 20, -2),
         ("ena", "Decaf line", "qualified", 50000, 15, -16), ("kima", "New espresso", "proposal", 110000, 8, -3),
         ("gonia", "First order", "new", 90000, 21, -1)]
for k, title, stage, amount, close, last_act in DEALS:
    add("deal", {"id": uid("deal", k), "account_id": A[k], "owner_id": U[ACC[k][3]], "stage_code": stage, "title": title,
                 "amount_minor": amount, "expected_close_date": d(close), "next_step": None,
                 "last_activity_at": dt(last_act, "12:00"), "closed_at": dt(close, "12:00") if stage in ("won", "lost") else None})
add("problem", {"id": uid("problem", "miltos:grinder"), "account_id": A["miltos"], "description": "Grinder is making noise",
                "status": "open", "due_date": d(2)})
add("problem", {"id": uid("problem", "artos:delivery"), "account_id": A["artos"], "description": "Late delivery last week",
                "status": "in_progress", "due_date": d(1)})
add("task", {"id": uid("task", "lofos:offer"), "account_id": A["lofos"], "owner_id": U["nikos"], "deal_id": uid("deal", "lofos"),
             "title": "Bistro Lofos offer expires - follow up", "is_customer_promise": True, "due_at": dt(1, "12:00"),
             "status": "open", "source": "human"})
add("task", {"id": uid("task", "artos:call"), "account_id": A["artos"], "owner_id": U["nikos"], "title": "Call about delivery",
             "is_customer_promise": False, "due_at": dt(0, "16:00"), "status": "open", "source": "human"})
for k, comp, days, delta in [("plateia", "aroma", -3, -15), ("aera", "aroma", -5, -20), ("dasos", "aroma", -2, -12), ("kolonaki_c", "bluebean", -8, -10)]:
    add("competitor_signal", {"id": uid("competitor_signal", f"{k}:{days}"), "account_id": A[k], "competitor_id": CP[comp],
                              "reported_by": U[ACC[k][3]], "statement": f"{COMP[comp]} offered {abs(delta)}% lower",
                              "price_delta_pct": delta, "observed_at": dt(days, "10:00")})

# ---------------------------------------------------------------- prospect dossier (Café Avra)
DOS = uid("dossier", "avra")
add("dossier", {"id": DOS, "account_id": A["avra"], "summary": "Specialty café, opened 8 months ago, brunch menu, ~60 seats.",
                "price_level": "mid", "researched_at": dt(-2, "09:00")})
for j, (ft, val, comp) in enumerate([("product", "Freddo espresso, cappuccino, filter V60", None), ("brand", "BlueBean Roasters espresso", "bluebean"),
                                     ("price", "Espresso 2.20 EUR, freddo 3.40 EUR", None), ("opening_hours", "07:30-20:00 daily", None),
                                     ("review_theme", "Customers praise brunch, mention slow coffee at peak", None),
                                     ("size_signal", "Two baristas, 60 seats", None)]):
    add("dossier_fact", {"id": uid("dossier_fact", f"avra:{j}"), "dossier_id": DOS, "fact_type": ft, "value": val,
                         "competitor_id": CP[comp] if comp else None, "source_url": "https://cafeavra.example.gr/menu",
                         "retrieved_at": dt(-2, "09:00")})

# ---------------------------------------------------------------- campaign (J2), discounts (G1), targets (G4)
CAMP = uid("campaign", "espresso-nuovo")
add("campaign", {"id": CAMP, "org_id": ORG, "created_by": U["eleni"], "title": "Espresso Nuovo to cafés",
                 "message": "This week push the new Espresso Nuovo blend to cafés: offer a 1kg trial bag.",
                 "starts_on": d(-1), "ends_on": d(6), "status": "active"})
add("campaign_product", {"id": uid("campaign_product", "nuovo"), "campaign_id": CAMP, "product_id": P["ESP-NEW-1"]})
for t in ["north", "center"]:
    add("campaign_territory", {"id": uid("campaign_territory", t), "campaign_id": CAMP, "territory_id": T[t]})
add("campaign_category", {"id": uid("campaign_category", "cafe"), "campaign_id": CAMP, "category_id": C["cafe"]})

for key, role, user, pcat, acat, pct in [("rep_default", "rep", None, None, None, 3), ("rep_bakery", "rep", None, "bakery_supplies", "bakery", 5),
                                         ("manager_default", "manager", None, None, None, 10), ("admin_default", "admin", None, None, None, 100)]:
    add("discount_policy", {"id": uid("discount_policy", key), "org_id": ORG, "role_code": role, "user_id": user,
                            "product_category_id": PC[pcat] if pcat else None, "account_category_id": C[acat] if acat else None,
                            "max_discount_pct": pct, "active": True})

for key, terr, user, metric, value in [("nikos_rev", None, "nikos", "revenue", 1800000), ("nikos_visits", None, "nikos", "visits", 110),
                                       ("north_rev", "north", None, "revenue", 12000000), ("org_rev", None, None, "revenue", 30000000)]:
    add("sales_target", {"id": uid("sales_target", key), "org_id": ORG, "territory_id": T[terr] if terr else None,
                         "user_id": U[user] if user else None, "metric": metric, "period_start": "@MONTH_START",
                         "period_end": "@MONTH_END", "target_value": value, "set_by": U["eleni"]})

# ---------------------------------------------------------------- prospect list fallback (J4: bakeries, Chalandri)
PROSPECT_LIST = []
dups = [("artos", "vat"), ("zymi", "website"), ("pita", "phone"), ("stavros", "name"), ("glykia", "vat")]
for k, rule in dups:
    row = ACC[k][0]
    PROSPECT_LIST.append({"business_name": row["name"] if rule != "name" else row["name"].upper(),
                          "vat_number": row["vat_number"] if rule == "vat" else None,
                          "website": row["website"] if rule == "website" else None,
                          "phone": row["phone"] if rule == "phone" else None, "postal_code": row["postal_code"],
                          "external_source": "csv", "expected": f"duplicate:{rule}"})
NEW_BAKERIES = ["Fournos Agia Paraskevi", "Psomi tis Geitonias", "Bakery Elia", "Oven 15233", "Mylos Bread Co",
                "Prozymi Artisan", "Koulouri Corner", "Fournos Melissia", "Sitari Bakehouse", "Chalandri Sourdough",
                "Bougatsa Thessaloniki Chalandri", "Glykes Stigmes Patisserie", "Ble Fournos"]
for j, n in enumerate(NEW_BAKERIES):
    pc = ["15231", "15232", "15233", "15234"][j % 4]
    PROSPECT_LIST.append({"business_name": n, "vat_number": f"{900000000 + j * 101:09d}",
                          "website": f"https://{n.lower().replace(' ', '')}.example.gr" if j % 5 != 4 else None,
                          "phone": f"+30210{6800000 + j * 31:07d}", "postal_code": pc, "external_source": "csv", "expected": "new"})

EXTRA = {"prospect_list_chalandri_bakeries": PROSPECT_LIST}
