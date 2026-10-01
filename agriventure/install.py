import frappe


def after_install():
	"""Register the single Desk page owned by this app."""
	if frappe.db.exists("Page", "agriventure-portal"):
		return
	frappe.get_doc({"doctype": "Page", "page_name": "agriventure-portal", "title": "Agriventure", "module": "Agriventure", "standard": "Yes"}).insert()
