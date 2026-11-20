import json
import random
import time
import unittest

import frappe

from ampower_visualize.ampower_visualize.page.warehouse_traceability import warehouse_traceability as api
from ampower_visualize.ampower_visualize.page.warehouse_traceability.stock_graph import MAX_LEDGER, MAX_MOVEMENTS

COMPANY = "Ambibuzz Technologies"
STORES = "Stores - AT"
TRANSIT = "Goods In Transit - AT"
FINISHED = "Finished Goods - AT"
WIP = "Work In Progress - AT"
START = "2025-01-15 10:00:00"
END = "2025-01-16 10:00:00"


class TestWarehouseTraceability(unittest.TestCase):
    def setUp(self):
        self.prefix = "WT-" + frappe.generate_hash(length=9)
        self.item = self.prefix + "-Item"
        self.scope = dict(company=COMPANY, from_datetime=START, to_datetime=END)
        self.sequence = 0

    def row(self, doctype, name=None, **fields):
        # Write only the historical records the trace reads, not live posting workflows.
        self.sequence += 1
        doc = frappe.get_doc(dict(doctype=doctype, name=name or f"{self.prefix}-{self.sequence}", **fields))
        doc.db_insert()
        return doc

    def batch(self, suffix, item=None):
        name = f"{self.prefix}-{suffix}"
        self.row("Batch", name, item=item or self.item)
        return name

    def voucher(self, subtype="Material Transfer", doctype="Stock Entry", status=1):
        fields = {"stock_entry_type": subtype} if doctype == "Stock Entry" else {}
        return self.row(doctype, docstatus=status, company=COMPANY, **fields).name

    def sle(self, voucher, warehouse, batch, qty, *, item=None, timestamp=START,
            voucher_type="Stock Entry", status=1, cancelled=0, bundle=None, detail=None, company=COMPANY):
        return self.row("Stock Ledger Entry", docstatus=status, is_cancelled=cancelled, warehouse=warehouse,
                        company=company, item_code=item or self.item, stock_uom="Nos", batch_no=batch,
                        serial_and_batch_bundle=bundle, voucher_type=voucher_type, voucher_no=voucher,
                        voucher_detail_no=detail, actual_qty=qty, posting_datetime=timestamp,
                        posting_date=timestamp[:10], posting_time=timestamp[11:]).name

    def bundle(self, warehouse, quantities, sign="Inward", cancelled=0, status=1):
        bundle = self.row("Serial and Batch Bundle", docstatus=status, is_cancelled=cancelled, company=COMPANY,
                          warehouse=warehouse, item_code=self.item, type_of_transaction=sign).name
        for batch, qty in quantities:
            self.row("Serial and Batch Entry", docstatus=status, parent=bundle, parenttype="Serial and Batch Bundle",
                     parentfield="entries", batch_no=batch, qty=qty, warehouse=warehouse)
        return bundle

    def test_frontiers_directions_and_exact_seed(self):
        # Isolate this history from the reconciliation fixture in the same test transaction.
        start, end = "2025-02-15 10:00:00", "2025-02-16 10:00:00"
        self.scope.update(from_datetime=start, to_datetime=end)
        batch, b2, b3, unrelated = (self.batch(n) for n in ("B1", "B2", "B3", "Other"))
        voucher = self.voucher()
        issue = self.sle(voucher, STORES, batch, -5, timestamp=start)
        receipt = self.sle(voucher, TRANSIT, batch, 5, timestamp=start)
        voucher2 = self.voucher()
        self.sle(voucher2, TRANSIT, batch, -5, timestamp=end)
        self.sle(voucher2, FINISHED, batch, 5, timestamp=end)
        self.sle(self.voucher("Material Receipt"), FINISHED, unrelated, 50, timestamp=start)
        zero = api.trace_warehouse(STORES, direction=1, max_depth=0, **self.scope)
        self.assertEqual({r["sle"] for r in zero["movements"]}, {issue, receipt})
        self.assertFalse(zero["truncated"])
        self.assertEqual({(l["source"], l["target"]) for l in zero["graph_links"]},
                         {(f"W::{STORES}", f"B::{batch}"), (f"B::{batch}", f"W::{TRANSIT}")})
        self.assertEqual({(r["qty"], r["posting_datetime"]) for r in zero["movements"]}, {(-5, start), (5, start)})
        full = api.trace_warehouse(STORES, direction=1, max_depth=1, **self.scope)
        self.assertEqual(full["visited_batches"], [batch])
        self.assertEqual({r["warehouse"] for r in full["movements"]}, {STORES, TRANSIT, FINISHED})
        back = api.trace_warehouse(FINISHED, direction=-1, max_depth=1, **self.scope)
        self.assertEqual({(l["source"], l["target"]) for l in back["graph_links"]},
                         {(l["source"], l["target"]) for l in full["graph_links"]}
                         | {(f"B::{unrelated}", f"W::{FINISHED}")})
        self.assertEqual(api.trace_warehouse(FINISHED, direction=0, max_depth=1, **self.scope)["visited_batches"], sorted([batch, unrelated]))
        self.assertEqual({r["warehouse"] for r in api.trace_batch(batch, max_depth=0, **self.scope)["movements"]}, {STORES, TRANSIT, FINISHED})
        dates = dict(self.scope, to_datetime=start)
        self.assertEqual(len(api.trace_batch(batch, **dates)["movements"]), 2)
        for source, target, wh1, wh2 in [(batch, b2, FINISHED, WIP), (b2, b3, WIP, TRANSIT)]:
            v = self.voucher("Repack")
            self.sle(v, wh1, source, -5, timestamp=start)
            self.sle(v, wh2, target, 3, item=f"item-for-{target}", timestamp=start)
        shallow = api.trace_batch(batch, direction=1, max_depth=0, **self.scope)
        self.assertIn(b2, shallow["visited_batches"])
        self.assertNotIn(b3, shallow["visited_batches"])
        result = api.trace_batch(batch, direction=1, max_depth=1, **self.scope)
        self.assertEqual(set(result["visited_batches"]), {batch, b2, b3})
        lineage = [l for l in result["graph_links"] if l["kind"] == "lineage"]
        self.assertEqual(len(lineage), 2)
        by_id = {r["id"]: r for r in result["movements"]}
        for link in random.Random(4501).sample(result["graph_links"], 4):
            for key in link["movement_ids"]:
                r = by_id[key]
                sle = frappe.db.get_value("Stock Ledger Entry", r["sle"], ["actual_qty", "warehouse", "voucher_no", "posting_datetime"], as_dict=True)
                self.assertEqual((r["qty"], r["warehouse"], r["voucher_no"], r["posting_datetime"]),
                                 (sle.actual_qty, sle.warehouse, sle.voucher_no, str(sle.posting_datetime)))
        for link in lineage:
            self.assertEqual([[by_id[s]["qty"], by_id[d]["qty"]] for s, d in link["pairs"]], [[-5, 3]])

    def test_bundle_reconciliation_legacy_and_permissions(self):
        b1, b2 = (self.batch(b) for b in ("A1", "A2"))
        bundle = self.bundle(STORES, [(b1, 1), (b1, 2), (b2, 4)])
        receipt = self.sle(self.voucher("Material Receipt"), STORES, b1, 7, bundle=bundle)
        return_voucher = self.voucher(doctype="Delivery Note")
        returned = self.sle(return_voucher, STORES, b1, 1, voucher_type="Delivery Note")
        self.sle(self.voucher("Material Issue"), STORES, b1, -1)
        self.sle(self.voucher(), STORES, b1, 999, cancelled=1)
        self.sle(self.voucher(), STORES, b1, 999, status=0)
        self.sle(self.voucher(status=2), STORES, b1, 999)
        self.sle(self.voucher(), STORES, b1, 999, bundle=self.bundle(STORES, [(b1, 999)], cancelled=1))
        self.sle(self.voucher(), STORES, b1, 999, timestamp="2025-01-14 12:00:00")
        self.sle(self.voucher(), STORES, b1, 999, company="Not selected")
        rec_type = "Stock Reconciliation"
        rec = self.voucher(doctype=rec_type)
        old = self.bundle(STORES, [(b1, -3), (b2, -4)], sign="Outward")
        new = self.bundle(STORES, [(b1, 5), (b2, 2)])
        detail = self.row("Stock Reconciliation Item", docstatus=1, parent=rec, parenttype=rec_type,
                          parentfield="items", serial_and_batch_bundle=new, current_serial_and_batch_bundle=old).name
        adjustment = self.sle(rec, STORES, None, 0, bundle=new, detail=detail, voucher_type=rec_type)
        expected = {receipt: {b1: 3, b2: 4}, adjustment: {b1: 2, b2: -2}, returned: {b1: 1}}
        result = api.trace_warehouse(STORES, **self.scope)
        for sle, qtys in expected.items():
            self.assertEqual({r["batch_no"]: r["qty"] for r in result["movements"] if r["sle"] == sle}, qtys)
        self.assertEqual(len(result["movements"]), 6)
        self.assertFalse(result["edges"])
        self.assertEqual([r.name for r in api.search_batches(f"{self.prefix} A2")], [b2])
        self.assertEqual([r.name for r in api.search_warehouses("Stores", COMPANY)], [STORES])
        with self.assertRaises(frappe.ValidationError):
            api.trace_warehouse("All Warehouses - AT", **self.scope)
        for values in ({"from_datetime": None}, {"from_datetime": "2025-01-17"}, {"company": None}):
            with self.assertRaises(frappe.ValidationError):
                api.trace_warehouse(STORES, **dict(self.scope, **values))
        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                api.trace_warehouse(STORES, **self.scope)
            with self.assertRaises(frappe.PermissionError):
                api.search_batches(self.prefix)
        finally:
            frappe.set_user(original)

    def test_caps_leave_usable_partial_graph(self):
        batch = self.batch("Load")
        voucher = self.voucher("Material Receipt")
        fields = ["name", "docstatus", "is_cancelled", "company", "warehouse", "item_code", "batch_no", "actual_qty",
                  "voucher_type", "voucher_no", "posting_datetime", "posting_date", "posting_time"]
        pop = [(f"{self.prefix}-SLE-{i:05}", 1, 0, COMPANY, STORES, self.item, batch, 1, "Stock Entry", voucher,
                "2025-01-18 00:00:00", "2025-01-18", "00:00:00") for i in range(MAX_LEDGER + 3)]
        frappe.db.bulk_insert("Stock Ledger Entry", fields, pop)
        started = time.perf_counter()
        result = api.trace_warehouse(STORES, company=COMPANY, from_datetime="2025-01-18 00:00:00", to_datetime="2025-01-18 00:00:00")
        elapsed = time.perf_counter() - started
        size = len(json.dumps(result))
        print(f"Warehouse cap fixture: {elapsed:.3f}s, {size} bytes, {len(result['movements'])} movements, {len(result['graph_links'])} links")
        self.assertTrue(result["truncated"])
        self.assertEqual(set(result["truncation_reasons"]), {"ledger entries", "movements"})
        self.assertEqual(len(result["movements"]), MAX_MOVEMENTS)
        self.assertEqual(len(result["graph_links"]), 1)
        self.assertLess(size, 500_000)
        self.assertLess(elapsed, 10)
