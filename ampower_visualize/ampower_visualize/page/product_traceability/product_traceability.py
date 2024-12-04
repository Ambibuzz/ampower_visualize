import frappe

@frappe.whitelist()
def get_sales_order_links(document_name):
    sales_order = frappe.get_doc("Sales Order", document_name)

    result = {
        "sales_order": {
            "name": sales_order.name,
            "status": sales_order.status,
        },
        "items": [],
    }

    for so_item in sales_order.items:
        item_links = {
            "item_code": so_item.item_code,
            "item_name": so_item.item_name,
            "sales_order_qty": so_item.qty,
            "sales_invoices": [],
            "delivery_notes": [],
            "material_requests": [],
            "purchase_orders": [],
        }

        sales_invoices = get_sales_invoices_for_so_item(so_item)
        item_links["sales_invoices"] = sales_invoices

        delivery_notes = get_delivery_notes_for_so_item(so_item)
        item_links["delivery_notes"] = delivery_notes

        material_requests = get_material_requests_for_so_item(so_item)
        for mr in material_requests:
            mr["purchase_orders"] = get_purchase_orders_for_mr(mr["material_request"])
        item_links["material_requests"] = material_requests

        purchase_orders = get_purchase_orders_for_so_item(so_item)
        item_links["purchase_orders"] = purchase_orders

        result["items"].append(item_links)

    return result


def get_sales_invoices_for_so_item(so_item):
    sales_invoices = []

    sinv_items = frappe.get_all(
        "Sales Invoice Item",
        filters={"sales_order": so_item.parent, "item_code": so_item.item_code},
        fields=["parent", "item_code", "qty", "idx"],
    )

    for sinv_item in sinv_items:
        parent_status = frappe.get_value("Sales Invoice", sinv_item["parent"], "status")
        if parent_status != "Cancelled":
            sales_invoices.append(
                {
                    "sales_invoice": sinv_item["parent"],
                    "status": parent_status,
                    "item_code": sinv_item["item_code"],
                    "qty": sinv_item["qty"],
                    "unique_id": f"{sinv_item['parent']}-{sinv_item['item_code']}-{sinv_item['idx']}",
                }
            )

    return sales_invoices


def get_delivery_notes_for_so_item(so_item):
    delivery_notes = []

    dn_items = frappe.get_all(
        "Delivery Note Item",
        filters={"against_sales_order": so_item.parent, "item_code": so_item.item_code},
        fields=["parent", "item_code", "qty", "idx"],
    )

    for dn_item in dn_items:
        parent_status = frappe.get_value("Delivery Note", dn_item["parent"], "status")
        if parent_status != "Cancelled":
            delivery_notes.append(
                {
                    "delivery_note": dn_item["parent"],
                    "status": parent_status,
                    "item_code": dn_item["item_code"],
                    "qty": dn_item["qty"],
                    "unique_id": f"{dn_item['parent']}-{dn_item['item_code']}-{dn_item['idx']}",
                }
            )

    return delivery_notes


def get_material_requests_for_so_item(so_item):
    material_requests = []

    mr_items = frappe.get_all(
        "Material Request Item",
        filters={"sales_order_item": so_item.name, "item_code": so_item.item_code},
        fields=["parent", "item_code", "qty", "idx"],
    )

    for mr_item in mr_items:
        parent_status = frappe.get_value(
            "Material Request", mr_item["parent"], "status"
        )
        if parent_status != "Cancelled":
            material_requests.append(
                {
                    "material_request": mr_item["parent"],
                    "status": parent_status,
                    "item_code": mr_item["item_code"],
                    "qty": mr_item["qty"],
                    "unique_id": f"{mr_item['parent']}-{mr_item['item_code']}-{mr_item['idx']}",
                }
            )

    return material_requests


def get_purchase_orders_for_mr(material_request_name):
    purchase_orders = []

    po_items = frappe.get_all(
        "Purchase Order Item",
        filters={"material_request": material_request_name},
        fields=["parent", "item_code", "qty", "idx"],
    )

    for po_item in po_items:
        parent_status = frappe.get_value("Purchase Order", po_item["parent"], "status")
        if parent_status != "Cancelled":
            purchase_invoices = get_purchase_invoices_for_po(po_item["parent"])
            purchase_receipts = get_purchase_receipts_for_po(po_item["parent"])
            purchase_orders.append(
                {
                    "purchase_order": po_item["parent"],
                    "status": parent_status,
                    "item_code": po_item["item_code"],
                    "qty": po_item["qty"],
                    "purchase_invoices": purchase_invoices,
                    "purchase_receipts": purchase_receipts,
                    "unique_id": f"{po_item['parent']}-{po_item['item_code']}-{po_item['idx']}",
                }
            )

    return purchase_orders


def get_purchase_orders_for_so_item(so_item):
    purchase_orders = []

    po_items = frappe.get_all(
        "Purchase Order Item",
        filters={"sales_order_item": so_item.name, "item_code": so_item.item_code},
        fields=["parent", "item_code", "qty", "idx"],
    )

    for po_item in po_items:
        parent_status = frappe.get_value("Purchase Order", po_item["parent"], "status")
        if parent_status != "Cancelled":
            purchase_invoices = get_purchase_invoices_for_po(po_item["parent"])
            purchase_receipts = get_purchase_receipts_for_po(po_item["parent"])
            purchase_orders.append(
                {
                    "purchase_order": po_item["parent"],
                    "status": parent_status,
                    "item_code": po_item["item_code"],
                    "qty": po_item["qty"],
                    "purchase_invoices": purchase_invoices,
                    "purchase_receipts": purchase_receipts,
                    "unique_id": f"{po_item['parent']}-{po_item['item_code']}-{po_item['idx']}",
                }
            )

    return purchase_orders


def get_purchase_invoices_for_po(purchase_order_name):
    purchase_invoices = []

    pi_items = frappe.get_all(
        "Purchase Invoice Item",
        filters={"purchase_order": purchase_order_name},
        fields=["parent", "item_code", "qty", "idx"],
    )

    for pi_item in pi_items:
        parent_status = frappe.get_value(
            "Purchase Invoice", pi_item["parent"], "status"
        )
        if parent_status != "Cancelled":
            purchase_invoices.append(
                {
                    "purchase_invoice": pi_item["parent"],
                    "status": parent_status,
                    "item_code": pi_item["item_code"],
                    "qty": pi_item["qty"],
                    "unique_id": f"{pi_item['parent']}-{pi_item['item_code']}-{pi_item['idx']}",
                }
            )

    return purchase_invoices


def get_purchase_receipts_for_po(purchase_order_name):
    purchase_receipts = []

    pr_items = frappe.get_all(
        "Purchase Receipt Item",
        filters={"purchase_order": purchase_order_name},
        fields=["parent", "item_code", "qty", "idx"],
    )

    for pr_item in pr_items:
        parent_status = frappe.get_value(
            "Purchase Receipt", pr_item["parent"], "status"
        )
        if parent_status != "Cancelled":
            purchase_receipts.append(
                {
                    "purchase_receipt": pr_item["parent"],
                    "status": parent_status,
                    "item_code": pr_item["item_code"],
                    "qty": pr_item["qty"],
                    "unique_id": f"{pr_item['parent']}-{pr_item['item_code']}-{pr_item['idx']}",
                }
            )

    return purchase_receipts
