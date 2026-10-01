# Copyright (c) 2026, Dux Digitech and contributors
# For license information, please see license.txt

"""Shared plumbing for the crop operation logs - Harvest, Spraying, and the ones to come.

Every log answers the same three questions off the day's Shift Details: which centres had
this activity assigned, which fields, and who worked them. Only the activity name and the
direction of the stock movement differ, so all of that lives here once.

The activity is matched on `Category Details.agricultural_activity`, never on the link id,
so it keeps working whatever naming scheme that master uses.
"""

import frappe
from frappe import _
from frappe.utils import flt, nowtime

from agriventure.api import DOCTYPES

# The category/activity master is not called the same DocType on every bench this app is
# deployed to ("Category Details" on some, "Category Master" here) - read from the one place
# (agriventure.api.DOCTYPES) that already gets this right, instead of a second hardcoded name
# that can drift out of sync with it, as it had.
_CATEGORY_TABLE = "`tab" + DOCTYPES["category-details"]["doctype"] + "`"

# Shift Details -> its labour rows -> the activity master, keeping only the wanted activity.
_JOIN = f"""
	FROM `tabShift Details` sd
	INNER JOIN `tabLabour Attendance Line` lal
		ON lal.parent = sd.name
		AND lal.parenttype = 'Shift Details'
		AND lal.parentfield = 'assignment_task'
	INNER JOIN {_CATEGORY_TABLE} cd
		ON cd.name = lal.task_name_lal
	LEFT JOIN `tabField Details` fd
		ON fd.name = lal.name_of_field_lal
	WHERE sd.docstatus < 2
		AND cd.agricultural_activity = %(activity)s
"""


def _args(filters):
	return frappe.parse_json(filters) if isinstance(filters, str) else (filters or {})


# ----------------------------------------------------------------- link queries


@frappe.whitelist()
def get_centres(doctype, txt, searchfield, start, page_len, filters):
	"""Centres with this activity assigned on this date."""
	args = _args(filters)
	if not (args.get("activity") and args.get("date")):
		return []

	return frappe.db.sql(
		"SELECT DISTINCT sd.centre__location_sd"
		+ _JOIN
		+ """	AND sd.date_sd = %(date)s
			AND IFNULL(sd.centre__location_sd, '') != ''
			AND sd.centre__location_sd LIKE %(txt)s
		ORDER BY sd.centre__location_sd
		LIMIT %(limit)s OFFSET %(offset)s""",
		{
			"activity": args["activity"],
			"date": args["date"],
			"txt": f"%{txt or ''}%",
			"limit": page_len,
			"offset": start,
		},
	)


@frappe.whitelist()
def get_fields(doctype, txt, searchfield, start, page_len, filters):
	"""Fields with this activity assigned on this date at this centre."""
	args = _args(filters)
	if not (args.get("activity") and args.get("date") and args.get("centre")):
		return []

	return frappe.db.sql(
		"SELECT DISTINCT lal.name_of_field_lal, fd.name_of_field"
		+ _JOIN
		+ """	AND sd.date_sd = %(date)s
			AND sd.centre__location_sd = %(centre)s
			AND IFNULL(lal.name_of_field_lal, '') != ''
			AND (lal.name_of_field_lal LIKE %(txt)s OR fd.name_of_field LIKE %(txt)s)
		ORDER BY fd.name_of_field
		LIMIT %(limit)s OFFSET %(offset)s""",
		{
			"activity": args["activity"],
			"date": args["date"],
			"centre": args["centre"],
			"txt": f"%{txt or ''}%",
			"limit": page_len,
			"offset": start,
		},
	)


# ----------------------------------------------------------------- dialogs and messages


@frappe.whitelist()
def get_shift_summary(activity, date, centre):
	"""One row per field for the Pick dialog, with how many distinct people worked it."""
	if not (activity and date and centre):
		return []

	return frappe.db.sql(
		"""SELECT
			sd.centre__location_sd AS centre,
			lal.name_of_field_lal AS field_id,
			COALESCE(fd.name_of_field, lal.name_of_field_lal) AS field_name,
			cd.agricultural_activity AS task,
			COUNT(DISTINCT lal.name_of_person_lal) AS number_of_labour"""
		+ _JOIN
		+ """	AND sd.date_sd = %(date)s
			AND sd.centre__location_sd = %(centre)s
			AND IFNULL(lal.name_of_field_lal, '') != ''
		GROUP BY sd.centre__location_sd, lal.name_of_field_lal, fd.name_of_field, cd.agricultural_activity
		ORDER BY field_name""",
		{"activity": activity, "date": date, "centre": centre},
		as_dict=True,
	)


@frappe.whitelist()
def get_task_summary(activity, date):
	"""Centre -> field names, for the message shown when a date is picked."""
	if not (activity and date):
		return {}

	rows = frappe.db.sql(
		"""SELECT DISTINCT
			sd.centre__location_sd AS centre,
			COALESCE(fd.name_of_field, lal.name_of_field_lal) AS field_name"""
		+ _JOIN
		+ """	AND sd.date_sd = %(date)s
			AND IFNULL(sd.centre__location_sd, '') != ''
			AND IFNULL(lal.name_of_field_lal, '') != ''
		ORDER BY centre, field_name""",
		{"activity": activity, "date": date},
		as_dict=True,
	)

	summary = {}
	for row in rows:
		summary.setdefault(row.centre, []).append(row.field_name)
	return summary


@frappe.whitelist()
def get_item_uoms(item_code):
	"""Stock UOM plus whatever else the item may be measured in."""
	if not item_code:
		return {}
	stock_uom = frappe.db.get_value("Item", item_code, "stock_uom")
	uoms = frappe.get_all("UOM Conversion Detail", filters={"parent": item_code}, pluck="uom")
	if stock_uom and stock_uom not in uoms:
		uoms.append(stock_uom)
	return {"stock_uom": stock_uom, "uoms": uoms}


# ----------------------------------------------------------------- controller helpers


def ensure_company(doc, fieldname):
	if not doc.get(fieldname):
		doc.set(
			fieldname,
			frappe.defaults.get_user_default("Company") or frappe.defaults.get_global_default("company"),
		)
	if not doc.get(fieldname):
		frappe.throw(_("No default Company is set"))


def refuse_duplicate_items(doc, table_field, item_field, message):
	values = [row.get(item_field) for row in doc.get(table_field) or [] if row.get(item_field)]
	if len(values) != len(set(values)):
		frappe.throw(message)


def set_totals(doc, table_field, mapping):
	"""mapping: {target fieldname on the parent: source fieldname on each row}."""
	rows = doc.get(table_field) or []
	for target, source in mapping.items():
		doc.set(target, sum(flt(row.get(source)) for row in rows))


def post_stock_entry(
	doc,
	*,
	stock_entry_type,
	reference_field,
	table_field,
	item_field,
	qty_field,
	warehouse_field,
	warehouse_side,
	company_field,
	date_field,
	centre_field,
	source_type,
	allow_zero_valuation=False,
):
	"""Create and submit the Stock Entry a crop log implies, once.

	`warehouse_side` is "t_warehouse" for something coming in (a harvest) or
	"s_warehouse" for something being consumed (a spraying).
	"""
	if doc.get(reference_field):
		return

	if not doc.get(centre_field):
		frappe.throw(_("Centre / Location is required"))

	if not doc.get(table_field):
		frappe.throw(_("No items found in {0}").format(_(doc.doctype)))

	company = doc.get(company_field)
	if not frappe.db.exists("Company", company):
		frappe.throw(_("Company {0} not found").format(company))

	entry = frappe.new_doc("Stock Entry")
	entry.stock_entry_type = stock_entry_type
	entry.company = company
	# without this the posting date is ignored and the entry lands on today
	entry.set_posting_time = 1
	entry.posting_date = doc.get(date_field)
	entry.posting_time = nowtime()

	# These two exist only where someone has added them to Stock Entry; guarding keeps the
	# log working now and starts filling them the day they exist.
	se_meta = frappe.get_meta("Stock Entry")
	if se_meta.has_field("source_type"):
		entry.source_type = source_type
	if se_meta.has_field("source_reference_one"):
		entry.source_reference_one = doc.name

	for row in doc.get(table_field):
		if not row.get(item_field) or flt(row.get(qty_field)) <= 0:
			continue
		item = {
			"item_code": row.get(item_field),
			"qty": flt(row.get(qty_field)),
			warehouse_side: doc.get(warehouse_field),
			"uom": row.get("uom"),
		}
		if allow_zero_valuation:
			item["allow_zero_valuation_rate"] = 1
		entry.append("items", item)

	if not entry.items:
		frappe.throw(_("No valid quantity found"))

	entry.insert(ignore_permissions=True)
	entry.submit()

	doc.db_set(reference_field, entry.name)
	frappe.msgprint(_("Stock Entry <b>{0}</b> created and submitted successfully.").format(entry.name))


def cancel_stock_entry(doc, reference_field, log_title):
	reference = doc.get(reference_field)
	if not reference:
		return
	try:
		entry = frappe.get_doc("Stock Entry", reference)
		if entry.docstatus == 1:
			entry.cancel()
		frappe.msgprint(_("Linked Stock Entry <b>{0}</b> cancelled.").format(entry.name))
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"{log_title} - Cancel Failed")
		frappe.throw(_("Unable to cancel linked Stock Entry."))
