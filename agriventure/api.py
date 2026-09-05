"""Permission-respecting services for the Agriventure purchasing workspace."""

import inspect
import json
from datetime import datetime, timedelta

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate


# Step one: the transaction documents, every one of them a stock ERPNext doctype that
# the target site already has. The page hides any kind that is not listed here, so the
# rest of the sidebar simply does not appear until it is added back.
DOCTYPES = {'material-request': {'doctype': 'Material Request',
                      'title': 'Material Request',
                      'date_field': 'transaction_date',
                      'search_fields': ['name', 'title', 'custom_department'],
                      'columns': ['title', 'transaction_date', 'workflow_state', 'status', 'name']},
 'supplier-quotation': {'doctype': 'Supplier Quotation',
                        'title': 'Supplier Quotation',
                        'date_field': 'transaction_date',
                        'search_fields': ['name', 'supplier', 'supplier_name'],
                        'columns': ['name',
                                    'transaction_date',
                                    'supplier',
                                    'valid_till',
                                    'grand_total',
                                    'status']},
 'purchase-order': {'doctype': 'Purchase Order',
                    'title': 'Purchase Order',
                    'date_field': 'transaction_date',
                    'search_fields': ['name', 'supplier', 'supplier_name'],
                    'columns': ['supplier_name',
                                'status',
                                'transaction_date',
                                'grand_total',
                                'per_billed',
                                'name']},
 'purchase-receipt': {'doctype': 'Purchase Receipt',
                      'title': 'Purchase Receipt',
                      'date_field': 'posting_date',
                      'search_fields': ['name', 'supplier', 'supplier_name'],
                      'columns': ['supplier_name',
                                  'status',
                                  'posting_date',
                                  'grand_total',
                                  'per_returned',
                                  'custom_purchase_orders',
                                  'name']},
 'purchase-invoice': {'doctype': 'Purchase Invoice',
                      'title': 'Purchase Invoice',
                      'date_field': 'posting_date',
                      'search_fields': ['name', 'supplier', 'supplier_name', 'bill_no'],
                      'columns': ['supplier_name',
                                  'status',
                                  'posting_date',
                                  'grand_total',
                                  'name']},
 'payment-entry': {'doctype': 'Payment Entry',
                   'title': 'Payment Entry',
                   'date_field': 'posting_date',
                   'search_fields': ['name', 'party', 'party_name', 'reference_no'],
                   'columns': ['party_name',
                               'status',
                               'payment_type',
                               'posting_date',
                               'mode_of_payment',
                               'name']}}

MAPPERS = {
	("Material Request", "Purchase Order"): "erpnext.stock.doctype.material_request.material_request.make_purchase_order",
	("Material Request", "Supplier Quotation"): "erpnext.stock.doctype.material_request.material_request.make_supplier_quotation",
	("Supplier Quotation", "Purchase Order"): "erpnext.buying.doctype.supplier_quotation.supplier_quotation.make_purchase_order",
	("Purchase Order", "Purchase Receipt"): "erpnext.buying.doctype.purchase_order.purchase_order.make_purchase_receipt",
	("Purchase Order", "Purchase Invoice"): "erpnext.buying.doctype.purchase_order.purchase_order.make_purchase_invoice",
	("Purchase Receipt", "Purchase Invoice"): "erpnext.stock.doctype.purchase_receipt.purchase_receipt.make_purchase_invoice",
	("Purchase Invoice", "Purchase Receipt"): "erpnext.accounts.doctype.purchase_invoice.purchase_invoice.make_purchase_receipt",
}

# what a submitted document offers under its Create menu. A target with a "kind" opens
# inside the workspace; the rest hand over to the standard desk form for that DocType.
CREATE_TARGETS = {
	"Material Request": [
		{"label": "Purchase Order", "kind": "purchase-order"},
		{
			"label": "Request for Quotation",
			"doctype": "Request for Quotation",
			"method": "erpnext.stock.doctype.material_request.material_request.make_request_for_quotation",
		},
		{"label": "Supplier Quotation", "kind": "supplier-quotation"},
	],
	"Supplier Quotation": [
		{"label": "Purchase Order", "kind": "purchase-order"},
	],
	"Purchase Order": [
		{"label": "Purchase Receipt", "kind": "purchase-receipt"},
		{"label": "Purchase Invoice", "kind": "purchase-invoice"},
	],
	"Purchase Receipt": [
		{"label": "Purchase Invoice", "kind": "purchase-invoice"},
	],
	"Purchase Invoice": [
		# ERPNext builds this one through get_payment_entry rather than a plain mapper,
		# so it is flagged for the dedicated builder below
		{"label": "Payment", "kind": "payment-entry", "builder": "payment_entry"},
	],
}


FIELD_PROPERTIES = (
	"fieldname", "label", "fieldtype", "options", "reqd", "read_only", "hidden", "default",
	"depends_on", "mandatory_depends_on", "read_only_depends_on", "in_list_view", "columns",
	"length", "precision", "non_negative", "description", "allow_on_submit",
	"collapsible", "collapsible_depends_on",
)

STANDARD_FIELDS = {"name", "owner", "creation", "modified", "modified_by", "docstatus", "idx"}

# ERPNext's mappers fill these on the target rows and then mark them read only. Stripping
# them on save would cut the document loose from whatever it was created from, so they are
# allowed through even though the user can never type into them.
PRESERVED_CHILD_FIELDS = {
	"material_request", "material_request_item",
	"supplier_quotation", "supplier_quotation_item",
	"purchase_order", "purchase_order_item", "po_detail",
	"purchase_receipt", "purchase_receipt_item", "pr_detail",
	"purchase_invoice", "purchase_invoice_item",
	"sales_order", "sales_order_item",
	"prevdoc_docname", "prevdoc_detail_docname",
}

# where a mandatory child field the workspace does not show can borrow its value from a sibling
REQUIRED_FALLBACKS = {
	"Purchase Taxes and Charges": {"description": "account_head"},
	"Sales Taxes and Charges": {"description": "account_head"},
	"Advance Taxes and Charges": {"description": "account_head"},
}


def _is_blank_row(values):
	"""True for a child row the user never actually filled in.

	Every items table opens with one empty line so there is somewhere to type. If that
	line is left untouched it must not reach ERPNext, which would otherwise reject the
	whole document over a row that was never meant to exist. A row that already carries
	a name belongs to the saved document and is always kept.
	"""
	if values.get("name"):
		return False
	return not any(value not in (None, "", 0, 0.0, False, []) for value in values.values())


def _complete_child_row(child_meta, row):
	"""Fill mandatory child fields that the workspace does not render.

	The workspace deliberately shows a trimmed set of columns, so a field the user was
	never offered must not be the reason a save fails. Values come from the DocType's own
	default, or from a sibling field where ERPNext stores the same text anyway.
	"""
	fallbacks = REQUIRED_FALLBACKS.get(child_meta.name, {})
	for field in child_meta.fields:
		if not field.fieldname or not field.reqd or field.read_only:
			continue
		if row.get(field.fieldname) not in (None, ""):
			continue
		default = field.default
		if default and not str(default).startswith(":") and str(default) not in {"Today", "Now"}:
			row[field.fieldname] = default
			continue
		source = fallbacks.get(field.fieldname)
		if source and row.get(source):
			row[field.fieldname] = row[source]
	return row

# fields the Agriventure form exposes as editable even though Customize Form marks them read-only
# Customize Form marks these read only on this site, but the workspace deliberately renders
# them as editable. Without listing them here the sanitizer would drop whatever was chosen.
EDITABLE_READ_ONLY = {
	"Material Request": {"material_request_type", "set_warehouse"},
}


def _config(key):
	if key not in DOCTYPES:
		frappe.throw(_("Unsupported purchasing document."), frappe.ValidationError)
	return DOCTYPES[key]


def _json(value, default):
	return json.loads(value) if isinstance(value, str) and value else (value or default)


def _field_dict(field):
	return {key: getattr(field, key, None) for key in FIELD_PROPERTIES}


def _valid_fields(meta, requested):
	return [field for field in requested if field in STANDARD_FIELDS or meta.has_field(field)]


def _default_order(config):
	date_field = config.get("date_field") or "modified"
	if date_field in ("modified", "creation"):
		return ["{0} desc".format(date_field)]
	return ["{0} desc".format(date_field), "modified desc"]


def _normalize_list_filters(config, meta, raw_filters):
	allowed_operators = {"=", "like", "between", ">=", "<="}
	normalized = []
	for item in _json(raw_filters, []):
		if not isinstance(item, (list, tuple)) or len(item) != 3:
			frappe.throw(_("Invalid list filter."), frappe.ValidationError)
		fieldname, operator, value = item
		# "table_field.child_field" filters on the rows inside the document - the crop on a
		# Harvest Log lives in its table, not on the log itself
		child_doctype = None
		if "." in str(fieldname):
			table_field, _sep, child_field = str(fieldname).partition(".")
			table = meta.get_field(table_field)
			if not table or table.fieldtype != "Table" or not table.options:
				frappe.throw(_("Invalid filter field: {0}").format(fieldname), frappe.ValidationError)
			if not frappe.get_meta(table.options).has_field(child_field):
				frappe.throw(_("Invalid filter field: {0}").format(fieldname), frappe.ValidationError)
			child_doctype, fieldname = table.options, child_field
		elif fieldname not in STANDARD_FIELDS and not meta.has_field(fieldname):
			frappe.throw(_("Invalid filter field: {0}").format(fieldname), frappe.ValidationError)
		if operator not in allowed_operators:
			frappe.throw(_("Invalid filter operator."), frappe.ValidationError)
		if value in (None, "", []):
			continue
		if operator == "between":
			if not isinstance(value, (list, tuple)) or len(value) != 2:
				frappe.throw(_("Invalid date range."), frappe.ValidationError)
			if fieldname == config["date_field"] and getdate(value[0]) > getdate(value[1]):
				frappe.throw(_("From Date cannot be after To Date."), frappe.ValidationError)
		normalized.append([child_doctype or config["doctype"], fieldname, operator, value])
	return normalized


def _sanitize_document(doctype, payload):
	meta = frappe.get_meta(doctype)
	clean = {"doctype": doctype}
	if payload.get("name"):
		clean["name"] = payload["name"]
	if payload.get("__newname"):
		clean["__newname"] = payload["__newname"]
	# amended_from is read only, so the loop below would drop it - and without it Frappe
	# never applies the amend counter, naming the copy from the series instead of
	# <original>-1. It is re-checked here rather than trusted: only a cancelled document
	# of this same doctype may be amended.
	amended_from = payload.get("amended_from")
	if amended_from and meta.has_field("amended_from"):
		if cint(frappe.db.get_value(doctype, amended_from, "docstatus")) == 2:
			clean["amended_from"] = amended_from
		else:
			frappe.throw(_("Only a cancelled document can be amended."), frappe.ValidationError)
	editable = EDITABLE_READ_ONLY.get(doctype, set())
	for field in meta.fields:
		if not field.fieldname or field.fieldname not in payload:
			continue
		if field.read_only and field.fieldname not in editable:
			continue
		if field.fieldtype == "Table":
			child_meta = frappe.get_meta(field.options)
			allowed = {
				df.fieldname
				for df in child_meta.fields
				if df.fieldname and (not df.read_only or df.fieldname in PRESERVED_CHILD_FIELDS)
			} | {"name"}
			rows = []
			for row in payload.get(field.fieldname) or []:
				values = {key: value for key, value in row.items() if key in allowed}
				if _is_blank_row(values):
					continue
				rows.append(_complete_child_row(child_meta, {"doctype": field.options, **values}))
			clean[field.fieldname] = rows
		elif field.fieldtype not in {"Section Break", "Column Break", "Tab Break", "HTML", "Button", "Fold"}:
			clean[field.fieldname] = payload[field.fieldname]
	return clean


@frappe.whitelist()
def bootstrap():
	user = frappe.get_doc("User", frappe.session.user)
	return {
		"user": {
			"name": user.name,
			"full_name": user.full_name or user.name,
			"user_image": user.user_image,
		},
		"fiscal_year": frappe.defaults.get_global_default("fiscal_year") or "",
		"doctypes": DOCTYPES,
	}


def _pending_approvals(limit=10, from_date=None, to_date=None):
	"""Documents sitting in a workflow state this user can actually act on.

	The states are worked out from the workflow's own transitions and the user's roles, so
	the card shows exactly what an Approve or Reject button would be offered for. Reading
	through frappe.get_list keeps the usual permission checks in place.
	"""
	roles = set(frappe.get_roles())
	pending = []

	for kind, config in DOCTYPES.items():
		doctype = config["doctype"]
		workflow_name = frappe.db.get_value("Workflow", {"document_type": doctype, "is_active": 1}, "name")
		if not workflow_name:
			continue
		workflow = frappe.get_cached_doc("Workflow", workflow_name)
		states = {row.state for row in workflow.transitions if row.allowed in roles}
		if not states:
			continue

		state_field = workflow.workflow_state_field
		meta = frappe.get_meta(doctype)
		if not meta.has_field(state_field):
			continue

		filters = {state_field: ["in", sorted(states)], "docstatus": 0}
		# the dashboard's fiscal year, where the doctype has a date to apply it to
		if from_date and to_date and config["date_field"] != "creation" and meta.has_field(config["date_field"]):
			filters[config["date_field"]] = ["between", [from_date, to_date]]

		rows = frappe.get_list(
			doctype,
			fields=_valid_fields(meta, ["name", state_field, config["date_field"], "modified"]),
			filters=filters,
			order_by="modified desc",
			page_length=limit,
		)
		for row in rows:
			pending.append({
				"kind": kind,
				"document": config["title"],
				"reference": row.name,
				"state": row.get(state_field) or "",
				"date": row.get(config["date_field"]),
				"modified": row.get("modified"),
			})

	pending.sort(key=lambda row: row.get("modified") or datetime.min, reverse=True)
	return pending[:limit]


@frappe.whitelist()
def dashboard(from_date=None, to_date=None):
	recent = []
	active_count = 0
	for kind, config in DOCTYPES.items():
		meta = frappe.get_meta(config["doctype"])
		fields = _valid_fields(meta, ["name", config["date_field"], "status", "workflow_state", "modified"])
		# a fiscal year narrows everything that has a real date; master data, dated only by
		# when it was created, is left alone
		window = {}
		if from_date and to_date and config["date_field"] != "creation":
			window[config["date_field"]] = ["between", [from_date, to_date]]
		rows = frappe.get_list(config["doctype"], fields=fields, filters=window, order_by="modified desc", page_length=4)
		count_rows = frappe.get_list(config["doctype"], fields=["count(name) as count"], filters=dict(window, docstatus=["!=", 2]), page_length=1)
		active_count += cint(count_rows[0].count if count_rows else 0)
		for row in rows:
			recent.append({
				"kind": kind,
				"document": config["title"],
				"reference": row.name,
				"date": row.get(config["date_field"]) or row.get("modified"),
				"status": row.get("status") or row.get("workflow_state") or _("Draft"),
				"modified": row.get("modified"),
			})
	recent.sort(key=lambda row: row.get("modified") or datetime.min, reverse=True)
	return {"active_count": active_count, "recent": recent[:8], "pending": _pending_approvals(from_date=from_date, to_date=to_date)}


def _apply_link_titles(meta, columns, rows):
	"""Show a link's title rather than its id, wherever the target opts into it.

	Same rule the desk list view follows, so a row reads "Ramesh Patil" instead of
	"LAB-00003". Only the displayed value changes; rows are still opened by name.
	"""
	for fieldname in columns:
		field = meta.get_field(fieldname)
		if not field or field.fieldtype != "Link" or not field.options:
			continue
		target = frappe.get_meta(field.options)
		title_field = target.get("title_field")
		if not target.get("show_title_field_in_link") or not title_field or title_field == "name":
			continue
		ids = {row.get(fieldname) for row in rows if row.get(fieldname)}
		if not ids:
			continue
		titles = dict(
			frappe.get_all(
				field.options,
				filters={"name": ["in", list(ids)]},
				fields=["name", title_field],
				as_list=True,
				ignore_permissions=True,
			)
		)
		for row in rows:
			title = titles.get(row.get(fieldname))
			if title:
				row[fieldname] = title


# Attendance Log's own Leave options on this site. A half day counts as half a person
# present; the reference app checks for "Half Day"/"Full Day", which are not values this
# site uses, so its weighting never applied.
HALF_DAY_LEAVE = ("First Half", "Second Half")
FULL_DAY_LEAVE = ("Full Day",)


@frappe.whitelist()
def kpi_dashboard(date=None):
	"""The numbers behind the KPI cards, for one day. Nothing is stored; all read live."""
	date = getdate(date or frappe.utils.nowdate())

	# a person on half leave counts as 0.5
	present = flt(
		frappe.db.sql(
			"""SELECT IFNULL(SUM(CASE
					WHEN `leave` IN %(full_day)s THEN 0
					WHEN `leave` IN %(half_day)s THEN 0.5
					ELSE 1 END), 0)
				FROM `tabAttendance Log`
				WHERE date_al = %(date)s
					AND docstatus < 2
					AND IFNULL(name_of_person_al, '') != ''""",
			{"date": date, "half_day": HALF_DAY_LEAVE, "full_day": FULL_DAY_LEAVE},
		)[0][0]
	)

	# the labour master is the denominator; if it is empty, fall back to whoever has ever
	# been logged, so the percentage still means something
	workforce = frappe.db.count("Labour Information")
	if not workforce:
		workforce = cint(
			frappe.db.sql(
				"""SELECT COUNT(DISTINCT name_of_person_al) FROM `tabAttendance Log`
					WHERE IFNULL(name_of_person_al, '') != ''"""
			)[0][0]
		)

	# POS invoices consolidate into Sales Invoice with is_pos = 1, so counting Sales
	# Invoice alone covers both and cannot double up
	sales = flt(
		frappe.db.sql(
			"""SELECT IFNULL(SUM(grand_total), 0) FROM `tabSales Invoice`
				WHERE posting_date = %(date)s AND docstatus = 1""",
			{"date": date},
		)[0][0]
	)

	# read off the harvest rows rather than the parent total, so it holds even if that
	# total was never recalculated
	production = flt(
		frappe.db.sql(
			"""SELECT IFNULL(SUM(row.usable_quantity_ht), 0)
				FROM `tabHarvest Table` row
				INNER JOIN `tabHarvest Log` log ON log.name = row.parent
				WHERE log.date_hl = %(date)s AND log.docstatus < 2""",
			{"date": date},
		)[0][0]
	)
	spoilage = flt(
		frappe.db.sql(
			"""SELECT IFNULL(SUM(row.spoilage_quantity_ht), 0)
				FROM `tabHarvest Table` row
				INNER JOIN `tabHarvest Log` log ON log.name = row.parent
				WHERE log.date_hl = %(date)s AND log.docstatus < 2""",
			{"date": date},
		)[0][0]
	)

	# everything that actually left stock that day, whatever moved it
	consumed = flt(
		frappe.db.sql(
			"""SELECT IFNULL(SUM(ABS(actual_qty)), 0) FROM `tabStock Ledger Entry`
				WHERE posting_date = %(date)s AND actual_qty < 0 AND is_cancelled = 0""",
			{"date": date},
		)[0][0]
	)

	attendance = round(present * 100.0 / workforce) if workforce else 0

	return {
		"date": str(date),
		"currency": frappe.db.get_value("Company", frappe.defaults.get_global_default("company"), "default_currency") or "INR",
		"cards": [
			{"key": "present", "label": _("Total Employees Present"), "value": present, "tone": "green",
			 "note": _("Half day counts as 0.5")},
			{"key": "attendance", "label": _("Attendance %"), "value": attendance, "suffix": "%", "tone": "blue",
			 "note": _("{0} of {1} on the labour master").format(present, workforce)},
			{"key": "sales", "label": _("Total Sales Today"), "value": sales, "money": 1, "tone": "teal"},
			{"key": "production", "label": _("Production Output"), "value": production, "tone": "amber",
			 "note": _("Usable harvest; {0} spoiled").format(spoilage)},
			{"key": "consumed", "label": _("Stock Consumed"), "value": consumed, "tone": "red",
			 "note": _("Everything issued out of stock today")},
		],
	}


# ---------------------------------------------------------------- attendance report
# One definition of the table, used by the screen, the spreadsheet and the PDF, so the
# three can never drift apart.
ATTENDANCE_COLUMNS = [
	("date", "Date", "left"),
	("worker_name", "Worker Name", "left"),
	("location", "Centre / Location", "left"),
	("leave", "Leave", "left"),
	("present", "Present", "center"),
	("absent", "Absent", "center"),
	("daily_wages", "Daily Wages (Rs)", "right"),
	("amount", "Amount (Rs)", "right"),
]

# how a Leave value splits a day. Anything else counts as a full day present.
LEAVE_SPLIT = {
	"First Half": (0.5, 0.5),
	"Second Half": (0.5, 0.5),
	"Full Day": (0.0, 1.0),
}


def _attendance_rows(from_date, to_date, location=None, worker=None, leave_type=None):
	filters = {"date_al": ["between", [getdate(from_date), getdate(to_date)]], "docstatus": ["<", 2]}
	if location:
		filters["centre__location_al"] = location
	if worker:
		# a Link control showing a title can hand back that title instead of the id, so a
		# readable name is resolved rather than quietly matching nothing
		if not frappe.db.exists("Labour Information", worker):
			worker = frappe.db.get_value("Labour Information", {"name_of_person": worker}, "name") or worker
		filters["name_of_person_al"] = worker

	logs = frappe.get_all(
		"Attendance Log",
		fields=["name", "date_al", "centre__location_al", "name_of_person_al", "log_in_al", "log_out_al", "leave"],
		filters=filters,
		limit_page_length=0,
		order_by="date_al asc, name_of_person_al asc",
	)

	# a blank Leave means the same thing as "No Leave", so the filter treats them alike
	if leave_type:
		wanted = "" if leave_type == "No Leave" else leave_type
		logs = [log for log in logs if (log.get("leave") or "").strip() in ({"", "No Leave"} if wanted == "" else {wanted})]

	# Labour Information is named by a series here, so the readable name and the wage rate
	# both have to be looked up
	ids = list({log["name_of_person_al"] for log in logs if log.get("name_of_person_al")})
	labour = {}
	if ids:
		for row in frappe.get_all(
			"Labour Information",
			fields=["name", "name_of_person", "first_name", "last_name", "daily_wage_rate"],
			filters=[["name", "in", ids]],
			limit_page_length=0,
		):
			readable = row.name_of_person or " ".join(filter(None, [row.first_name, row.last_name])) or row.name
			labour[row.name] = {"label": readable, "rate": flt(row.daily_wage_rate)}

	rows = []
	for log in logs:
		worker_id = log.get("name_of_person_al") or ""
		info = labour.get(worker_id, {})
		leave = (log.get("leave") or "").strip() or "No Leave"
		present, absent = LEAVE_SPLIT.get(leave, (1.0, 0.0))
		rate = flt(info.get("rate"))
		rows.append({
			"date": _user_date(log.get("date_al")),
			"worker": worker_id,
			"worker_name": info.get("label") or worker_id or "Unknown",
			"location": log.get("centre__location_al") or "Unknown",
			"leave": leave,
			"present": present,
			"absent": absent,
			"daily_wages": rate,
			"amount": flt(present * rate),
		})

	rows.sort(key=lambda row: (row["date"], row["location"], row["worker_name"]))
	return rows


def _attendance_payload(from_date, to_date, location=None, worker=None, leave_type=None, view="present"):
	rows = _attendance_rows(from_date, to_date, location, worker, leave_type)
	shown = [row for row in rows if row["absent"] > 0] if view == "absent" else rows

	daily, by_location = {}, {}
	for row in rows:
		daily[row["date"]] = flt(daily.get(row["date"], 0)) + row["present"]
		by_location[row["location"]] = flt(by_location.get(row["location"], 0)) + row["present"]

	return {
		"rows": shown,
		"columns": [{"key": key, "label": _(label), "align": align} for key, label, align in ATTENDANCE_COLUMNS],
		"summary": {
			"total_workers": len({row["worker_name"] for row in rows}),
			"total_present": flt(sum(row["present"] for row in rows)),
			"total_absent": flt(sum(row["absent"] for row in rows)),
			"total_amount": flt(sum(row["amount"] for row in rows)),
		},
		"daily_trend": dict(sorted(daily.items())),
		"location_wise": dict(sorted(by_location.items())),
		"currency": frappe.db.get_value("Company", frappe.defaults.get_global_default("company"), "default_currency") or "INR",
	}


@frappe.whitelist()
def attendance_report(from_date, to_date, location=None, worker=None, leave_type=None, view="present"):
	return _attendance_payload(from_date, to_date, location, worker, leave_type, view)


def _attendance_totals(rows):
	return (
		flt(sum(row["present"] for row in rows)),
		flt(sum(row["absent"] for row in rows)),
		flt(sum(row["daily_wages"] for row in rows)),
		flt(sum(row["amount"] for row in rows)),
	)


def _attendance_filter_pairs(location, worker, leave_type, view):
	return [
		(_("Centre / Location"), location),
		(_("Worker"), worker),
		(_("Leave Type"), leave_type),
		(_("View"), _("Absentees") if view == "absent" else _("Employees Attendance")),
	]


@frappe.whitelist()
def attendance_report_xlsx(from_date, to_date, location=None, worker=None, leave_type=None, view="present"):
	data = _attendance_payload(from_date, to_date, location, worker, leave_type, view)
	present, absent, wages, amount = _attendance_totals(data["rows"])
	_report_xlsx(
		_("Attendance Report"),
		_("Period: {0} to {1}").format(_user_date(from_date), _user_date(to_date)),
		data["columns"],
		data["rows"],
		totals=["", "", "", "", _("Grand Total"), present, absent, wages, amount],
		filters=_attendance_filter_pairs(location, worker, leave_type, view),
	)


@frappe.whitelist()
def attendance_report_pdf(from_date, to_date, location=None, worker=None, leave_type=None, view="present"):
	data = _attendance_payload(from_date, to_date, location, worker, leave_type, view)
	present, absent, wages, amount = _attendance_totals(data["rows"])
	_report_pdf(
		_("Attendance Report"),
		_("Period: {0} to {1}").format(_user_date(from_date), _user_date(to_date)),
		data["columns"],
		data["rows"],
		footer=_(
			"Total Present: {0} &nbsp;&nbsp; Total Leave / Absent: {1} &nbsp;&nbsp; "
			"Total Daily Wages: {2} &nbsp;&nbsp; Grand Total Amount: {3}"
		).format(present, absent, wages, amount),
		filters=_attendance_filter_pairs(location, worker, leave_type, view),
	)

# ---------------------------------------------------------------- report exports
# One pair of helpers for every report, so a spreadsheet and a PDF always carry exactly
# the columns the screen shows.


def _report_filters(pairs):
	"""Only the filters that were actually set, as label/value pairs."""
	return [[label, str(value)] for label, value in (pairs or []) if value not in (None, "", [])]


def _report_xlsx(title, period, columns, rows, totals=None, filters=None):
	from frappe.utils.xlsxutils import make_xlsx

	sheet = [[title], [period]]
	applied = _report_filters(filters)
	if applied:
		# spelled out, so a saved sheet still says what it was filtered by
		sheet.append([])
		sheet.append([_("Filters applied")])
		sheet.extend(applied)
	sheet.append([])
	sheet.append(["#"] + [column["label"] for column in columns])
	for index, row in enumerate(rows, start=1):
		sheet.append([index] + [row.get(column["key"]) for column in columns])
	if totals:
		sheet.append([])
		sheet.append(totals)

	frappe.response["filename"] = f"{title.replace(' ', '_')}_{frappe.utils.nowdate()}.xlsx"
	frappe.response["filecontent"] = make_xlsx(sheet, title[:31]).getvalue()
	frappe.response["type"] = "binary"


def _report_pdf(title, period, columns, rows, footer="", filters=None):
	from frappe.utils.pdf import get_pdf

	head = "".join(
		f'<th style="text-align:{column.get("align", "left")}">{frappe.utils.escape_html(column["label"])}</th>'
		for column in columns
	)
	body = ""
	for index, row in enumerate(rows, start=1):
		cells = "".join(
			f'<td style="text-align:{column.get("align", "left")}">'
			f'{frappe.utils.escape_html("" if row.get(column["key"]) is None else str(row.get(column["key"])))}</td>'
			for column in columns
		)
		body += f"<tr><td>{index}</td>{cells}</tr>"

	applied = _report_filters(filters)
	applied_html = ""
	if applied:
		joined = " &nbsp;·&nbsp; ".join(
			f"{frappe.utils.escape_html(label)}: <b>{frappe.utils.escape_html(value)}</b>" for label, value in applied
		)
		applied_html = f"<br>{_('Filters applied')} &mdash; {joined}"

	html = f"""<style>
			body {{ font-family: sans-serif; font-size: 9pt; color: #222; }}
			h2 {{ margin: 0 0 4px; color: #5b45e8; font-size: 14pt; }}
			p.period {{ margin: 0 0 12px; color: #555; font-size: 8pt; }}
			table {{ width: 100%; border-collapse: collapse; }}
			th {{ background: #5b45e8; color: #fff; padding: 6px; font-size: 8pt; }}
			td {{ padding: 5px 6px; border-bottom: 1px solid #e9e6fb; }}
			tr:nth-child(even) td {{ background: #f6f5ff; }}
			.totals {{ margin-top: 12px; color: #5b45e8; font-weight: bold; font-size: 9pt; }}
		</style>
		<h2>{frappe.utils.escape_html(title)}</h2>
		<p class="period">{frappe.utils.escape_html(period)}{applied_html}</p>
		<table><thead><tr><th>#</th>{head}</tr></thead><tbody>{body}</tbody></table>
		{f'<div class="totals">{footer}</div>' if footer else ''}"""

	frappe.response["filename"] = f"{title.replace(' ', '_')}_{frappe.utils.nowdate()}.pdf"
	frappe.response["filecontent"] = get_pdf(html, {"orientation": "Landscape"})
	frappe.response["type"] = "binary"


# ---------------------------------------------------------------- production report
PRODUCTION_COLUMNS = [
	{"key": "date", "label": "Date", "align": "left"},
	{"key": "stock_entry", "label": "Stock Entry Ref", "align": "left"},
	{"key": "location", "label": "Centre / Location", "align": "left"},
	{"key": "field", "label": "Name of Field", "align": "left"},
	{"key": "item", "label": "Item", "align": "left"},
	{"key": "quantity", "label": "Quantity", "align": "right"},
	{"key": "uom", "label": "UOM", "align": "left"},
]


def _production_payload(from_date, to_date, location=None, items=None):
	conditions = ["hl.docstatus < 2", "hl.date_hl BETWEEN %(from_date)s AND %(to_date)s"]
	values = {"from_date": getdate(from_date), "to_date": getdate(to_date)}

	if location:
		conditions.append("hl.centre__location_hl = %(location)s")
		values["location"] = location

	# the picker sends item codes, but a name typed by hand should work too
	chosen = [name.strip() for name in (items or "").split(",") if name.strip()]
	if chosen:
		placeholders = []
		for index, name in enumerate(chosen):
			key = f"item_{index}"
			placeholders.append(f"%({key})s")
			values[key] = name
		joined = ", ".join(placeholders)
		conditions.append(f"(ht.name_of_crop_ht IN ({joined}) OR it.item_name IN ({joined}))")

	where = "WHERE " + " AND ".join(conditions)

	rows = frappe.db.sql(
		f"""SELECT
				hl.date_hl AS date,
				hl.stock_entry_reference_hl AS stock_entry,
				hl.centre__location_hl AS location,
				COALESCE(fd.name_of_field, hl.name_of_field_hl) AS field,
				COALESCE(it.item_name, ht.name_of_crop_ht) AS item,
				IFNULL(ht.usable_quantity_ht, 0) AS quantity,
				ht.uom AS uom,
				IFNULL(ht.spoilage_quantity_ht, 0) AS spoilage
			FROM `tabHarvest Log` hl
			INNER JOIN `tabHarvest Table` ht ON ht.parent = hl.name
			LEFT JOIN `tabItem` it ON it.item_code = ht.name_of_crop_ht
			LEFT JOIN `tabField Details` fd ON fd.name = hl.name_of_field_hl
			{where}
			ORDER BY hl.date_hl ASC, hl.centre__location_hl ASC, item ASC""",
		values,
		as_dict=True,
	)
	for row in rows:
		row["date"] = _user_date(row["date"])

	graph = frappe.db.sql(
		f"""SELECT
				hl.date_hl AS date,
				COALESCE(it.item_name, ht.name_of_crop_ht) AS item,
				ht.uom AS uom,
				SUM(IFNULL(ht.usable_quantity_ht, 0)) AS value
			FROM `tabHarvest Log` hl
			INNER JOIN `tabHarvest Table` ht ON ht.parent = hl.name
			LEFT JOIN `tabItem` it ON it.item_code = ht.name_of_crop_ht
			{where}
			GROUP BY hl.date_hl, item, ht.uom
			ORDER BY hl.date_hl ASC""",
		values,
		as_dict=True,
	)
	for row in graph:
		row["date"] = str(row["date"] or "")

	# every item ever harvested, so the picker is not narrowed by the current filters
	picker = frappe.db.sql(
		"""SELECT DISTINCT COALESCE(it.item_name, ht.name_of_crop_ht) AS item
			FROM `tabHarvest Table` ht
			LEFT JOIN `tabItem` it ON it.item_code = ht.name_of_crop_ht
			WHERE IFNULL(ht.name_of_crop_ht, '') != ''
			ORDER BY item""",
		as_dict=True,
	)

	return {
		"rows": rows,
		"graph": graph,
		"items": [row["item"] for row in picker if row["item"]],
		"columns": [{**column, "label": _(column["label"])} for column in PRODUCTION_COLUMNS],
		"summary": {
			"total_quantity": flt(sum(flt(row["quantity"]) for row in rows)),
			"total_spoilage": flt(sum(flt(row["spoilage"]) for row in rows)),
			"total_records": len(rows),
			"total_items": len({row["item"] for row in rows if row["item"]}),
		},
	}


@frappe.whitelist()
def production_report(from_date, to_date, location=None, items=None):
	return _production_payload(from_date, to_date, location, items)


def _production_filter_pairs(location, items):
	chosen = ", ".join(name.strip() for name in (items or "").split(",") if name.strip())
	return [(_("Location"), location), (_("Item"), chosen)]


@frappe.whitelist()
def production_report_xlsx(from_date, to_date, location=None, items=None):
	data = _production_payload(from_date, to_date, location, items)
	_report_xlsx(
		_("Production Report"),
		_("Period: {0} to {1}").format(_user_date(from_date), _user_date(to_date)),
		data["columns"],
		data["rows"],
		totals=["", "", "", "", "", _("Total Quantity"), data["summary"]["total_quantity"], ""],
		filters=_production_filter_pairs(location, items),
	)


@frappe.whitelist()
def production_report_pdf(from_date, to_date, location=None, items=None):
	data = _production_payload(from_date, to_date, location, items)
	summary = data["summary"]
	_report_pdf(
		_("Production Report"),
		_("Period: {0} to {1}").format(_user_date(from_date), _user_date(to_date)),
		data["columns"],
		data["rows"],
		footer=_("Total Quantity: {0} &nbsp;&nbsp; Records: {1} &nbsp;&nbsp; Items: {2}").format(
			summary["total_quantity"], summary["total_records"], summary["total_items"]
		),
		filters=_production_filter_pairs(location, items),
	)


# ---------------------------------------------------------------- sales report
# Two views over the same invoices. Qty carries its UOM in the cell, so the screen, the
# spreadsheet and the PDF all show the identical table.
SALES_INVOICE_COLUMNS = [
	{"key": "date", "label": "Date", "align": "left"},
	{"key": "invoice", "label": "Invoice No", "align": "left"},
	{"key": "status", "label": "Status", "align": "left"},
	{"key": "warehouse", "label": "Source Warehouse", "align": "left"},
	{"key": "item", "label": "Item", "align": "left"},
	{"key": "qty", "label": "Qty", "align": "right"},
	{"key": "rate", "label": "Rate (Rs.)", "align": "right"},
	{"key": "amount", "label": "Amount (Rs.)", "align": "right"},
]

SALES_CUSTOMER_COLUMNS = [
	{"key": "date", "label": "Date", "align": "left"},
	{"key": "invoice", "label": "Invoice No", "align": "left"},
	{"key": "status", "label": "Status", "align": "left"},
	{"key": "warehouse", "label": "Source Warehouse", "align": "left"},
	{"key": "customer", "label": "Customer", "align": "left"},
	{"key": "amount", "label": "Amount (Rs.)", "align": "right"},
]


def _sales_conditions(from_date, to_date, customer=None, warehouse=None, status=None):
	conditions = ["si.docstatus = 1", "si.posting_date BETWEEN %(from_date)s AND %(to_date)s"]
	values = {"from_date": getdate(from_date), "to_date": getdate(to_date)}

	if customer:
		conditions.append("si.customer = %(customer)s")
		values["customer"] = customer
	if warehouse:
		conditions.append("si.set_warehouse = %(warehouse)s")
		values["warehouse"] = warehouse
	# Paid means nothing outstanding; anything still owed counts as unpaid, Overdue included
	if status == "Paid":
		conditions.append("IFNULL(si.outstanding_amount, 0) = 0")
	elif status == "Unpaid":
		conditions.append("IFNULL(si.outstanding_amount, 0) > 0")

	return conditions, values


def _sales_item_clause(items, values):
	chosen = [name.strip() for name in _json(items, []) if str(name).strip()] if items else []
	if isinstance(items, str) and not items.strip().startswith("["):
		chosen = [name.strip() for name in items.split(",") if name.strip()]
	if not chosen:
		return "", chosen
	placeholders = []
	for index, name in enumerate(chosen):
		key = f"sitem_{index}"
		placeholders.append(f"%({key})s")
		values[key] = name
	joined = ", ".join(placeholders)
	return f"(sii.item_code IN ({joined}) OR sii.item_name IN ({joined}))", chosen


@frappe.whitelist()
def sales_report(from_date, to_date, view="invoice", customer=None, warehouse=None, status=None, items=None):
	conditions, values = _sales_conditions(from_date, to_date, customer, warehouse, status)
	item_clause, chosen = _sales_item_clause(items, values)

	if view == "customer":
		# one row per invoice; when items are chosen the amount narrows to those lines
		if chosen:
			conditions.append(item_clause)
			amount = "SUM(sii.amount)"
			join = "INNER JOIN `tabSales Invoice Item` sii ON sii.parent = si.name"
		else:
			amount = "MAX(si.grand_total)"
			join = ""
		rows = frappe.db.sql(
			f"""SELECT
					si.posting_date AS date,
					si.name AS invoice,
					si.status AS status,
					COALESCE(si.set_warehouse, '') AS warehouse,
					COALESCE(si.customer_name, si.customer) AS customer,
					{amount} AS amount
				FROM `tabSales Invoice` si
				{join}
				WHERE {' AND '.join(conditions)}
				GROUP BY si.name, si.posting_date, si.status, si.set_warehouse, si.customer_name, si.customer
				ORDER BY si.posting_date ASC, si.name ASC""",
			values,
			as_dict=True,
		)
		for row in rows:
			row["date"] = _user_date(row["date"])
			row["amount"] = flt(row["amount"])
		return {
			"rows": rows,
			"columns": [{**column, "label": _(column["label"])} for column in SALES_CUSTOMER_COLUMNS],
			"totals": {"amount": flt(sum(row["amount"] for row in rows)), "records": len(rows)},
			"currency": frappe.db.get_value("Company", frappe.defaults.get_global_default("company"), "default_currency") or "INR",
		}

	# invoice-wise: one row per invoice line
	if item_clause:
		conditions.append(item_clause)
	rows = frappe.db.sql(
		f"""SELECT
				si.posting_date AS date,
				si.name AS invoice,
				si.status AS status,
				COALESCE(NULLIF(si.set_warehouse, ''), sii.warehouse, '') AS warehouse,
				COALESCE(sii.item_name, sii.item_code) AS item,
				IFNULL(sii.qty, 0) AS qty_value,
				COALESCE(sii.uom, '') AS uom,
				IFNULL(sii.rate, 0) AS rate,
				IFNULL(sii.amount, 0) AS amount
			FROM `tabSales Invoice` si
			INNER JOIN `tabSales Invoice Item` sii ON sii.parent = si.name
			WHERE {' AND '.join(conditions)}
			ORDER BY si.posting_date ASC, si.name ASC, sii.idx ASC""",
		values,
		as_dict=True,
	)
	for row in rows:
		row["date"] = _user_date(row["date"])
		row["qty_value"] = flt(row["qty_value"])
		# the cell shown everywhere, so exports match the screen exactly
		row["qty"] = f"{row['qty_value']:g} {row['uom']}".strip()

	return {
		"rows": rows,
		"columns": [{**column, "label": _(column["label"])} for column in SALES_INVOICE_COLUMNS],
		"totals": {
			"qty": flt(sum(row["qty_value"] for row in rows)),
			"amount": flt(sum(flt(row["amount"]) for row in rows)),
			"records": len(rows),
		},
		"currency": frappe.db.get_value("Company", frappe.defaults.get_global_default("company"), "default_currency") or "INR",
	}


def _sales_title(view):
	return _("Customer-wise Sales") if view == "customer" else _("Invoice-wise Sales")


def _sales_filter_pairs(view, customer, warehouse, status, items):
	chosen = _json(items, []) if items else []
	if isinstance(chosen, str):
		chosen = [chosen]
	return [
		(_("View"), _sales_title(view)),
		(_("Source Warehouse"), warehouse),
		(_("Customer"), customer),
		(_("Status"), status),
		(_("Item"), ", ".join(str(name) for name in chosen)),
	]


@frappe.whitelist()
def sales_report_xlsx(from_date, to_date, view="invoice", customer=None, warehouse=None, status=None, items=None):
	data = sales_report(from_date, to_date, view, customer, warehouse, status, items)
	totals = data["totals"]
	row = (["", "", "", "", _("Total"), totals["amount"]] if view == "customer"
		else ["", "", "", "", _("Total"), totals["qty"], "", totals["amount"]])
	_report_xlsx(_sales_title(view), _("Period: {0} to {1}").format(_user_date(from_date), _user_date(to_date)),
		data["columns"], data["rows"], totals=row,
		filters=_sales_filter_pairs(view, customer, warehouse, status, items))


@frappe.whitelist()
def sales_report_pdf(from_date, to_date, view="invoice", customer=None, warehouse=None, status=None, items=None):
	data = sales_report(from_date, to_date, view, customer, warehouse, status, items)
	totals = data["totals"]
	footer = (_("Total Amount: {0} &nbsp;&nbsp; Invoices: {1}").format(totals["amount"], totals["records"])
		if view == "customer"
		else _("Total Qty: {0} &nbsp;&nbsp; Total Amount: {1} &nbsp;&nbsp; Rows: {2}").format(
			totals["qty"], totals["amount"], totals["records"]))
	_report_pdf(_sales_title(view), _("Period: {0} to {1}").format(_user_date(from_date), _user_date(to_date)),
		data["columns"], data["rows"], footer=footer,
		filters=_sales_filter_pairs(view, customer, warehouse, status, items))


# ---------------------------------------------------------------- pos closing entry
@frappe.whitelist()
def pos_closing_from_opening(pos_opening_entry, period_end_date=None):
	"""Everything a POS Closing Entry takes from its opening entry.

	ERPNext's desk form assembles this in the browser; the same numbers are put together
	here so the Agriventure form can fill itself the moment the opening entry is picked.
	Its own `get_pos_invoices` decides which invoices fall inside the shift, so the window
	logic stays ERPNext's.
	"""
	from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import get_pos_invoices

	opening = frappe.get_doc("POS Opening Entry", pos_opening_entry)
	opening.check_permission("read")

	start = opening.period_start_date
	end = period_end_date or frappe.utils.now_datetime()

	# opening float per mode; expected starts there and grows with the day's takings
	payments = {}
	order = []
	for row in opening.balance_details:
		payments[row.mode_of_payment] = {
			"mode_of_payment": row.mode_of_payment,
			"opening_amount": flt(row.opening_amount),
			"expected_amount": flt(row.opening_amount),
			"closing_amount": 0.0,
			"difference": 0.0,
		}
		order.append(row.mode_of_payment)

	invoices = get_pos_invoices(
		frappe.utils.get_datetime_str(start),
		frappe.utils.get_datetime_str(end),
		opening.pos_profile,
		opening.user,
	)

	transactions = []
	taxes = {}
	grand_total = net_total = total_quantity = 0.0

	for invoice in invoices:
		grand_total += flt(invoice.get("grand_total"))
		net_total += flt(invoice.get("net_total"))
		total_quantity += flt(invoice.get("total_qty"))

		transactions.append({
			"pos_invoice": invoice.get("name"),
			"posting_date": _system_date(invoice.get("posting_date")),
			"customer": invoice.get("customer"),
			"grand_total": flt(invoice.get("grand_total")),
			"is_return": cint(invoice.get("is_return")),
			"return_against": invoice.get("return_against"),
		})

		for payment in invoice.get("payments") or []:
			amount = flt(payment.get("amount"))
			# change handed back is not money left in the drawer
			if payment.get("account") and payment.get("account") == invoice.get("account_for_change_amount"):
				amount -= flt(invoice.get("change_amount"))
			mode = payment.get("mode_of_payment")
			if mode not in payments:
				payments[mode] = {"mode_of_payment": mode, "opening_amount": 0.0,
					"expected_amount": 0.0, "closing_amount": 0.0, "difference": 0.0}
				order.append(mode)
			payments[mode]["expected_amount"] += amount

		for tax in invoice.get("taxes") or []:
			key = (tax.get("account_head"), flt(tax.get("rate")))
			taxes.setdefault(key, {"account_head": key[0], "rate": key[1], "amount": 0.0})
			taxes[key]["amount"] += flt(tax.get("tax_amount"))

	# ERPNext seeds the counted amount with what it expects, and the cashier corrects it
	for mode in order:
		row = payments[mode]
		row["closing_amount"] = row["expected_amount"]
		row["difference"] = 0.0

	return {
		"period_start_date": _trim_microseconds(start),
		"period_end_date": _trim_microseconds(frappe.utils.get_datetime(end)),
		"company": opening.company,
		"pos_profile": opening.pos_profile,
		"user": opening.user,
		"payment_reconciliation": [payments[mode] for mode in order],
		"pos_transactions": transactions,
		"taxes": list(taxes.values()),
		"grand_total": flt(grand_total),
		"net_total": flt(net_total),
		"total_quantity": flt(total_quantity),
		"invoice_count": len(transactions),
	}


@frappe.whitelist()
def list_status_options(kind):
	"""What the list's Status column can actually read, and the field it comes from.

	Where a workflow is in charge the column shows its state, so offering the doctype's
	own `status` options would filter on something the user never sees. The values are
	taken from the rows themselves, so the list can only ever offer what exists.
	"""
	config = _config(kind)
	meta = frappe.get_meta(config["doctype"])
	workflow_field = frappe.db.get_value(
		"Workflow", {"document_type": config["doctype"], "is_active": 1}, "workflow_state_field"
	)
	fieldname = None
	if workflow_field and meta.has_field(workflow_field):
		fieldname = workflow_field
	elif meta.has_field("status"):
		fieldname = "status"
	if not fieldname:
		return {"fieldname": None, "options": []}

	rows = frappe.get_all(
		config["doctype"],
		fields=["distinct `{0}` as value".format(fieldname)],
		filters={fieldname: ["not in", ["", None]]},
		limit_page_length=200,
	)
	options = sorted({row.value for row in rows if row.value})
	# Cancelling does not move a workflow, so no row stores "Cancelled" - yet that is what
	# the list shows for one. The filter offers it too, and list_documents reads it back as
	# docstatus, so what is picked matches what is on screen.
	if meta.is_submittable and frappe.db.exists(config["doctype"], {"docstatus": 2}):
		if "Cancelled" not in options:
			options.append("Cancelled")
	return {"fieldname": fieldname, "options": options}


@frappe.whitelist()
def amend_document(kind, name):
	"""A cancelled document copied for amendment, the way the desk's Amend does it.

	frappe.copy_doc drops the no-copy fields and every child row's name, so the copy comes
	back genuinely new. Doing this server-side rather than with the browser's copy_doc
	avoids the local placeholder names that would then be sent back as real ones.
	"""
	config = _config(kind)
	doc = frappe.get_doc(config["doctype"], name)
	doc.check_permission("read")

	if cint(doc.docstatus) != 2:
		frappe.throw(_("Only a cancelled document can be amended."), frappe.ValidationError)
	if not doc.meta.has_field("amended_from"):
		frappe.throw(_("This document type cannot be amended."), frappe.ValidationError)
	# the same guard the desk applies through frappe.client.is_document_amended
	if frappe.db.exists(config["doctype"], {"amended_from": name, "docstatus": ["!=", 2]}):
		frappe.throw(_("This document is already amended, you cannot amend it again."), frappe.ValidationError)

	copy = frappe.copy_doc(doc, ignore_no_copy=False)
	copy.amended_from = name
	if copy.meta.has_field("amendment_date"):
		copy.amendment_date = nowdate()
	return _trim_microseconds(copy.as_dict())


@frappe.whitelist()
def document_connections(kind, name):
	"""What the desk's Connections panel shows: the documents tied to this one.

	The groups and the link fields are read from the doctype's own
	<doctype>_dashboard.py, so nothing about the relationships is restated here - the same
	source the desk uses. Only the counting is done locally, because the names are wanted
	too: one linked document can then be opened directly instead of through a list.
	"""
	config = _config(kind)
	doctype = config["doctype"]
	doc = frappe.get_doc(doctype, name)
	doc.check_permission("read")

	links = frappe.get_meta(doctype).get_dashboard_data()
	default_field = links.get("fieldname")
	odd_fields = links.get("non_standard_fieldnames") or {}
	internal = dict(links.get("internal_links") or {})
	internal.update(links.get("internal_and_external_links") or {})

	# a target this workspace has a page for can be opened without leaving it
	kind_for = {config["doctype"]: key for key, config in DOCTYPES.items()}

	groups = []
	for group in links.get("transactions") or []:
		items = []
		for target in group.get("items") or []:
			names, fieldname = [], odd_fields.get(target) or default_field
			route = internal.get(target)
			try:
				if route:
					# the link lives on the child rows, not on the document itself
					table, child_field = route[0], route[1]
					names = sorted({row.get(child_field) for row in (doc.get(table) or []) if row.get(child_field)})
					fieldname = None
				elif fieldname and frappe.has_permission(target, "read"):
					names = sorted(set(frappe.get_all(target, filters={fieldname: name}, pluck="name", limit=200)))
			except Exception:
				names = []
			items.append({
				"doctype": target,
				"kind": kind_for.get(target),
				"count": len(names),
				"names": names[:50],
				"fieldname": fieldname,
			})
		if items:
			groups.append({"label": group.get("label") or "", "items": items})

	return {"groups": groups}


@frappe.whitelist()
def list_documents(kind, search=None, status=None, from_date=None, to_date=None, start=0, page_length=20, filters=None):
	config = _config(kind)
	meta = frappe.get_meta(config["doctype"])
	query_filters = _normalize_list_filters(config, meta, filters)
	# a kind may be permanently narrowed, whatever the user filters on
	for fieldname, value in (config.get("fixed_filters") or {}).items():
		query_filters.append([config["doctype"], fieldname, "=", value])
	if status:
		query_filters.append([config["doctype"], "status", "=", status])
	if from_date or to_date:
		query_filters.append([config["doctype"], config["date_field"], "between", [from_date or "1900-01-01", to_date or "2999-12-31"]])
	or_filters = []
	if search:
		or_filters = [[field, "like", f"%{search}%"] for field in _valid_fields(meta, config["search_fields"])]
	columns = _valid_fields(meta, config["columns"])
	# where a workflow is in charge it owns the real state, so the Status column shows
	# that instead of the built-in status and the list agrees with the badge on the form
	workflow_field = frappe.db.get_value(
		"Workflow", {"document_type": config["doctype"], "is_active": 1}, "workflow_state_field"
	)
	# When the workflow field is asked for by name the two are shown side by side, so the
	# doctype's own status is left alone; otherwise the Status column carries the workflow.
	use_workflow_state = (
		bool(workflow_field)
		and "status" in columns
		and meta.has_field(workflow_field)
		and workflow_field not in columns
	)
	# The Status column reads "Cancelled" for a cancelled document while the stored state
	# still says "Approved". Filtering on what is on screen therefore has to be translated:
	# "Cancelled" becomes docstatus, and any other state excludes the cancelled rows that
	# would otherwise come back wearing a state they no longer show.
	state_fields = {"status", workflow_field} - {None, ""}
	translated = []
	for entry in query_filters:
		entry_doctype, entry_field, entry_operator, entry_value = entry
		if entry_doctype == config["doctype"] and entry_field in state_fields and entry_operator in ("=", "like"):
			plain = str(entry_value).strip().strip("%")
			if plain.lower() == "cancelled":
				translated.append([config["doctype"], "docstatus", "=", 2])
				continue
			if meta.is_submittable:
				translated.append([config["doctype"], "docstatus", "!=", 2])
		translated.append(entry)
	query_filters = translated

	query = {
		# docstatus bhi laate hain — cancelled row ka status workflow state se
		# overwrite nahi hona chahiye (workflow state cancel par badalta nahi).
		"fields": columns
		+ ([workflow_field] if use_workflow_state and workflow_field not in columns else [])
		+ (["docstatus"] if "docstatus" not in columns else []),
		"filters": query_filters,
		# Newest first by the document's own date, with last-touched breaking a tie. A kind
		# may name its own order; masters, dated only by creation, sort on that.
		# Qualified, because a filter on a child row joins that table in and both sides
		# carry `modified`.
		"order_by": ", ".join(
			"`{0}`.{1}".format("tab" + config["doctype"], term)
			for term in (config.get("order_by") or _default_order(config))
		),
		"start": cint(start),
		"page_length": min(max(cint(page_length), 1), 100),
	}
	if or_filters:
		query["or_filters"] = or_filters
	# filtering on a child row joins the table, so the parent would repeat once per match
	if any(entry[0] != config["doctype"] for entry in query_filters):
		query["distinct"] = True
	rows = frappe.get_list(config["doctype"], **query)
	for row in rows:
		if cint(row.get("docstatus")) == 2:
			# Cancel har workflow state par bhaari — warna list me "Approved" dikhta tha.
			row["status"] = "Cancelled"
			if workflow_field and workflow_field in columns:
				row[workflow_field] = "Cancelled"
		elif use_workflow_state and row.get(workflow_field):
			row["status"] = row[workflow_field]
	_apply_link_titles(meta, columns, rows)
	# qualified: Frappe leaves fields wrapped in a function alone, so with a child table
	# joined in a bare `name` would be ambiguous
	count_query = {
		"fields": ["count(distinct `tab{0}`.name) as count".format(config["doctype"])],
		"filters": query_filters,
		"page_length": 1,
	}
	if or_filters:
		count_query["or_filters"] = or_filters
	count = frappe.get_list(config["doctype"], **count_query)
	return {
		"rows": rows,
		"count": cint(count[0].count if count else 0),
		"columns": columns,
		"can_delete": bool(frappe.has_permission(config["doctype"], "delete")),
	}


CALCULATED_DOCTYPES = {"supplier-quotation", "purchase-order", "purchase-receipt", "purchase-invoice"}

RATE_FALLBACK_DOCTYPES = {"Purchase Order"}


def _seed_currency(doc):
	"""Give ERPNext a currency and exchange rate before it fetches item details.

	A half-filled form often has no currency yet, and ERPNext's item-details code
	throws "Exchange Rate is mandatory" in that state, which would leave the row
	without its UOM or last purchase rate.
	"""
	import erpnext

	if doc.meta.has_field("company") and not doc.get("company"):
		doc.company = frappe.defaults.get_user_default("Company") or frappe.defaults.get_global_default("company")

	company_currency = erpnext.get_company_currency(doc.company) if doc.get("company") else None
	if doc.meta.has_field("currency") and not doc.get("currency"):
		doc.currency = company_currency or frappe.defaults.get_global_default("currency")
	if doc.meta.has_field("conversion_rate") and not flt(doc.get("conversion_rate")):
		doc.conversion_rate = 1
	if doc.meta.has_field("plc_conversion_rate") and not flt(doc.get("plc_conversion_rate")):
		doc.plc_conversion_rate = 1


def _seed_item_defaults(doc):
	"""Fill the item's own defaults for any row ERPNext could not resolve on its own."""
	from erpnext.stock.doctype.item.item import get_last_purchase_details

	for row in doc.get("items") or []:
		if not row.get("item_code"):
			continue
		if row.meta.has_field("uom") and not row.get("uom"):
			stock_uom = frappe.db.get_value("Item", row.item_code, "stock_uom")
			if stock_uom:
				row.uom = stock_uom
				if row.meta.has_field("stock_uom") and not row.get("stock_uom"):
					row.stock_uom = stock_uom
				if row.meta.has_field("conversion_factor") and not flt(row.get("conversion_factor")):
					row.conversion_factor = 1
		if row.meta.has_field("last_purchase_rate") and not flt(row.get("last_purchase_rate")):
			try:
				details = get_last_purchase_details(row.item_code, doc.get("name")) or {}
			except Exception:
				details = {}
			if details.get("base_rate"):
				row.last_purchase_rate = flt(details["base_rate"]) * flt(row.get("conversion_factor") or 1)


def _apply_rate_fallback(rows):
	"""Agriventure rule: a row left at zero rate is priced at the item's last purchase rate.

	The rate itself is rewritten rather than only the amount, so that every downstream
	figure - amount, totals, taxes, grand total - still comes from ERPNext's own engine
	and the saved document matches what the workspace showed.
	"""
	for row in rows or []:
		read = row.get if isinstance(row, dict) else lambda key: row.get(key)
		if flt(read("rate")) > 0:
			continue
		fallback = flt(read("last_purchase_rate"))
		if fallback <= 0:
			continue
		if isinstance(row, dict):
			row["rate"] = fallback
		else:
			row.rate = fallback


def _prune_blanks(value):
	"""Drop empty strings so ERPNext treats those fields as missing and fills its own defaults."""
	if isinstance(value, dict):
		return {key: _prune_blanks(item) for key, item in value.items() if item != ""}
	if isinstance(value, list):
		return [_prune_blanks(item) for item in value]
	return value


@frappe.whitelist()
def recalculate(kind, document):
	"""Run ERPNext's own item-details and taxes/totals engine over an in-progress document.

	Nothing is written to the database - the document is built in memory purely so the
	standard calculation code decides every total, which keeps the workspace in step with
	what the server will compute on save.
	"""
	config = _config(kind)
	if kind not in CALCULATED_DOCTYPES:
		frappe.throw(_("Live totals are not available for this document."), frappe.ValidationError)
	if not frappe.has_permission(config["doctype"], "read"):
		raise frappe.PermissionError

	clean = _sanitize_document(config["doctype"], _prune_blanks(_json(document, {})))
	doc = frappe.get_doc(clean)
	doc.flags.ignore_mandatory = True
	_seed_currency(doc)

	try:
		doc.set_missing_values()
	except Exception:
		# an incomplete form must never stop the totals from updating
		frappe.clear_last_message()

	_seed_item_defaults(doc)

	if config["doctype"] in RATE_FALLBACK_DOCTYPES:
		_apply_rate_fallback(doc.get("items"))

	doc.calculate_taxes_and_totals()
	return doc.as_dict()


AG_DATE_FORMAT = "%d/%m/%Y"


def _user_date(value):
	"""dd/mm/yyyy, the format this workspace shows everywhere.

	Kept here rather than leaning on System Settings, whose date_format is dd-mm-yyyy and
	is shared with every other app on this site.
	"""
	if not value:
		return ""
	try:
		return getdate(value).strftime(AG_DATE_FORMAT)
	except Exception:
		return str(value)


def _system_date(value):
	"""yyyy-mm-dd, which is what a form control reads.

	_user_date above is for a report - a printed page, where the reader's own format is the
	point. A control is the opposite: it parses the system format and formats for display
	itself, so handing it the user's format makes it reject the value outright.
	"""
	if not value:
		return ""
	try:
		return getdate(value).strftime("%Y-%m-%d")
	except Exception:
		return ""


def _trim_microseconds(value):
	"""Frappe's Date/Datetime/Time controls reject a value carrying microseconds.

	`period_start_date` on a POS Opening Entry is stored with them, which made the form
	complain "must be in format: dd-mm-yyyy" and drop the value.
	"""
	if isinstance(value, datetime):
		return value.replace(microsecond=0)
	if isinstance(value, timedelta):
		return timedelta(seconds=int(value.total_seconds()))
	if isinstance(value, dict):
		return {key: _trim_microseconds(item) for key, item in value.items()}
	if isinstance(value, list):
		return [_trim_microseconds(item) for item in value]
	return value


@frappe.whitelist()
def get_document(kind, name):
	config = _config(kind)
	doc = frappe.get_doc(config["doctype"], name)
	doc.check_permission("read")
	return _trim_microseconds(doc.as_dict())


@frappe.whitelist()
def get_meta(kind):
	config = _config(kind)
	meta = frappe.get_meta(config["doctype"])
	child_tables = {}
	for field in meta.fields:
		if field.fieldtype == "Table" and field.options:
			child_meta = frappe.get_meta(field.options)
			child_tables[field.fieldname] = {
				"doctype": field.options,
				"fields": [_field_dict(child) for child in child_meta.fields],
			}
	workflow = frappe.db.get_value(
		"Workflow",
		{"document_type": config["doctype"], "is_active": 1},
		["name", "workflow_state_field"],
		as_dict=True,
	)
	return {
		"doctype": config["doctype"],
		"title": config["title"],
		"fields": [_field_dict(field) for field in meta.fields],
		"child_tables": child_tables,
		"workflow": workflow,
		"create_targets": [
			{"label": target["label"], "kind": target.get("kind"), "doctype": target.get("doctype")}
			for target in CREATE_TARGETS.get(config["doctype"], [])
		],
	}


def _seed_payment_amounts(doc):
	"""Derive the Payment Entry amounts ERPNext insists on but the workspace does not ask for.

	Payment Entry's own validate_mandatory demands received_amount and both exchange rates.
	The workspace only asks for the paid amount, exactly as the approved screens do, so the
	rest are derived the same way ERPNext derives them: rate 1 against the company currency,
	and a received amount equal to the paid amount when both accounts share a currency.
	"""
	import erpnext

	if doc.doctype != "Payment Entry":
		return

	try:
		doc.set_missing_values()
	except Exception:
		# an incomplete form still gets whatever we can derive below
		frappe.clear_last_message()

	company_currency = erpnext.get_company_currency(doc.company) if doc.get("company") else None
	source_currency = doc.get("paid_from_account_currency")
	target_currency = doc.get("paid_to_account_currency")

	if not flt(doc.get("source_exchange_rate")) and source_currency == company_currency:
		doc.source_exchange_rate = 1
	if not flt(doc.get("target_exchange_rate")) and target_currency == company_currency:
		doc.target_exchange_rate = 1

	if flt(doc.get("received_amount")) or not flt(doc.get("paid_amount")):
		return
	if source_currency and source_currency == target_currency:
		doc.received_amount = flt(doc.paid_amount)
	elif flt(doc.get("source_exchange_rate")) and flt(doc.get("target_exchange_rate")):
		doc.received_amount = flt(doc.paid_amount) * flt(doc.source_exchange_rate) / flt(doc.target_exchange_rate)


@frappe.whitelist()
def save_document(kind, document):
	config = _config(kind)
	payload = _json(document, {})
	if payload.get("doctype") and payload["doctype"] != config["doctype"]:
		frappe.throw(_("Invalid document type."), frappe.ValidationError)
	clean = _sanitize_document(config["doctype"], payload)
	if config["doctype"] in RATE_FALLBACK_DOCTYPES:
		_apply_rate_fallback(clean.get("items"))
	# doctypes named "Prompt" (POS Profile) get their name typed on the form; it arrives
	# separately from `name` so an existing document is still recognised as an update
	new_name = clean.pop("__newname", None)
	if clean.get("name"):
		doc = frappe.get_doc(config["doctype"], clean["name"])
		doc.check_permission("write")
		if cint(doc.docstatus) == 1:
			# a submitted document is not rewritten wholesale; only the fields ERPNext marks
			# allow_on_submit are taken, and Frappe's own check still guards the rest
			_apply_allowed_after_submit(doc, clean)
		else:
			doc.update(clean)
		_seed_payment_amounts(doc)
		doc.save()
	else:
		doc = frappe.get_doc(clean)
		if new_name:
			doc.name = new_name
		_seed_payment_amounts(doc)
		doc.insert()
	return doc.as_dict()


def _apply_allowed_after_submit(doc, payload):
	"""Copy across only what may change after submission, parent fields and child rows.

	Child rows are matched by name, so a row cannot be added, removed or reordered here -
	exactly the behaviour the desk form allows.
	"""
	for field in doc.meta.fields:
		if not field.allow_on_submit or field.fieldtype in ("Table", "Table MultiSelect"):
			continue
		if field.fieldname in payload:
			doc.set(field.fieldname, payload[field.fieldname])

	for field in doc.meta.get_table_fields():
		allowed = [
			child.fieldname
			for child in frappe.get_meta(field.options).fields
			if child.allow_on_submit
		]
		if not allowed:
			continue
		incoming = {row.get("name"): row for row in (payload.get(field.fieldname) or []) if row.get("name")}
		for row in doc.get(field.fieldname) or []:
			source = incoming.get(row.name)
			if not source:
				continue
			for fieldname in allowed:
				if fieldname in source:
					row.set(fieldname, source[fieldname])


@frappe.whitelist()
def submit_document(kind, name):
	config = _config(kind)
	doc = frappe.get_doc(config["doctype"], name)
	doc.check_permission("submit")
	if doc.docstatus != 0:
		frappe.throw(_("Only draft documents can be submitted."), frappe.ValidationError)
	doc.submit()
	return doc.as_dict()


@frappe.whitelist()
def document_activity(kind, name, limit=40):
	"""Read-only history for a document, built from the records Frappe already keeps.

	Comment rows carry the workflow and status notes Frappe writes on every transition,
	and Version rows carry the field level diffs. Nothing extra is stored for this view.
	"""
	config = _config(kind)
	doctype = config["doctype"]
	doc = frappe.get_doc(doctype, name)
	doc.check_permission("read")

	meta = frappe.get_meta(doctype)
	limit = min(max(cint(limit), 1), 100)

	def label_for(fieldname):
		if fieldname == "docstatus":
			return _("Document Status")
		field = meta.get_field(fieldname)
		return field.label if field and field.label else frappe.unscrub(fieldname)

	def shown(fieldname, value):
		"""0 -> 1 means nothing to a reader; Draft -> Submitted does."""
		if fieldname == "docstatus":
			return {0: _("Draft"), 1: _("Submitted"), 2: _("Cancelled")}.get(cint(value), value)
		return value if value not in (None, "") else "\u2014"

	def child_label(table_field):
		field = meta.get_field(table_field)
		return field.label if field and field.label else frappe.unscrub(table_field)

	events = []

	for row in frappe.get_all(
		"Comment",
		filters={"reference_doctype": doctype, "reference_name": name},
		fields=["comment_type", "content", "owner", "comment_email", "comment_by", "creation"],
		order_by="creation desc",
		limit=limit,
	):
		events.append({
			"type": row.comment_type or "Info",
			"by": row.comment_by or row.comment_email or row.owner,
			"text": frappe.utils.strip_html(row.content or "").strip(),
			"changes": [],
			"at": row.creation,
		})

	for row in frappe.get_all(
		"Version",
		filters={"ref_doctype": doctype, "docname": name},
		fields=["data", "owner", "creation"],
		order_by="creation desc",
		limit=limit,
	):
		try:
			payload = json.loads(row.data or "{}")
		except ValueError:
			continue
		changes = []
		for change in payload.get("changed") or []:
			if len(change) != 3:
				continue
			fieldname, before, after = change
			changes.append("{0}: {1} → {2}".format(label_for(fieldname), shown(fieldname, before), shown(fieldname, after)))

		# a row edited, added or removed is a real change too; these were being dropped,
		# so an edit that only touched the items table left no trace at all
		for change in payload.get("row_changed") or []:
			if len(change) != 4:
				continue
			table_field, _idx, _rowname, fields = change
			for row_change in fields or []:
				if len(row_change) != 3:
					continue
				fieldname, before, after = row_change
				changes.append("{0} → {1}: {2} → {3}".format(
					child_label(table_field), frappe.unscrub(fieldname),
					shown(fieldname, before), shown(fieldname, after)))
		for key, word in (("added", _("row added")), ("removed", _("row removed"))):
			for change in payload.get(key) or []:
				if len(change) != 2:
					continue
				changes.append("{0}: {1}".format(child_label(change[0]), word))

		if not changes:
			continue
		events.append({
			"type": _("Document updated"),
			"by": row.owner,
			"text": "",
			"changes": changes[:8],
			"at": row.creation,
		})

	# Frappe writes no record for an insert; the document itself carries who and when, and
	# the desk timeline reads it the same way.
	events.append({
		"type": _("Created"),
		"by": doc.owner,
		"text": "",
		"changes": [],
		"at": doc.creation,
	})

	events.sort(key=lambda event: event["at"] or datetime.min, reverse=True)

	files = frappe.db.count("File", {"attached_to_doctype": doctype, "attached_to_name": name})
	assigned = len(_json(doc.get("_assign"), []) or [])
	return {
		"events": events[:limit],
		"counts": {"events": len(events), "files": cint(files), "assigned": assigned},
	}


@frappe.whitelist()
def delete_document(kind, name):
	config = _config(kind)
	doc = frappe.get_doc(config["doctype"], name)
	doc.check_permission("delete")
	frappe.delete_doc(config["doctype"], name)
	return {"name": name}


@frappe.whitelist()
def cancel_document(kind, name):
	config = _config(kind)
	doc = frappe.get_doc(config["doctype"], name)
	doc.check_permission("cancel")
	if doc.docstatus != 1:
		frappe.throw(_("Only submitted documents can be cancelled."), frappe.ValidationError)
	doc.cancel()
	return doc.as_dict()


@frappe.whitelist()
def attach_files(kind, name, files):
	"""Attach File records that were uploaded before the document existed.

	Only files the current user uploaded, and that are not already attached elsewhere, can
	be linked - otherwise this would be a way to pull someone else's file onto a document.
	"""
	config = _config(kind)
	doc = frappe.get_doc(config["doctype"], name)
	doc.check_permission("write")

	linked = []
	for file_name in _json(files, []):
		if not frappe.db.exists("File", file_name):
			continue
		file_doc = frappe.get_doc("File", file_name)
		if file_doc.attached_to_name or file_doc.owner != frappe.session.user:
			continue
		file_doc.attached_to_doctype = config["doctype"]
		file_doc.attached_to_name = name
		file_doc.save(ignore_permissions=True)
		linked.append(file_doc.name)

	return {"linked": linked}


@frappe.whitelist()
def workflow_transitions(kind, name):
	"""Actions the current user may take on this document, straight from Frappe's workflow."""
	from frappe.model.workflow import get_transitions

	config = _config(kind)
	doc = frappe.get_doc(config["doctype"], name)
	doc.check_permission("read")
	try:
		return get_transitions(doc)
	except Exception:
		frappe.clear_last_message()
		return []


REJECTION_REMARK_FIELD = "custom_rejection_remark"


@frappe.whitelist()
def apply_workflow_action(kind, name, action, remark=None):
	"""Hand the action to Frappe's own workflow engine, which enforces roles and transitions.

	A rejection reason is written onto the document in the same operation, so the remark and
	the state change are saved together rather than in two steps that could half-fail.
	"""
	from frappe.model.workflow import apply_workflow

	config = _config(kind)
	doc = frappe.get_doc(config["doctype"], name)
	doc.check_permission("read")

	remark = (remark or "").strip()
	updated = apply_workflow(doc, action)

	if remark:
		# apply_workflow starts with load_from_db, so anything set before it is discarded.
		# The remark is written afterwards, straight to the column, with no second round of
		# workflow validation.
		if updated.meta.has_field(REJECTION_REMARK_FIELD):
			updated.db_set(REJECTION_REMARK_FIELD, remark, update_modified=False)
		# a comment as well as the field: Version rows only exist where the DocType has
		# Track Changes on, and the reason has to show in the activity trail either way
		updated.add_comment("Comment", _("{0} reason: {1}").format(action, remark))

	return updated.as_dict()


@frappe.whitelist()
def make_create_target(kind, name, label):
	"""Build the document behind a Create menu entry using ERPNext's own mapper."""
	config = _config(kind)
	targets = {target["label"]: target for target in CREATE_TARGETS.get(config["doctype"], [])}
	target = targets.get(label)
	if not target:
		frappe.throw(_("This document conversion is not available."), frappe.ValidationError)

	source = frappe.get_doc(config["doctype"], name)
	source.check_permission("read")

	if target.get("builder") == "payment_entry":
		return {"kind": target["kind"], "document": make_payment_entry(name)}
	if target.get("kind"):
		return {"kind": target["kind"], "document": make_mapped_document(kind, name, target["kind"])}
	return {"doctype": target["doctype"], "document": frappe.get_attr(target["method"])(name).as_dict()}


@frappe.whitelist()
def make_mapped_document(source_kind, source_name, target_kind, args=None):
	"""Build the target document from the source, optionally from chosen rows only.

	`args` carries ERPNext's own `filtered_children` - the child row names to keep. It is
	passed on only where the mapper declares an `args` parameter: ERPNext deliberately left
	it off the Supplier Quotation mapper, because a quotation is asked for the whole
	outstanding quantity, and that choice is respected rather than worked around.
	"""
	source = _config(source_kind)["doctype"]
	target = _config(target_kind)["doctype"]
	method = MAPPERS.get((source, target))
	if not method:
		frappe.throw(_("This document conversion is not available."), frappe.ValidationError)
	doc = frappe.get_doc(source, source_name)
	doc.check_permission("read")

	mapper = frappe.get_attr(method)
	payload = _json(args, {}) or {}
	if payload and "args" in inspect.signature(mapper).parameters:
		return mapper(source_name, args=payload).as_dict()
	return mapper(source_name).as_dict()


@frappe.whitelist()
def make_payment_entry(purchase_invoice):
	doc = frappe.get_doc("Purchase Invoice", purchase_invoice)
	doc.check_permission("read")
	return frappe.get_attr("erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry")(
		"Purchase Invoice", purchase_invoice
	).as_dict()
