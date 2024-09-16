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

/**
 * created fields for user input and disables default onchange events
 * @field {String} doctype
 * @field {String} document_name
 */
const setup_fields = (page, wrapper) => {
	let previous_document_name, previous_doctype_name;
	let doctype_field = page.add_field({
		label: 'Document Type',
		fieldtype: 'Link',
		fieldname: 'document_type',
		options: 'DocType',
		change() {
			const doctype = doctype_field.get_value();
			if (doctype !== previous_doctype_name) {
				page.clear_fields();
				setup_fields(page, wrapper);
				previous_doctype_name = doctype;
				let document_field = page.add_field({
					label: doctype_field.get_value(),
					fieldtype: 'Link',
					fieldname: 'document',
					options: doctype,
					change() {
						const document_name = document_field.get_value();
						if (document_name !== previous_document_name) {
							$(wrapper).find('.top-level-parent').remove();
							previous_document_name = document_name;
							append_dynamic_html(doctype, document_name);
						}
					}
				});
			}
		}
	});
}

/**
 * Appends static HTML script elements to the document
 */
const append_static_html = () => {
	$(global_wrapper).find('.layout-main-section').append(`
		<script>
			let isDragging = false;
			let startX, startY;
			let offsetX = 0, offsetY = 0;
			let scale = 1;
			const updateTransform = () => {
				document.getElementById('canvas').style.transform = \`translate(\${offsetX}px, \${offsetY}px) scale(\${scale})\`;
			}
			const handleMouseDown = (e) => {
				isDragging = true;
				startX = e.clientX - offsetX;
				startY = e.clientY - offsetY;
				document.getElementById('canvas-container').style.cursor = 'grabbing';
			}
			const handleMouseMove = (e) => {
				if (isDragging) {
					offsetX = e.clientX - startX;
					offsetY = e.clientY - startY;
					updateTransform();
				}
			}
			const handleMouseUp = () => {
				isDragging = false;
				document.getElementById('canvas-container').style.cursor = 'move';
			}
		</script>
	`);
}

/**
 * Appends dynamic HTML elements and scripts to the document
 * called every time the user changes the document_name or doctype
 * hence needs to be added dynamically
 */
const append_dynamic_html = (doctype, document_name) => {
	$(global_wrapper).find('.layout-main-section').append(`
		<div class="top-level-parent">
			<script>
				document.getElementById('canvas-container').addEventListener('mousedown', handleMouseDown);
				document.getElementById('canvas-container').addEventListener('mousemove', handleMouseMove);
				document.getElementById('canvas-container').addEventListener('mouseup', handleMouseUp);
				document.getElementById('canvas-container').addEventListener('mouseleave', handleMouseUp);
				refresh_list_properties();
			</script>
			<style>
				.layer-wrapper{display:flex;align-items:center;justify-content:center;margin-top:5vh}#canvas-container{width:1000px;height:600px;background-color:#005ce6;border:1px solid #000;box-shadow:0 0 10px rgb(0 0 0 / .1);overflow:hidden;cursor:move}#canvas{position:relative;width:9999px;height:9999px}.tree{width:9999px;height:9999px}.tree ul{padding-top:20px;position:relative;transition:.5s}.tree li{display:inline-table;text-align:center;color:#fff;list-style-type:none;position:relative;padding:10px;transition:.5s}.tree li::before,.tree li::after{content:'';position:absolute;top:0;right:50%;border-top:1px solid #000;width:51%;height:10px}.tree li::after{right:auto;left:50%;border-left:1px solid #000}.tree li:only-child::after,.tree li:only-child::before{display:none}.tree li:only-child{padding-top:0}.tree li:first-child::before,.tree li:last-child::after{border:0 none}.tree li:last-child::before{border-right:1px solid #000;border-radius:0 5px 0 0;-webkit-border-radius:0 5px 0 0;-moz-border-radius:0 5px 0 0}.tree li:first-child::after{border-radius:5px 0 0 0;-webkit-border-radius:5px 0 0 0;-moz-border-radius:5px 0 0 0}.tree ul ul::before{content:'';position:absolute;top:0;left:50%;border-left:1px solid #000;width:0;height:20px}.tree li a{border:1px solid #000;padding:10px;display:inline-grid;border-radius:5px;text-decoration-line:none;border-radius:5px;transition:.5s}.tree li a span{border:1px solid #000;border-radius:5px;color:#000;padding:8px;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:500}.tree li a:hover,.tree li a:hover i,.tree li a:hover span,.tree li a:hover+ul li a{background-color:#ED9226;border:1px solid #000}.tree li a:hover+ul li::after,.tree li a:hover+ul li::before,.tree li a:hover+ul::before,.tree li a:hover+ul ul::before{border-color:#fff}.tree>ul{display:block}.tree ul ul{display:none}.tree ul ul.active{display:block}
			</style>
			<div class="layer-wrapper">
				<div id="canvas-container">
					<div id="canvas">
						<div class="tree">
							<ul>
								<li class="${document_name}">
									<a onclick="get_linked_documents('${doctype}', '${document_name}')"><b>${document_name} - ${doctype}</b></a>
								</li>
							</ul>
						</div>
					</div>
				</div>
			</div>
		</div>
    `);
}

/**
 * Refreshes the list properties for each list item on the canvas
 */
const refresh_list_properties = () => {
	const togglerLinks = document.querySelectorAll(".tree a");
	togglerLinks.forEach(link => {
		link.addEventListener("click", function (event) {
			event.preventDefault();
			const childUl = this.nextElementSibling;
			if (childUl) {
				childUl.classList.toggle("active");
				this.classList.toggle("expanded");
			}
		});
	});
}

/**
 * takes the doctype and document_name as parameters and returns a list of links to that document
 * then, this list is iterated and a child node is created for each link
 * these children are then clubbed into an HTML ul, and appended to the base HTML on canvas
 */
const get_linked_documents = (doctype, document_name) => {
	const nodeElement = document.querySelector(`.${document_name}`);
	if (!nodeElement.isExpanded) {
		nodeElement.isExpanded = false;
	}
	else return;
	frappe.call({
		method: 'ampower_visualize.ampower_visualize.page.product_traceability.product_traceability.get_linked_documents',
		args: {
			doctype: doctype,
			docname: document_name
		},
		callback: function (r) {
			if (!r.message.length) {
				frappe.show_alert({
					message: __('Node cannot be expanded further.'),
					indicator: 'red'
				}, 2);
				return;
			}
			const new_list = document.createElement("ul");	// creates a new list and populates it with list items (links to documents)
			new_list.className = "active";
			for (let i = 0; i < r.message.length; i++) {
				const new_item = document.createElement("li");
				new_item.className = r.message[i].linked_parent;
				new_item.innerHTML = `<a>${r.message[i].linked_parent} <br/> ${r.message[i].linked_parenttype}</a>`;
				new_item.onclick = () => {
					get_linked_documents(r.message[i].linked_parenttype, r.message[i].linked_parent);
				};
				new_list.appendChild(new_item);
			}
			$(global_wrapper).find(`.${document_name}`).append(new_list);
			nodeElement.isExpanded = true;
			refresh_list_properties();	// sets properties to newly added list items
		}
	});
}
