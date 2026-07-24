# Copyright (c) 2026, Ambibuzz Technologies LLP and contributors
# For license information, please see license.txt

import frappe

DOCTYPE_ABBREV = {
	"Sales Order":      "SO",
	"Delivery Note":    "DN",
	"Sales Invoice":    "SI",
	"Material Request": "MR",
	"Purchase Order":   "PO",
	"Purchase Receipt": "PR",
	"Purchase Invoice": "PI",
	"Production Plan":  "PP",
	"Work Order":       "WO",
	"Job Card":         "JC",
	"Stock Entry":      "SE",
}

ITEM_ABBREV = {
	"Sales Order":      "SOI",
	"Delivery Note":    "DNI",
	"Sales Invoice":    "SII",
	"Material Request": "MRI",
	"Purchase Order":   "POI",
	"Purchase Receipt": "PRI",
	"Purchase Invoice": "PII",
	"Production Plan":  "PPI",
	"Work Order":       "WOI",
	"Job Card":         "JCI",
	"Stock Entry":      "SEI",
}

ITEMS_CHILD = {
	"Sales Order":      ("Sales Order Item",      ["item_code", "item_name", "qty", "uom", "rate", "amount"]),
	"Delivery Note":    ("Delivery Note Item",    ["item_code", "item_name", "qty", "uom"]),
	"Sales Invoice":    ("Sales Invoice Item",    ["item_code", "item_name", "qty", "uom", "rate", "amount"]),
	"Material Request": ("Material Request Item", ["item_code", "item_name", "qty", "uom"]),
	"Purchase Order":   ("Purchase Order Item",   ["item_code", "item_name", "qty", "uom", "rate", "amount"]),
	"Purchase Receipt": ("Purchase Receipt Item", ["item_code", "item_name", "qty", "uom"]),
	"Purchase Invoice": ("Purchase Invoice Item", ["item_code", "item_name", "qty", "uom", "rate", "amount"]),
	"Production Plan":  ("Production Plan Item",  ["item_code", "item_name", "planned_qty", "uom"]),
	"Job Card":         ("Job Card Item",         ["item_code", "transferred_qty"]),
	"Stock Entry":      ("Stock Entry Detail",    ["item_code", "item_name", "qty", "s_warehouse", "t_warehouse"]),
}

SUPPORTED_DOCTYPES = (
	"Sales Order", "Delivery Note", "Sales Invoice",
	"Material Request", "Purchase Order", "Purchase Receipt", "Purchase Invoice",
	"Production Plan", "Work Order", "Job Card", "Stock Entry",
)


@frappe.whitelist()
def get_document_trace(doctype, docname, include_items=0):
	"""
	Return a graph of nodes and edges for the given document.

	include_items=1 produces a radial item graph (root → item rows → linked docs).
	include_items=0 is retained for API compatibility but the UI always uses 1.
	"""
	if not doctype or not docname:
		frappe.throw("doctype and docname are required.")
	if doctype not in SUPPORTED_DOCTYPES:
		frappe.throw(f"Unsupported doctype: {doctype}")
	if not frappe.db.exists(doctype, docname):
		frappe.throw(f"{doctype} {docname!r} does not exist.")

	try:
		frappe.has_permission(doctype, doc=docname, throw=True)
		tracer = DocumentTracer(include_items=frappe.utils.cint(include_items))
		tracer.trace(doctype, docname)
		nodes = list(tracer.nodes.values())
		edges = tracer.edges
		if not nodes:
			frappe.log_error(
				f"No nodes returned for {doctype} {docname}",
				"Document Traceability: empty result",
			)
		return {"nodes": nodes, "edges": edges}
	except frappe.PermissionError:
		raise
	except frappe.ValidationError:
		raise
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Document Traceability: {doctype} {docname}")
		frappe.throw(
			"An error occurred while building the traceability graph. "
			"Details have been logged to the Error Log."
		)


@frappe.whitelist()
def get_document_items(doctype, docname):
	"""Return the child item rows for a document, used to populate the side panel."""
	frappe.has_permission(doctype, doc=docname, throw=True)
	if doctype == "Work Order":
		wo = frappe.get_value("Work Order", docname,
			["production_item", "item_name", "qty", "uom"], as_dict=True)
		if wo:
			return [{"item_code": wo.production_item, "item_name": wo.get("item_name") or "",
					 "qty": wo.qty, "uom": wo.uom}]
		return []
	cfg = ITEMS_CHILD.get(doctype)
	if not cfg:
		return []
	child_dt, fields = cfg
	items = frappe.get_all(child_dt, filters={"parent": docname},
		fields=fields, order_by="idx asc", limit=200)
	result = []
	for item in items:
		row = {}
		for k, v in item.items():
			if isinstance(v, float):
				v = round(v, 3) if v != int(v) else int(v)
			row[k] = v if v is not None else ""
		result.append(row)
	return result


class DocumentTracer:
	def __init__(self, include_items=False):
		"""Initialise an empty tracer. Set include_items=True for the radial item graph."""
		self.include_items  = bool(include_items)
		self.nodes          = {}
		self.edges          = []
		self._edge_set      = set()
		self._visited       = set()
		self._root_doctype  = None
		self._root_docname  = None

	def _nid(self, doctype, name):
		"""Return a stable node ID string for a document."""
		return f"{doctype}||{name}"

	def _add_node(self, doctype, name, role="doc"):
		"""
		Add a document node if it does not already exist.
		Returns the node ID.
		"""
		nid = self._nid(doctype, name)
		if nid in self.nodes:
			return nid
		try:
			values    = frappe.get_value(doctype, name, ["status", "docstatus"], as_dict=True) or {}
			docstatus = values.get("docstatus", 0)
			status    = values.get("status") or (
				"Submitted" if docstatus == 1 else
				"Cancelled" if docstatus == 2 else "Draft"
			)
		except Exception:
			status = ""
		self.nodes[nid] = {
			"id":      nid,
			"type":    "doc",
			"role":    role,
			"doctype": doctype,
			"name":    name,
			"abbrev":  DOCTYPE_ABBREV.get(doctype, doctype[:2].upper()),
			"status":  status,
			"url":     f"/app/{frappe.scrub(doctype).replace('_', '-')}/{name}",
		}
		return nid

	def _add_leaf_node(self, doctype, name, item_nid=None):
		"""
		Add a leaf document node in the radial item graph.

		When item_nid is supplied a unique node is created per (item, document)
		pair so the same document (e.g. DN-001) can appear separately for every
		item row that links to it.

		Generic sibling-exclusion rule: if the leaf's doctype matches the root
		document's doctype it is a sibling (e.g. another DN when visualising a DN)
		and is excluded. Returns None in that case so the caller skips the edge.
		"""
		if doctype == self._root_doctype:
			return None
		nid = f"leaf||{item_nid}||{doctype}||{name}" if item_nid else self._nid(doctype, name)
		if nid in self.nodes:
			return nid
		try:
			values    = frappe.get_value(doctype, name, ["status", "docstatus"], as_dict=True) or {}
			docstatus = values.get("docstatus", 0)
			status    = values.get("status") or (
				"Submitted" if docstatus == 1 else
				"Cancelled" if docstatus == 2 else "Draft"
			)
		except Exception:
			status = ""
		self.nodes[nid] = {
			"id":      nid,
			"type":    "doc",
			"role":    "leaf",
			"doctype": doctype,
			"name":    name,
			"abbrev":  DOCTYPE_ABBREV.get(doctype, doctype[:2].upper()),
			"status":  status,
			"url":     f"/app/{frappe.scrub(doctype).replace('_', '-')}/{name}",
		}
		return nid

	def _add_group_node(self, doctype, name):
		"""
		Add an intermediate group node representing a source document (SO, MR, PO)
		that is not the root but groups a set of item rows beneath it.
		Used to build the four-tier radial layout: root → group → item → leaf.
		"""
		nid = self._nid(doctype, name)
		if nid in self.nodes:
			return nid
		try:
			values    = frappe.get_value(doctype, name, ["status", "docstatus"], as_dict=True) or {}
			docstatus = values.get("docstatus", 0)
			status    = values.get("status") or (
				"Submitted" if docstatus == 1 else
				"Cancelled" if docstatus == 2 else "Draft"
			)
		except Exception:
			status = ""
		self.nodes[nid] = {
			"id":      nid,
			"type":    "doc",
			"role":    "group",
			"doctype": doctype,
			"name":    name,
			"abbrev":  DOCTYPE_ABBREV.get(doctype, doctype[:2].upper()),
			"status":  status,
			"url":     f"/app/{frappe.scrub(doctype).replace('_', '-')}/{name}",
		}
		return nid

	def _add_item_node(self, doctype, docname, row_name, item_code,
					   item_name="", qty=0, uom=""):
		"""Add an item-row node (SOI, MRI, POI …) for the radial item graph."""
		nid = f"item||{doctype}||{docname}||{row_name}"
		if nid in self.nodes:
			return nid
		self.nodes[nid] = {
			"id":        nid,
			"type":      "item",
			"role":      "item",
			"doctype":   doctype,
			"docname":   docname,
			"name":      row_name,
			"item_code": item_code,
			"item_name": item_name or item_code,
			"qty":       qty,
			"uom":       uom or "",
			"abbrev":    ITEM_ABBREV.get(doctype, doctype[:2].upper() + "I"),
			"url":       f"/app/{frappe.scrub(doctype).replace('_', '-')}/{docname}",
		}
		return nid

	def _add_edge(self, from_dt, from_name, to_dt, to_name, label="", dashed=False):
		"""Add a directed edge between two document nodes (deduplicates)."""
		key = (from_dt, from_name, to_dt, to_name)
		if key in self._edge_set:
			return
		self._edge_set.add(key)
		self.edges.append({
			"from":   self._nid(from_dt, from_name),
			"to":     self._nid(to_dt, to_name),
			"label":  label,
			"dashed": dashed,
		})

	def _add_item_edge(self, from_nid, to_nid, dashed=False):
		"""Add a directed edge between two item-graph nodes (deduplicates). Ignores None nids."""
		if not from_nid or not to_nid:
			return
		key = (from_nid, to_nid)
		if key in self._edge_set:
			return
		self._edge_set.add(key)
		self.edges.append({"from": from_nid, "to": to_nid, "label": "", "dashed": dashed})

	def _seen(self, key):
		"""Return True (and mark as visited) if key has been visited before."""
		if key in self._visited:
			return True
		self._visited.add(key)
		return False

	def trace(self, doctype, docname):
		"""
		Entry point. Populates self.nodes and self.edges for the given document.
		With include_items=True the result is a radial item graph; otherwise a
		flat document-level graph is returned.
		"""
		self._root_doctype = doctype
		self._root_docname = docname
		if self.include_items:
			doc_finder = DocumentTracer(include_items=False)
			doc_finder.trace(doctype, docname)
			self._build_radial_item_graph(doctype, docname, doc_finder.nodes)
		else:
			roots = self._find_roots(doctype, docname)
			for root_dt, root_name in roots:
				self._trace_forward(root_dt, root_name)

	def _build_radial_item_graph(self, root_doctype, root_docname, doc_nodes):
		"""
		Build a radial graph of either three or four tiers.

		Three-tier (root IS the SO/MR/PO):
		  root → item rows → linked docs

		Four-tier (root is a DN, SI, PR, etc. that links back to one or more SOs):
		  root → SO/MR/PO group → item rows → linked docs

		The extra group tier makes it clear which items belong to which source order
		when a single DN (or SI/PR) consolidates items from multiple orders.

		Priority: Sales Order > Material Request > Purchase Order.
		"""
		docs = {}
		for node in doc_nodes.values():
			docs.setdefault(node["doctype"], []).append(node["name"])

		self._add_node(root_doctype, root_docname, role="root")
		root_nid = self._nid(root_doctype, root_docname)

		if "Sales Order" in docs:
			for so_name in docs["Sales Order"]:
				if root_doctype == "Sales Order" and so_name == root_docname:
					self._trace_so_items_radial(so_name, root_nid)
				else:
					so_nid = self._add_group_node("Sales Order", so_name)
					self._add_item_edge(root_nid, so_nid)
					self._trace_so_items_radial(so_name, so_nid)

		elif "Material Request" in docs:
			for mr_name in docs["Material Request"]:
				if root_doctype == "Material Request" and mr_name == root_docname:
					self._trace_mr_items_radial(mr_name, root_nid)
				else:
					mr_nid = self._add_group_node("Material Request", mr_name)
					self._add_item_edge(root_nid, mr_nid)
					self._trace_mr_items_radial(mr_name, mr_nid)

		elif "Purchase Order" in docs:
			for po_name in docs["Purchase Order"]:
				if root_doctype == "Purchase Order" and po_name == root_docname:
					self._trace_po_items_radial(po_name, root_nid)
				else:
					po_nid = self._add_group_node("Purchase Order", po_name)
					self._add_item_edge(root_nid, po_nid)
					self._trace_po_items_radial(po_name, po_nid)

	def _trace_so_items_radial(self, so_name, parent_nid):
		"""
		Trace Sales Order items and their linked downstream documents.
		Creates item nodes for each SOI and leaf nodes for DN, SI, MR, PO, PR, PI.
		"""
		if self._seen(f"SO_RADIAL:{so_name}"):
			return
		for r in frappe.get_all("Sales Order Item",
			filters={"parent": so_name},
			fields=["name", "item_code", "item_name", "qty", "uom"],
			order_by="idx asc", limit=50):

			item_nid = self._add_item_node(
				"Sales Order", so_name, r.name,
				r.item_code, r.get("item_name") or "", r.qty, r.uom,
			)
			self._add_item_edge(parent_nid, item_nid)

			for d in frappe.get_all("Delivery Note Item",
				filters={"so_detail": r.name, "docstatus": ["!=", 2]},
				fields=["parent"], distinct=True, limit=20):
				self._add_item_edge(item_nid, self._add_leaf_node("Delivery Note", d.parent, item_nid))

			for d in frappe.get_all("Sales Invoice Item",
				filters={"so_detail": r.name, "docstatus": ["!=", 2]},
				fields=["parent"], distinct=True, limit=20):
				self._add_item_edge(item_nid, self._add_leaf_node("Sales Invoice", d.parent, item_nid))

			for d in frappe.get_all("Material Request Item",
				filters={"sales_order": so_name, "item_code": r.item_code, "docstatus": ["!=", 2]},
				fields=["parent"], distinct=True, limit=20):
				self._add_item_edge(item_nid, self._add_leaf_node("Material Request", d.parent, item_nid))

			for d in frappe.get_all("Purchase Order Item",
				filters={"sales_order": so_name, "item_code": r.item_code, "docstatus": ["!=", 2]},
				fields=["parent"], distinct=True, limit=20):
				self._add_item_edge(item_nid, self._add_leaf_node("Purchase Order", d.parent, item_nid))

			po_names = list({
				d.parent for d in frappe.get_all("Purchase Order Item",
					filters={"sales_order": so_name, "item_code": r.item_code, "docstatus": ["!=", 2]},
					fields=["parent"], distinct=True, limit=10)
			})
			for po_name in po_names:
				for d in frappe.get_all("Purchase Receipt Item",
					filters={"purchase_order": po_name, "item_code": r.item_code, "docstatus": ["!=", 2]},
					fields=["parent"], distinct=True, limit=10):
					self._add_item_edge(item_nid, self._add_leaf_node("Purchase Receipt", d.parent, item_nid))

				for d in frappe.get_all("Purchase Invoice Item",
					filters={"purchase_order": po_name, "item_code": r.item_code, "docstatus": ["!=", 2]},
					fields=["parent"], distinct=True, limit=10):
					self._add_item_edge(item_nid, self._add_leaf_node("Purchase Invoice", d.parent, item_nid))

	def _trace_mr_items_radial(self, mr_name, parent_nid):
		"""
		Trace Material Request items and their linked PO, PR, PI documents.
		Used when no Sales Order is present in the discovered document set.
		"""
		if self._seen(f"MR_RADIAL:{mr_name}"):
			return
		for r in frappe.get_all("Material Request Item",
			filters={"parent": mr_name},
			fields=["name", "item_code", "item_name", "qty", "uom"],
			order_by="idx asc", limit=50):

			item_nid = self._add_item_node(
				"Material Request", mr_name, r.name,
				r.item_code, r.get("item_name") or "", r.qty, r.uom,
			)
			self._add_item_edge(parent_nid, item_nid)

			for d in frappe.get_all("Purchase Order Item",
				filters={"material_request_item": r.name, "docstatus": ["!=", 2]},
				fields=["name", "parent"], distinct=True, limit=20):
				self._add_item_edge(item_nid, self._add_leaf_node("Purchase Order", d.parent, item_nid))
				for pr in frappe.get_all("Purchase Receipt Item",
					filters={"purchase_order": d.parent, "item_code": r.item_code, "docstatus": ["!=", 2]},
					fields=["parent"], distinct=True, limit=10):
					self._add_item_edge(item_nid, self._add_leaf_node("Purchase Receipt", pr.parent, item_nid))
				for pi in frappe.get_all("Purchase Invoice Item",
					filters={"purchase_order": d.parent, "item_code": r.item_code, "docstatus": ["!=", 2]},
					fields=["parent"], distinct=True, limit=10):
					self._add_item_edge(item_nid, self._add_leaf_node("Purchase Invoice", pi.parent, item_nid))

	def _trace_po_items_radial(self, po_name, parent_nid):
		"""
		Trace Purchase Order items and their linked PR and PI documents.
		Used as a fallback when neither SO nor MR is present.
		"""
		if self._seen(f"PO_RADIAL:{po_name}"):
			return
		for r in frappe.get_all("Purchase Order Item",
			filters={"parent": po_name},
			fields=["name", "item_code", "item_name", "qty", "uom"],
			order_by="idx asc", limit=50):

			item_nid = self._add_item_node(
				"Purchase Order", po_name, r.name,
				r.item_code, r.get("item_name") or "", r.qty, r.uom,
			)
			self._add_item_edge(parent_nid, item_nid)

			for d in frappe.get_all("Purchase Receipt Item",
				filters={"purchase_order_item": r.name, "docstatus": ["!=", 2]},
				fields=["parent"], distinct=True, limit=20):
				self._add_item_edge(item_nid, self._add_leaf_node("Purchase Receipt", d.parent, item_nid))

			for d in frappe.get_all("Purchase Invoice Item",
				filters={"po_detail": r.name, "docstatus": ["!=", 2]},
				fields=["parent"], distinct=True, limit=20):
				self._add_item_edge(item_nid, self._add_leaf_node("Purchase Invoice", d.parent, item_nid))

	def _find_roots(self, doctype, docname):
		"""
		Walk up the document chain to find the root Sales Order (or equivalent)
		for the flat document-graph mode. Returns a list of (doctype, name) tuples.
		"""
		if doctype == "Sales Order":
			return [("Sales Order", docname)]

		if doctype == "Delivery Note":
			sos = frappe.get_all("Delivery Note Item",
				filters={"parent": docname, "against_sales_order": ["!=", ""]},
				fields=["against_sales_order"], distinct=True)
			return [("Sales Order", r.against_sales_order) for r in sos] or [("Delivery Note", docname)]

		if doctype == "Sales Invoice":
			sos = frappe.get_all("Sales Invoice Item",
				filters={"parent": docname, "sales_order": ["!=", ""]},
				fields=["sales_order"], distinct=True)
			if sos:
				return [("Sales Order", r.sales_order) for r in sos]
			dns = frappe.get_all("Sales Invoice Item",
				filters={"parent": docname, "delivery_note": ["!=", ""]},
				fields=["delivery_note"], distinct=True)
			roots = []
			for r in dns:
				roots.extend(self._find_roots("Delivery Note", r.delivery_note))
			return roots or [("Sales Invoice", docname)]

		if doctype == "Material Request":
			sos = frappe.get_all("Material Request Item",
				filters={"parent": docname, "sales_order": ["!=", ""]},
				fields=["sales_order"], distinct=True)
			return [("Sales Order", r.sales_order) for r in sos] or [("Material Request", docname)]

		if doctype == "Purchase Order":
			sos = frappe.get_all("Purchase Order Item",
				filters={"parent": docname, "sales_order": ["!=", ""]},
				fields=["sales_order"], distinct=True)
			if sos:
				return [("Sales Order", r.sales_order) for r in sos]
			mrs = frappe.get_all("Purchase Order Item",
				filters={"parent": docname, "material_request": ["!=", ""]},
				fields=["material_request"], distinct=True)
			roots = []
			for r in mrs:
				roots.extend(self._find_roots("Material Request", r.material_request))
			return roots or [("Purchase Order", docname)]

		if doctype == "Purchase Receipt":
			pos = frappe.get_all("Purchase Receipt Item",
				filters={"parent": docname, "purchase_order": ["!=", ""]},
				fields=["purchase_order"], distinct=True)
			roots = []
			for r in pos:
				roots.extend(self._find_roots("Purchase Order", r.purchase_order))
			return roots or [("Purchase Receipt", docname)]

		if doctype == "Purchase Invoice":
			roots = []
			for row in frappe.get_all("Purchase Invoice Item",
				filters={"parent": docname, "purchase_order": ["!=", ""]},
				fields=["purchase_order"], distinct=True):
				roots.extend(self._find_roots("Purchase Order", row.purchase_order))
			if not roots:
				for row in frappe.get_all("Purchase Invoice Item",
					filters={"parent": docname, "purchase_receipt": ["!=", ""]},
					fields=["purchase_receipt"], distinct=True):
					roots.extend(self._find_roots("Purchase Receipt", row.purchase_receipt))
			return roots or [("Purchase Invoice", docname)]

		if doctype == "Production Plan":
			sos = frappe.get_all("Production Plan Sales Order",
				filters={"parent": docname, "sales_order": ["!=", ""]},
				fields=["sales_order"], distinct=True)
			return [("Sales Order", r.sales_order) for r in sos] or [("Production Plan", docname)]

		if doctype == "Work Order":
			pp = frappe.get_value("Work Order", docname, "production_plan")
			return self._find_roots("Production Plan", pp) if pp else [("Work Order", docname)]

		if doctype == "Job Card":
			wo = frappe.get_value("Job Card", docname, "work_order")
			return self._find_roots("Work Order", wo) if wo else [("Job Card", docname)]

		if doctype == "Stock Entry":
			wo = frappe.get_value("Stock Entry", docname, "work_order")
			return self._find_roots("Work Order", wo) if wo else [("Stock Entry", docname)]

		return [(doctype, docname)]

	def _trace_forward(self, doctype, name):
		"""Dispatch forward tracing to the appropriate method for the given doctype."""
		dispatch = {
			"Sales Order":      self._trace_so,
			"Delivery Note":    lambda n: (self._add_node("Delivery Note", n),    self._trace_dn(n)),
			"Sales Invoice":    lambda n:  self._add_node("Sales Invoice", n),
			"Material Request": lambda n: (self._add_node("Material Request", n), self._trace_mr(n)),
			"Purchase Order":   lambda n: (self._add_node("Purchase Order", n),   self._trace_po(n)),
			"Purchase Receipt": lambda n: (self._add_node("Purchase Receipt", n), self._trace_pr(n)),
			"Purchase Invoice": lambda n:  self._add_node("Purchase Invoice", n),
			"Production Plan":  lambda n: (self._add_node("Production Plan", n),  self._trace_pp(n)),
			"Work Order":       lambda n: (self._add_node("Work Order", n),       self._trace_wo(n)),
			"Job Card":         lambda n:  self._add_node("Job Card", n),
			"Stock Entry":      lambda n:  self._add_node("Stock Entry", n),
		}
		fn = dispatch.get(doctype)
		if fn:
			fn(name)

	def _trace_so(self, name):
		"""Trace a Sales Order forward to DN, SI, MR, PO, and Production Plan."""
		if self._seen(f"SO:{name}"):
			return
		self._add_node("Sales Order", name)
		for r in frappe.get_all("Delivery Note Item",
			filters={"against_sales_order": name, "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True):
			self._add_node("Delivery Note", r.parent)
			self._add_edge("Sales Order", name, "Delivery Note", r.parent)
			self._trace_dn(r.parent)
		for r in frappe.get_all("Sales Invoice Item",
			filters={"sales_order": name, "delivery_note": ["in", ["", None]], "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True):
			self._add_node("Sales Invoice", r.parent)
			self._add_edge("Sales Order", name, "Sales Invoice", r.parent, dashed=True)
		for r in frappe.get_all("Material Request Item",
			filters={"sales_order": name, "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True):
			self._add_node("Material Request", r.parent)
			self._add_edge("Sales Order", name, "Material Request", r.parent)
			self._trace_mr(r.parent)
		for r in frappe.get_all("Purchase Order Item",
			filters={"sales_order": name, "material_request": ["in", ["", None]], "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True):
			self._add_node("Purchase Order", r.parent)
			self._add_edge("Sales Order", name, "Purchase Order", r.parent, dashed=True)
			self._trace_po(r.parent)
		for r in frappe.get_all("Production Plan Sales Order",
			filters={"sales_order": name}, fields=["parent"], distinct=True):
			if frappe.get_value("Production Plan", r.parent, "docstatus") != 2:
				self._add_node("Production Plan", r.parent)
				self._add_edge("Sales Order", name, "Production Plan", r.parent)
				self._trace_pp(r.parent)

	def _trace_dn(self, name):
		"""Trace a Delivery Note forward to Sales Invoice."""
		if self._seen(f"DN:{name}"):
			return
		for r in frappe.get_all("Sales Invoice Item",
			filters={"delivery_note": name, "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True):
			self._add_node("Sales Invoice", r.parent)
			self._add_edge("Delivery Note", name, "Sales Invoice", r.parent)

	def _trace_mr(self, name):
		"""Trace a Material Request forward to Purchase Order."""
		if self._seen(f"MR:{name}"):
			return
		for r in frappe.get_all("Purchase Order Item",
			filters={"material_request": name, "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True):
			self._add_node("Purchase Order", r.parent)
			self._add_edge("Material Request", name, "Purchase Order", r.parent)
			self._trace_po(r.parent)

	def _trace_po(self, name):
		"""Trace a Purchase Order forward to Purchase Receipt and Purchase Invoice."""
		if self._seen(f"PO:{name}"):
			return
		for r in frappe.get_all("Purchase Receipt Item",
			filters={"purchase_order": name, "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True):
			self._add_node("Purchase Receipt", r.parent)
			self._add_edge("Purchase Order", name, "Purchase Receipt", r.parent)
			self._trace_pr(r.parent)
		for r in frappe.get_all("Purchase Invoice Item",
			filters={"purchase_order": name, "purchase_receipt": ["in", ["", None]], "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True):
			self._add_node("Purchase Invoice", r.parent)
			self._add_edge("Purchase Order", name, "Purchase Invoice", r.parent, dashed=True)

	def _trace_pr(self, name):
		"""Trace a Purchase Receipt forward to Purchase Invoice."""
		if self._seen(f"PR:{name}"):
			return
		for r in frappe.get_all("Purchase Invoice Item",
			filters={"purchase_receipt": name, "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True):
			self._add_node("Purchase Invoice", r.parent)
			self._add_edge("Purchase Receipt", name, "Purchase Invoice", r.parent)

	def _trace_pp(self, name):
		"""Trace a Production Plan forward to Work Orders."""
		if self._seen(f"PP:{name}"):
			return
		for r in frappe.get_all("Work Order",
			filters={"production_plan": name, "docstatus": ["!=", 2]}, fields=["name"]):
			self._add_node("Work Order", r.name)
			self._add_edge("Production Plan", name, "Work Order", r.name)
			self._trace_wo(r.name)

	def _trace_wo(self, name):
		"""Trace a Work Order forward to Job Cards and Stock Entries."""
		if self._seen(f"WO:{name}"):
			return
		for r in frappe.get_all("Job Card",
			filters={"work_order": name, "docstatus": ["!=", 2]}, fields=["name"]):
			self._add_node("Job Card", r.name)
			self._add_edge("Work Order", name, "Job Card", r.name)
		for r in frappe.get_all("Stock Entry",
			filters={"work_order": name, "docstatus": ["!=", 2]}, fields=["name"]):
			self._add_node("Stock Entry", r.name)
			self._add_edge("Work Order", name, "Stock Entry", r.name)