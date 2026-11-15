"""Tiny DSL shared by the contract sources. Edit the *_src.py files, then run build.py."""

# ---------------------------------------------------------------- tables
class Col:
    def __init__(self, name, type_, req=False, ref=None, on_delete=None, enum=None, note=None):
        self.name, self.type, self.req = name, type_, req
        self.ref, self.on_delete, self.enum, self.note = ref, on_delete, enum, note


def S(name, req=False, note=None):
    return Col(name, "string", req, note=note)


def N(name, req=False, note=None):
    return Col(name, "number", req, note=note)


def B(name, req=False, note=None):
    return Col(name, "boolean", req, note=note)


def D(name, req=False, note=None):
    return Col(name, "date", req, note=note)


def DT(name, req=False, note=None):
    return Col(name, "datetime", req, note=note)


def E(name, values, req=False, note=None):
    return Col(name, "string", req, enum=list(values), note=note)


def FK(name, table, req=False, od="restrict", note=None):
    # type is resolved at build time from the referenced table's primary key
    return Col(name, None, req, ref=table, on_delete=od, note=note)


class Idx:
    def __init__(self, cols, unique=False, gin=False, name=None):
        self.cols, self.unique, self.gin = list(cols), unique, gin
        self.name = name


def U(*cols):
    return Idx(cols, unique=True)


def X(*cols):
    return Idx(cols)


def G(*cols):
    return Idx(cols, gin=True)


class Table:
    def __init__(self, name, desc, cols, idx=(), pk=None, domain="core", derived=False):
        self.name, self.desc, self.cols, self.idx = name, desc, list(cols), list(idx)
        self.pk = pk  # None -> surrogate "id" auto_uuid; else name of a string column
        self.domain, self.derived = domain, derived


# ---------------------------------------------------------------- JSON-schema shorthand
# "uuid" "str" "int" "num" "bool" "date" "datetime" "e:a|b" "[T]" "$Def" ; trailing "?" = optional + nullable
def to_schema(spec):
    if isinstance(spec, dict):
        props, required = {}, []
        for k, v in spec.items():
            opt = isinstance(v, str) and v.endswith("?")
            props[k] = to_schema(v[:-1] if opt else v)
            if opt:
                props[k] = {"anyOf": [props[k], {"type": "null"}]}
            else:
                required.append(k)
        out = {"type": "object", "properties": props, "additionalProperties": False}
        if required:
            out["required"] = required
        return out
    if isinstance(spec, list):
        return {"type": "array", "items": to_schema(spec[0])}
    s = spec
    if s.startswith("[") and s.endswith("]"):
        return {"type": "array", "items": to_schema(s[1:-1])}
    if s.startswith("$"):
        return {"$ref": f"../_defs.json#/$defs/{s[1:]}"}
    if s.startswith("e:"):
        return {"type": "string", "enum": s[2:].split("|")}
    base = {
        "uuid": {"type": "string", "format": "uuid"},
        "str": {"type": "string"},
        "int": {"type": "integer"},
        "num": {"type": "number"},
        "bool": {"type": "boolean"},
        "date": {"type": "string", "format": "date"},
        "datetime": {"type": "string", "format": "date-time"},
        "any": {},
        "obj": {"type": "object"},
    }
    if s not in base:
        raise ValueError(f"unknown type shorthand: {spec!r}")
    return dict(base[s])


class Fn:
    def __init__(self, slug, method, gate=None, callers=(), req=None, res=None, reads=(), writes=(),
                 kind="http", timeout_ms=30000, schedule=None, notes="", errors=(), wave=2, priority="P0",
                 scope=None, integrations=(), llm=()):
        self.slug, self.method, self.gate, self.callers = slug, method, gate, list(callers)
        self.req, self.res = req or {}, res or {}
        self.reads, self.writes = list(reads), list(writes)
        self.kind, self.timeout_ms, self.schedule, self.notes = kind, timeout_ms, schedule, notes
        self.errors, self.wave, self.priority, self.scope = list(errors), wave, priority, scope
        self.integrations, self.llm = list(integrations), list(llm)


class Tool:
    def __init__(self, name, agent, function, description, params=None, inject=("caller",), priority="P0",
                 side_effects=(), say=""):
        # function: a function slug, or "integration:<connection>.<action>", or "builtin:<context api>"
        self.name, self.agent, self.function, self.description = name, agent, function, description
        self.params = params or {}
        self.inject, self.priority = list(inject), priority
        self.side_effects, self.say = list(side_effects), say
