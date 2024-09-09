frappe.pages['product_traceability'].on_page_load = function (wrapper) {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Product Traceability',
		single_column: true
	});
	setup_fields(page, wrapper)
};

function setup_fields(page, wrapper) {
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
							display_linked_documents(wrapper, doctype, document_name)
						}
					}
				});
			}
		}
	});
}

function log_to_console() {
	console.log("Log function called from appended html")
}

const append_base_html = (data, wrapper, document_name) => {
	$(wrapper).find('.layout-main-section').append(`
        <div class="row">
            <div class="col-sm-9">
                <div id="node_display" class="linked-list">The documents linked to ${document_name} are:</div>
				<ul>
				    ${data.map((doc) => `<li>${doc.linked_doctype} - ${doc.linked_parent}</li>`).join('')}
				</ul>
            </div>
			<button onclick="log_to_console()">
				LOG ON CONSOLE
			</button>
        </div>
    `);
}

const display_linked_documents = (wrapper, doctype, docname) => {
	frappe.call({
		method: 'ampower_visualize.ampower_visualize.page.product_traceability.product_traceability.get_linked_documents',
		args: {
			doctype: doctype,
			docname: docname
		},
		callback: function (r) {
			console.log(r.message)
			append_base_html(r.message, wrapper, docname);
		}
	});
}
