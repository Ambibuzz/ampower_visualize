frappe.pages['product_traceability'].on_page_load = function (wrapper) {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Product Traceability',
		single_column: true
	});
	setup_fields(page)
	$(wrapper).find('.layout-main-section').append(`
        <div class="row">
            <div class="col-sm-9">
                <div id="node_display" class="linked-list"></div>
            </div>
        </div>
    `);
};

frappe.pages['product_traceability'].on_page_show = function (wrapper) {
	frappe.require('canvas.bundle.js').then(() => {
		window.get_animation();
	})
}

function setup_fields(page) {
	let is_document_name_added = false;
	let is_field_name_added = false;
	let doctype_field = page.add_field({
		label: 'Document Type',
		fieldtype: 'Link',
		fieldname: 'document_type',
		options: 'DocType',
		change() {
			const doctype = doctype_field.get_value()
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
							display_linked_documents(doctype, document_name);
						}
					}
				});
			}
		}
	});
}

function display_linked_documents(doctype, docname) {
	$('#node_display').empty();

	frappe.call({
		method: 'ampower_visualize.ampower_visualize.page.product_traceability.product_traceability.get_linked_documents',
		args: {
			doctype: doctype,
			docname: docname
		},
		callback: function (r) {
			if (r.message) {
				let linked_docs = r.message;

				let nodes_html = `
                    <div class="node parent-node" data-docname="${docname}">
                        <div class="node-content">
                            <span class="node-title">${doctype}: ${docname}</span>
                        </div>
                    </div>
                    <div class="child-nodes-container" id="child-nodes-${docname}" style="display: none;">`;

				linked_docs.forEach(doc => {
					nodes_html += `
                        <div class="node child-node">
                            <div class="node-content">
                                <span class="node-title">${doc.doctype}: ${doc.name}</span>
                            </div>
                        </div>`;
				});

				nodes_html += `</div>`;

				$('#node_display').append(nodes_html);

				$(`.parent-node[data-docname="${docname}"]`).on('click', function () {
					$(`#child-nodes-${docname}`).toggle();
				});
			}
		}
	});
}
