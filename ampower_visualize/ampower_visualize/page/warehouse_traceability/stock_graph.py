from collections import defaultdict, deque

import frappe
from frappe.desk.reportview import get_match_cond
from frappe.utils import flt, get_datetime
from pypika.terms import ExistsCriterion

MAX_LEDGER = 4000
MAX_CHILDREN = 8000
MAX_LEGS = 12000
MAX_MOVEMENTS = 400
MAX_BATCHES = 200
MAX_BRIDGES = 800
MAX_CHECKS = 20000


def require_read(doctype, name):
    if not name:
        frappe.throw(f"{doctype} is required.")
    frappe.has_permission(doctype, "read", doc=name, throw=True)
    if not frappe.get_list(doctype, filters={"name": name}, pluck="name", limit=1):
        frappe.throw(f"Cannot read the selected {doctype}.", frappe.PermissionError)


def trace(company, direction, start, end, depth, batch_no=None, warehouse=None):
    frappe.has_permission("Stock Ledger Entry", "read", throw=True)
    require_read("Company", company)
    if not start or not end:
        frappe.throw("Both From and To datetimes are required.")
    try:
        start, end = get_datetime(start), get_datetime(end)
        direction = int(direction)
    except (TypeError, ValueError, OverflowError):
        frappe.throw("Enter valid datetimes and a direction of -1, 0, or 1.")
    if not start or not end or start.tzinfo or end.tzinfo or start > end or direction not in (-1, 0, 1):
        frappe.throw("Enter an ordered date range in site time and a direction of -1, 0, or 1.")
    try:
        depth = max(0, min(int(depth), 50))
    except (TypeError, ValueError):
        depth = 2
    limits = set()
    return walk(Ledger(company, start, end, limits), batch_no, warehouse, direction, depth, limits)


def bridge_scope(row):
    # Only actual transformations can relate different items or batches on a voucher.
    if row.voucher_type == "Stock Entry" and row.stock_entry_purpose in {"Manufacture", "Repack", "Disassemble"}:
        return ()
    return (row.voucher_detail_no, row.item_code, row.batch_no)


def walk(ledger, batch_no, warehouse, direction, depth, limits):
    recorded, edges, links, bridges = {}, {}, {}, {}
    batches = {batch_no} if batch_no else set()
    signs = (1, -1) if direction == 0 else (direction,)
    queue = deque((sign, batch_no, warehouse, 0) for sign in signs)
    seen = {(s, batch_no, warehouse) for s in signs}
    followed = set()
    checks = 0

    def record(row, level):
        if row.id in recorded:
            recorded[row.id]["depth"] = min(recorded[row.id]["depth"], level)
            return True
        if len(recorded) >= MAX_MOVEMENTS:
            limits.add("movements")
            return False
        if row.batch_no not in batches and len(batches) >= MAX_BATCHES:
            limits.add("batches")
            return False
        batches.add(row.batch_no)
        movement = dict(row, depth=level)
        movement.pop("voucher_detail_no")
        movement.pop("stock_entry_purpose")
        recorded[row.id] = movement
        batch, wh = f"B::{row.batch_no}", f"W::{row.warehouse}"
        pair = (wh, batch) if row.type_of_transaction == "Outward" else (batch, wh)
        links.setdefault(pair, []).append(row.id)
        return True

    while queue and checks < MAX_CHECKS:
        sign, batch, location, level = queue.popleft()
        issue, receipt = ("Outward", "Inward") if sign == 1 else ("Inward", "Outward")
        rows = ledger.history(batch, location)
        for row in rows:
            checks += 1
            if checks >= MAX_CHECKS:
                break
            if not record(row, level) or row.type_of_transaction != issue or (sign, row.id) in followed:
                continue
            followed.add((sign, row.id))
            for other in ledger.siblings(row, receipt):
                checks += 1
                if checks >= MAX_CHECKS:
                    break
                src, dst = (row, other) if sign == 1 else (other, row)
                if src.sle == dst.sle:
                    continue
                edge_key = (src.batch_no, dst.batch_no, row.voucher_type, row.voucher_no)
                bridge_key = (src.id, dst.id)
                if bridge_key not in bridges and len(bridges) >= MAX_BRIDGES:
                    limits.add("bridges")
                    continue
                next_level = level + 1
                if not record(other, next_level):
                    continue
                edges.setdefault(edge_key, dict(from_batch=src.batch_no, to_batch=dst.batch_no,
                    voucher_type=row.voucher_type, voucher_no=row.voucher_no, voucher_subtype=row.voucher_subtype,
                    direction=sign, depth=next_level))
                bridges[bridge_key] = (src, dst)
                state = (sign, other.batch_no, other.warehouse if other.batch_no == row.batch_no else None)
                if level < depth and state not in seen:
                    seen.add(state)
                    queue.append((*state, next_level))
    if checks >= MAX_CHECKS:
        limits.add("walk")

    lineage = defaultdict(list)
    for src, dst in bridges.values():
        if src.batch_no != dst.batch_no:
            lineage[f"B::{src.batch_no}", f"B::{dst.batch_no}"].append([src.id, dst.id])
    nodes = {}
    graph_links = []
    for kind, groups in (("movement", links), ("lineage", lineage)):
        for (source, target), events in sorted(groups.items()):
            ids = events if kind == "movement" else [key for event in events for key in event]
            graph_links.append(dict(source=source, target=target, kind=kind,
                                    movement_ids=sorted(set(ids)), pairs=events if kind == "lineage" else [],
                                    depth=min(recorded[key]["depth"] for key in ids)))
            for key in (source, target):
                nodes[key] = dict(id=key, kind="batch" if key.startswith("B::") else "warehouse", label=key[3:])
    return dict(batch_no=batch_no, warehouse=warehouse, direction=direction,
                movements=sorted(recorded.values(), key=lambda m: (m["posting_datetime"], m["id"])),
                visited_batches=sorted(batches), edges=list(edges.values()), nodes=list(nodes.values()),
                graph_links=graph_links, truncated=bool(limits), truncation_reasons=sorted(limits))


class Ledger:
    """Cache normalized rows and spend one trace-wide budget on reachable scopes."""

    def __init__(self, company, start, end, limits):
        self.company, self.start, self.end = company, start, end
        self.limits = limits
        self.rows = {}
        self.scopes = {}
        self.batch_access = {}
        self.child_count = self.leg_count = 0
        self.can_read_batches = frappe.has_permission("Batch", "read")
        self.match = get_match_cond("Stock Ledger Entry") if self.can_read_batches else ""

    def history(self, batch, warehouse):
        return self.load(batch, warehouse)

    def siblings(self, row, side):
        scope = bridge_scope(row)
        voucher = (row.voucher_type, row.voucher_no)
        if scope:
            detail, item, batch = scope
            candidates = self.load(batch, None, voucher, (detail, item))
        else:
            candidates = self.load(None, None, voucher)
        return (other for other in candidates if other.type_of_transaction == side and bridge_scope(other) == scope)

    def load(self, batch, warehouse, voucher=None, line=None):
        if not self.can_read_batches:
            return []
        key = (batch, warehouse, voucher, line)
        if key in self.scopes:
            return self.scopes[key]
        sle = frappe.qb.DocType("Stock Ledger Entry")
        fields = ("name", "warehouse", "item_code", "batch_no", "actual_qty", "stock_uom", "posting_datetime",
                  "voucher_type", "voucher_no", "voucher_detail_no", "serial_and_batch_bundle")
        query = frappe.qb.from_(sle).select(*[sle[field] for field in fields]).where(
            (sle.company == self.company) & (sle.is_cancelled == 0) & (sle.docstatus == 1)
            & sle.posting_datetime.between(self.start, self.end) & batch_candidate(sle, batch))
        if warehouse:
            query = query.where(sle.warehouse == warehouse)
        if voucher:
            query = query.where((sle.voucher_type == voucher[0]) & (sle.voucher_no == voucher[1]))
        if line:
            detail, item = line
            query = query.where(sle.item_code == item).where(
                sle.voucher_detail_no == detail if detail else (sle.voucher_detail_no.isnull() | (sle.voucher_detail_no == "")))
        # Frappe supplies the permission predicate; query-builder values remain bound.
        sql, values = query.walk()
        rows = frappe.db.sql(sql + (self.match or "") +
            f" ORDER BY `tabStock Ledger Entry`.`posting_datetime` DESC, `tabStock Ledger Entry`.`name` ASC LIMIT {MAX_LEDGER + 1}",
            values, as_dict=True)
        if len(rows) > MAX_LEDGER:
            self.limits.add("ledger entries")
        pending = []
        for row in rows[:MAX_LEDGER]:
            if row.name not in self.rows:
                if len(self.rows) >= MAX_LEDGER:
                    self.limits.add("ledger entries")
                    continue
                self.rows[row.name] = []
                pending.append(row)
        if pending:
            for leg in normalize_legs(self, pending):
                self.rows[leg.sle].append(leg)
        result = [leg for row in rows[:MAX_LEDGER] for leg in self.rows.get(row.name, ())
                  if not batch or leg.batch_no == batch]
        self.scopes[key] = result
        return result


def batch_candidate(sle, batch):
    """Filter before the ledger cap, including batches removed by reconciliation."""
    bundle, entry, detail = (frappe.qb.DocType(dt) for dt in (
        "Serial and Batch Bundle", "Serial and Batch Entry", "Stock Reconciliation Item"))

    def has_entries(references):
        query = frappe.qb.from_(bundle).join(entry).on(entry.parent == bundle.name).select(entry.name).where(
            references & (bundle.docstatus == 1) & (bundle.is_cancelled == 0) & (bundle.company == sle.company)
            & (bundle.item_code == sle.item_code) & (bundle.warehouse == sle.warehouse)
            & (entry.docstatus == 1) & (entry.parenttype == "Serial and Batch Bundle")
            & (entry.warehouse.isnull() | (entry.warehouse == "") | (entry.warehouse == sle.warehouse)))
        return ExistsCriterion(query.where(entry.batch_no == batch if batch else entry.batch_no != ""))

    reconciliation = frappe.qb.from_(detail).select(detail.name).where(
        (detail.name == sle.voucher_detail_no) & (detail.parent == sle.voucher_no) & has_entries(
            (bundle.name == detail.current_serial_and_batch_bundle) | (bundle.name == detail.serial_and_batch_bundle)))
    legacy = sle.batch_no == batch if batch else sle.batch_no != ""
    return legacy | has_entries(bundle.name == sle.serial_and_batch_bundle) | (
        (sle.voucher_type == "Stock Reconciliation") & ExistsCriterion(reconciliation))


def normalize_legs(ledger, rows):
    company, limits = ledger.company, ledger.limits
    warehouses = sorted({r.warehouse for r in rows if r.warehouse})
    allowed = set(frappe.get_list("Warehouse", filters={"name": ["in", warehouses],
                  "company": company, "is_group": 0}, pluck="name", limit=len(warehouses))) if warehouses else set()
    vouchers = defaultdict(set)
    for row in rows:
        if row.warehouse in allowed and row.voucher_type and row.voucher_no:
            vouchers[row.voucher_type].add(row.voucher_no)
    visible = {}
    for dt, names in vouchers.items():
        if not frappe.db.exists("DocType", dt) or not frappe.has_permission(dt, "read"):
            continue
        fields = ["name", "stock_entry_type", "purpose"] if dt == "Stock Entry" else ["name"]
        for r in frappe.get_list(dt, filters={"name": ["in", sorted(names)], "docstatus": 1}, fields=fields, limit=len(names)):
            visible[dt, r.name] = r
    rows = [r for r in rows if r.warehouse in allowed and (r.voucher_type, r.voucher_no) in visible]
    reconciliation = sorted({r.voucher_detail_no for r in rows if r.voucher_type == "Stock Reconciliation" and r.voucher_detail_no})
    details = {r.name: r for r in frappe.get_all("Stock Reconciliation Item", filters={"name": ["in", reconciliation]},
        fields=["name", "parent", "serial_and_batch_bundle", "current_serial_and_batch_bundle"],
        limit=len(reconciliation))} if reconciliation else {}
    names = {r.serial_and_batch_bundle for r in rows if r.serial_and_batch_bundle}
    for detail in details.values():
        names.update(value for value in (detail.serial_and_batch_bundle, detail.current_serial_and_batch_bundle) if value)
    bundles = {r.name: r for r in frappe.get_all("Serial and Batch Bundle", filters={"name": ["in", sorted(names)],
        "company": company, "is_cancelled": 0, "docstatus": 1}, fields=["name", "item_code", "warehouse", "type_of_transaction"],
        limit=len(names))} if names else {}
    children = defaultdict(lambda: defaultdict(float))
    incomplete = set()
    if bundles:
        remaining = MAX_CHILDREN - ledger.child_count
        entries = frappe.get_all("Serial and Batch Entry", filters={"parent": ["in", sorted(bundles)],
            "parenttype": "Serial and Batch Bundle", "docstatus": 1, "batch_no": ["is", "set"]},
            fields=["parent", "batch_no", "qty", "warehouse"], order_by="parent asc, name asc", limit=remaining + 1)
        if len(entries) > remaining:
            limits.add("batch entries")
            incomplete = {name for name in bundles if name >= entries[remaining].parent}
        ledger.child_count += min(len(entries), remaining)
        for e in entries[:remaining]:
            if e.parent not in incomplete and (not e.warehouse or e.warehouse == bundles[e.parent].warehouse):
                children[e.parent][e.batch_no] += flt(e.qty)

    batch_names = {r.batch_no for r in rows if r.batch_no}
    for quantities in children.values():
        batch_names.update(quantities)
    unknown = sorted(batch_names - ledger.batch_access.keys())
    if unknown:
        allowed_batches = set(frappe.get_list("Batch", filters={"name": ["in", unknown]}, pluck="name", limit=len(unknown)))
        ledger.batch_access.update((name, name in allowed_batches and
            frappe.has_permission("Batch", "read", doc=name)) for name in unknown)

    def quantities(name, row):
        bundle = bundles.get(name)
        return children[name] if bundle and bundle.item_code == row.item_code and bundle.warehouse == row.warehouse else {}

    legs = []
    for r in rows:
        detail = details.get(r.voucher_detail_no) if r.voucher_type == "Stock Reconciliation" else None
        bundle = r.serial_and_batch_bundle
        if detail and detail.parent == r.voucher_no and (detail.current_serial_and_batch_bundle or detail.serial_and_batch_bundle):
            before, after = detail.current_serial_and_batch_bundle, detail.serial_and_batch_bundle
            if any(name and not quantities(name, r) for name in (before, after)):
                continue
            old, new = quantities(before, r), quantities(after, r)
            qtys = {key: abs(new.get(key, 0)) - abs(old.get(key, 0)) for key in sorted(old.keys() | new.keys())}
        elif bundle:
            if bundle not in bundles or bundle in incomplete:
                continue
            qtys = quantities(bundle, r)
            if qtys:
                sign = -1 if bundles[bundle].type_of_transaction == "Outward" else 1
                qtys = {key: sign * abs(value) for key, value in qtys.items()}
            elif r.batch_no:
                qtys = {r.batch_no: flt(r.actual_qty)}
        else:
            qtys = {r.batch_no: flt(r.actual_qty)} if r.batch_no else {}
        for batch, qty in sorted(qtys.items()):
            if not qty or not ledger.batch_access.get(batch):
                continue
            if ledger.leg_count >= MAX_LEGS:
                limits.add("normalized stock legs")
                return legs
            ledger.leg_count += 1
            voucher = visible[r.voucher_type, r.voucher_no]
            legs.append(frappe._dict(id=f"{r.name}:{batch}", sle=r.name, sabb=bundle or None, batch_no=batch,
                item_code=r.item_code, warehouse=r.warehouse, type_of_transaction="Inward" if qty > 0 else "Outward",
                qty=qty, stock_uom=r.stock_uom, voucher_type=r.voucher_type, voucher_no=r.voucher_no,
                voucher_subtype=voucher.get("stock_entry_type"), posting_datetime=str(r.posting_datetime),
                voucher_detail_no=r.voucher_detail_no or None, stock_entry_purpose=voucher.get("purpose") or voucher.get("stock_entry_type")))
    return legs
