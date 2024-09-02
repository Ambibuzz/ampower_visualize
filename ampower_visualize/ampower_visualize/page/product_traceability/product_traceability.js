frappe.pages['product_traceability'].on_page_load = function (wrapper) {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Product Traceability',
		single_column: true
	});

	$(wrapper).find('.layout-main-section').append(`
        <div class="row">
            <div class="col-sm-3">
                <select id="sales_order_select" class="form-control">
                    <option value="">Select Sales Order</option>
                </select>
            </div>
            <div class="col-sm-9">
                <div id="node_display" class="linked-list"></div>
            </div>
        </div>
    `);

	frappe.call({
		method: 'ampower_visualize.ampower_visualize.page.product_traceability.product_traceability.get_sales_orders',
		callback: function (r) {
			if (r.message) {
				let sales_orders = r.message;
				let select = $('#sales_order_select');
				sales_orders.forEach(so => {
					select.append(`<option value="${so.name}">${so.name}</option>`);
				});
			}
		}
	});

	$('#sales_order_select').on('change', function () {
		let selected_order = $(this).val();
		if (selected_order) {
			display_sales_order_nodes(selected_order);
		}
	});
};

function display_sales_order_nodes(sales_order) {
	$('#node_display').empty();

	frappe.call({
		method: 'ampower_visualize.ampower_visualize.page.product_traceability.product_traceability.get_linked_documents',
		args: {
			sales_order: sales_order
		},
		callback: function (r) {
			if (r.message) {
				let linked_docs = r.message;

				let nodes_html = `
                    <div class="node parent-node" data-sales-order="${sales_order}">
                        <div class="node-content">
                            <span class="node-title">${sales_order}</span>
                        </div>
                    </div>
                    <div class="child-nodes-container" id="child-nodes-${sales_order}" style="display: none;">`;

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

				// click event to toggle visibility
				$(`.parent-node[data-sales-order="${sales_order}"]`).on('click', function () {
					$(`#child-nodes-${sales_order}`).toggle();
				});
			}
		}
	});
}
