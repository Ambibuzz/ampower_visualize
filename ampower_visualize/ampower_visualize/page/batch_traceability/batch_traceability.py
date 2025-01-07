import frappe

@frappe.whitelist()
def get_serial_and_batch_bundle_links(sabb_name):
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
            batch_links = {
                "batch_no": entry.batch_no,
                "batch_qty": entry.qty,
                "serial_numbers": get_serial_numbers_for_batch(entry.batch_no),
            }

            result["batches"].append(batch_links)

    return result

def get_serial_numbers_for_batch(batch_no):
    serial_numbers = []
    sn_records = frappe.get_all(
        "Serial No",
        filters={"batch_no": batch_no},
        fields=["name", "item_code", "serial_no"]
    )

    for sn in sn_records:
        serial_numbers.append({
            "serial_no": sn["serial_no"],
            "item_code": sn["item_code"],
            "unique_id": f"{sn['name']}-{sn['item_code']}-{sn['serial_no']}",
        })

    return serial_numbers
