import frappe

@frappe.whitelist()
def get_linked_documents(doctype, docname):
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
                fields=['name', 'parent']
            )
        except Exception as e:
            continue
        for record in linked_records:
            linked_docs.append({
                'linked_doctype': link['parent'],
                'linked_name': record['name'],
                'linked_parent': record['parent']
            })

    return linked_docs
