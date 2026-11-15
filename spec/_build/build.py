"""Generate spec/contracts/** from the *_src.py sources and validate cross-references.
Run:  python3 -I spec/_build/build.py      (exit 1 on any error)
"""
import hashlib, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
SPEC = os.path.dirname(HERE)
OUT = os.path.join(SPEC, "contracts")

from dsl import to_schema  # noqa: E402
import tables_src, functions_src, agents_src, llm_events_src, app_src, seed_src  # noqa: E402

ERR, WARN = [], []
def err(m): ERR.append(m)
def warn(m): WARN.append(m)

TABLES = {t.name: t for t in tables_src.TABLES}
FUNCS = functions_src.FUNCTIONS
FN = {}
DEFS = functions_src.DEFS
LLM, EVENTS = llm_events_src.LLM, llm_events_src.EVENTS
TOOLS, AGENTS, PROCS = agents_src.TOOLS, agents_src.AGENTS, agents_src.PROCEDURES
INTEG = agents_src.INTEGRATIONS
PERMS, ROLES, SCREENS = app_src.PERMISSIONS, app_src.ROLES, app_src.SCREENS
SNAKE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
SLUG = re.compile(r"^[a-z][a-z0-9-]{1,62}$")
APP_CALLERS = {"app", "mgmt"}  # mgmt = management screens of the same Wonderful App
AGENT_ALIAS = {"buddy": "merc-buddy"}
SCALARS = {"uuid", "str", "int", "num", "bool", "date", "datetime"}

# ---------------------------------------------------------------- schema helpers
def walk_refs(spec, where):
    if isinstance(spec, dict):
        for k, v in spec.items():
            walk_refs(v, f"{where}.{k}")
    elif isinstance(spec, list):
        if len(spec) != 1:
            err(f"{where}: list shorthand must have exactly one item type")
        for v in spec:
            walk_refs(v, f"{where}[]")
    elif isinstance(spec, str):
        s = spec[:-1] if spec.endswith("?") else spec
        while s.startswith("[") and s.endswith("]"):
            s = s[1:-1]
        if s.startswith("$"):
            if s[1:] not in DEFS:
                err(f"{where}: unresolved $ref {s}")
        elif not s.startswith("e:"):
            try:
                to_schema(s)
            except ValueError as e:
                err(f"{where}: {e}")
    else:
        err(f"{where}: bad schema node {spec!r}")

def is_scalar(v):
    if not isinstance(v, str):
        return False
    s = v[:-1] if v.endswith("?") else v
    return s in SCALARS or s.startswith("e:")

def schema(spec):
    try:
        return to_schema(spec)
    except ValueError as e:
        err(str(e)); return {}

# ---------------------------------------------------------------- tables
def pk_of(t):
    return t.pk or "id"

def pk_type(t):
    return "auto_uuid" if t.pk is None else next(c.type for c in t.cols if c.name == t.pk)

def col_type(c):
    return pk_type(TABLES[c.ref]) if c.ref else c.type

def check_tables():
    for t in TABLES.values():
        w = f"table {t.name}"
        if not SNAKE.match(t.name): err(f"{w}: name not snake_case")
        names = [c.name for c in t.cols] + ([] if t.pk else ["id"])
        if len(names) != len(set(names)): err(f"{w}: duplicate column")
        if len(names) > 50: err(f"{w}: {len(names)} columns > 50")
        if len(t.idx) > 10: err(f"{w}: {len(t.idx)} indexes > 10")
        for n in names:
            if not SNAKE.match(n): err(f"{w}.{n}: column not snake_case")
            if n in ("created_at", "updated_at"): err(f"{w}.{n}: system column must not be declared")
        if t.pk and t.pk not in names: err(f"{w}: pk {t.pk} missing")
        for c in t.cols:
            if c.ref:
                if c.ref not in TABLES: err(f"{w}.{c.name}: FK to unknown table {c.ref}"); continue
                if c.on_delete not in ("restrict", "cascade", "set_null"): err(f"{w}.{c.name}: bad on_delete")
                if c.on_delete == "set_null" and c.req: err(f"{w}.{c.name}: set_null on required column")
            if c.enum and c.type != "string": err(f"{w}.{c.name}: enum on non-string")
        inames = [index_name(t, i) for i in t.idx]
        if len(inames) != len(set(inames)): err(f"{w}: duplicate index name")
        for i, nm in zip(t.idx, inames):
            if len(nm) > MAX_INDEX_NAME: err(f"{w}: index name {nm} > {MAX_INDEX_NAME} chars")
            if len(i.cols) > 8: err(f"{w}: index {nm} has {len(i.cols)} columns > 8")
            if i.gin and i.unique: err(f"{w}: index {nm}: unique is only allowed on btree")
            for cn in i.cols:
                if cn not in names: err(f"{w}: index column {cn} missing")
        # FK columns should be indexed (leading column) unless covered
        lead = {i.cols[0] for i in t.idx}
        for c in t.cols:
            if c.ref and c.name not in lead and c.name != t.pk:
                warn(f"{w}.{c.name}: FK not the leading column of any index")
        check_payload(t, table_payload(t)["create"])

PLATFORM_TYPES = {"string", "number", "boolean", "date", "datetime", "enum", "vector", "big_vector",
                  "raw_vector", "auto_inc_id", "auto_uuid"}

def check_payload(t, p):
    """The create block must be exactly the verified Tables payload (docs/spikes/S9-S10.md section 1)."""
    w = f"table {t.name} payload"
    if set(p) != {"schema", "name", "description", "columns", "indexes"}: err(f"{w}: bad top-level keys {sorted(p)}")
    if p["schema"] != tables_src.SCHEMA: err(f"{w}: schema {p['schema']} != {tables_src.SCHEMA}")
    if [c["name"] for c in p["columns"] if c.get("primary_key")] != [pk_of(t)]: err(f"{w}: must have exactly one primary_key column {pk_of(t)}")
    for c in p["columns"]:
        if not set(c) <= {"name", "type", "required", "primary_key", "reference"}: err(f"{w}.{c['name']}: bad keys {sorted(c)}")
        if c["type"] not in PLATFORM_TYPES: err(f"{w}.{c['name']}: unknown type {c['type']}")
        r = c.get("reference")
        if r:
            sch, _, tn = r["table"].partition(".")
            if sch != tables_src.SCHEMA or tn not in TABLES: err(f"{w}.{c['name']}: reference {r['table']} not merc.<table>")
            elif c["type"] != pk_type(TABLES[tn]): err(f"{w}.{c['name']}: FK type {c['type']} != PK type of {tn}")
            if set(r) != {"table", "on_delete"}: err(f"{w}.{c['name']}: reference keys {sorted(r)}")
    for i in p["indexes"]:
        if not set(i) <= {"name", "columns", "unique", "type"} or i.get("type") not in ("btree", "gin"):
            err(f"{w}: index {i.get('name')} not in platform shape")
        if len(i["name"]) > MAX_INDEX_NAME: err(f"{w}: index name {i['name']} > {MAX_INDEX_NAME}")

MAX_INDEX_NAME = 49  # platform limit (S9-S10); infra/tables applies these names unchanged

def index_name(t, i):
    """Deterministic index name <= 49 chars; keeps the _uq/_idx/_gin suffix (same as WP-INF-01 created)."""
    nm = i.name or f"{t.name}_{'_'.join(i.cols)}_{'uq' if i.unique else ('gin' if i.gin else 'idx')}"
    if len(nm) <= MAX_INDEX_NAME:
        return nm
    m = re.search(r"(_uq|_idx|_gin)$", nm)
    suffix = m.group(1) if m else ""
    h = hashlib.sha1(nm.encode()).hexdigest()[:8]
    head = nm[:MAX_INDEX_NAME - len(suffix) - len(h) - 1].rstrip("_")
    return f"{head}_{h}{suffix}"

def table_payload(t):
    """`create` is the verified Wonderful Tables payload (POST /api/v1/custom-tables), applied as is."""
    cols = []
    if t.pk is None:
        cols.append({"name": "id", "type": "auto_uuid", "required": True, "primary_key": True})
    for c in t.cols:
        d = {"name": c.name, "type": col_type(c), "required": bool(c.req)}
        if c.name == t.pk: d["primary_key"] = True
        if c.ref:
            d["reference"] = {"table": f"{tables_src.SCHEMA}.{c.ref}", "on_delete": c.on_delete}
        cols.append(d)
    idx = []
    for i in t.idx:
        d = {"name": index_name(t, i), "columns": i.cols, "type": "gin" if i.gin else "btree"}
        if i.unique: d["unique"] = True
        idx.append(d)
    create = {"schema": tables_src.SCHEMA, "name": t.name, "description": t.desc, "columns": cols, "indexes": idx}
    x = {"domain": t.domain, "derived": t.derived,
         "enums": {c.name: c.enum for c in t.cols if c.enum},
         "notes": {c.name: c.note for c in t.cols if c.note}}
    return {"create": create, "x": x}

def topo_order():
    deps = {n: {c.ref for c in t.cols if c.ref and c.ref != n} for n, t in TABLES.items()}
    order, done = [], set()
    while len(order) < len(TABLES):
        ready = sorted(n for n in TABLES if n not in done and deps[n] <= done)
        if not ready:
            err(f"FK cycle among {sorted(set(TABLES) - done)}"); break
        order += ready; done |= set(ready)
    deferred = [{"table": n, "column": c.name} for n, t in TABLES.items() for c in t.cols if c.ref == n]
    return {"order": order, "deferred_self_refs": deferred,
            "note": "Create in order. Self-referencing FKs are added after the table exists (or created nullable then altered)."}

# ---------------------------------------------------------------- functions
def check_functions():
    seen = set()
    for f in FUNCS:
        w = f"function {f.slug}"
        if f.slug in FN: err(f"{w}: duplicate slug")
        FN[f.slug] = f
        if not SLUG.match(f.slug): err(f"{w}: slug not kebab-case")
        if f.method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "WS", "CRON"): err(f"{w}: bad method {f.method}")
        if (f.slug, f.method) in seen: err(f"{w}: duplicate (slug, method)")
        seen.add((f.slug, f.method))
        if f.method == "GET":
            for k, v in f.req.items():
                if not is_scalar(v): err(f"{w}: GET param {k} must be scalar (string/number/boolean)")
        if f.method == "CRON" and not f.schedule: err(f"{w}: cron without schedule")
        if f.schedule and len(f.schedule.split()) != 5: err(f"{w}: schedule must be 5-field cron")
        if f.timeout_ms > 300000: err(f"{w}: timeout > 300 s")
        walk_refs(f.req, f"{w}.req"); walk_refs(f.res, f"{w}.res")
        if f.gate and f.gate not in PERMS: err(f"{w}: gate {f.gate} not in permission catalog")
        if APP_CALLERS & set(f.callers) and not f.gate and f.slug not in ("me", "merc-live"):
            warn(f"{w}: app-callable function without gate")
        for tn in f.reads + f.writes:
            if tn != "*" and tn not in TABLES: err(f"{w}: unknown table {tn}")
        for l in f.llm:
            if l not in LLM: err(f"{w}: unknown llm schema {l}")
        for i in f.integrations:
            check_integration_ref(i, w)
        if f.priority not in ("P0", "P1", "P2"): err(f"{w}: bad priority")
        if f.wave not in (1, 2, 3, 4): err(f"{w}: bad wave")

def check_integration_ref(ref, w):
    if ref.startswith("integration:"):
        conn = ref.split(":", 1)[1].split(".")[0]
        if conn not in INTEG: err(f"{w}: unknown integration {conn}")
        else:
            act = ref.split(".", 1)[1] if "." in ref else None
            if act and act not in INTEG[conn].get("actions", [act]): err(f"{w}: unknown action {ref}")
    elif ref.startswith("backoffice:"):
        if ref.split(":", 1)[1] not in AGENTS: err(f"{w}: unknown agent {ref}")
    elif ref.startswith("procedure:"):
        if ref.split(":", 1)[1] not in PROCS: err(f"{w}: unknown procedure {ref}")
    elif ref.startswith("outbound_call:"):
        if ref.split(":", 1)[1] not in AGENTS: err(f"{w}: unknown agent {ref}")
    elif ref.startswith("builtin:"):
        pass
    elif ref not in INTEG:
        err(f"{w}: unknown integration ref {ref}")

def fn_payload(f):
    d = {"slug": f.slug, "method": f.method, "kind": f.kind, "gate": f.gate, "callers": f.callers,
         "timeout_ms": f.timeout_ms, "priority": f.priority, "wave": f.wave,
         "request": schema(f.req), "response": schema(f.res),
         "reads": f.reads, "writes": f.writes, "errors": f.errors, "llm": f.llm, "integrations": f.integrations,
         "notes": f.notes}
    if f.schedule: d["schedule"] = f.schedule
    if f.scope: d["scope"] = f.scope
    return d

# ---------------------------------------------------------------- tools / agents / procedures
def inject_names(inj):
    out = set()
    for i in inj:
        i = i.rstrip("?").split("=")[0]
        out.add(i.split(".")[-1])
    return out

def check_tools():
    names = set()
    for t in TOOLS:
        w = f"tool {t.agent}/{t.name}"
        if (t.agent, t.name) in names: err(f"{w}: duplicate")
        names.add((t.agent, t.name))
        if not SNAKE.match(t.name): err(f"{w}: name not snake_case")
        if t.agent not in AGENTS: err(f"{w}: unknown agent")
        walk_refs(t.params, f"{w}.params")
        for p, v in t.params.items():
            if not is_scalar(v): warn(f"{w}: param {p} is not scalar (LLM tool args should be flat)")
        if t.function.startswith(("integration:", "builtin:")):
            check_integration_ref(t.function, w); continue
        f = FN.get(t.function)
        if not f: err(f"{w}: unknown function {t.function}"); continue
        if t.agent not in {AGENT_ALIAS.get(c, c) for c in f.callers}:
            err(f"{w}: function {f.slug} does not list {t.agent} in callers")
        for p in t.params:
            if p not in f.req: err(f"{w}: param {p} not in {f.slug} request")
        covered = set(t.params) | inject_names(t.inject)
        for k, v in f.req.items():
            if not (isinstance(v, str) and v.endswith("?")) and k not in covered:
                err(f"{w}: required {f.slug}.{k} neither a param nor injected")

def check_agents():
    tool_by_agent = {}
    for t in TOOLS:
        tool_by_agent.setdefault(t.agent, set()).add(t.name)
    for a, spec in AGENTS.items():
        for s in spec.get("skills", []):
            for tn in s.get("tools", []):
                if tn not in tool_by_agent.get(a, set()): err(f"agent {a} skill {s['name']}: unknown tool {tn}")
        used = {tn for s in spec.get("skills", []) for tn in s.get("tools", [])}
        for tn in tool_by_agent.get(a, set()) - used:
            warn(f"agent {a}: tool {tn} not in any skill")
    for l, spec in LLM.items():
        for u in spec["used_by"]:
            if u not in FN and u not in AGENTS: err(f"llm {l}: used_by {u} unknown")
        if spec["profile"] not in agents_src.MODEL_PROFILES: err(f"llm {l}: unknown profile")
        walk_refs(spec["input"], f"llm {l}.input"); walk_refs(spec["output"], f"llm {l}.output")
    for p, spec in PROCS.items():
        def steps(ss):
            for s in ss:
                if s["type"] == "function" and s["function"] not in FN: err(f"procedure {p}: unknown function {s['function']}")
                if s["type"] == "agent_task" and s["agent"] not in AGENTS: err(f"procedure {p}: unknown agent {s['agent']}")
                if s["type"] == "wait_table_condition" and s["table"] not in TABLES: err(f"procedure {p}: unknown table")
                steps(s.get("steps", [])); steps(s.get("then", [])); steps(s.get("else", []))
        steps(spec["steps"])
        for s in spec["steps"]:
            if s["type"] == "function" and "procedure" not in FN.get(s["function"], type("x", (), {"callers": ["procedure"]})).callers:
                warn(f"procedure {p}: function {s['function']} does not list procedure caller")

def check_app():
    for r, spec in ROLES.items():
        for p in spec["all"] + [p for ps in spec["relation"].values() for p in ps]:
            if p not in PERMS: err(f"role {r}: unknown permission {p}")
        for rel in spec["relation"]:
            if rel not in app_src.RELATIONS: err(f"role {r}: unknown relation {rel}")
    for p, (_, _, rels) in PERMS.items():
        for rel in rels:
            if rel not in app_src.RELATIONS: err(f"permission {p}: unknown relation {rel}")
    gates = {f.gate for f in FUNCS if f.gate}
    for p in PERMS:
        if p not in gates: warn(f"permission {p} gates no function")
    for app, screens in SCREENS.items():
        for s, spec in screens.items():
            for fn in spec["functions"]:
                if fn not in FN: err(f"screen {app}/{s}: unknown function {fn}")
                elif not APP_CALLERS & set(FN[fn].callers): err(f"screen {app}/{s}: function {fn} not callable by app")
            for e in spec.get("events", []):
                if e not in EVENTS: err(f"screen {app}/{s}: unknown event {e}")
    for e, spec in EVENTS.items():
        walk_refs(spec, f"event {e}")
    used = {t for f in FUNCS for t in f.reads + f.writes}
    for t in TABLES:
        if t not in used: err(f"table {t}: not read or written by any function")

# ---------------------------------------------------------------- seed
DATE_TOK = re.compile(r"^(@D([+-]\d+)?|@WEEK_START|@MONTH_START|@MONTH_END|\d{4}-\d{2}-\d{2})$")
DT_TOK = re.compile(r"^@D([+-]\d+)?@\d{2}:\d{2}$")

def check_seed():
    rows = seed_src.ROWS
    keys = {}
    for tn, rs in rows.items():
        if tn not in TABLES: err(f"seed: unknown table {tn}"); continue
        t = TABLES[tn]; pk = pk_of(t)
        keys[tn] = set()
        for r in rs:
            if pk not in r: err(f"seed {tn}: row without {pk}"); continue
            if r[pk] in keys[tn]: err(f"seed {tn}: duplicate {pk} {r[pk]}")
            keys[tn].add(r[pk])
    for tn, rs in rows.items():
        if tn not in TABLES: continue
        t = TABLES[tn]; cols = {c.name: c for c in t.cols}
        uniq = [i.cols for i in t.idx if i.unique]
        seen = [set() for _ in uniq]
        for n, r in enumerate(rs):
            w = f"seed {tn}[{n}]"
            for k, v in r.items():
                if k == "id" and t.pk is None: continue
                c = cols.get(k)
                if not c: err(f"{w}: unknown column {k}"); continue
                if v is None:
                    continue
                if c.ref:
                    if v not in keys.get(c.ref, set()): err(f"{w}.{k}: FK {v} not in seed {c.ref}")
                elif c.enum and v not in c.enum: err(f"{w}.{k}: {v!r} not in enum")
                elif c.type == "number" and (isinstance(v, bool) or not isinstance(v, (int, float))): err(f"{w}.{k}: not a number")
                elif c.type == "boolean" and not isinstance(v, bool): err(f"{w}.{k}: not boolean")
                elif c.type == "string" and not isinstance(v, str): err(f"{w}.{k}: not string")
                elif c.type == "date" and not (isinstance(v, str) and DATE_TOK.match(v)): err(f"{w}.{k}: bad date {v!r}")
                elif c.type == "datetime" and not (isinstance(v, str) and DT_TOK.match(v)): err(f"{w}.{k}: bad datetime {v!r}")
            for c in t.cols:
                if c.req and r.get(c.name) is None: err(f"{w}: required {c.name} missing")
            for j, cs in enumerate(uniq):
                key = tuple(r.get(c) for c in cs)
                if None in key: continue
                if key in seen[j]: err(f"{w}: unique {cs} violated by {key}")
                seen[j].add(key)
    for code_table, codes in tables_src.LOOKUP_CODES.items():
        have = {r[pk_of(TABLES[code_table])] for r in rows.get(code_table, [])}
        for c in codes:
            if c not in have: err(f"seed {code_table}: missing lookup code {c}")

# ---------------------------------------------------------------- SPEC.md
def check_spec_md():
    p = os.path.join(SPEC, "SPEC.md")
    if not os.path.exists(p):
        warn("SPEC.md missing"); return
    text = open(p, encoding="utf-8").read()
    ids = re.findall(r"^\|?\s*\*?\*?(REQ-[A-Z]+-\d{3})\b", text, re.M)
    dup = {i for i in ids if ids.count(i) > 1}
    for i in sorted(dup): err(f"SPEC.md: duplicate {i}")
    defined = set(ids)
    for ref in set(re.findall(r"REQ-[A-Z]+-\d{3}", text)) - defined:
        err(f"SPEC.md: {ref} referenced but not defined")
    for ref in set(re.findall(r"contracts/[A-Za-z0-9_./-]+?\.(?:json|md)", text)):
        if not os.path.exists(os.path.join(SPEC, ref)): err(f"SPEC.md: missing contract {ref}")
    for slug in set(re.findall(r"`fn:([a-z0-9-]+)`", text)):
        if slug not in FN: err(f"SPEC.md: unknown function fn:{slug}")
    for tn in set(re.findall(r"`tbl:([a-z_]+)`", text)):
        if tn not in TABLES: err(f"SPEC.md: unknown table tbl:{tn}")
    return len(defined)

# ---------------------------------------------------------------- write
def dump(rel, obj):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2); fh.write("\n")

def write_all():
    for sub in ["tables", "functions", "tools", "agents", "procedures", "events", "llm", "app", "seed", "platform"]:
        shutil.rmtree(os.path.join(OUT, sub), ignore_errors=True)
    dump("_defs.json", {"$schema": "https://json-schema.org/draft/2020-12/schema",
                        "$defs": {k: to_schema(v) for k, v in DEFS.items()}})
    for t in TABLES.values(): dump(f"tables/{t.name}.json", table_payload(t))
    dump("tables/_order.json", topo_order())
    for f in FUNCS: dump(f"functions/{f.slug}.json", fn_payload(f))
    for t in TOOLS:
        target = FN.get(t.function)
        dump(f"tools/{t.agent}/{t.name}.json", {
            "name": t.name, "agent": t.agent, "function": t.function, "description": t.description,
            "parameters": schema(t.params), "inject": t.inject, "priority": t.priority,
            "side_effects": t.side_effects, "say": t.say,
            "returns": f"../../functions/{t.function}.json#/response" if target else None})
    for a, spec in AGENTS.items():
        dump(f"agents/{a}.json", dict(spec, name=a, tools=sorted(t.name for t in TOOLS if t.agent == a)))
    for p, spec in PROCS.items(): dump(f"procedures/{p}.json", dict(spec, name=p))
    for e, spec in EVENTS.items():
        dump(f"events/{e}.json", {"type": e, "envelope": {"type": e, "at": "date-time", "payload": "see schema"},
                                  "payload": schema(spec)})
    for l, spec in LLM.items():
        dump(f"llm/{l}.json", dict(spec, name=l, input=schema(spec["input"]), output=schema(spec["output"])))
    dump("app/app.json", {"name": "merc", "relations": app_src.RELATIONS,
                          "permissions": [{"key": k, "resource": r, "action": a, "relations": rel} for k, (r, a, rel) in PERMS.items()],
                          "roles": ROLES, "default_role": app_src.DEFAULT_ROLE,
                          "workspace_admin_role": app_src.WORKSPACE_ADMIN_ROLE, "screens": SCREENS})
    dump("platform/platform.json", {"integrations": INTEG, "model_profiles": agents_src.MODEL_PROFILES,
                                    "service_accounts": agents_src.SERVICE_ACCOUNTS, "chat_sdk_keys": agents_src.CHAT_SDK_KEYS, "globals": getattr(agents_src, "GLOBALS", {}),
                                    "knowledge_bases": agents_src.KNOWLEDGE_BASES, "secrets": agents_src.SECRETS,
                                    "monitors": agents_src.MONITORS})
    order = topo_order()["order"]
    for tn in order:
        if tn in seed_src.ROWS: dump(f"seed/{tn}.json", seed_src.ROWS[tn])
    dump("seed/_order.json", [tn for tn in order if tn in seed_src.ROWS])
    for k, v in seed_src.EXTRA.items(): dump(f"seed/{k}.json", v)
    write_index()

def write_index():
    L = ["# Contracts index (generated by `_build/build.py`, do not edit)", ""]
    L += [f"Tables: {len(TABLES)} · Functions: {len(FUNCS)} · Tools: {len(TOOLS)} · Agents: {len(AGENTS)} · "
          f"Procedures: {len(PROCS)} · LLM schemas: {len(LLM)} · Events: {len(EVENTS)} · "
          f"Seed rows: {sum(len(v) for v in seed_src.ROWS.values())}", ""]
    L += ["## Tables", "", "| table | domain | cols | indexes | written by |", "|---|---|---|---|---|"]
    for t in TABLES.values():
        by = sorted(f.slug for f in FUNCS if t.name in f.writes)
        L.append(f"| [{t.name}](tables/{t.name}.json) | {t.domain} | {len(t.cols) + (0 if t.pk else 1)} | {len(t.idx)} | {', '.join(by[:6])}{' …' if len(by) > 6 else ''} |")
    L += ["", "## Functions", "", "| slug | method | gate | callers | wave | prio |", "|---|---|---|---|---|---|"]
    for f in sorted(FUNCS, key=lambda f: (f.wave, f.slug)):
        L.append(f"| [{f.slug}](functions/{f.slug}.json) | {f.method} | {f.gate or '-'} | {', '.join(f.callers)} | {f.wave} | {f.priority} |")
    L += ["", "## Tools", "", "| agent | tool | function | prio |", "|---|---|---|---|"]
    for t in TOOLS:
        L.append(f"| {t.agent} | [{t.name}](tools/{t.agent}/{t.name}.json) | {t.function} | {t.priority} |")
    L += ["", "## Agents, procedures, LLM schemas, events", ""]
    L += [f"- agent [{a}](agents/{a}.json) ({s['type']}, {s['priority']})" for a, s in AGENTS.items()]
    L += [f"- procedure [{p}](procedures/{p}.json)" for p in PROCS]
    L += [f"- llm [{l}](llm/{l}.json) ({s['profile']})" for l, s in LLM.items()]
    L += [f"- event [{e}](events/{e}.json)" for e in EVENTS]
    with open(os.path.join(OUT, "INDEX.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")

def main():
    check_tables(); check_functions(); check_tools(); check_agents(); check_app(); check_seed()
    n_req = check_spec_md()
    if not ERR:
        write_all()
    for w in WARN: print("WARN ", w)
    for e in ERR: print("ERROR", e)
    print(f"\n{len(ERR)} errors, {len(WARN)} warnings; tables={len(TABLES)} functions={len(FUNCS)} tools={len(TOOLS)} "
          f"reqs={n_req or 0}" + ("" if ERR else f"  -> written to {OUT}"))
    sys.exit(1 if ERR else 0)

if __name__ == "__main__":
    main()
