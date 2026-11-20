import unittest

import frappe

from ampower_visualize.ampower_visualize.page.warehouse_traceability import warehouse_traceability as api
from ampower_visualize.ampower_visualize.page.warehouse_traceability.stock_graph import MAX_LEDGER


COMPANY = "Ambibuzz Technologies"
STORES = "Stores - AT"
TRANSIT = "Goods In Transit - AT"
FINISHED = "Finished Goods - AT"
WIP = "Work In Progress - AT"
START = "2025-03-15 10:00:00"
END = "2025-03-16 10:00:00"


class TestScopedWarehouseTraceability(unittest.TestCase):
    def setUp(self):
        self.prefix = "WTS-" + frappe.generate_hash(length=9)
        self.item = self.prefix + "-item"
        self.scope = dict(company=COMPANY, from_datetime=START, to_datetime=END)
        self.sequence = 0

    def row(self, doctype, name=None, **fields):
        self.sequence += 1
        doc = frappe.get_doc(dict(doctype=doctype, name=name or f"{self.prefix}-{self.sequence}", **fields))
        doc.db_insert()
        return doc.name

    def batch(self, item=None):
        return self.row("Batch", item=item or self.item)

    def voucher(self, purpose="Material Transfer", subtype=None):
        return self.row("Stock Entry", docstatus=1, company=COMPANY, purpose=purpose,
                        stock_entry_type=subtype or purpose)

    def sle(self, voucher, warehouse, batch, qty, *, detail=None, item=None,
            bundle=None, voucher_type="Stock Entry"):
        timestamp = self.scope["from_datetime"]
        return self.row("Stock Ledger Entry", docstatus=1, is_cancelled=0, warehouse=warehouse,
                        company=COMPANY, item_code=item or self.item, stock_uom="Nos", batch_no=batch,
                        voucher_type=voucher_type, voucher_no=voucher, voucher_detail_no=detail,
                        serial_and_batch_bundle=bundle, actual_qty=qty, posting_datetime=timestamp,
                        posting_date=timestamp[:10], posting_time=timestamp[11:])

    def test_transfer_uses_the_same_line_and_batch(self):
        self.scope.update(from_datetime="2025-04-15 10:00:00", to_datetime="2025-04-15 10:00:00")
        b1, b2 = self.batch(), self.batch()
        v = self.voucher(subtype="Custom Transfer")
        a, b, c = (f"{self.prefix}-line-{n}" for n in "abc")
        issue = self.sle(v, STORES, b1, -5, detail=a)
        receipt = self.sle(v, TRANSIT, b1, 5, detail=a)
        self.sle(v, WIP, b2, -3, detail=b)
        self.sle(v, FINISHED, b2, 3, detail=b)
        self.sle(v, WIP, b1, -1, detail=c)
        self.sle(v, FINISHED, b1, 1, detail=c)
        extra = self.voucher()
        self.sle(extra, FINISHED, b2, -3, detail=b)
        self.sle(extra, WIP, b2, 3, detail=b)

        for warehouse, direction in ((STORES, 1), (TRANSIT, -1)):
            result = api.trace_warehouse(warehouse, direction=direction, max_depth=3, **self.scope)
            self.assertEqual(result["visited_batches"], [b1])
            movements = {r["sle"] for r in result["movements"] if r["voucher_no"] == v}
            self.assertEqual(movements, {issue, receipt})
            self.assertFalse(result["truncated"])

    def test_same_warehouse_repack_exposes_both_posted_legs(self):
        output_item = self.item + "-output"
        b1, b2 = self.batch(), self.batch(output_item)
        v = self.voucher("Repack", "Custom Repack")
        issue = self.sle(v, STORES, b1, -5, detail=self.prefix + "-raw")
        receipt = self.sle(v, STORES, b2, 3, detail=self.prefix + "-finished", item=output_item)
        result = api.trace_batch(b1, direction=1, max_depth=0, **self.scope)
        link, = [link for link in result["graph_links"] if link["kind"] == "lineage"]
        self.assertEqual((link["source"], link["target"]), (f"B::{b1}", f"B::{b2}"))
        self.assertEqual(link["pairs"], [[f"{issue}:{b1}", f"{receipt}:{b2}"]])
        by_id = {row["id"]: row for row in result["movements"]}
        self.assertEqual([(by_id[key]["qty"], by_id[key]["posting_datetime"], by_id[key]["voucher_no"])
                          for key in link["pairs"][0]], [(-5, START, v), (3, START, v)])

    def test_no_batch_permission_no_batch_data(self):
        batch = self.batch()
        voucher = self.voucher("Material Receipt")
        sle = self.sle(voucher, STORES, batch, 5)
        user = self.prefix.lower() + "@example.com"
        self.row("User", user, email=user, first_name="Trace test", enabled=1, user_type="System User")
        self.row("Has Role", parent=user, parenttype="User", parentfield="roles", role="Stock User")
        original = frappe.session.user
        try:
            frappe.set_user(user)
            for doctype, name in (("Company", COMPANY), ("Warehouse", STORES),
                                  ("Stock Entry", voucher), ("Stock Ledger Entry", sle)):
                self.assertTrue(frappe.has_permission(doctype, "read", doc=name), doctype)
            self.assertFalse(frappe.has_permission("Batch", "read", doc=batch))
            result = api.trace_warehouse(STORES, **self.scope)
            for key in ("visited_batches", "nodes", "movements", "edges", "graph_links"):
                self.assertEqual(result[key], [], key)
            with self.assertRaises(frappe.PermissionError):
                api.trace_batch(batch, **self.scope)
        finally:
            frappe.set_user(original)
        self.assertEqual([row["sle"] for row in api.trace_batch(batch, **self.scope)["movements"]], [sle])

    def test_authorized_stock_user_can_expand_returned_batch(self):
        self.scope.update(from_datetime="2025-06-15 10:00:00", to_datetime="2025-06-15 10:00:00")
        batch = self.batch()
        sle = self.sle(self.voucher("Material Receipt"), STORES, batch, 5)
        user = self.prefix.lower() + "@example.com"
        self.row("User", user, email=user, first_name="Trace test", enabled=1, user_type="System User")
        for role in ("Stock User", "Item Manager"):
            self.row("Has Role", parent=user, parenttype="User", parentfield="roles", role=role)
        original = frappe.session.user
        try:
            frappe.set_user(user)
            result = api.trace_warehouse(STORES, **self.scope)
            self.assertEqual(result["visited_batches"], [batch])
            expanded = api.trace_batch(batch, **self.scope)
            self.assertEqual([row["sle"] for row in expanded["movements"]], [sle])
        finally:
            frappe.set_user(original)

    def test_newer_irrelevant_stock_cannot_starve_seed_or_frontier(self):
        end = "2025-05-16 10:00:00"
        self.scope.update(from_datetime="2025-05-15 10:00:00", to_datetime=end)
        b1, other_batch = self.batch(), self.batch()
        v = self.voucher()
        line = self.prefix + "-move"
        issue = self.sle(v, STORES, b1, -5, detail=line)
        receipt = self.sle(v, TRANSIT, b1, 5, detail=line)
        extra = self.voucher()
        onward = self.sle(extra, TRANSIT, b1, -4)
        arrived = self.sle(extra, FINISHED, b1, 4)
        noise = self.voucher("Material Receipt")
        fields = ["name", "docstatus", "is_cancelled", "company", "warehouse", "item_code", "batch_no", "actual_qty",
                  "voucher_type", "voucher_no", "posting_datetime", "posting_date", "posting_time"]
        frappe.db.bulk_insert("Stock Ledger Entry", fields, [
            (f"{self.prefix}-noise-{i:05}", 1, 0, COMPANY, WIP if i % 2 else STORES, self.item,
             other_batch if i % 2 else None, 1, "Stock Entry", noise, end, end[:10], end[11:])
            for i in range(2 * MAX_LEDGER + 4)])
        shallow = api.trace_warehouse(STORES, direction=1, max_depth=0, **self.scope)
        self.assertEqual({r["sle"] for r in shallow["movements"]}, {issue, receipt})
        self.assertFalse(shallow["truncated"])
        for result in (api.trace_warehouse(STORES, direction=1, max_depth=1, **self.scope),
                       api.trace_batch(b1, direction=1, max_depth=1, **self.scope)):
            self.assertEqual({r["sle"] for r in result["movements"]}, {issue, receipt, onward, arrived})
            self.assertFalse(result["truncated"])

    def test_batch_lookup_sees_reconciliation_removal_only_in_before_bundle(self):
        b1, b2 = self.batch(), self.batch()
        kind = "Stock Reconciliation"
        voucher = self.row(kind, docstatus=1, company=COMPANY)
        before = self.row("Serial and Batch Bundle", docstatus=1, is_cancelled=0, company=COMPANY,
                          warehouse=STORES, item_code=self.item, type_of_transaction="Outward")
        after = self.row("Serial and Batch Bundle", docstatus=1, is_cancelled=0, company=COMPANY,
                         warehouse=STORES, item_code=self.item, type_of_transaction="Inward")
        for parent, batch, qty in ((before, b1, -5), (after, b2, 3)):
            self.row("Serial and Batch Entry", docstatus=1, parent=parent, parenttype="Serial and Batch Bundle",
                     parentfield="entries", batch_no=batch, qty=qty, warehouse=STORES)
        detail = self.row("Stock Reconciliation Item", docstatus=1, parent=voucher, parenttype=kind,
                          parentfield="items", current_serial_and_batch_bundle=before, serial_and_batch_bundle=after)
        sle = self.sle(voucher, STORES, None, -2, detail=detail, bundle=after, voucher_type=kind)
        result = api.trace_batch(b1, **self.scope)
        self.assertEqual([(row["sle"], row["batch_no"], row["qty"]) for row in result["movements"]],
                         [(sle, b1, -5)])
