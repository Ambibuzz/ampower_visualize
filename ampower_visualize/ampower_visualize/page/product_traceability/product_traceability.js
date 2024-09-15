frappe.pages['product_traceability'].on_page_load = (wrapper) => {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Product Traceability',
		single_column: true
	});
	setup_fields(page, wrapper);
}

var global_wrapper;

const setup_fields = (page, wrapper) => {
	global_wrapper = wrapper;
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
							append_base_html(wrapper, doctype, document_name);
						}
					}
				});
			}
		}
	});
}

const append_base_html = (wrapper, doctype, document_name) => {
	$(wrapper).find('.layout-main-section').append(`
		<script>
			const container = document.getElementById('canvas-container');
			const canvas = document.getElementById('canvas');
			let isDragging = false;
			let startX, startY;
			let offsetX = 0, offsetY = 0;
			let scale = 1;
			const updateTransform = () => {
				canvas.style.transform = \`translate(\${offsetX}px, \${offsetY}px) scale(\${scale})\`;
			}
			const handleMouseDown = (e) => {
				isDragging = true;
				startX = e.clientX - offsetX;
				startY = e.clientY - offsetY;
				container.style.cursor = 'grabbing';
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
				container.style.cursor = 'move';
			}
			container.addEventListener('mousedown', handleMouseDown);
			container.addEventListener('mousemove', handleMouseMove);
			container.addEventListener('mouseup', handleMouseUp);
			container.addEventListener('mouseleave', handleMouseUp);
			refresh_list_properties();
		</script>
		<style>
			.layer-wrapper{display:flex;align-items:center;justify-content:center;margin-top:5vh}#canvas-container{width:1000px;height:600px;background-color:#005ce6;border:1px solid #000;box-shadow:0 0 10px rgb(0 0 0 / .1);overflow:hidden;cursor:move}#canvas{position:relative;width:9999px;height:9999px}.tree{width:9999px;height:9999px}.tree ul{padding-top:20px;position:relative;transition:.5s}.tree li{display:inline-table;text-align:center;color:#fff;list-style-type:none;position:relative;padding:10px;transition:.5s}.tree li::before,.tree li::after{content:'';position:absolute;top:0;right:50%;border-top:1px solid #000;width:51%;height:10px}.tree li::after{right:auto;left:50%;border-left:1px solid #000}.tree li:only-child::after,.tree li:only-child::before{display:none}.tree li:only-child{padding-top:0}.tree li:first-child::before,.tree li:last-child::after{border:0 none}.tree li:last-child::before{border-right:1px solid #000;border-radius:0 5px 0 0;-webkit-border-radius:0 5px 0 0;-moz-border-radius:0 5px 0 0}.tree li:first-child::after{border-radius:5px 0 0 0;-webkit-border-radius:5px 0 0 0;-moz-border-radius:5px 0 0 0}.tree ul ul::before{content:'';position:absolute;top:0;left:50%;border-left:1px solid #000;width:0;height:20px}.tree li a{border:1px solid #000;padding:10px;display:inline-grid;border-radius:5px;text-decoration-line:none;border-radius:5px;transition:.5s}.tree li a span{border:1px solid #000;border-radius:5px;color:#000;padding:8px;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:500}.tree li a:hover,.tree li a:hover i,.tree li a:hover span,.tree li a:hover+ul li a{background-color:#f60;border:1px solid #000}.tree li a:hover+ul li::after,.tree li a:hover+ul li::before,.tree li a:hover+ul::before,.tree li a:hover+ul ul::before{border-color:#fff}.tree>ul{display:block}.tree ul ul{display:none}.tree ul ul.active{display:block}
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
    `);
}

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

const get_linked_documents = (doctype, document_name) => {
	const nodeElement = document.querySelector(`.${document_name}`);
	if (!nodeElement.isExpanded) {
		nodeElement.isExpanded = false;
	}
	if (nodeElement.isExpanded) {
		return;
	}
	frappe.call({
		method: 'ampower_visualize.ampower_visualize.page.product_traceability.product_traceability.get_linked_documents',
		args: {
			doctype: doctype,
			docname: document_name
		},
		callback: function (r) {
			console.log(r.message);
			if (!r.message.length) {
				frappe.msgprint({
					title: __('End of sequence'),
					indicator: 'blue',
					message: __('No linked documents found.')
				});
				return;
			}
			const new_list = document.createElement("ul");
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
			refresh_list_properties();
		}
	});
}
