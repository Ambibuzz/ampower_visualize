from collections import deque

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

	return {
		"batch_no": batch_no,
		"direction": direction,
		"movements": movements,
		"visited_batches": sorted(all_batches),
		"edges": edges,
		"truncated": truncated,
	}


def _annotate_voucher_subtypes(movements, edges):
	se_names = {
		row["voucher_no"]
		for row in (movements + edges)
		if row.get("voucher_type") == "Stock Entry" and row.get("voucher_no")
	}
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

	for row in (movements + edges):
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


def _walk(start_batch, sign, all_batches, recorded_sabbs, edge_keys,
		  movements, edges, from_datetime, to_datetime, max_depth):
	walk_via, follow_into = _legs_for(sign)

	seen_batches = {start_batch}
	seen_pairs = set()
	seen_sles = set()

	queue = deque([(start_batch, 0)])
	truncated = False

	while queue:
		if len(all_batches) > MAX_BATCHES_HARD_CAP:
			truncated = True
			break

		batch, depth = queue.popleft()
		if depth > max_depth:
			continue

		for sabb in _query_sabbs_for_batch(batch, from_datetime, to_datetime):
			move_key = (sabb["name"], batch)
			if move_key not in recorded_sabbs:
				recorded_sabbs.add(move_key)
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
					"discovered_via": sign,
				})

			# At the depth limit we bridge one step to emit neighbour nodes +
			# edges (clickable stubs) but don't load their movements or recurse.
			at_boundary = depth >= max_depth

			if sabb["type_of_transaction"] != walk_via:
				continue

			pair = (batch, sabb["name"])
			if pair in seen_pairs:
				continue
			seen_pairs.add(pair)

			origin_sles = _query_sles_for_sabb(sabb["name"])
			if not origin_sles:
				continue

			origin_sle_names = {sle["name"] for sle in origin_sles}
			seen_sles.update(origin_sle_names)

			processed_vouchers = set()
			for origin_sle in origin_sles:
				voucher_key = (origin_sle["voucher_type"], origin_sle["voucher_no"])
				if voucher_key in processed_vouchers:
					continue
				processed_vouchers.add(voucher_key)

				sibling_sles = _query_sibling_sles_for_voucher(
					voucher_type=origin_sle["voucher_type"],
					voucher_no=origin_sle["voucher_no"],
					exclude_sle_names=origin_sle_names,
				)

				next_sabb_names = set()
				for sibling_sle in sibling_sles:
					if sibling_sle["name"] in seen_sles:
						continue
					seen_sles.add(sibling_sle["name"])
					if sibling_sle["serial_and_batch_bundle"]:
						next_sabb_names.add(sibling_sle["serial_and_batch_bundle"])

				for next_sabb_name in next_sabb_names:
					next_sabb = _query_sabb(next_sabb_name, from_datetime, to_datetime)
					if not next_sabb:
						continue
					if next_sabb["type_of_transaction"] != follow_into:
						continue

					for next_batch in _query_batches_in_sabb(next_sabb_name):
						# Same batch on both legs is a warehouse hop, not lineage.
						if next_batch == batch:
							continue

						# Boundary stubs get a node + edge but no movement rows.
						move_key = (next_sabb_name, next_batch)
						if not at_boundary and move_key not in recorded_sabbs:
							recorded_sabbs.add(move_key)
							movements.append({
								"sabb": next_sabb["name"],
								"batch_no": next_batch,
								"item_code": next_sabb["item_code"],
								"warehouse": next_sabb["warehouse"],
								"type_of_transaction": next_sabb["type_of_transaction"],
								"qty": float(next_sabb["total_qty"] or 0),
								"voucher_type": next_sabb["voucher_type"],
								"voucher_no": next_sabb["voucher_no"],
								"posting_datetime": str(next_sabb["posting_datetime"] or ""),
								"depth": depth + 1,
								"discovered_via": sign,
							})

						from_b, to_b = (
							(batch, next_batch) if sign == FORWARD
							else (next_batch, batch)
						)
						edge_key = (
							from_b, to_b,
							origin_sle["voucher_type"], origin_sle["voucher_no"],
						)
						if edge_key not in edge_keys:
							edge_keys.add(edge_key)
							edges.append({
								"from_batch": from_b,
								"to_batch": to_b,
								"voucher_type": origin_sle["voucher_type"],
								"voucher_no": origin_sle["voucher_no"],
								"direction": sign,
								"depth": depth + 1,
							})

						all_batches.add(next_batch)
						if not at_boundary and next_batch not in seen_batches:
							seen_batches.add(next_batch)
							queue.append((next_batch, depth + 1))

	return truncated


def _query_sabbs_for_batch(batch, from_datetime, to_datetime):
	SBE = DocType("Serial and Batch Entry")
	SABB = DocType("Serial and Batch Bundle")
	ts = Timestamp(SABB.posting_date, SABB.posting_time)

	q = (
		frappe.qb.from_(SBE)
		.join(SABB).on(SABB.name == SBE.parent)
		.select(
			SABB.name, SABB.item_code, SABB.warehouse,
			SABB.type_of_transaction, SABB.total_qty,
			SABB.voucher_type, SABB.voucher_no,
			ts.as_("posting_datetime"),
		)
		.where(SBE.batch_no == batch)
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
	return q.run(as_dict=True)


def _query_sles_for_sabb(sabb_name):
	SLE = DocType("Stock Ledger Entry")
	return (
		frappe.qb.from_(SLE)
		.select(
			SLE.name, SLE.voucher_type, SLE.voucher_no,
			SLE.serial_and_batch_bundle,
			SLE.item_code, SLE.warehouse, SLE.actual_qty,
		)
		.where(SLE.serial_and_batch_bundle == sabb_name)
		.where(SLE.is_cancelled == 0)
		.where(SLE.docstatus == 1)
		.run(as_dict=True)
	)


def _query_sibling_sles_for_voucher(voucher_type, voucher_no, exclude_sle_names):
	SLE = DocType("Stock Ledger Entry")
	q = (
		frappe.qb.from_(SLE)
		.select(
			SLE.name, SLE.voucher_type, SLE.voucher_no,
			SLE.serial_and_batch_bundle,
			SLE.item_code, SLE.warehouse, SLE.actual_qty,
		)
		.where(SLE.voucher_type == voucher_type)
		.where(SLE.voucher_no == voucher_no)
		.where(SLE.is_cancelled == 0)
		.where(SLE.docstatus == 1)
	)
	if exclude_sle_names:
		q = q.where(SLE.name.notin(list(exclude_sle_names)))
	return q.run(as_dict=True)


def _query_sabb(sabb_name, from_datetime=None, to_datetime=None):
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
		.where(SABB.name == sabb_name)
		.where(SABB.docstatus == 1)
		.where(SABB.is_cancelled == 0)
	)
	if from_datetime:
		q = q.where(ts >= from_datetime)
	if to_datetime:
		q = q.where(ts <= to_datetime)
	rows = q.run(as_dict=True)
	return rows[0] if rows else None


def _query_batches_in_sabb(sabb_name):
	SBE = DocType("Serial and Batch Entry")
	SABB = DocType("Serial and Batch Bundle")
	rows = (
		frappe.qb.from_(SBE)
		.join(SABB).on(SABB.name == SBE.parent)
		.select(SBE.batch_no)
		.distinct()
		.where(SBE.parent == sabb_name)
		.where(SBE.batch_no.isnotnull())
		.where(SBE.docstatus == 1)
		.where(SABB.docstatus == 1)
		.where(SABB.is_cancelled == 0)
		.run(as_list=True)
	)
	return [r[0] for r in rows]
