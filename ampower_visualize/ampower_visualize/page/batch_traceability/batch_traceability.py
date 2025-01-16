import frappe

@frappe.whitelist()
def get_serial_and_batch_bundle_links(sabb_name=""):
    try:
        serial_and_batch_bundle = frappe.get_doc("Serial and Batch Bundle", sabb_name)
    except frappe.DoesNotExistError:
        frappe.throw(f"Serial and Batch Bundle '{sabb_name}' does not exist")

    result = {
        "serial_and_batch_bundle": {
            "name": serial_and_batch_bundle.name,
            "docstatus": serial_and_batch_bundle.docstatus,
        },
        "batches": [],
    }

    entries = serial_and_batch_bundle.get("entries")
    if isinstance(entries, list):
        for entry in entries:
            batch_qty = frappe.get_value("Batch", entry.batch_no, "batch_qty")
            batch_links = {
                "batch_no": entry.batch_no,
                "batch_qty": batch_qty if batch_qty else 0,
                "current_warehouse": entry.warehouse,
                "serial_numbers": get_serial_numbers_for_batch(entry.batch_no),
            }

            result["batches"].append(batch_links)

    return result

def get_serial_numbers_for_batch(batch_no):
    serial_numbers = frappe.get_all(
        "Serial No",
        filters={"batch_no": batch_no},
        fields=["name", "item_code", "serial_no"]
    )
    return [
        {
            "serial_no": sn["serial_no"],
            "item_code": sn["item_code"],
            "unique_id": f"{sn['name']}-{sn['item_code']}-{sn['serial_no']}",
        }
        for sn in serial_numbers
    ]
