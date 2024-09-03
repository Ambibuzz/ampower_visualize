import frappe

@frappe.whitelist()
def get_linked_documents(doctype, docname):
    linked_docs = []

    link_fields = frappe.get_all('DocField', filters={
        'options': doctype,
        'fieldtype': 'Link'
    }, fields=['parent', 'fieldname'])

    for link_field in link_fields:
        linked_records = frappe.get_all(link_field.parent, filters={link_field.fieldname: docname}, fields=['name'])
        for record in linked_records:
            linked_docs.append({'doctype': link_field.parent, 'name': record.comments})

    dynamic_links = frappe.get_all('Dynamic Link', filters={
        'link_doctype': doctype,
        'link_name': docname
    }, fields=['parenttype as doctype', 'parent as name'])

    linked_docs.extend(dynamic_links)

    return linked_docs
