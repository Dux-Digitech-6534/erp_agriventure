"""Keeps a header-level summary of every Purchase Order behind a Purchase Receipt.

Purchase Receipt Item carries its own `purchase_order` link, since one receipt can
draw items from several orders - there is no such field on the parent. This mirrors
that list into a single comma-separated, de-duplicated field so the purchasing
portal can show and filter on it without joining the child table every time.
"""

from frappe.utils import cstr


def set_po_ids(doc, method=None):
	seen = []
	for item in doc.items:
		po = cstr(item.purchase_order).strip()
		if po and po not in seen:
			seen.append(po)
	doc.custom_purchase_orders = ", ".join(seen)
