frappe.pages['product_traceability'].on_page_load = function (wrapper) {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Product Traceability',
		single_column: true
	});
	setup_fields(page)
	$(wrapper).find('.layout-size-section').append(`
		<script type="importmap">
			{
				"imports": {
				"three": "https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js",
				"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.168.0/examples/jsm/"
				}
			}
		</script>
        <div class="row">
            <div class="col-sm-9">
                <div id="node_display" class="linked-list"></div>
            </div>
        </div>
    `);
};

var graph_configuration = []

function setup_fields(page) {
	let is_document_name_added = false;
	let is_field_name_added = false;
	let doctype_field = page.add_field({
		label: 'Document Type',
		fieldtype: 'Link',
		fieldname: 'document_type',
		options: 'DocType',
		change() {
			const doctype = doctype_field.get_value();
			if (!is_document_name_added) {
				is_document_name_added = true;
				let document_field = page.add_field({
					label: doctype_field.get_value(),
					fieldtype: 'Link',
					fieldname: 'document',
					options: doctype,
					change() {
						const document_name = document_field.get_value();
						if (document_name && !is_field_name_added) {
							is_field_name_added = true;
							configure_graph();
							render_graph(graph_configuration);
						}
					}
				});
			}
		}
	});
}

function configure_graph() {
	console.log('graph configured!');
}

function render_graph(message) {
	frappe.require('canvas.bundle.js').then(() => {
		window.get_animation(message);
	})
}

function display_linked_documents(doctype, docname) {
	frappe.call({
		method: 'ampower_visualize.ampower_visualize.page.product_traceability.product_traceability.get_linked_documents',
		args: {
			doctype: doctype,
			docname: docname
		},
		callback: function (r) {
			console.log(r.message)
		}
	});
}
