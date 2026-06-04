import frappe
from frappe.query_builder import DocType
from frappe.query_builder.functions import Timestamp

FORWARD = 1
BACKWARD = -1

MAX_DEPTH_DEFAULT = 2
MAX_BATCHES_HARD_CAP = 2000


def _legs_for(sign):
    return ("Outward", "Inward") if sign == FORWARD else ("Inward", "Outward")


@frappe.whitelist()
def trace_batch(batch_no, direction=0, from_datetime=None, to_datetime=None,
                max_depth=MAX_DEPTH_DEFAULT):
    """Trace a batch's lineage.

    direction: 1 = forward only, -1 = backward only, 0 = both.
    Returns {batch_no, direction, movements, visited_batches, edges, truncated}.
    """
    if not batch_no:
        frappe.throw("batch_no is required")

    try:
        direction = int(direction)
    except (TypeError, ValueError):
        frappe.throw("direction must be -1, 0, or 1")
    if direction not in (FORWARD, BACKWARD, 0):
        frappe.throw("direction must be -1, 0, or 1")

    try:
        max_depth = MAX_DEPTH_DEFAULT if max_depth is None else int(max_depth)
        max_depth = max(0, min(max_depth, 50))
    except (TypeError, ValueError):
        max_depth = MAX_DEPTH_DEFAULT

    all_batches = {batch_no}
    recorded_sabbs = set()
    edge_keys = set()
    movements = []
    edges = []
    truncated = False

    signs = (FORWARD, BACKWARD) if direction == 0 else (direction,)

    try:
        for sign in signs:
            hit_cap = _walk(
                start_batch=batch_no, sign=sign,
                all_batches=all_batches,
                recorded_sabbs=recorded_sabbs,
                edge_keys=edge_keys,
                movements=movements,
                edges=edges,
                from_datetime=from_datetime or None,
                to_datetime=to_datetime or None,
                max_depth=max_depth,
            )
            truncated = truncated or hit_cap

        movements.sort(key=lambda m: m.get("posting_datetime") or "")
        _annotate_voucher_subtypes(movements, edges)
    except Exception:
        frappe.log_error(
            title="Batch Traceability trace failed",
            message=(
                f"batch_no={batch_no} direction={direction} "
                f"max_depth={max_depth} from={from_datetime} to={to_datetime}\n\n"
                f"{frappe.get_traceback()}"
            ),
        )
        frappe.throw("Could not trace this batch. The error has been logged.")

    return {
        "batch_no": batch_no,
        "direction": direction,
        "movements": movements,
        "visited_batches": sorted(all_batches),
        "edges": edges,
        "truncated": truncated,
    }


def _annotate_voucher_subtypes(movements, edges):
    se_names = set()
    for row_list in (movements, edges):
        for row in row_list:
            if row.get("voucher_type") == "Stock Entry" and row.get("voucher_no"):
                se_names.add(row["voucher_no"])
    if not se_names:
        return

    SE = DocType("Stock Entry")
    rows = (
        frappe.qb.from_(SE)
        .select(SE.name, SE.stock_entry_type)
        .where(SE.name.isin(list(se_names)))
        .run(as_dict=True)
    )
    subtype_by_name = {r["name"]: r["stock_entry_type"] for r in rows}

    for row_list in (movements, edges):
        for row in row_list:
            if row.get("voucher_type") == "Stock Entry":
                row["voucher_subtype"] = subtype_by_name.get(row.get("voucher_no"))
            else:
                row["voucher_subtype"] = None


@frappe.whitelist()
def search_batches(query, limit=20):
    """Type-ahead for the batch input. Every whitespace-separated token must
    appear (as a substring) in the batch name or item."""
    q = (query or "").strip()
    if not q:
        return []
    try:
        limit = max(1, min(int(limit or 20), 50))
    except (TypeError, ValueError):
        limit = 20

    Batch = DocType("Batch")
    qb = frappe.qb.from_(Batch).select(Batch.name, Batch.item, Batch.batch_qty)
    for token in q.split():
        like = f"%{token}%"
        qb = qb.where(Batch.name.like(like) | Batch.item.like(like))
    return (
        qb.orderby(Batch.creation, order=frappe.qb.desc)
        .limit(limit)
        .run(as_dict=True)
    )


def _record_movement(movements, recorded_sabbs, sabb, batch, depth):
    key = (sabb["name"], batch)
    if key in recorded_sabbs:
        return
    recorded_sabbs.add(key)
    movements.append({
        "sabb": sabb["name"],
        "batch_no": batch,
        "item_code": sabb["item_code"],
        "warehouse": sabb["warehouse"],
        "type_of_transaction": sabb["type_of_transaction"],
        "qty": float(sabb["total_qty"] or 0),
        "voucher_type": sabb["voucher_type"],
        "voucher_no": sabb["voucher_no"],
        "posting_datetime": str(sabb["posting_datetime"] or ""),
        "depth": depth,
    })


def _record_edge(edges, edge_keys, from_b, to_b, voucher_type, voucher_no, sign, depth):
    key = (from_b, to_b, voucher_type, voucher_no)
    if key in edge_keys:
        return
    edge_keys.add(key)
    edges.append({
        "from_batch": from_b,
        "to_batch": to_b,
        "voucher_type": voucher_type,
        "voucher_no": voucher_no,
        "direction": sign,
        "depth": depth,
    })


def _walk(start_batch, sign, all_batches, recorded_sabbs, edge_keys,
          movements, edges, from_datetime, to_datetime, max_depth):
    """Breadth-first lineage walk, processed one depth level at a time.

    Processing a whole level together lets each lookup fan out across every
    batch at that depth in a single ``IN (...)`` query rather than one per batch.
    """
    walk_via, follow_into = _legs_for(sign)

    seen_batches = {start_batch}
    seen_pairs = set()   # (batch, sabb_name) already followed on the walk_via leg
    seen_sles = set()    # SLE names already consumed as origin or sibling

    level = [start_batch]
    depth = 0

    while level:
        if len(all_batches) > MAX_BATCHES_HARD_CAP:
            return True

        # At the limit, bridge one more hop to emit the frontier as stubs
        # (nodes + edges), but don't load their movements or enqueue them.
        at_boundary = depth >= max_depth

        sabbs_by_batch = _query_sabbs_for_batches(level, from_datetime, to_datetime)

        followable = []  # (batch, sabb) pairs to expand one lineage hop
        for batch in level:
            for sabb in sabbs_by_batch.get(batch, ()):
                _record_movement(movements, recorded_sabbs, sabb, batch, depth)
                if sabb["type_of_transaction"] != walk_via:
                    continue
                pair = (batch, sabb["name"])
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                followable.append((batch, sabb))

        if not followable:
            break

        origin_sabb_names = [sabb["name"] for _, sabb in followable]
        origin_sles_by_sabb = _query_sles_for_sabbs(origin_sabb_names)
        origin_sle_names = {
            sle["name"]
            for sles in origin_sles_by_sabb.values()
            for sle in sles
        }
        seen_sles.update(origin_sle_names)

        # Lineage is defined at the voucher level: any batch moved by the same
        # voucher is linked.
        voucher_keys = {
            (sle["voucher_type"], sle["voucher_no"])
            for sles in origin_sles_by_sabb.values()
            for sle in sles
        }

        # Seen SLEs are filtered in memory below rather than via a growing
        # NOT IN clause.
        siblings_by_voucher = _query_sibling_sles_for_vouchers(voucher_keys)

        next_sabb_names = set()
        for sib_list in siblings_by_voucher.values():
            for sib in sib_list:
                if sib["name"] in seen_sles:
                    continue
                seen_sles.add(sib["name"])
                if sib["serial_and_batch_bundle"]:
                    next_sabb_names.add(sib["serial_and_batch_bundle"])

        next_sabbs = {
            name: sabb
            for name, sabb in _query_sabbs_by_names(
                next_sabb_names, from_datetime, to_datetime
            ).items()
            if sabb["type_of_transaction"] == follow_into
        }
        batches_by_sabb = _query_batches_in_sabbs(next_sabbs.keys())

        next_level = []
        for batch, sabb in followable:
            for sle in origin_sles_by_sabb.get(sabb["name"], ()):
                voucher_type = sle["voucher_type"]
                voucher_no = sle["voucher_no"]
                for sib in siblings_by_voucher.get((voucher_type, voucher_no), ()):
                    next_sabb = next_sabbs.get(sib["serial_and_batch_bundle"])
                    if not next_sabb:
                        continue
                    for next_batch in batches_by_sabb.get(next_sabb["name"], ()):
                        # Same batch on both legs is a warehouse hop, not lineage.
                        if next_batch == batch:
                            continue
                        if not at_boundary:
                            _record_movement(
                                movements, recorded_sabbs, next_sabb, next_batch, depth + 1
                            )
                        from_b, to_b = (
                            (batch, next_batch) if sign == FORWARD
                            else (next_batch, batch)
                        )
                        _record_edge(
                            edges, edge_keys, from_b, to_b,
                            voucher_type, voucher_no, sign, depth + 1,
                        )
                        all_batches.add(next_batch)
                        if not at_boundary and next_batch not in seen_batches:
                            seen_batches.add(next_batch)
                            next_level.append(next_batch)

        if at_boundary:
            break
        level = next_level
        depth += 1

    return False


def _query_sabbs_for_batches(batches, from_datetime, to_datetime):
    """All SABBs touching any of ``batches``, grouped by batch_no."""
    result = {}
    if not batches:
        return result
    SBE = DocType("Serial and Batch Entry")
    SABB = DocType("Serial and Batch Bundle")
    ts = Timestamp(SABB.posting_date, SABB.posting_time)

    q = (
        frappe.qb.from_(SBE)
        .join(SABB).on(SABB.name == SBE.parent)
        .select(
            SBE.batch_no,
            SABB.name, SABB.item_code, SABB.warehouse,
            SABB.type_of_transaction, SABB.total_qty,
            SABB.voucher_type, SABB.voucher_no,
            ts.as_("posting_datetime"),
        )
        .where(SBE.batch_no.isin(list(batches)))
        .where(SBE.docstatus == 1)
        .where(SABB.docstatus == 1)
        .where(SABB.is_cancelled == 0)
        .distinct()
        .orderby(ts)
    )
    if from_datetime:
        q = q.where(ts >= from_datetime)
    if to_datetime:
        q = q.where(ts <= to_datetime)
    for row in q.run(as_dict=True):
        result.setdefault(row["batch_no"], []).append(row)
    return result


def _query_sles_for_sabbs(sabb_names):
    """Origin SLEs for the given SABBs, grouped by serial_and_batch_bundle."""
    result = {}
    if not sabb_names:
        return result
    SLE = DocType("Stock Ledger Entry")
    rows = (
        frappe.qb.from_(SLE)
        .select(
            SLE.name, SLE.voucher_type, SLE.voucher_no,
            SLE.serial_and_batch_bundle,
            SLE.item_code, SLE.warehouse, SLE.actual_qty,
        )
        .where(SLE.serial_and_batch_bundle.isin(list(sabb_names)))
        .where(SLE.is_cancelled == 0)
        .where(SLE.docstatus == 1)
        .run(as_dict=True)
    )
    for row in rows:
        result.setdefault(row["serial_and_batch_bundle"], []).append(row)
    return result


def _query_sibling_sles_for_vouchers(voucher_keys):
    """Sibling SLEs for the given (voucher_type, voucher_no) pairs, keyed by
    that pair. Vouchers are grouped by type so each type costs one query."""
    result = {}
    if not voucher_keys:
        return result
    SLE = DocType("Stock Ledger Entry")

    by_type = {}
    for voucher_type, voucher_no in voucher_keys:
        by_type.setdefault(voucher_type, set()).add(voucher_no)

    for voucher_type, voucher_nos in by_type.items():
        rows = (
            frappe.qb.from_(SLE)
            .select(
                SLE.name, SLE.voucher_type, SLE.voucher_no,
                SLE.serial_and_batch_bundle,
                SLE.item_code, SLE.warehouse, SLE.actual_qty,
            )
            .where(SLE.voucher_type == voucher_type)
            .where(SLE.voucher_no.isin(list(voucher_nos)))
            .where(SLE.is_cancelled == 0)
            .where(SLE.docstatus == 1)
            .run(as_dict=True)
        )
        for row in rows:
            result.setdefault((row["voucher_type"], row["voucher_no"]), []).append(row)
    return result


def _query_sabbs_by_names(sabb_names, from_datetime=None, to_datetime=None):
    """Fetch the given SABBs by name, keyed by name."""
    result = {}
    if not sabb_names:
        return result
    SABB = DocType("Serial and Batch Bundle")
    ts = Timestamp(SABB.posting_date, SABB.posting_time)
    q = (
        frappe.qb.from_(SABB)
        .select(
            SABB.name, SABB.item_code, SABB.warehouse,
            SABB.type_of_transaction, SABB.total_qty,
            SABB.voucher_type, SABB.voucher_no,
            ts.as_("posting_datetime"),
        )
        .where(SABB.name.isin(list(sabb_names)))
        .where(SABB.docstatus == 1)
        .where(SABB.is_cancelled == 0)
    )
    if from_datetime:
        q = q.where(ts >= from_datetime)
    if to_datetime:
        q = q.where(ts <= to_datetime)
    for row in q.run(as_dict=True):
        result[row["name"]] = row
    return result


def _query_batches_in_sabbs(sabb_names):
    """Distinct batch_no per parent SABB, keyed by parent."""
    result = {}
    sabb_names = list(sabb_names)
    if not sabb_names:
        return result
    SBE = DocType("Serial and Batch Entry")
    rows = (
        frappe.qb.from_(SBE)
        .select(SBE.parent, SBE.batch_no)
        .distinct()
        .where(SBE.parent.isin(sabb_names))
        .where(SBE.batch_no.isnotnull())
        .where(SBE.docstatus == 1)
        .run(as_dict=True)
    )
    for row in rows:
        result.setdefault(row["parent"], []).append(row["batch_no"])
    return result
