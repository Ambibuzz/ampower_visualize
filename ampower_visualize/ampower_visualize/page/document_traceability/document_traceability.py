import frappe

DOCTYPE_ABBREV = {
	"Sales Order":      "SO",
	"Delivery Note":    "DN",
	"Sales Invoice":    "SI",
	"Material Request": "MR",
	"Purchase Order":   "PO",
	"Purchase Receipt": "PR",
	"Purchase Invoice": "PI",
}


@frappe.whitelist()
def get_document_trace(doctype, docname):
	"""
	Return the full traceability graph for any supported document.
	Response: { nodes: [...], edges: [...] }
	"""
	frappe.has_permission(doctype, doc=docname, throw=True)
	tracer = DocumentTracer()
	tracer.trace(doctype, docname)
	return {
		"nodes": list(tracer.nodes.values()),
		"edges": tracer.edges,
	}


class DocumentTracer:
	def __init__(self):
		self.nodes     = {}
		self.edges     = []
		self._edge_set = set()
		self._visited  = set()

	def _nid(self, doctype, name):
		return f"{doctype}||{name}"

	def _add_node(self, doctype, name):
		nid = self._nid(doctype, name)
		if nid in self.nodes:
			return nid
		try:
			doc    = frappe.get_doc(doctype, name)
			status = doc.get("status") or (
				"Submitted" if doc.docstatus == 1 else
				"Cancelled" if doc.docstatus == 2 else "Draft"
			)
		except Exception:
			status = ""
		self.nodes[nid] = {
			"id":      nid,
			"doctype": doctype,
			"name":    name,
			"abbrev":  DOCTYPE_ABBREV.get(doctype, doctype[:2].upper()),
			"status":  status,
			"url":     f"/app/{frappe.scrub(doctype)}/{name}",
		}
		return nid

	def _add_edge(self, from_dt, from_name, to_dt, to_name, label="", dashed=False):
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

	def _seen(self, key):
		if key in self._visited:
			return True
		self._visited.add(key)
		return False

	def trace(self, doctype, docname):
		roots = self._find_roots(doctype, docname)
		for root_dt, root_name in roots:
			self._trace_forward(root_dt, root_name)

	def _find_roots(self, doctype, docname):
		if doctype == "Sales Order":
			return [("Sales Order", docname)]

		if doctype == "Delivery Note":
			sos = frappe.get_all(
				"Delivery Note Item",
				filters={"parent": docname, "against_sales_order": ["!=", ""]},
				fields=["against_sales_order"], distinct=True,
			)
			return [("Sales Order", r.against_sales_order) for r in sos] or [("Delivery Note", docname)]

		if doctype == "Sales Invoice":
			sos = frappe.get_all(
				"Sales Invoice Item",
				filters={"parent": docname, "sales_order": ["!=", ""]},
				fields=["sales_order"], distinct=True,
			)
			if sos:
				return [("Sales Order", r.sales_order) for r in sos]
			dns = frappe.get_all(
				"Sales Invoice Item",
				filters={"parent": docname, "delivery_note": ["!=", ""]},
				fields=["delivery_note"], distinct=True,
			)
			roots = []
			for r in dns:
				roots.extend(self._find_roots("Delivery Note", r.delivery_note))
			return roots or [("Sales Invoice", docname)]

		if doctype == "Material Request":
			sos = frappe.get_all(
				"Material Request Item",
				filters={"parent": docname, "sales_order": ["!=", ""]},
				fields=["sales_order"], distinct=True,
			)
			return [("Sales Order", r.sales_order) for r in sos] or [("Material Request", docname)]

		if doctype == "Purchase Order":
			sos = frappe.get_all(
				"Purchase Order Item",
				filters={"parent": docname, "sales_order": ["!=", ""]},
				fields=["sales_order"], distinct=True,
			)
			if sos:
				return [("Sales Order", r.sales_order) for r in sos]
			mrs = frappe.get_all(
				"Purchase Order Item",
				filters={"parent": docname, "material_request": ["!=", ""]},
				fields=["material_request"], distinct=True,
			)
			roots = []
			for r in mrs:
				roots.extend(self._find_roots("Material Request", r.material_request))
			return roots or [("Purchase Order", docname)]

		if doctype == "Purchase Receipt":
			pos = frappe.get_all(
				"Purchase Receipt Item",
				filters={"parent": docname, "purchase_order": ["!=", ""]},
				fields=["purchase_order"], distinct=True,
			)
			roots = []
			for r in pos:
				roots.extend(self._find_roots("Purchase Order", r.purchase_order))
			return roots or [("Purchase Receipt", docname)]

		if doctype == "Purchase Invoice":
			roots = []
			pos = frappe.get_all(
				"Purchase Invoice Item",
				filters={"parent": docname, "purchase_order": ["!=", ""]},
				fields=["purchase_order"], distinct=True,
			)
			for r in pos:
				roots.extend(self._find_roots("Purchase Order", r.purchase_order))
			if not roots:
				prs = frappe.get_all(
					"Purchase Invoice Item",
					filters={"parent": docname, "purchase_receipt": ["!=", ""]},
					fields=["purchase_receipt"], distinct=True,
				)
				for r in prs:
					roots.extend(self._find_roots("Purchase Receipt", r.purchase_receipt))
			if not roots:
				mrs = frappe.get_all(
					"Purchase Invoice Item",
					filters={"parent": docname, "material_request": ["!=", ""]},
					fields=["material_request"], distinct=True,
				)
				for r in mrs:
					roots.extend(self._find_roots("Material Request", r.material_request))
			return roots or [("Purchase Invoice", docname)]

		if doctype == "Production Plan":
			sos = frappe.get_all(
				"Production Plan Sales Order",
				filters={"parent": docname, "sales_order": ["!=", ""]},
				fields=["sales_order"], distinct=True,
			)
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
		dispatch = {
			"Sales Order":      self._trace_so,
			"Delivery Note":    lambda n: (self._add_node("Delivery Note", n),    self._trace_dn(n)),
			"Material Request": lambda n: (self._add_node("Material Request", n), self._trace_mr(n)),
			"Purchase Order":   lambda n: (self._add_node("Purchase Order", n),   self._trace_po(n)),
			"Production Plan":  lambda n: (self._add_node("Production Plan", n),  self._trace_pp(n)),
			"Work Order":       lambda n: (self._add_node("Work Order", n),       self._trace_wo(n)),
		}
		fn = dispatch.get(doctype)
		if fn:
			fn(name)

	def _trace_so(self, name):
		if self._seen(f"SO:{name}"):
			return
		self._add_node("Sales Order", name)

		for r in frappe.get_all(
			"Delivery Note Item",
			filters={"against_sales_order": name, "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True,
		):
			self._add_node("Delivery Note", r.parent)
			self._add_edge("Sales Order", name, "Delivery Note", r.parent, "against_sales_order")
			self._trace_dn(r.parent)

		for r in frappe.get_all(
			"Sales Invoice Item",
			filters={"sales_order": name, "delivery_note": ["in", ["", None]], "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True,
		):
			self._add_node("Sales Invoice", r.parent)
			self._add_edge("Sales Order", name, "Sales Invoice", r.parent, "sales_order", dashed=True)

		for r in frappe.get_all(
			"Material Request Item",
			filters={"sales_order": name, "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True,
		):
			self._add_node("Material Request", r.parent)
			self._add_edge("Sales Order", name, "Material Request", r.parent, "sales_order")
			self._trace_mr(r.parent)

		for r in frappe.get_all(
			"Purchase Order Item",
			filters={"sales_order": name, "material_request": ["in", ["", None]], "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True,
		):
			self._add_node("Purchase Order", r.parent)
			self._add_edge("Sales Order", name, "Purchase Order", r.parent, "sales_order", dashed=True)
			self._trace_po(r.parent)

		for r in frappe.get_all(
			"Production Plan Sales Order",
			filters={"sales_order": name},
			fields=["parent"], distinct=True,
		):
			if frappe.get_value("Production Plan", r.parent, "docstatus") != 2:
				self._add_node("Production Plan", r.parent)
				self._add_edge("Sales Order", name, "Production Plan", r.parent, "sales_order")
				self._trace_pp(r.parent)

	def _trace_dn(self, name):
		if self._seen(f"DN:{name}"):
			return
		for r in frappe.get_all(
			"Sales Invoice Item",
			filters={"delivery_note": name, "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True,
		):
			self._add_node("Sales Invoice", r.parent)
			self._add_edge("Delivery Note", name, "Sales Invoice", r.parent, "delivery_note")

	def _trace_mr(self, name):
		if self._seen(f"MR:{name}"):
			return
		for r in frappe.get_all(
			"Purchase Order Item",
			filters={"material_request": name, "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True,
		):
			self._add_node("Purchase Order", r.parent)
			self._add_edge("Material Request", name, "Purchase Order", r.parent, "material_request")
			self._trace_po(r.parent)
		for r in frappe.get_all(
			"Purchase Invoice Item",
			filters={"material_request": name, "purchase_order": ["in", ["", None]], "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True,
		):
			self._add_node("Purchase Invoice", r.parent)
			self._add_edge("Material Request", name, "Purchase Invoice", r.parent, "material_request", dashed=True)

	def _trace_po(self, name):
		if self._seen(f"PO:{name}"):
			return
		for r in frappe.get_all(
			"Purchase Receipt Item",
			filters={"purchase_order": name, "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True,
		):
			self._add_node("Purchase Receipt", r.parent)
			self._add_edge("Purchase Order", name, "Purchase Receipt", r.parent, "purchase_order")
			self._trace_pr(r.parent)
		for r in frappe.get_all(
			"Purchase Invoice Item",
			filters={"purchase_order": name, "purchase_receipt": ["in", ["", None]], "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True,
		):
			self._add_node("Purchase Invoice", r.parent)
			self._add_edge("Purchase Order", name, "Purchase Invoice", r.parent, "purchase_order", dashed=True)

	def _trace_pr(self, name):
		if self._seen(f"PR:{name}"):
			return
		for r in frappe.get_all(
			"Purchase Invoice Item",
			filters={"purchase_receipt": name, "docstatus": ["!=", 2]},
			fields=["parent"], distinct=True,
		):
			self._add_node("Purchase Invoice", r.parent)
			self._add_edge("Purchase Receipt", name, "Purchase Invoice", r.parent, "purchase_receipt")

	def _trace_pp(self, name):
		if self._seen(f"PP:{name}"):
			return
		for r in frappe.get_all(
			"Work Order",
			filters={"production_plan": name, "docstatus": ["!=", 2]},
			fields=["name"],
		):
			self._add_node("Work Order", r.name)
			self._add_edge("Production Plan", name, "Work Order", r.name, "production_plan")
			self._trace_wo(r.name)

	def _trace_wo(self, name):
		if self._seen(f"WO:{name}"):
			return
		for r in frappe.get_all(
			"Job Card",
			filters={"work_order": name, "docstatus": ["!=", 2]},
			fields=["name"],
		):
			self._add_node("Job Card", r.name)
			self._add_edge("Work Order", name, "Job Card", r.name, "work_order")
		for r in frappe.get_all(
			"Stock Entry",
			filters={"work_order": name, "docstatus": ["!=", 2]},
			fields=["name"],
		):
			self._add_node("Stock Entry", r.name)
			self._add_edge("Work Order", name, "Stock Entry", r.name, "work_order")