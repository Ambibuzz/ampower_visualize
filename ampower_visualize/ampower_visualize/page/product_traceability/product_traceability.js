// On page load event product traceability content(title,body) is rendered
frappe.pages['product_traceability'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Product Traceability')
	});

	let product_traceability = new ProductTraceability(wrapper);
	$(wrapper).bind('show', () => {
		product_traceability.show();
	});
};

// ProductTraceability Class is created with a constructor function
class ProductTraceability {
	constructor(wrapper) {
		this.wrapper = $(wrapper);
		this.page = wrapper.page;
		this.sidebar = this.wrapper.find('.layout-side-section');
		this.main_section = this.wrapper.find('.layout-main-section');
		this.start = 0;
	}

	// show method is called when on load event of this page
	show() {
		frappe.breadcrumbs.add('Product Traceability');
		this.sidebar.empty();
		this.main_section.empty().append(frappe.render_template('product_traceability'));
		let me = this;
		let item = frappe.ui.form.make_control({
			parent: $('.item-filter'),
			df: {
				label: "Item Code",
				fieldtype: 'Link',
				options: 'Item',
				fieldname: 'item',
				placeholder: __('Select Item'),
				only_select: true,
				change: () => {
					console.log("Item change event");
				}
			}
		});
		item.refresh();

		// btn1 is rendered on page when clicked all batch no of item apears
		let btn1 = frappe.ui.form.make_control({
			parent: $('.btn1-filter'),
			df: {
				label: "Fetch Batch No",
				fieldtype: 'Button',
				btn_size: 'sm',
				click: () => {
					console.log("BTN1 event");
					console.log(me);
					me.item_code = '';
					$(".all-data").hide();
					if ($('.doctype-filter').children().length > 0) {
						$(".btn2-filter").empty();
						$(".btn3-filter").empty();
						$(".btn4-filter").empty();
					}
					if (me.item_code != item.get_value() && item.get_value()) {
						me.start = 0;
						me.item_code = item.get_value();
						me.make_item_profile();
					}
				}
			}
		});
		btn1.refresh();
		// dynamic link to each item is added
		if (frappe.route_options && !this.item_code) {
			item.set_value(frappe.route_options.item);
			this.item_code = frappe.route_options.item;
		}

		this.sidebar.find('[data-fieldname="item"]').append('<div class="item-info"></div>');
	}
	// this method changes title of the page and calls another method setup_filters
	make_item_profile() {
		this.page.set_title(__('Product Traceability Details'));
		this.setup_filters();
	}

	// this method triggers backend to get all the bacth no of item and renders to select field
	setup_filters() {
		$('.doctype-filter').empty();
		let me = this;
		// backend call to get all the batch for an item
		frappe.call({
			method: 'ampower_product_traceability.ampower_product_traceability.page.product_traceability.product_traceability.get_batch_item',
			args: { item_code: me.item_code }
		}
		).then(res => {
			var results = [];
			results = JSON.parse(JSON.stringify(res.message));
			// if batch no is found for selected item
			if (results.length > 0) {
				var batch_array = results.map(result => result.name)
				let batch = frappe.ui.form.make_control({
					parent: $('.doctype-filter'),
					df: {
						label: "Select Batch No",
						fieldtype: 'Select',
						options: batch_array,
						fieldname: 'batch',
						placeholder: __('Select Batch No.'),
						change: () => {
							console.log("Batch No change event");
						}
					}
				});
				batch.refresh();
				// get_data() method is called on click of this button
				let btn2 = frappe.ui.form.make_control({
					parent: $('.btn2-filter'),
					df: {
						label: "View Page",
						fieldtype: 'Button',
						btn_size: 'sm',
						click: () => {
							console.log("BTN3 event");
							console.log(me)
							$(".data_div").empty();
							$(".tree-data").hide();
							me.batch_no = batch.get_value();
							me.get_data()
						}
					}
				});
				btn2.refresh();
				// btn3 is rendered on page when clicked redirected to script report roduct Traceability Report
				let btn3 = frappe.ui.form.make_control({
					parent: $('.btn3-filter'),
					df: {
						label: "View Report",
						fieldtype: 'Button',
						btn_size: 'sm',
						click: () => {
							console.log("BTN3 event");
							$(".data_div").empty();
							me.batch_no = batch.get_value();
							if (!me.batch_no) {
								frappe.msgprint({
									title: __('Notification'),
									indicator: 'red',
									message: __('Please select a Batch No before click on Report button')
								});
								return;
							}
							frappe.set_route("query-report", "Product Traceability Report", { batch_no: me.batch_no });
						}
					}
				});
				btn3.refresh();

				// btn4 is rendered on page when clicked redirected to Tree View
				let btn4 = frappe.ui.form.make_control({
					parent: $('.btn4-filter'),
					df: {
						label: "View Tree",
						fieldtype: 'Button',
						btn_size: 'sm',
						click: () => {
							console.log("BTN4 event");
							$(".data_div").empty();
							$(".all-data").hide();
							me.batch_no = batch.get_value();
							me.get_tree_data();
							console.log(me);
						}
					}
				});
				btn4.refresh();
			}
			// if no batch no is found for selected item, an error is prompt
			else {
				$('.btn1-filter').show();
				frappe.msgprint({
					title: __('Notification'),
					indicator: 'red',
					message: __('No Batch found for this item')
				});
			}
		});
	}

	// this method renders all details of the selected batch to the right side of the page
	get_data() {
		var batch_no = this.batch_no;
		// if no batch no is selected for selected item, an error is prompt
		if (!batch_no) {
			frappe.msgprint({
				title: __('Notification'),
				indicator: 'red',
				message: __('Please select a Batch No before click on submit button')
			});
			return;
		}
		// backend call to get all the details for an batch no
		frappe.call({
			method: 'ampower_product_traceability.ampower_product_traceability.page.product_traceability.product_traceability.get_data',
			args: { batch_no: batch_no }
		}
		).then(res => {
			var results = JSON.parse(JSON.stringify(res.message));
			console.log(results, batch_no);
			var host_url = window.location.href.split("/app")[0]
			console.log(host_url)
			var data = results.data;
			for (var i in data) {
				for (var j of data[i]) {
					var dataDiv = document.createElement('div');
					dataDiv.setAttribute('class', `card-body`);
					dataDiv.innerHTML = `
					<h4 class="card-title text-light"><a href="${host_url}/app/${i}/${j.name}" target="_blank">${j.name}</a></h4>
					<p class="card-text">Date: ${j.posting_date}</p>
					`
					if (j.total) {
						dataDiv.innerHTML += `<p class="card-text">Amount in INR: ${j.total}</p>`
					}
					$(`#${i}`).append(dataDiv)
				}
			}
			$(".data_div").hide();
			$(".all-data").show();
		});
	}

	// This fn is used to view tree structures of BOM data
	get_tree_data() {
		var batch_no = this.batch_no;
		var item_code = this.item_code;
		// if no batch no is selected for selected item, an error is prompt
		if (!batch_no || !item_code) {
			frappe.msgprint({
				title: __('Notification'),
				indicator: 'red',
				message: __('Please select a Batch No and Item Code before click on submit button')
			});
			return;
		}
		// backend call to get all the connected docs for an batch no
		frappe.call({
			method: 'ampower_product_traceability.ampower_product_traceability.page.product_traceability.product_traceability.get_nested_docs',
			args: { item_code: item_code, batch_no: batch_no, doc_type: "Stock Entry" }
		}
		).then(res => {
			var results = JSON.parse(JSON.stringify(res.message));
			var tree_table = document.getElementById("tree_table").getElementsByTagName('tbody')[0]
			$(".tree-data").show();
			tree_table.innerHTML = '';
			// for all entries of results array a new row is created and its name is rendered basd on doc type 
			for (var i of results) {
				var newRow = tree_table.insertRow(-1);
				var c1 = newRow.insertCell(-1);
				var c2 = newRow.insertCell(-1);
				var c21 = newRow.insertCell(-1);
				var c3 = newRow.insertCell(-1);
				var c4 = newRow.insertCell(-1);
				if (i.doc == "Stock Entry") {
					c1.innerHTML = i.name;
				}
				if (i.doc == "Item") {
					c2.innerHTML = i.name;
				}
				if (i.doc == "Batch") {
					c21.innerHTML = i.name;
				}
				if (i.doc == "Purchase Receipt") {
					c3.innerHTML = i.name;
				}
				if (i.doc == "Purchase Order") {
					c4.innerHTML = i.name;
				}
			}
		});
	}
}

// this function added to toggle the visibility of a div when click om "+" button
function expand_element(id) {
	console.log(`${id} change event`);
	if (id == 'se_btn') {
		if ($('#stock-entry').is(':empty')) {
			$('#stock-entry').html(`
			<div class="card-body">
				<h4 class="card-title text-light">No Data</h4>
			</div>
			`)
		}
		$(`#stock-entry`).toggle();
	}
	else if (id == 'si_btn') {
		if ($('#sales-invoice').is(':empty')) {
			$('#sales-invoice').html(`
			<div class="card-body">
				<h4 class="card-title text-light">No Data</h4>
			</div>
			`)
		}
		$(`#sales-invoice`).toggle();
	}
	else if (id == 'pr_btn') {
		if ($('#purchase-receipt').is(':empty')) {
			$('#purchase-receipt').html(`
			<div class="card-body">
				<h4 class="card-title text-light">No Data</h4>
			</div>
			`)
		}
		$(`#purchase-receipt`).toggle();
	}
	else if (id == 'pi_btn') {
		if ($('#purchase-invoice').is(':empty')) {
			$('#purchase-invoice').html(`
			<div class="card-body">
				<h4 class="card-title text-light">No Data</h4>
			</div>
			`)
		}
		$(`#purchase-invoice`).toggle();
	}
	else {
		if ($('#delivery-note').is(':empty')) {
			$('#delivery-note').html(`
			<div class="card-body">
				<h4 class="card-title text-light">No Data</h4>
			</div>
			`)
		}
		$(`#delivery-note`).toggle();
	}
}