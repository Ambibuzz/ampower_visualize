frappe.pages['product_traceability'].on_page_load = function (wrapper) {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Product Traceability',
		single_column: true
	});
	setup_fields(page, wrapper)
};

const setup_fields = (page, wrapper) => {
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

const log_to_console = () => {
	console.log("Log function called from appended html")
}

const makeDraggable = (element) => {
	let isDragging = false;
	let startX, startY;

	element.addEventListener('mousedown', startDragging);
	element.addEventListener('touchstart', startDragging);

	document.addEventListener('mousemove', drag);
	document.addEventListener('touchmove', drag);

	document.addEventListener('mouseup', stopDragging);
	document.addEventListener('touchend', stopDragging);

	function startDragging(e) {
		isDragging = true;
		const rect = element.getBoundingClientRect();
		startX = (e.clientX || e.touches[0].clientX) - rect.left;
		startY = (e.clientY || e.touches[0].clientY) - rect.top;
		e.preventDefault();
	}

	function drag(e) {
		if (!isDragging) return;
		const x = (e.clientX || e.touches[0].clientX) - canvasContainer.getBoundingClientRect().left;
		const y = (e.clientY || e.touches[0].clientY) - canvasContainer.getBoundingClientRect().top;
		element.style.left = ((x - startX) / scale) + 'px';
		element.style.top = ((y - startY) / scale) + 'px';
	}

	function stopDragging() {
		isDragging = false;
	}
}

const append_base_html = (data, wrapper, document_name) => {
	$(wrapper).find('.layout-main-section').append(`
		<style>
			#canvasContainer {
				position: relative;
				width: 100%;
				height: 600px;
				border: 1px solid #ccc;
				overflow: hidden;
			}

			#contentWrapper {
				position: absolute;
				top: 0;
				left: 0;
				width: 100%;
				height: 100%;
				transform-origin: 0 0;
			}

			.embedded-div {
				position: absolute;
				padding: 10px;
				background-color: #f0f0f0;
				border: 1px solid #999;
				cursor: move;
				user-select: none;
			}

			#addButton {
				margin-top: 10px;
			}
		</style>
		<script>
			let scale = 1;
			const contentWrapper = document.getElementById('contentWrapper');
			const canvasContainer = document.getElementById('canvasContainer');
			const addButton = document.getElementById('addButton');
			document.querySelectorAll('.embedded-div').forEach(makeDraggable);
			canvasContainer.addEventListener('wheel', (e) => {
				e.preventDefault();
				const delta = e.deltaY > 0 ? 0.9 : 1.1;
				scale *= delta;
				contentWrapper.style.transform = \`scale(\${scale})\`;
			});
			addButton.addEventListener('click', () => {
				const newDiv = document.createElement('div');
				newDiv.className = 'embedded-div';
				newDiv.style.top = '100px';
				newDiv.style.left = '100px';
				newDiv.textContent = 'New Div';
				contentWrapper.appendChild(newDiv);
				makeDraggable(newDiv);
			});
		</script>
        <div id="canvasContainer">
			<div id="contentWrapper">
				<div class="embedded-div" style="top: 80px; left: 20px;">Embedded Div 1</div>
				<div class="embedded-div" style="top: 100px; left: 150px;">Embedded Div 2</div>
				<div class="embedded-div" style="top: 200px; left: 50px;">Embedded Div 3</div>
			</div>
		</div>
		<button id="addButton">Add New Div</button>
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
