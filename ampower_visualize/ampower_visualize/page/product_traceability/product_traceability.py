import frappe

@frappe.whitelist()
def get_linked_documents(doctype = "Delivery Note", docname = "MAT-DN-2024-00002"):
    linked_docs = []

    linked_doctypes = frappe.get_all('DocField',
        filters={
            'options': doctype,
            'fieldtype': 'Link'
        },
        fields=['parent', 'fieldname']
    )

    for link in linked_doctypes:
        try:    # exception handling for records without a parent
            linked_records = frappe.get_all(link['parent'],
                filters={link['fieldname']: docname},
                fields=['name', 'parent', 'parenttype']
            )
        except Exception as e:
            continue
        for record in linked_records:
            linked_docs.append({
                'linked_doctype': link['parent'],
                'linked_name': record['name'],
                'linked_parent': record['parent'],
                'linked_parenttype': record['parenttype']
            })
    print(linked_docs)
    return linked_docs
