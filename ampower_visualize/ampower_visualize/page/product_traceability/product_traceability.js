frappe.pages['product_traceability'].on_page_load = function (wrapper) {
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

const append_base_html = (wrapper, doctype, document_name) => {
	$(wrapper).find('.layout-main-section').append(`
		<style>
			#canvasContainer {
				position: relative;
				margin-top: 5%;
				margin-left: 10%;
				width: 80%;
				height: 600px;
				border: 1px solid #ccc;
				border-radius: 5px;
				overflow: hidden;
			}

			#contentWrapper {
				position: absolute;
				top: 0;
				left: 0;
				width: 5000%;
				height: 5000%;
				transform-origin: 0 0;
			}

			.embedded-div {
				position: absolute;
				border-radius: 12px;
				padding: 10px;
				background-color: #ff8000;
				color: #000000;
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
		</script>
        <center id="canvasContainer">
			<div id="contentWrapper">
				<div onClick="toggle_linked_documents('${doctype}', '${document_name}', this, 1)" class="embedded-div" style="top: 20px; left: 20px;">
					${doctype} <br/> ${document_name}
				</div>
			</div>
		</center>
    `);
}

const toggle_linked_documents = (doctype, document_name, parentDiv, level) => {
	if (parentDiv.expanded) {
		remove_child_divs(level);
		parentDiv.expanded = false;
	} else {
		display_linked_documents(doctype, document_name, parentDiv, level);
		parentDiv.expanded = true;
	}
}

const remove_child_divs = (parentLevel) => {
	$(global_wrapper).find('.child-div').each(function () {
		const divLevel = parseInt($(this).attr('level'));
		if (divLevel > parentLevel) {
			$(this).remove();
		}
	});
}

const display_linked_documents = (doctype, document_name, parentDiv, level) => {
	console.log(doctype, document_name);
	frappe.call({
		method: 'ampower_visualize.ampower_visualize.page.product_traceability.product_traceability.get_linked_documents',
		args: {
			doctype: doctype,
			docname: document_name
		},
		callback: function (r) {
			console.log(r.message);
			for (let i = 0; i < r.message.length; i++) {
				const newDiv = document.createElement('div');
				newDiv.className = 'embedded-div child-div';
				newDiv.setAttribute('level', level + 1);
				newDiv.style.top = `${(i + 1) * 50 + 50}px`;
				newDiv.style.left = `${(i + 1) * 50 + 50}px`;
				newDiv.textContent = `${r.message[i].linked_parent} - ${r.message[i].linked_parenttype}`;
				newDiv.addEventListener('click', () => {
					toggle_linked_documents(r.message[i].linked_parenttype, r.message[i].linked_parent, newDiv, level + 1);
				});
				$(global_wrapper).find('#contentWrapper').append(newDiv);
				makeDraggable(newDiv);
			}
		}
	});
}
