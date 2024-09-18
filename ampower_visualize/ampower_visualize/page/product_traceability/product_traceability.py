import frappe

@frappe.whitelist()
def get_linked_documents(doctype, docname):

	if not doctype or not docname:
		return []

	linked_docs = []

	# Fetch all fields of type 'Link' in all doctypes where the 'options' field equals the given 'doctype'
	linked_doctypes = frappe.get_all('DocField',
		filters={
			'options': doctype,
			'fieldtype': 'Link'  # Only fields of type 'Link' must be included
		},
		fields=['parent', 'fieldname']  # Fetch the parent doctype and the field name that links to the given doctype
	)

	# Iterate through the linked doctypes to find related documents
	for link in linked_doctypes:
		try:
			# Fetch all records from the linked doctype where the field (link['fieldname']) matches the given 'docname'
			linked_records = frappe.get_all(link['parent'],
				filters={link['fieldname']: docname},
				fields=['name', 'parent', 'parenttype', 'creation']
			)
		except Exception as e:
			# In case of an error (e.g., if the linked doctype doesn't have a parent), skip to the next iteration
			continue
		
		# Append each linked record to the linked_docs list with its details
		for record in linked_records:
			linked_docs.append({
				'linked_doctype': link['parent'],
				'linked_name': record['name'],
				'linked_parent': record['parent'],
				'linked_parenttype': record['parenttype'],
				'date': record['creation']
			})

	return linked_docs
