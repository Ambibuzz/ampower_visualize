import frappe
from frappe.desk.form.linked_with import get_linked_docs, get_linked_doctypes
# Fn to get all the batch of an item
@frappe.whitelist()
def get_batch_item(item_code):
    batch_list = frappe.get_all("Batch", filters = {"item": item_code}, fields = ["name"])
    return batch_list

# Fn to get all the details ie stock entry, purchase_receipt, purchase invoice, sales invoice
# and delivery note of a batch no is returrned
@frappe.whitelist()
def get_data(batch_no):
    data = {}
    # to remove duplication on each document list, a blank list is initiated and only appended to this list
    # if that entry is not already present
    stock_entry = frappe.get_all("Stock Entry", filters = [["Stock Entry Detail", "batch_no", "=", batch_no]], fields = ["name", "posting_date"])
    stock_entry_list = []
    [stock_entry_list.append(i) for i in stock_entry if i not in stock_entry_list]
    purchase_receipt = frappe.get_all("Purchase Receipt", filters = [["Purchase Receipt Item","batch_no","=", batch_no]], fields = ["name", "posting_date"])
    purchase_receipt_list = []
    [purchase_receipt_list.append(i) for i in purchase_receipt if i not in purchase_receipt_list]
    purchase_invoice = frappe.get_all("Purchase Invoice", filters = [["Purchase Invoice Item","batch_no","=", batch_no]], fields = ["name", "posting_date", "total"])
    purchase_invoice_list = []
    [purchase_invoice_list.append(i) for i in purchase_invoice if i not in purchase_invoice_list]
    sales_invoice = frappe.get_all("Sales Invoice", filters = [["Sales Invoice Item", "batch_no", "=", batch_no]], fields = ["name", "posting_date", "`base_total` as total"])
    sales_invoice_list = []
    [sales_invoice_list.append(i) for i in sales_invoice if i not in sales_invoice_list]
    delivery_note = frappe.get_all("Delivery Note", filters = [["Delivery Note Item", "batch_no", "=", batch_no]], fields = ["name", "posting_date", "`base_total` as total"])
    delivery_note_list = []
    [delivery_note_list.append(i) for i in delivery_note if i not in delivery_note_list]
    data['stock-entry'] = stock_entry
    data['purchase-receipt'] = purchase_receipt_list
    data['purchase-invoice'] = purchase_invoice_list
    data['sales-invoice'] = sales_invoice_list
    data['delivery-note'] = delivery_note_list
    results = {'data':data}
    return results

# Fn to get all the connected documents ie stock entry, item, batch, purchase receipt,
# purchase order, sales invoice from a single item code and batch
@frappe.whitelist()
def get_nested_docs(item_code, batch_no, doc_type):
    """ negative depths means unlimited recursion """
    doc_ids = []
    # recursive function that loops throgh all nested connecting documents and save ids and doc type
    # to a blank list doc_ids
    def recurse(obj):
        if obj.get('type') == "Stock Entry":
            se_list = frappe.get_all("Stock Entry", filters = [["Stock Entry","stock_entry_type","=","Manufacture"],["Stock Entry Detail", "batch_no", "=", obj.get('batch_no')], ["Stock Entry Detail", "item_code", "=", obj.get('item_code')],["Stock Entry Detail","t_warehouse","is","set"], ["Stock Entry Detail","s_warehouse","is","not set"]], fields = ["name"])
            for i in se_list:
                doc_ids.append({"name": i.name, "doc": "Stock Entry"})
                i.type = "Stock Entry Detail"
                # recursive call to get docs connected to Stock Entry
                recurse(i)
        elif obj.get('type') == "Stock Entry Detail":
            bt_list = frappe.get_all("Stock Entry Detail", filters = [["Stock Entry Detail", "parent", "=", obj.get('name')], ["Stock Entry Detail","t_warehouse","is","not set"]], fields = [ "batch_no", "item_code"])
            for i in bt_list:
                doc_ids.append({"name": i.item_code, "doc": "Item"})
                doc_ids.append({"name": i.batch_no, "doc": "Batch"})
                i.type = "Purchase Receipt"
                # recursive call to get docs connected to Stock Entry Detail
                recurse(i)
        elif obj.get('type') == "Purchase Receipt":
            pr_list = frappe.get_all("Purchase Receipt", filters = [["Purchase Receipt Item", "batch_no", "=", obj.get('batch_no')]], fields = ["`name` as `purchase_receipt`"])
            for i in pr_list:
                doc_ids.append({"name": i.purchase_receipt, "doc": "Purchase Receipt"})
                i.type = "Purchase Order"
                # recursive call to get docs connected to Purchase Receipt
                recurse(i)
        elif obj.get('type') == "Purchase Order":
            po_list = frappe.get_all("Purchase Receipt Item", filters = [["Purchase Receipt Item", "parent", "=", obj.get('purchase_receipt')]], fields = ["purchase_order"])
            for i in po_list:
                doc_ids.append({"name": i.purchase_order, "doc": "Purchase Order"})
                # recursive call to get docs connected to Purchase Receipt Item ir Purchase Order
                recurse(i)

    # starts the recursion
    recurse({"item_code": item_code, "batch_no": batch_no, "type": doc_type})
    return doc_ids