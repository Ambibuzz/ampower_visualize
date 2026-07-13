frappe.ui.form.on("Purchase Order", {
	refresh(frm) {
		if (frm.is_new()) return;
		frm.add_custom_button(__("Visualize"), function () {
			frappe.route_options = {
				doctype: "Purchase Order",
				docname: frm.docname,
			};
			frappe.set_route("document-traceability");
		});
	},
});