import frappe

@frappe.whitelist()
def get_linked_documents(doctype, docname):

	if not doctype or not docname:
		return []

	linked_docs = []

	# Fetch all fields of type 'Link' in all doctypes where the 'options' field equals the given 'doctype'
	linked_doctypes = frappe.get_all('DocField',
		filters={
			'options': doctype,  # Find link fields that point to the given 'doctype'
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
				fields=['name', 'parent', 'parenttype', 'creation']  # Include the 'creation' (or relevant date field)
			)
		except Exception as e:
			# In case of an error (e.g., if the linked doctype doesn't have a parent), skip to the next iteration
			continue
		
		# Append each linked record to the linked_docs list with its details
		for record in linked_records:
			linked_docs.append({
				'linked_doctype': link['parent'],  # The doctype of the linked record
				'linked_name': record['name'],  # The name of the linked record
				'linked_parent': record['parent'],  # The parent of the linked record (if applicable)
				'linked_parenttype': record['parenttype'],  # The parenttype of the linked record (if applicable)
				'date': record['creation']  # The creation date of the linked record
			})

	return linked_docs
