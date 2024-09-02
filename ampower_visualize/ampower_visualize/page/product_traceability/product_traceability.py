import frappe

@frappe.whitelist()
def get_sales_orders():
    sales_orders = frappe.get_all('Sales Order', fields=['name'])
    return sales_orders

@frappe.whitelist()
def get_linked_documents(sales_order):
    linked_docs = []

    delivery_notes = frappe.get_all('Delivery Note', filters={'against_sales_order': sales_order}, fields=['name'])
    for dn in delivery_notes:
        linked_docs.append({'doctype': 'Delivery Note', 'name': dn.name})

    sales_invoices = frappe.get_all('Sales Invoice', filters={'sales_order': sales_order}, fields=['name'])
    for invoice in sales_invoices:
        linked_docs.append({'doctype': 'Sales Invoice', 'name': invoice.name})

    return linked_docs
