import frappe


def after_install():
	"""Register the single Desk page owned by this app."""
	if frappe.db.exists("Page", "agriventure"):
		return
	frappe.get_doc({"doctype": "Page", "page_name": "agriventure", "title": "Agriventure", "module": "Agriventure", "standard": "Yes"}).insert()
