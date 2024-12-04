/**
 * wrapper cannot be passed back and forth from the appended html
 * hence needs to be maintained in the global scope
 * How does this work? Read about variable hoisting: https://developer.mozilla.org/en-US/docs/Glossary/Hoisting
 */
var global_wrapper;

/**
 * initializes a frappe page and wraps its elements inside a default wrapper
 */
frappe.pages['product_traceability'].on_page_load = (wrapper) => {
	global_wrapper = wrapper;
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Product Traceability',
		single_column: true
	});
	setup_fields(page, wrapper);
	append_static_html();
}

let previous_doctype_name = 'Select DocType', previous_document_name = 'Select Document'	// default value gets updated after selection

/**
 * created fields for user input and disables default onchange events
 * @param {Object} page
 * @param {Object} wrapper
 */
const setup_fields = (page, wrapper) => {
	let doctype_field = page.add_field({
		label: 'Select DocType',
		fieldtype: 'Link',
		fieldname: 'document_type',
		options: 'DocType',
		filters: {
			name: ["in", ["Sales Order"]]
		},
		change() {
			const doctype = doctype_field.get_value();
			if (doctype && doctype !== previous_doctype_name) {
				previous_doctype_name = doctype;
				update_document_field(page, doctype);
			}
		}
	});

	let document_field = page.add_field({
		label: 'Select Document',
		fieldtype: 'Link',
		fieldname: 'document',
		options: previous_doctype_name,
		get_query() {
			return {
				filters: {
					docstatus: 1
				}
			};
		},
		change() {
			const document_name = document_field.get_value();
			if (document_name && document_name !== previous_document_name) {
				previous_document_name = document_name;
				update_visualization(wrapper, previous_doctype_name, document_name);
			}
		}
	});
}

/**
 * Utility function to update the document fields
 */
const update_document_field = (page, doctype) => {
	const document_field = page.fields_dict.document;
	document_field.df.options = doctype;
	document_field.df.label = `Select ${doctype}`;
	document_field.refresh();
	document_field.set_value('');
}

/**
 * Re-populates the wrapper with dynamic HTML elements
 */
const update_visualization = (wrapper, doctype, document_name) => {
	$(wrapper).find('.top-level-parent').remove();
	append_dynamic_html(doctype, document_name);
}

/**
 * Appends static HTML script elements to the document
 * - includes functions for canvas events
 * - constant values that shouldn't be redeclared
 */
const append_static_html = () => {
	$(global_wrapper).find('.layout-main-section').append(`
		<script src="https://d3js.org/d3.v7.min.js"/>
	`);
}

/**
 * Appends dynamic HTML elements and scripts to the document
 * called every time the user changes the document_name or doctype
 * hence needs to be added dynamically
 * @param {String} doctype
 * @param {String} document_name
 */
const append_dynamic_html = (doctype, document_name) => {
	if (!doctype) {
		notify("No doctype specified");
		return;
	}
	if (!document_name) {
		notify("No document name specified");
		return;
	}
	$(global_wrapper).find('.layout-main-section').append(`
		<div class="top-level-parent">
			<script>
				configure_query_url('${doctype}', '${document_name}');
			</script>
		</div>
	`);
}

/**
 * configures corresponding backend functions depending on the doctype
 * @param {String} doctype
 * @param {String} document_name
 */
const configure_query_url = (doctype, document_name) => {
	if (!doctype || !document_name) {
		notify("Error parsing fields.", "red");
		return;
	}
	let method_type = 'ampower_visualize.ampower_visualize.page.product_traceability.product_traceability.';
	switch (doctype) {
		case 'Sales Order':
			method_type += 'get_sales_order_links';
			break;
		default:
			notify("This is the last node.", "red", 5);
			return;
	}
	const node_element = document.querySelector(`.top-level-parent`);
	get_graph_data(document_name, method_type, node_element);
}

/**
 * Fetches data from the backend function, formats it into a JSON that can be consumed directly by the library functions
 * @param {String} document_name
 * @param {String} method_type
 * @param {DOM Element} node_element
 */
const get_graph_data = (document_name, method_type, node_element) => {
	frappe.call({
		method: method_type,
		args: { document_name: document_name },
		callback: function (r) {
			if (!r.message || r.message.length === 0) {
				notify("Invalid data format or no items to display.", "red");
				return;
			}

			const data = r.message.items;
			const graph_data = { nodes: [], links: [] };
			const existing_nodes = new Set();

			data.forEach((item) => {
				const parent_node_id = `${item.item_code}-${item.sales_order_qty}`;
				if (!existing_nodes.has(parent_node_id)) {
					graph_data.nodes.push({
						id: parent_node_id,
						label: `${item.item_name}\n(${item.item_code})`,
						type: 'sales_order_item',
						qty: item.sales_order_qty,
						is_parent: true,
						expanded: false
					});
					existing_nodes.add(parent_node_id);
				}

				const add_connections = (connections, type) => {
					connections.forEach(connection => {
						const child_node_id = connection.unique_id;

						if (!existing_nodes.has(child_node_id)) {
							graph_data.nodes.push({
								id: child_node_id,
								label: `${connection[type]}`,
								type: type,
								qty: connection.qty,
								status: connection.status,
								is_parent: false
							});
							existing_nodes.add(child_node_id);
						}

						graph_data.links.push({
							source: parent_node_id,
							target: child_node_id
						});
					});
				};

				add_connections(item.sales_invoices, "sales_invoice");
				add_connections(item.delivery_notes, "delivery_note");
				add_connections(item.material_requests, "material_request");
				add_connections(item.purchase_orders, "purchase_order");
			});

			const root_node_id = "root";
			if (!existing_nodes.has(root_node_id)) {
				graph_data.nodes.push({
					id: root_node_id,
					label: document_name,
					type: "root",
					qty: '',
					is_parent: true,
					expanded: false,
				});
				existing_nodes.add(root_node_id);
			}

			const connectedNodeIds = new Set(graph_data.links.map(link => link.target));
			graph_data.nodes.forEach(node => {
				if (!connectedNodeIds.has(node.id) && node.id !== root_node_id) {
					graph_data.links.push({
						source: root_node_id,
						target: node.id
					});
				}
			});

			visualize_graph(graph_data, node_element);
		},
		freeze: true,
		freeze_message: __("Fetching linked documents...")
	});
};

/**
 * Creates a graph using the JSON data and appends it to the root node
 * @param {Dict} graph_data
 * @param {DOM Element} node_element
 */
const visualize_graph = (graph_data, node_element) => {
	const width = 1256, height = 720;
	d3.select(node_element).select("svg").remove();

	const svg = d3.select(node_element)
		.append("svg")
		.attr("width", width)
		.attr("height", height)
		.call(
			d3.zoom()
				.scaleExtent([0.1, 3])
				.on("zoom", event => {
					g.attr("transform", event.transform);
				})
		)
		.append("g");

	const g = svg.append("g");

	const parentNodes = graph_data.nodes.filter(node => node.is_parent);

	const nodeColors = {
		'sales_order_item': '#ff59d0',
		'sales_invoice': '#3498db',
		'delivery_note': '#e74c3c',
		'material_request': '#f39c12',
		'purchase_order': '#2ecc71',
		'purchase_invoice': '#9b59b6',
		'purchase_receipt': '#34495e',
		'root': '#b0b336'
	};

	const nodeSizes = {
		'sales_order_item': 60,
		'default': 36
	};

	const legendData = [
		{ type: 'root', label: 'Root Document' },
		{ type: 'sales_order_item', label: 'Sales Order Item' },
		{ type: 'sales_invoice', label: 'Sales Invoice' },
		{ type: 'delivery_note', label: 'Delivery Note' },
		{ type: 'material_request', label: 'Material Request' },
		{ type: 'purchase_order', label: 'Purchase Order' },
		{ type: 'purchase_invoice', label: 'Purchase Invoice' },
		{ type: 'purchase_receipt', label: 'Purchase Receipt' }
	];

	const legendGroup = svg.append("g")
		.attr("transform", `translate(20, 10)`);

	const legendItems = legendGroup.selectAll(".legend-item")
		.data(legendData)
		.enter()
		.append("g")
		.attr("transform", (d, i) => `translate(${i * 150}, 0)`);

	legendItems.append("rect")
		.attr("width", 20)
		.attr("height", 20)
		.attr("fill", d => nodeColors[d.type] || '#69b3a2')

	legendItems.append("text")
		.attr("x", 25)
		.attr("y", 15)
		.text(d => d.label)
		.style("fill", "#555555")
		.style("font-size", "12px");

	const format_document_url = (base_url, type, label) => {
		let formatted_label, document_name;
		if (type === "root") {
			formatted_label = "sales-order";
		}
		else if (type === "sales_order_item") {
			formatted_label = "item";
		}
		else formatted_label = type.replace(/_/g, '-');
		if (type === "sales_order_item") {
			document_name = label.match(/\((.*?)\)/)[1];
		}
		else document_name = label.split(' ')[0];
		return `${base_url}/app/${formatted_label}/${document_name}`;
	}

	const simulation = d3.forceSimulation(graph_data.nodes)
		.force("link", d3.forceLink(graph_data.links)
			.id(d => d.id)
			.distance(300)
		)
		.force("charge", d3.forceManyBody()
			.strength(-100)
		)
		.force("center", d3.forceCenter(width / 2, height / 2))
		.force("parent_repulsion", d => {
			for (let i = 0; i < graph_data.nodes.length; i++) {
				if (!graph_data.nodes[i].is_parent) {
					for (let j = 0; j < parentNodes.length; j++) {
						const parent = parentNodes[j];
						const node = graph_data.nodes[i];
						
						const dx = node.x - parent.x;
						const dy = node.y - parent.y;
						const distance = Math.sqrt(dx * dx + dy * dy);
						
						const strength = 0.5;
						node.vx += dx / distance * strength;
						node.vy += dy / distance * strength;
					}
				}
			}
		})
		.alphaDecay(0)
		.alphaMin(0.001)
		.alphaTarget(0.3);

	const link = g.append("g")
		.selectAll("line")
		.data(graph_data.links)
		.enter()
		.append("g");

		link.append("line")
		.attr("stroke", "#696C71")
		.attr("stroke-width", d => d.source.is_parent ? 2.5 : 1.5)
		.attr("stroke-opacity", 0.6);

		link.append("text")
		.attr("text-anchor", "end")
		.style("font-size", "14px")
		.style("fill", "#696C71")
		.text(d => `${d.target.status ? d.target.status + " [Qty: " + d.target.qty + "]" : ''}`);

	const node = g.append("g")
		.selectAll("rect")
		.data(graph_data.nodes)
		.enter()
		.append("rect")
		.attr("width", d => d.is_parent ? nodeSizes['sales_order_item'] : nodeSizes['default'])
		.attr("height", d => d.is_parent ? nodeSizes['sales_order_item'] : nodeSizes['default'])
		.attr("fill", d => nodeColors[d.type] || '#69b3a2')
		.attr("x", d => d.x - (d.is_parent ? nodeSizes['sales_order_item'] : nodeSizes['default']) / 2)
		.attr("y", d => d.y - (d.is_parent ? nodeSizes['sales_order_item'] : nodeSizes['default']) / 2)
		.call(d3.drag()
			.on("start", dragstarted)
			.on("drag", dragged)
			.on("end", dragended));

	const label = g.append("g")
		.selectAll("a")
		.data(graph_data.nodes)
		.enter()
		.append("a")
		.attr("xlink:href", d => format_document_url(window.location.origin, d.type, d.label))
		.attr("target", "_blank")
		.append("text")
		.text(d => d.label)
		.style("font-size", d => d.is_parent ? "12px" : "10px")
		.style("font-weight", d => d.is_parent ? "bold" : "normal")
		.style("fill", d => "#000")
		.attr("text-anchor", "middle")
		.attr("alignment-baseline", "middle");

	simulation.on("tick", () => {
		link
			.attr("x1", d => d.source.x)
			.attr("y1", d => d.source.y)
			.attr("x2", d => d.target.x)
			.attr("y2", d => d.target.y);
		
		link.selectAll("line")
			.attr("x1", d => d.source.x)
			.attr("y1", d => d.source.y)
			.attr("x2", d => d.target.x)
			.attr("y2", d => d.target.y);

		link.selectAll("text")
			.attr("x", d => (d.source.x + d.target.x) / 2)
			.attr("y", d => (d.source.y + d.target.y) / 2);

		node
			.attr("x", d => d.x - (d.is_parent ? nodeSizes['sales_order_item'] : nodeSizes['default']) / 2)
			.attr("y", d => d.y - (d.is_parent ? nodeSizes['sales_order_item'] : nodeSizes['default']) / 2);

		label
			.attr("x", d => d.x)
			.attr("y", d => d.y);
	});

	function dragstarted(event, d) {
		if (!event.active) simulation.alphaTarget(0.3).restart();
		d.fx = d.x;
		d.fy = d.y;
	}

	function dragged(event, d) {
		d.fx = event.x;
		d.fy = event.y;
	}

	function dragended(event, d) {
		if (!event.active) simulation.alphaTarget(0);
		d.fx = null;
		d.fy = null;
	}
};

/**
 * UTILITY FUNCTIONS
 */

// Sends frappe alerts
const notify = (message, indicator = "yellow", time = 3) => {	// default time and indicators set
	frappe.show_alert({
		message: __(message),
		indicator: indicator
	}, time);
}
