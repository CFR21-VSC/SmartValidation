"""
Sincronización por diferencias (delta) del snapshot de proyecto, con fusión por elemento.

Cada elemento (prueba, carpeta, protocolo) lleva `_srev`: la revisión del servidor en la que se
escribió por última vez. El cliente envía solo lo que cambió respecto de la revisión sobre la que
trabajó (`baseRev`). Si el servidor ya avanzó, solo se rechazan los elementos que OTRA sesión
modificó después de esa revisión; el resto se aplica. La respuesta trae lo que cambió en el
servidor y el cliente todavía no tiene (`serverChanges`), de modo que ambos lados convergen.

Módulo puro (sin base de datos ni HTTP): se prueba directamente.
"""
import copy

KINDS = ("tests", "groups", "protocols")
META_KEYS = ("systemInfo", "executor", "projectData", "exportConfig")
TOL = 0.001
MAX_TOMBSTONES = 500


def _sync_block(snap):
    sb = snap.get("_sync")
    if not isinstance(sb, dict):
        sb = {}
    sb.setdefault("meta", {})
    rem = sb.setdefault("removed", {})
    for k in KINDS:
        rem.setdefault(k, {})
    snap["_sync"] = sb
    return sb


def _strip(o):
    """Copia sin `_srev` (para comparar contenido)."""
    if isinstance(o, dict):
        return {k: _strip(v) for k, v in o.items() if k != "_srev"}
    if isinstance(o, list):
        return [_strip(v) for v in o]
    return o


def _same(a, b):
    return _strip(a) == _strip(b)


def _ent_id(e):
    return e.get("id") if isinstance(e, dict) else None


def _valid_id(i):
    return isinstance(i, (str, int)) and not isinstance(i, bool) and str(i) != ""


def stamp_entities(old, new, now):
    """Guardado completo: sella con `now` los elementos que cambiaron respecto de `old` y conserva el
    sello de los que no. También mantiene los sellos de metadatos y las lápidas de elementos borrados.
    Modifica `new` y lo devuelve."""
    old = old if isinstance(old, dict) else {}
    old_sync = _sync_block(copy.deepcopy(old)) if old else _sync_block({})
    sb = _sync_block(new)
    sb["meta"] = dict(old_sync.get("meta", {}))
    sb["removed"] = {k: dict(old_sync.get("removed", {}).get(k, {})) for k in KINDS}
    for kind in KINDS:
        old_idx = {_ent_id(e): e for e in (old.get(kind) or []) if _valid_id(_ent_id(e))}
        seen = set()
        for e in (new.get(kind) or []):
            eid = _ent_id(e)
            if not _valid_id(eid):
                continue
            seen.add(eid)
            prev = old_idx.get(eid)
            if prev is not None and _same(prev, e) and prev.get("_srev"):
                e["_srev"] = prev["_srev"]
            else:
                e["_srev"] = now
                sb["removed"][kind].pop(str(eid), None)
        for eid in old_idx:
            if eid not in seen:
                sb["removed"][kind][str(eid)] = now
        _prune(sb["removed"][kind])
    for k in META_KEYS:
        if k in new and not (k in old and _same(old.get(k), new.get(k))):
            sb["meta"][k] = now
    return new


def _prune(tomb):
    if len(tomb) > MAX_TOMBSTONES:
        for k, _ in sorted(tomb.items(), key=lambda kv: kv[1])[: len(tomb) - MAX_TOMBSTONES]:
            tomb.pop(k, None)


def changes_since(snap, base_rev, exclude_rev=None):
    """Lo que cambió en `snap` después de `base_rev` (sin contar lo escrito en `exclude_rev`)."""
    sb = _sync_block(snap)
    out = {"tests": [], "groups": [], "protocols": [], "removed": {k: [] for k in KINDS}, "meta": {}}

    def nuevo(r):
        return r is not None and r > base_rev + TOL and (exclude_rev is None or abs(r - exclude_rev) > 1e-9)

    for kind in KINDS:
        for e in (snap.get(kind) or []):
            if isinstance(e, dict) and nuevo(e.get("_srev")):
                out[kind].append(e)
        for eid, r in sb["removed"][kind].items():
            if nuevo(r):
                out["removed"][kind].append(eid)
    for k in META_KEYS:
        if k in snap and nuevo(sb["meta"].get(k)):
            out["meta"][k] = snap[k]
    return out


def apply_delta(snap, changes, base_rev, cur_rev, now):
    """Aplica `changes` sobre `snap` (se modifica). Devuelve (conflictos, hubo_cambios).

    Un elemento entra en conflicto si otra sesión lo escribió (o lo borró) después de `base_rev`.
    Los elementos sin sello se consideran escritos en `cur_rev` (criterio conservador)."""
    conflicts = []
    changed = False
    sb = _sync_block(snap)
    strict = base_rev + TOL >= cur_rev  # nadie escribió desde que el cliente bajó: no hay con qué chocar
    changes = changes if isinstance(changes, dict) else {}

    for kind in KINDS:
        ch = changes.get(kind) or {}
        lst = snap.setdefault(kind, [])
        idx = {_ent_id(e): i for i, e in enumerate(lst) if _valid_id(_ent_id(e))}
        for e in (ch.get("upsert") or []):
            eid = _ent_id(e)
            if not _valid_id(eid):
                continue
            cur = lst[idx[eid]] if eid in idx else None
            if not strict:
                if cur is not None and (cur.get("_srev") or cur_rev) > base_rev + TOL:
                    conflicts.append({"kind": kind, "id": eid, "motivo": "modificado"})
                    continue
                if cur is None and sb["removed"][kind].get(str(eid), 0) > base_rev + TOL:
                    conflicts.append({"kind": kind, "id": eid, "motivo": "eliminado"})
                    continue
            if cur is not None and _same(cur, e):
                continue
            # Un registro finalizado es inmutable: solo puede cambiar para reabrirse (finalized -> False).
            if cur is not None and cur.get("finalized") is True and e.get("finalized") is True:
                conflicts.append({"kind": kind, "id": eid, "motivo": "finalizado"})
                continue
            e = dict(e)
            e["_srev"] = now
            if cur is None:
                lst.append(e)
                idx[eid] = len(lst) - 1
            else:
                lst[idx[eid]] = e
            sb["removed"][kind].pop(str(eid), None)
            changed = True
        for eid in (ch.get("remove") or []):
            if not _valid_id(eid) or eid not in idx:
                continue
            cur = lst[idx[eid]]
            if cur.get("finalized") is True:
                conflicts.append({"kind": kind, "id": eid, "motivo": "finalizado"})
                continue
            if not strict and (cur.get("_srev") or cur_rev) > base_rev + TOL:
                conflicts.append({"kind": kind, "id": eid, "motivo": "modificado"})
                continue
            lst.pop(idx[eid])
            idx = {_ent_id(x): i for i, x in enumerate(lst) if _valid_id(_ent_id(x))}
            sb["removed"][kind][str(eid)] = now
            _prune(sb["removed"][kind])
            changed = True

    meta = changes.get("meta") or {}
    for k in META_KEYS:
        if k not in meta:
            continue
        if not strict and sb["meta"].get(k, cur_rev) > base_rev + TOL:
            conflicts.append({"kind": "meta", "id": k, "motivo": "modificado"})
            continue
        if k in snap and _same(snap[k], meta[k]):
            continue
        snap[k] = meta[k]
        sb["meta"][k] = now
        changed = True
    return conflicts, changed


def violations(snap):
    """Reglas de jerarquía de lo finalizado. Devuelve un conjunto de descripciones (vacío si cumple)."""
    v = set()
    groups = [g for g in (snap.get("groups") or []) if isinstance(g, dict) and _valid_id(g.get("id"))]
    tests = [t for t in (snap.get("tests") or []) if isinstance(t, dict) and _valid_id(t.get("id"))]
    protocols = [p for p in (snap.get("protocols") or []) if isinstance(p, dict) and _valid_id(p.get("id"))]
    for g in groups:
        if g.get("finalized"):
            for t in tests:
                if t.get("groupId") == g.get("id") and not t.get("finalized"):
                    v.add(f"carpeta {g['id']} finalizada con la prueba {t['id']} sin finalizar")
    for p in protocols:
        if p.get("finalized"):
            for g in groups:
                if g.get("protocolId") == p.get("id") and not g.get("finalized"):
                    v.add(f"protocolo {p['id']} finalizado con la carpeta {g['id']} sin finalizar")
    if (snap.get("projectData") or {}).get("finalized"):
        if any(not t.get("finalized") for t in tests):
            v.add("proyecto finalizado con pruebas sin finalizar")
        if any(not g.get("finalized") for g in groups):
            v.add("proyecto finalizado con carpetas sin finalizar")
        if any(not p.get("finalized") for p in protocols):
            v.add("proyecto finalizado con protocolos sin finalizar")
    return v


def transitions(before, after):
    """Finalizaciones y reaperturas entre dos snapshots: [(kind, id, 'finalizada'|'reabierta')]."""
    out = []
    for kind in KINDS:
        prev = {e.get("id"): bool(e.get("finalized")) for e in (before.get(kind) or []) if isinstance(e, dict)}
        for e in (after.get(kind) or []):
            if not isinstance(e, dict) or e.get("id") not in prev:
                continue
            if bool(e.get("finalized")) and not prev[e["id"]]:
                out.append((kind, e["id"], "finalizada"))
            elif not e.get("finalized") and prev[e["id"]]:
                out.append((kind, e["id"], "reabierta"))
    if bool((after.get("projectData") or {}).get("finalized")) != bool((before.get("projectData") or {}).get("finalized")):
        out.append(("proyecto", "projectData", "finalizada" if (after.get("projectData") or {}).get("finalized") else "reabierta"))
    return out
