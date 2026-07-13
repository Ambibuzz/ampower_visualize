frappe.ui.form.on("Delivery Note", {
	refresh(frm) {
		if (frm.is_new()) return;
		frm.add_custom_button(__("Visualize"), function () {
			frappe.route_options = {
				doctype: "Delivery Note",
				docname: frm.docname,
			};
			frappe.set_route("document-traceability");
		});
	},
});