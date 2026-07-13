frappe.ui.form.on("Sales Invoice", {
	refresh(frm) {
		if (frm.is_new()) return;
		frm.add_custom_button(__("Visualize"), function () {
			frappe.route_options = {
				doctype: "Sales Invoice",
				docname: frm.docname,
			};
			frappe.set_route("document-traceability");
		});
	},
});