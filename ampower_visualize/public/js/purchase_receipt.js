// Copyright (c) 2026, Ambibuzz Technologies LLP and contributors
// For license information, please see license.txt

frappe.ui.form.on("Purchase Reciept", {
	refresh(frm) {
		if (frm.is_new()) return;
		frm.add_custom_button(__("Visualize"), function () {
			frappe.route_options = {
				doctype: "Purchase Reciept",
				docname: frm.docname,
			};
			frappe.set_route("document-traceability");
		});
	},
});