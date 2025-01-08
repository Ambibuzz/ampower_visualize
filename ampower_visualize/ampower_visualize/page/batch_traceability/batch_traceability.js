frappe.pages['batch_traceability'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Batch Traceability',
		single_column: true
	});
}