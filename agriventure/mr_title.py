"""The Material Request title, written in this workspace's shorthand.

ERPNext builds "Purchase Request for A, B, C" in Material Request.set_title(), but only
when the title is still empty. Writing it in before_validate - which runs first - decides
the wording without touching that core method at all.
"""

import frappe

# what each request type is called here
TYPE_CODES = {
	"Purchase": "PR",
	"Material Transfer": "MT",
	"Material Issue": "MI",
	"Manufacture": "MFG",
	"Customer Provided": "CP",
}


def set_title(doc, method=None):
	# a title typed by hand is the user's, and an existing one is already settled
	if doc.get("title"):
		return

	names = []
	for row in (doc.get("items") or [])[:3]:
		label = (row.get("item_name") or row.get("item_code") or "").strip()
		if label:
			names.append(label)
	if not names:
		return

	code = TYPE_CODES.get(doc.get("material_request_type")) or doc.get("material_request_type") or ""
	# 100 characters, because the column holds 140 and three long item names pass that
	doc.title = "{0} For {1}".format(code, ", ".join(names)).strip()[:100]
