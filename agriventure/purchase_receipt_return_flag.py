"""Auto-ticks Is Return the moment a Purchase Receipt carries a negative-qty item.

Core ERPNext only allows a negative Grand Total when Is Return is set - otherwise
validate() throws "Grand Total must be >= 0" before the document can save. Typing
negative quantities by hand (or pulling them in via Get Items From) without also
remembering to tick the box is exactly what was tripping that error, so this fills
the box in for whoever forgot, rather than leaving it as a manual step.
"""

from frappe.utils import flt


def auto_flag_return(doc, method=None):
	if doc.is_return:
		return
	if any(flt(item.qty) < 0 for item in doc.items):
		doc.is_return = 1
