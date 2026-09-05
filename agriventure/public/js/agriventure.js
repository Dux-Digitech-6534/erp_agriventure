frappe.pages["agriventure"].on_page_load = function (wrapper) {
	document.body.classList.add("ag-portal-active");
	window.__agPortal = new AgriventurePortal(wrapper);
	window.__agPortal.start();
};

// The whole workspace lives at one URL, so the browser's Back would leave it outright.
// A guard entry is kept on the history stack and spent here instead: a form steps back to
// its list, a report to the report board, anything else to the dashboard, and only the
// dashboard lets Back actually go through. Capture phase and stopImmediatePropagation keep
// Frappe's own router out of it, since the URL never changed.
if (!window.__agBackNav) {
	window.__agBackNav = true;
	window.addEventListener("popstate", (event) => {
		const portal = window.__agPortal;
		if (!portal || !document.body.classList.contains("ag-portal-active")) return;
		if (portal.handleBack()) event.stopImmediatePropagation();
	}, true);
}

frappe.pages["agriventure"].on_page_show = function () {
	document.body.classList.add("ag-portal-active");
};

if (frappe.router && frappe.router.on) {
	frappe.router.on("change", () => {
		const route = frappe.get_route_str ? frappe.get_route_str() : "";
		document.body.classList.toggle("ag-portal-active", route === "agriventure");
	});
}

// documents whose totals ERPNext calculates through calculate_taxes_and_totals
const CALCULATED_KINDS = ["supplier-quotation", "purchase-order", "purchase-receipt", "purchase-invoice"];

// mirrors ERPNext's copy_value_in_all_rows: a value set on the parent flows down into
// the rows of its table that are still empty, and never overwrites what a user typed
// parent field -> the row field it fills in. The names need not match: Material Request
// keeps its store on set_warehouse while each row keeps its own warehouse.
// Link targets ERPNext scopes to the document's company. Each of these DocTypes carries a
// mandatory company of its own, so filtering can never hide a record that would be valid.
// where a draft can pull its items from, and the DocType behind each choice
// ERPNext leaves child selection off the Supplier Quotation mapper on purpose: a
// quotation is asked for the whole outstanding quantity, so there is nothing to pick.
const NO_CHILD_SELECTION = ["supplier-quotation"];

const GET_ITEMS_SOURCES = {
	"supplier-quotation": [
		{ label: "Material Request", kind: "material-request", doctype: "Material Request" },
	],
	"purchase-receipt": [
		{ label: "Purchase Order", kind: "purchase-order", doctype: "Purchase Order" },
		{ label: "Purchase Invoice", kind: "purchase-invoice", doctype: "Purchase Invoice" },
	],
	"purchase-invoice": [
		{ label: "Purchase Order", kind: "purchase-order", doctype: "Purchase Order" },
		{ label: "Purchase Receipt", kind: "purchase-receipt", doctype: "Purchase Receipt" },
	],
};

// tree DocTypes: only leaf nodes may be used on a transaction, a group node is a folder
const LEAF_ONLY_LINKS = ["Warehouse", "Cost Center", "Account"];

const COMPANY_SCOPED_LINKS = [
	"Warehouse",
	"Cost Center",
	"Account",
	"Purchase Taxes and Charges Template",
	"Sales Taxes and Charges Template",
];

// The menus a submitted document carries beyond this workspace's own Create targets, taken
// line for line from erpnext/stock/doctype/purchase_receipt/purchase_receipt.js and
// controllers/stock_controller.js - same items, same conditions. Whatever has no page in
// this workspace opens on the desk, which is what the desk button does anyway.
const DOC_MENUS = {
	"purchase-receipt": [
		{ key: "lcv", group: "Create", label: "Landed Cost Voucher", when: (doc) => doc.docstatus === 1 },
		{ key: "return", group: "Create", label: "Purchase Return", when: (doc) => doc.open },
		{ key: "stock-entry", group: "Create", label: "Make Stock Entry", when: (doc) => doc.open },
		{ key: "retention", group: "Create", label: "Retention Stock Entry", when: (doc) => doc.open },
		{ key: "stock-ledger", group: "View", label: "Stock Ledger", when: (doc) => doc.docstatus > 0 },
		{ key: "accounting-ledger", group: "View", label: "Accounting Ledger", when: (doc) => doc.docstatus > 0 },
		{ key: "asset", group: "View", label: "Asset", when: (doc) => doc.docstatus > 0 },
		{ key: "asset-movement", group: "View", label: "Asset Movement", when: (doc) => doc.docstatus > 0 },
		{ key: "close", group: "Status", label: "Close", when: (doc) => doc.open },
		{ key: "reopen", group: "Status", label: "Reopen", when: (doc) => doc.docstatus === 1 && doc.status === "Closed" },
	],
};

// A row pulled in from an upstream document carries a link back to the exact row it came
// from. That link is what ties the two together, so its item is fixed - only rows added by
// hand stay free. Fieldnames verified against the child doctypes on this site.
const LINKED_ROW_FIELDS = {
	"purchase-order": ["material_request_item"],
	"purchase-receipt": ["material_request_item", "purchase_order_item", "purchase_receipt_item"],
	"purchase-invoice": ["po_detail", "pr_detail", "material_request_item"],
};

// Documents that carry a Connections tab, the way the desk shows one
const CONNECTION_KINDS = ["material-request", "supplier-quotation", "purchase-order",
	"purchase-receipt", "purchase-invoice", "payment-entry"];

const PARENT_ROW_FIELDS = {
	schedule_date: { table: "items", field: "schedule_date" },
	set_warehouse: { table: "items", field: "warehouse" },
};

// Series and Status are the document's own account of itself. Once it is submitted both
// are settled and read as clutter, and the badge beside the title already carries the
// state - so the form drops them, the way the reference screens show them dropped.
const HIDE_AFTER_SUBMIT = {
	"material-request": ["naming_series", "status"],
	"supplier-quotation": ["naming_series", "status"],
	"purchase-order": ["naming_series", "status"],
	"purchase-receipt": ["naming_series", "status"],
	"purchase-invoice": ["naming_series", "status"],
};

// Address & Contact fills itself in the way the desk does: the picker names a record,
// and the read-only text beside it is fetched from that record.
const ADDRESS_DISPLAY_FIELDS = {
	supplier_address: "address_display",
	customer_address: "address_display",
	shipping_address: "shipping_address_display",
	billing_address: "billing_address_display",
	dispatch_address: "dispatch_address_display",
};

// what get_contact_details hands back, each piece going to the field of the same name
const CONTACT_DISPLAY_FIELDS = ["contact_display", "contact_email", "contact_mobile",
	"contact_phone", "contact_designation", "contact_department"];

const SHOW_PRINT_ACTIONS = true;

// documents that carry an approval trail worth showing beside the form
const ACTIVITY_KINDS = ["material-request", "supplier-quotation", "purchase-order",
	"purchase-receipt", "purchase-invoice", "payment-entry"];

// forms that offer file attachments, using Frappe's own File records rather than a
// DocType field, so nothing new appears on the standard desk form
const ATTACHMENT_KINDS = ["supplier-quotation"];

// Master data lives in its own sidebar group. These records have no transaction date,
// no status and no submit step, so the list toolbar and the form drop those controls.
const MASTER_KINDS = ["centre-location-details", "field-details", "labour-details", "supervisor-details", "category-details"];

// Daily attendance work, grouped on its own in the sidebar.
const ATTENDANCE_KINDS = ["attendance-log", "shift-details"];

// Neither masters nor attendance are submittable, so no kind here ever shows Submit.
// Field work logged against a day's shift.
const CROP_KINDS = ["harvest-log", "spraying-log", "sowing-log", "fertigation-log"];

// Point of sale configuration. Standard ERPNext doctypes, no customisation of our own.
const POS_KINDS = ["pos-profile", "pos-opening-entry", "pos-closing-entry", "pos-invoice-merge-log"];

// only the profile is plain configuration; the two shift entries are submittable
const POS_CONFIG_KINDS = ["pos-profile"];

// Stock movements, reached from the sidebar and from a crop log's reference.
const STOCK_KINDS = ["stock-entry"];

// Documents this workspace only ever reads. A Stock Entry is posted by a crop log, so
// the form must not offer Save, Submit or Cancel - cancelling one would unpost stock.
// Written by ERPNext itself, so this workspace shows them and never edits them
const READ_ONLY_KINDS = ["stock-entry", "pos-invoice-merge-log"];
const POS_PAGE_METHOD = "erpnext.selling.page.point_of_sale.point_of_sale";

// Tiles under the KPI cards. Every one opens a list this workspace actually has - a
// dashboard with nothing behind it is worse than no tile.
const KPI_SHORTCUTS = [
	// `report` opens a dashboard in this workspace; `kind` falls back to that doctype's list
	{ report: "attendance", label: "Attendance", icon: "users" },
	{ report: "production", label: "Production", icon: "crop" },
	{ report: "sales", label: "Sales", icon: "money-coins-1" },
];

// each report the tiles can reach, so a tile never points at something unbuilt
const REPORT_VIEWS = {
	attendance: "loadAttendanceReport",
	production: "loadProductionReport",
	sales: "loadSalesReport",
};

// how many rows a report shows at a time
const REPORT_PAGE_SIZES = [10, 25, 50, 100];

// Charts pick up the workspace accent rather than the reference app's green.
// frappe-charts rejects an 8-digit hex and silently falls back to the first colour of its
// own palette, which is pink - so the soft bar fill is the same purple already blended
// against white (#7b68ee at 25%) rather than #7b68ee40. A line at that lightness would be
// barely visible, so it stays solid.
// The dashboard is the count cards only. Flip this back on to return the Recent Activity
// and Pending Approvals tables; the markup and the queries behind them are untouched.
const DASHBOARD_TABLES = false;

const CHART_BAR_COLOR = "#ded9fb";
const CHART_LINE_COLOR = "#7b68ee";
const POS_PROFILE_QUERY = "erpnext.accounts.doctype.pos_profile.pos_profile.pos_profile_query";

// Each crop log reads the day's Shift Details for its own activity, so only the field
// names and that activity differ. crop_ops.py serves all of them.
const CROP_OPS_METHOD = "agriventure.crop_ops";
const CROP_LOG_CONFIG = {
	"harvest-log": { activity: "Harvesting", label: "Harvest", date: "date_hl", centre: "centre__location_hl", field: "name_of_field_hl" },
	"spraying-log": { activity: "Spraying", label: "Spraying", date: "date_spl", centre: "centre__location_spl", field: "name_of_field_spl" },
	"sowing-log": { activity: "Sowing", label: "Sowing", date: "date_sl", centre: "centre__location_sl", field: "name_of_field_sl" },
	"fertigation-log": { activity: "Fertigation", label: "Fertigation", date: "date_fl", centre: "centre__location_fl", field: "name_of_field_fl" },
};

const NON_SUBMITTABLE_KINDS = [...MASTER_KINDS, ...ATTENDANCE_KINDS, ...CROP_KINDS, ...POS_CONFIG_KINDS];

// Read-only Link fields pointing at a document this workspace also shows, so the value
// opens here instead of on the desk. Fields whose target has no page here (a Sales
// Invoice, say) are left as the plain desk link.
const PORTAL_LINK_FIELDS = {
	stock_entry_reference_hl: "stock-entry",
	stock_entry_reference_spl: "stock-entry",
	stock_entry_reference_sl: "stock-entry",
	stock_entry_reference_fl: "stock-entry",
	pos_closing_entry: "pos-closing-entry",
	pos_opening_entry: "pos-opening-entry",
};

// Fields the portal cannot render usefully, so they stay on the desk form only.
// Frappe's Geolocation control builds its Leaflet map on a dialog event that never
// fires here, leaving a blank 400px box behind.
// Fields shown whatever their own depends_on says. POS Profile ties Warehouse to
// update_stock, which Customize Form has hidden on this site, so the Warehouse box never
// appeared even though it is mandatory.
const PORTAL_FORCE_VISIBLE = {
	"pos-profile": ["warehouse"],
};

// Child tables that share a row instead of taking the full width, so a section laid out in
// two columns reads the way the desk form does.
const PORTAL_HALF_TABLES = {
	"pos-profile": ["item_groups", "customer_groups"],
};

const PORTAL_SKIP_FIELDS = {
	"attendance-log": ["geolocation"],
	// the tax breakdown and quantity total stay on the desk form, where accounting needs
	// them; this workspace only shows the money
	// the tax breakdown stays on the desk form; the totals themselves belong here
	"pos-closing-entry": ["amended_from", "taxes"],
	// the shift's end and its closing entry are written by the closing process, not typed
	"pos-opening-entry": ["period_end_date", "amended_from", "pos_closing_entry"],
};

// Columns dropped from a child table in this workspace only. Same idea as
// PORTAL_SKIP_FIELDS, one level down.
const PORTAL_SKIP_CHILD_FIELDS = {
	"pos-closing-entry": { pos_transactions: ["customer"] },
};

// Attendance runs the same face-check flow as the desk form, against the same endpoints.
const ATTENDANCE_KIND = "attendance-log";
const ATTENDANCE_METHOD = "agriventure.agriventure.doctype.attendance_log.attendance_log";
const SHIFT_METHOD = "agriventure.agriventure.doctype.shift_details.shift_details";

// the one or two fields worth filtering a master list by, beyond ID and its title field
// Where the standard ID / Title / Company / Status / Purpose set is not what a list
// needs, its filters are spelled out here instead, as [key, label, fieldname]. A
// fieldname of "status" still resolves to the workflow state where there is one.
// A heading that differs from what the field is called everywhere else. Payment Entry
// keeps "Posting Date"; on a receipt or an invoice the same field reads as the Date.
const LIST_COLUMN_LABELS = {
	"purchase-order": { per_billed: "% Billed" },
	"purchase-receipt": { posting_date: "Date", per_returned: "% Return", custom_purchase_orders: "PO Id" },
	"purchase-invoice": { posting_date: "Date" },
	// these doctypes suffix every fieldname, which unscrub then reads back as "Date Al"
	"attendance-log": {
		date_al: "Date",
		name_of_person_al: "Name of Person",
		centre__location_al: "Centre / Location",
		log_in_al: "Log In",
		log_out_al: "Log Out",
		working_hours_al: "Working Hours",
		login_status_al: "Login Status",
	},
	"shift-details": {
		date_sd: "Date",
		centre__location_sd: "Centre / Location",
	},
	"centre-location-details": { name_of_centrelocation: "Centre & Location" },
	// two states, and they mean different things: the approval trail, and how far the
	// request has been ordered and received
	"material-request": { workflow_state: "Status", status: "PO Status", title: "Title" },
	// the field records the exception, the column reads as the state
	"pos-profile": { disabled: "Status" },
	"pos-opening-entry": { period_start_date: "Period Start Date", period_end_date: "Period End Date" },
	"pos-closing-entry": { period_start_date: "Period Start Date", period_end_date: "Period End Date" },
	"harvest-log": {
		date_hl: "Date",
		centre__location_hl: "Centre / Location",
		name_of_field_hl: "Name of Field",
		total_usable_quantity_hl: "Total Usable Quantity",
	},
	"spraying-log": {
		date_spl: "Date",
		centre__location_spl: "Centre / Location",
		name_of_field_spl: "Name of Field",
		total_quantity_spl: "Total Quantity",
	},
	"sowing-log": {
		date_sl: "Date",
		centre__location_sl: "Centre / Location",
		name_of_field_sl: "Name of Field",
		total_quantity_sl: "Total Quantity",
	},
	"fertigation-log": {
		date_fl: "Date",
		centre__location_fl: "Centre / Location",
		name_of_field_fl: "Name of Field",
		warehouse_fl: "Warehouse",
	},
};

const LIST_FILTERS = {
	"field-details": [["id", "ID", "name"], ["field", "Name of Field", "name_of_field"],
		["centre", "Centre / Location", "centre__location_fd"]],
	// name_of_person carries first + last together, so one box searches both
	"labour-details": [["id", "ID", "name"], ["person", "Name", "name_of_person"],
		["agency", "Agency Payroll", "agency_payroll"]],
	"supervisor-details": [["id", "ID", "name"], ["supervisor", "Supervisor", "name_of_supervisor"],
		["centre", "Centre / Location", "centre__location"]],
	"centre-location-details": [["id", "ID", "name"], ["centre", "Centre & Location", "name_of_centrelocation"]],
	"category-details": [["id", "ID", "name"], ["activity", "Activity", "agricultural_activity"]],
	"material-request": [["id", "ID", "name"], ["company", "Company", "company"], ["status", "Status", "status"]],
	"purchase-order": [["id", "ID", "name"], ["supplier", "Supplier", "supplier"],
		["status", "Status", "status"]],
	"purchase-receipt": [["id", "ID", "name"], ["supplier", "Supplier", "supplier"], ["company", "Company", "company"],
		["status", "Status", "status"]],
	"purchase-invoice": [["id", "ID", "name"], ["supplier", "Supplier", "supplier"], ["company", "Company", "company"],
		["status", "Status", "status"]],
	"payment-entry": [["id", "ID", "name"], ["paymenttype", "Payment Type", "payment_type"],
		["partytype", "Party Type", "party_type"], ["party", "Party", "party"]],
	"attendance-log": [["id", "ID", "name"], ["person", "Person", "name_of_person_al"],
		["centre", "Centre / Location", "centre__location_al"], ["loginstatus", "Login Status", "login_status_al"]],
	// the centre already stands in for the title here, so there is nothing left for one
	"shift-details": [["id", "ID", "name"], ["centre", "Centre / Location", "centre__location_sd"]],
	// the title filter was the entry type, which Purpose already is, and this list only
	// ever shows Material Receipts anyway
	"stock-entry": [["id", "ID", "name"], ["company", "Company", "company"], ["purpose", "Purpose", "purpose"]],
	// the title filter here was already the warehouse, so it only needed saying so
	"pos-profile": [["id", "ID", "name"], ["warehouse", "Warehouse", "warehouse"], ["company", "Company", "company"]],
	"pos-opening-entry": [["id", "ID", "name"], ["company", "Company", "company"], ["status", "Status", "status"],
		["profile", "POS Profile", "pos_profile"]],
	"pos-closing-entry": [["id", "ID", "name"], ["status", "Status", "status"],
		["profile", "POS Profile", "pos_profile"]],
	// the crop is not on the log, it is on the rows inside it, so the filter reaches through
	"harvest-log": [["id", "ID", "name"], ["crop", "Filter by Crop", "harvest_log_child_table.name_of_crop_ht"],
		["centre", "Centre / Location", "centre__location_hl"]],
	"spraying-log": [["id", "ID", "name"], ["field", "Name of Field", "name_of_field_spl"],
		["centre", "Centre / Location", "centre__location_spl"]],
	"sowing-log": [["id", "ID", "name"], ["field", "Name of Field", "name_of_field_sl"],
		["centre", "Centre / Location", "centre__location_sl"]],
	"fertigation-log": [["id", "ID", "name"], ["field", "Name of Field", "name_of_field_fl"],
		["centre", "Centre / Location", "centre__location_fl"]],
};

const MASTER_FILTERS = {
	"field-details": [["centre", "Centre / Location", "centre__location_fd"]],
	"labour-details": [["agency", "Agency Payroll", "agency_payroll"]],
	"supervisor-details": [["centre", "Centre / Location", "centre__location"]],
	"attendance-log": [["centre", "Centre / Location", "centre__location_al"], ["loginstatus", "Login Status", "login_status_al"]],
	"shift-details": [["centre", "Centre / Location", "centre__location_sd"]],
	"harvest-log": [["centre", "Centre / Location", "centre__location_hl"]],
	"spraying-log": [["centre", "Centre / Location", "centre__location_spl"]],
	"sowing-log": [["centre", "Centre / Location", "centre__location_sl"]],
	"fertigation-log": [["centre", "Centre / Location", "centre__location_fl"]],
	"pos-opening-entry": [["profile", "POS Profile", "pos_profile"]],
	"pos-closing-entry": [["profile", "POS Profile", "pos_profile"]],
	"pos-invoice-merge-log": [["closing", "POS Closing Entry", "pos_closing_entry"]],
};

// where a rejection reason lives on these DocTypes
const REJECTION_REMARK_FIELD = "custom_rejection_remark";

// kinds whose workflow actions should not be offered in the header
const NO_WORKFLOW_ACTION_KINDS = [];

class AgriventureApi {
	call(method, args = {}) {
		return frappe.call({ method: `agriventure.api.${method}`, args }).then((response) => response.message);
	}
	bootstrap() { return this.call("bootstrap"); }
	dashboard(fromDate, toDate) { return this.call("dashboard", { from_date: fromDate || "", to_date: toDate || "" }); }
	list(args) { return this.call("list_documents", args); }
	statusOptions(kind) { return this.call("list_status_options", { kind }); }
	connections(kind, name) { return this.call("document_connections", { kind, name }); }
	amend(kind, name) { return this.call("amend_document", { kind, name }); }
	get(kind, name) { return this.call("get_document", { kind, name }); }
	meta(kind) { return this.call("get_meta", { kind }); }
	save(kind, document) { return this.call("save_document", { kind, document: JSON.stringify(document) }); }
	submit(kind, name) { return this.call("submit_document", { kind, name }); }
	recalculate(kind, document) { return this.call("recalculate", { kind, document: JSON.stringify(document) }); }
	transitions(kind, name) { return this.call("workflow_transitions", { kind, name }); }
	applyAction(kind, name, action, remark) { return this.call("apply_workflow_action", { kind, name, action, remark }); }
	cancel(kind, name) { return this.call("cancel_document", { kind, name }); }
	remove(kind, name) { return this.call("delete_document", { kind, name }); }
	activity(kind, name) { return this.call("document_activity", { kind, name }); }
	kpi(date) { return this.call("kpi_dashboard", { date }); }
	attendanceReport(args) { return this.call("attendance_report", args); }
	productionReport(args) { return this.call("production_report", args); }
	salesReport(args) { return this.call("sales_report", args); }
	attachFiles(kind, name, files) { return this.call("attach_files", { kind, name, files: JSON.stringify(files) }); }
	createTarget(kind, name, label) { return this.call("make_create_target", { kind, name, label }); }
	mapped(sourceKind, sourceName, targetKind, args) { return this.call("make_mapped_document", { source_kind: sourceKind, source_name: sourceName, target_kind: targetKind, args: args ? JSON.stringify(args) : null }); }
}

class AgriventurePortal {
	constructor(wrapper) {
		this.wrapper = $(wrapper);
		this.api = new AgriventureApi();
		this.state = { view: "dashboard", kind: "material-request", start: 0, pageLength: 20 };
		this.config = {
			"material-request": { title: "Material Request", badge: "MR", icon: "clipboard", summary: "Material Requests" },
			"supplier-quotation": { title: "Supplier Quotation", badge: "SQ", icon: "buying", summary: "Supplier Quotations" },
			"purchase-order": { title: "Purchase Order", badge: "PO", icon: "file", summary: "Purchase Orders" },
			"purchase-receipt": { title: "Purchase Receipt", badge: "PR", icon: "stock", summary: "Purchase Receipts" },
			"purchase-invoice": { title: "Purchase Invoice", badge: "PI", icon: "accounting", summary: "Purchase Invoices" },
			"payment-entry": { title: "Payment Entry", badge: "PE", icon: "money-coins-1", summary: "Payment Entries" },
			"field-details": { title: "Field Details", badge: "FD", icon: "crop", summary: "Field Details" },
			"labour-details": { title: "Labour Details", badge: "LD", icon: "users", summary: "Labour Details" },
			"supervisor-details": { title: "Supervisor Details", badge: "SD", icon: "assign", summary: "Supervisor Details" },
			"centre-location-details": { title: "Centre and Location Details", badge: "CL", icon: "map", summary: "Centre and Location Details" },
			"category-details": { title: "Category Details", badge: "CD", icon: "tag", summary: "Category Details" },
			"attendance-log": { title: "Attendance Log", badge: "AL", icon: "calendar", summary: "Attendance Logs" },
			"shift-details": { title: "Shift Details", badge: "SD", icon: "list-alt", summary: "Shift Details" },
			"harvest-log": { title: "Harvest Log", badge: "HL", icon: "crop", summary: "Harvest Logs" },
			"spraying-log": { title: "Spraying Log", badge: "SP", icon: "tool", summary: "Spraying Logs" },
			"sowing-log": { title: "Sowing Log", badge: "SW", icon: "milestone", summary: "Sowing Logs" },
			"fertigation-log": { title: "Fertigation Log", badge: "FL", icon: "filter", summary: "Fertigation Logs" },
			"stock-entry": { title: "Material Receipt", badge: "MR", icon: "stock", summary: "Material Receipts" },
			"pos-profile": { title: "POS Profile", badge: "PP", icon: "setting-gear", summary: "POS Profiles" },
			"pos-opening-entry": { title: "POS Opening Entry", badge: "PO", icon: "unlock", summary: "POS Opening Entries" },
			"pos-closing-entry": { title: "POS Closing Entry", badge: "PC", icon: "lock", summary: "POS Closing Entries" },
			"pos-invoice-merge-log": { title: "POS Invoice Merge Log", badge: "ML", icon: "small-file", summary: "POS Invoice Merge Logs" },
		};
		// state.view is written straight in a few places as well as through setActive, so the
		// guard is hung off the property itself rather than off any one call site
		let currentView = this.state.view;
		Object.defineProperty(this.state, "view", {
			get: () => currentView,
			set: (value) => {
				currentView = value;
				this.syncBackGuard();
			},
			enumerable: true,
			configurable: true,
		});
		this.formControls = [];
		this.formTableSlots = [];
		this.formSectionSlots = [];
		this.tableStates = new Map();
		this.listRequestId = 0;
		this.calculationToken = 0;
		this.applyingCalculation = false;
		this.listCount = 0;
		this.listLoading = false;
	}

	icon(name, size = "sm") {
		return frappe.utils.icon ? frappe.utils.icon(name, size) : "";
	}

	escape(value) {
		return frappe.utils.escape_html(String(value ?? ""));
	}

	ensureStyles() {
		const href = "/assets/agriventure/css/agriventure.css?v=20260904-gpssoft-215";
		let link = document.getElementById("agriventure-live-styles");
		if (!link) {
			link = document.createElement("link");
			link.id = "agriventure-live-styles";
			link.rel = "stylesheet";
			document.head.appendChild(link);
		}
		if (!link.href.endsWith(href)) link.href = href;
	}

	bindDatepickerScrollClose() {
		if (window.__agDatepickerScrollClose) return;
		window.__agDatepickerScrollClose = true;
		// body.ag-portal-active never scrolls itself (only the inner .ag-main panel does), so a
		// datepicker popup - appended to <body> and positioned relative to it - drifts away from
		// its field on scroll instead of tracking it. Closing it through the library's own hide()
		// (not a raw jQuery .hide()) keeps its internal "visible" state in sync so it still opens
		// normally on the next click.
		window.addEventListener("scroll", () => {
			document.querySelectorAll('.frappe-control[data-fieldtype="Date"] input, .frappe-control[data-fieldtype="Datetime"] input').forEach((input) => {
				const instance = $(input).data("datepicker");
				if (instance && instance.visible) instance.hide();
			});
		}, true);
	}

	async start() {
		this.ensureStyles();
		this.bindDatepickerScrollClose();
		this.wrapper.empty().append('<div class="agriventure-loading">Loading Agriventure…</div>');
		try {
			this.boot = await this.api.bootstrap();
			// A kind this build knows about but the server does not advertise - its api.py
			// not reloaded yet, or the doctype missing on this site - is dropped here. Left
			// in, it would take out the sidebar and the dashboard summary along with it.
			for (const kind of Object.keys(this.config)) {
				if (!this.boot.doctypes?.[kind]) delete this.config[kind];
			}
			this.boot.fiscal_year = this.boot.fiscal_year || frappe.sys_defaults?.fiscal_year || frappe.boot?.sysdefaults?.fiscal_year || this.currentFiscalYear();
			this.renderShell();
			await this.loadDashboard();
		} catch (error) {
			this.renderFatal(error);
		}
	}

	renderShell() {
		const navFor = (keys) => keys.map((key) => `
			<button class="ag-nav" type="button" data-kind="${key}">
				<span class="ag-doc-icon">${this.icon(this.config[key].icon, "sm")}</span><span>${this.config[key].title}</span>
			</button>`).join("");
		const keys = Object.keys(this.config);
		const grouped = [...MASTER_KINDS, ...ATTENDANCE_KINDS, ...CROP_KINDS, ...POS_KINDS, ...STOCK_KINDS];
		const nav = navFor(keys.filter((key) => !grouped.includes(key)));
		// a group is listed in the order its own array gives, and skips anything the server
		// did not advertise - so moving an entry is a matter of moving it in that array
		const groupNav = (kinds) => navFor(kinds.filter((key) => this.config[key]));
		const masterNav = groupNav(MASTER_KINDS);
		const attendanceNav = groupNav(ATTENDANCE_KINDS);
		const cropNav = groupNav(CROP_KINDS);
		const tillButton = `<button class="ag-nav" type="button" data-action="open-pos"><span class="ag-doc-icon">${this.icon("retail", "sm")}</span><span>Point of Sale</span></button>`;
		const posKeys = POS_KINDS.filter((key) => this.config[key]);
		const afterKey = posKeys.includes("pos-profile") ? "pos-profile" : posKeys[posKeys.length - 1];
		const posNav = posKeys.length
			? posKeys.map((key) => navFor([key]) + (key === afterKey ? tillButton : "")).join("")
			: tillButton;
		const stockNav = groupNav(STOCK_KINDS);
		this.wrapper.html(`<div class="agriventure-app">
			<div class="ag-mobile-backdrop" data-action="close-menu"></div>
			<aside class="ag-sidebar">
				<a class="ag-brand" href="/app"><strong>Agriventure</strong><small>WORK</small></a>
				<div class="ag-menu-search"><span>${this.icon("search", "xs")}</span><input aria-label="Search menu" placeholder="Search menu…"></div>
				<nav>
					<button class="ag-nav ag-dashboard-nav active" type="button" data-view="dashboard"><span class="ag-doc-icon">${this.icon("dashboard", "sm")}</span><span>Dashboard</span></button>
					<button class="ag-nav-heading" type="button" data-action="toggle-transactions" aria-expanded="true"><span>TRANSACTIONS</span>${this.icon("down", "xs")}</button>
					<div class="ag-transaction-list">${nav}</div>
					<button class="ag-nav-heading" type="button" data-action="toggle-masters" aria-expanded="true"><span>MASTER SETTING</span>${this.icon("down", "xs")}</button>
					<div class="ag-master-list">${masterNav}</div>
					<button class="ag-nav-heading" type="button" data-action="toggle-attendance" aria-expanded="true"><span>ATTENDANCE</span>${this.icon("down", "xs")}</button>
					<div class="ag-attendance-list">${attendanceNav}</div>
					<button class="ag-nav-heading" type="button" data-action="toggle-crop" aria-expanded="true"><span>CROP OPERATIONS</span>${this.icon("down", "xs")}</button>
					<div class="ag-crop-list">${cropNav}</div>
					<button class="ag-nav-heading" type="button" data-action="toggle-stock" aria-expanded="true"><span>STOCK</span>${this.icon("down", "xs")}</button>
					<div class="ag-stock-list">${stockNav}</div>
					<button class="ag-nav-heading" type="button" data-action="toggle-pos" aria-expanded="true"><span>POINT OF SALE</span>${this.icon("down", "xs")}</button>
					<div class="ag-pos-list">${posNav}</div>
					<div class="ag-reports-list">
						<button class="ag-nav-heading ag-nav-heading-link" type="button" data-action="open-kpi"><span>REPORT</span></button>
					</div>
				</nav>
				<div class="ag-user">
					${this.avatar(this.boot.user.full_name)}
					<div class="ag-user-copy"><b>${this.escape(this.boot.user.full_name)}</b><small>${this.escape(this.boot.user.name)}</small></div>
					<div class="ag-user-fy"><span>FY</span><b>${this.escape(String(this.boot.fiscal_year || this.currentFiscalYear()).replace(/^FY\s*/i, ""))}</b></div>
					<button class="ag-logout" type="button" data-action="logout" title="Logout" aria-label="Logout">${this.icon("arrow-right", "sm")}</button>
				</div>
			</aside>
			<main class="ag-main">
				<header class="ag-topbar">
					<button class="ag-mobile-menu" type="button" data-action="open-menu" aria-label="Open menu">${this.icon("menu", "md")}</button>
					<div class="ag-crumb"><span>Agriventure</span><i>›</i><b class="ag-crumb-title">Dashboard</b></div>
					<div class="ag-top-actions">
						<button class="ag-icon" type="button" data-action="refresh" title="Refresh">${this.icon("refresh", "sm")}</button>
						<button class="ag-icon" type="button" data-action="theme" title="Toggle dark theme" aria-label="Toggle dark theme">${this.icon("view", "sm")}</button>
						${this.avatar(this.boot.user.full_name)}
					</div>
				</header>
				<section class="ag-content"></section>
			</main>
		</div>`);
		this.bindShellEvents();
	}

	bindShellEvents() {
		this.wrapper.off(".agriventure");
		this.wrapper.on("click.agriventure", "[data-view=dashboard]", () => this.loadDashboard());
		this.wrapper.on("click.agriventure", ".ag-nav[data-kind]", (event) => {
			this.state.kind = $(event.currentTarget).data("kind");
			this.state.start = 0;
			this.loadList();
		});
		this.wrapper.on("click.agriventure", "[data-action=refresh]", () => {
			if (this.state.view === "dashboard") this.loadDashboard();
			else if (this.state.view === "list") this.clearListFilters();
			else if (this.state.view === "form") this.openForm(this.currentDocumentName);
		});
		this.wrapper.on("click.agriventure", "[data-action=theme]", () => this.wrapper.find(".agriventure-app").toggleClass("ag-dark"));
		this.wrapper.on("click.agriventure", "[data-action=open-pos]", () => this.openPointOfSale());
		this.wrapper.on("click.agriventure", "[data-action=open-kpi]", () => this.loadKpiDashboard());
		// the reports are reached from the board, so each one offers the way back
		this.wrapper.on("click.agriventure", ".ag-rep-back", () => this.loadKpiDashboard());
		this.wrapper.on("click.agriventure", "[data-action=toggle-pos]", (event) => {
			const app = this.wrapper.find(".agriventure-app");
			app.toggleClass("ag-pos-collapsed");
			$(event.currentTarget).attr("aria-expanded", String(!app.hasClass("ag-pos-collapsed")));
		});
		this.wrapper.on("click.agriventure", "[data-action=toggle-stock]", (event) => {
			const app = this.wrapper.find(".agriventure-app");
			app.toggleClass("ag-stock-collapsed");
			$(event.currentTarget).attr("aria-expanded", String(!app.hasClass("ag-stock-collapsed")));
		});
		this.wrapper.on("click.agriventure", "[data-action=toggle-crop]", (event) => {
			const app = this.wrapper.find(".agriventure-app");
			app.toggleClass("ag-crop-collapsed");
			$(event.currentTarget).attr("aria-expanded", String(!app.hasClass("ag-crop-collapsed")));
		});
		this.wrapper.on("click.agriventure", "[data-action=toggle-attendance]", (event) => {
			const app = this.wrapper.find(".agriventure-app");
			app.toggleClass("ag-attendance-collapsed");
			$(event.currentTarget).attr("aria-expanded", String(!app.hasClass("ag-attendance-collapsed")));
		});
		this.wrapper.on("click.agriventure", "[data-action=toggle-masters]", (event) => {
			const app = this.wrapper.find(".agriventure-app");
			app.toggleClass("ag-masters-collapsed");
			$(event.currentTarget).attr("aria-expanded", String(!app.hasClass("ag-masters-collapsed")));
		});
		this.wrapper.on("click.agriventure", "[data-action=toggle-transactions]", (event) => {
			const app = this.wrapper.find(".agriventure-app");
			app.toggleClass("ag-transactions-collapsed");
			$(event.currentTarget).attr("aria-expanded", String(!app.hasClass("ag-transactions-collapsed")));
		});
		this.wrapper.on("click.agriventure", "[data-action=open-menu]", () => this.wrapper.find(".agriventure-app").addClass("ag-menu-open"));
		this.wrapper.on("click.agriventure", "[data-action=close-menu]", () => this.wrapper.find(".agriventure-app").removeClass("ag-menu-open"));
		this.wrapper.on("click.agriventure", "[data-action=logout]", () => this.confirmLogout());
		this.wrapper.on("input.agriventure", ".ag-menu-search input", (event) => {
			const query = event.target.value.trim().toLowerCase();
			this.wrapper.find(".ag-transaction-list .ag-nav,.ag-master-list .ag-nav,.ag-attendance-list .ag-nav,.ag-crop-list .ag-nav,.ag-pos-list .ag-nav,.ag-stock-list .ag-nav,.ag-reports-list .ag-nav-heading-link").each((_, item) => $(item).toggle($(item).text().toLowerCase().includes(query)));
		});
	}

	avatar(name) {
		const initials = (name || "U").split(" ").filter(Boolean).map((part) => part[0]).slice(0, 2).join("");
		return `<div class="ag-avatar" aria-hidden="true">${this.escape(initials)}</div>`;
	}

	syncBackGuard() {
		// exactly one guard entry exists while the user is anywhere but the dashboard
		const needed = this.state.view !== "dashboard";
		if (needed === Boolean(this.backGuard)) return;
		if (needed) {
			this.backGuard = true;
			history.pushState({ agriventure: true }, "");
			return;
		}
		// back on the dashboard by some other route - the sidebar, say - so the guard is
		// spent now rather than costing the user a wasted press later
		this.backGuard = false;
		this.skipBack = true;
		history.back();
	}

	handleBack() {
		// true means this was ours to handle and the browser should be told no more
		if (this.skipBack) {
			this.skipBack = false;
			return true;
		}
		this.backGuard = false;
		const view = this.state.view;
		if (view === "dashboard") return false;
		if (view === "form") {
			this.loadList();
			return true;
		}
		if (["attendance-report", "production-report", "sales-report"].includes(view)) {
			this.loadKpiDashboard();
			return true;
		}
		this.loadDashboard();
		return true;
	}

	setActive(view, kind = null) {
		this.state.view = view;
		this.wrapper.find(".ag-nav").removeClass("active");
		if (view === "dashboard") this.wrapper.find("[data-view=dashboard]").addClass("active");
		if (kind) this.wrapper.find(`.ag-nav[data-kind="${kind}"]`).addClass("active");
		this.wrapper.find(".agriventure-app").removeClass("ag-menu-open");
	}

	setCrumb(title) {
		this.wrapper.find(".ag-crumb-title").text(title);
	}

	greeting() {
		const hour = new Date().getHours();
		if (hour < 12) return ["Good", "morning"];
		if (hour < 17) return ["Good", "afternoon"];
		return ["Good", "evening"];
	}

	currentFiscalYear() {
		const today = new Date();
		const start = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
		return `FY ${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
	}

	async loadFiscalYears() {
		// read once: the years rarely change within a session, and every dashboard reload
		// would otherwise fetch the same two rows
		if (this.fiscalYears) return this.fiscalYears;
		let rows = [];
		try {
			rows = await frappe.db.get_list("Fiscal Year", {
				fields: ["name", "year_start_date", "year_end_date"],
				filters: { disabled: 0 },
				order_by: "year_start_date desc",
				limit: 20,
			});
		} catch (error) {
			rows = [];
		}
		this.fiscalYears = (rows || []).map((row) => ({ name: row.name, from: row.year_start_date, to: row.year_end_date }));
		if (!this.state.fiscalYear && this.fiscalYears.length) {
			// the year today falls in, rather than simply the newest one
			const today = frappe.datetime.get_today();
			const current = this.fiscalYears.find((year) => year.from <= today && today <= year.to);
			this.state.fiscalYear = (current || this.fiscalYears[0]).name;
		}
		return this.fiscalYears;
	}

	buildFiscalPicker(holder) {
		if (!holder || !holder.length) return;
		const control = frappe.ui.form.make_control({
			parent: holder,
			df: {
				fieldname: "ag_fiscal_year",
				fieldtype: "Autocomplete",
				label: __("Financial Year"),
				placeholder: "",
				options: (this.fiscalYears || []).map((year) => this.fiscalLabel(year.name)),
				// free text is allowed: "26", "26-27" and "2026-2027" all resolve below
				only_select: false,
			},
			render_input: true,
		});
		control.set_value(this.fiscalLabel(this.state.fiscalYear));
		control.refresh();
		control.$input?.attr({ placeholder: "", autocomplete: "off" });
		control.$input?.on("change.agfy awesomplete-selectcomplete.agfy", () => {
			const typed = control.get_value();
			const year = this.findFiscalYear(typed);
			if (!year) {
				// nothing is silently ignored: the box goes back to the year on screen
				frappe.show_alert({ message: __("No Fiscal Year matches {0}", [typed]), indicator: "orange" });
				control.set_value(this.fiscalLabel(this.state.fiscalYear));
				return;
			}
			control.set_value(this.fiscalLabel(year.name));
			if (year.name === this.state.fiscalYear) return;
			this.state.fiscalYear = year.name;
			this.loadDashboard();
		});
		// clicking the box opens the list, the way the list filters behave. No blank row:
		// the dashboard is always showing some year, so there is nothing to unset.
		this.bindComboSearch(control, __("Financial Year"), { blank: false });
	}

	fiscalKey(text) {
		// "2026-2027", "26-27" and "FY 26-27" all reduce to "26-27", so what is typed and
		// what the Fiscal Year is actually called can be compared
		const parts = String(text || "").match(/\d+/g) || [];
		if (!parts.length) return "";
		const short = (value) => String(value).slice(-2).padStart(2, "0");
		return parts.length > 1 ? `${short(parts[0])}-${short(parts[1])}` : short(parts[0]);
	}

	fiscalLabel(name) {
		// shown as 25-2026: the year it opened in short, the year it closes in full
		const parts = String(name || "").match(/\d+/g) || [];
		if (parts.length < 2) return String(name || "");
		return `${String(parts[0]).slice(-2)}-${parts[1]}`;
	}

	findFiscalYear(text) {
		const key = this.fiscalKey(text);
		if (!key) return null;
		const years = this.fiscalYears || [];
		// a half-typed year - just "26" - still lands on 26-27
		return years.find((year) => this.fiscalKey(year.name) === key)
			|| years.find((year) => this.fiscalKey(year.name).startsWith(key))
			|| null;
	}

	fiscalRange() {
		const year = (this.fiscalYears || []).find((entry) => entry.name === this.state.fiscalYear);
		return year ? [year.from, year.to] : [null, null];
	}

	async loadDashboard() {
		this.setActive("dashboard");
		this.setCrumb("Dashboard");
		const content = this.wrapper.find(".ag-content").html('<div class="ag-loading-panel">Loading dashboard…</div>');
		try {
			// Use existing list endpoints until workers are restarted by the site administrator.
			// This avoids Frappe's automatic missing-method dialog without requiring a restart.
			await this.loadFiscalYears();
			const data = await this.dashboardFallback();
			const [prefix, accent] = this.greeting();
			// a picker where there are years to choose between, the plain badge otherwise
			// an empty slot: the picker is built below with make_control, so it is the same
			// Autocomplete the list filters use rather than a browser-styled box
			const yearPicker = (this.fiscalYears || []).length
				? '<div class="ag-fy-slot ag-list-filter"></div>'
				: `<b>${this.escape(this.boot.fiscal_year || "—")}</b>`;
			const summaryCards = (data.cards || []).map((card) => `<article class="ag-summary-card ag-summary-${card.kind}">
				<span class="ag-summary-icon">${this.icon(card.icon, "md")}</span>
				<strong>${this.escape(card.count)}</strong>
				<small>${this.escape(card.label)}</small>
			</article>`).join("");
			const recentRows = data.recent.map((row) => `<tr>
				<td>${this.escape(row.document)}</td>
				<td><button class="ag-doc-link" data-kind="${row.kind}" data-name="${this.escape(row.reference)}">${this.escape(row.reference)}</button></td>
				<td>${this.formatDate(row.date)}</td>
				<td>${this.statusBadge(row.status)}</td>
			</tr>`).join("") || '<tr><td colspan="4" class="ag-empty">No recent activity</td></tr>';
			const approvalRows = data.pending.map((row) => `<tr>
				<td>${this.escape(row.document)}</td>
				<td><button class="ag-doc-link" data-kind="${this.escape(row.kind)}" data-name="${this.escape(row.reference)}">${this.escape(row.reference)}</button></td>
				<td>${this.formatDate(row.date)}</td>
				<td>${this.statusBadge(row.state || "Pending")}</td>
			</tr>`).join("");
			// same table shell as Recent Activity, so both cards read the same way
			const pending = approvalRows
				? `<div class="ag-dashboard-table ag-approval-table"><table><thead><tr><th>Document</th><th>Reference</th><th>Date</th><th>Status</th></tr></thead><tbody>${approvalRows}</tbody></table></div>`
				: "";
			content.html(`<div class="ag-dashboard">
				<div class="ag-dashboard-head">
					<div><span class="ag-eyebrow">AGRIVENTURE · PROCUREMENT</span><h1>${prefix} <em>${accent}</em>, ${this.escape(this.boot.user.full_name)}</h1></div>
					<div class="ag-financial-year"><span>FINANCIAL YEAR</span>${yearPicker}</div>
				</div>
				<div class="ag-summary-grid">${summaryCards}</div>
				${DASHBOARD_TABLES ? `<div class="ag-dashboard-grid">
					<section class="ag-dashboard-card ag-recent-card"><header><b>Recent Activity</b><small>latest documents</small></header><div class="ag-dashboard-table"><table><thead><tr><th>Document</th><th>Reference</th><th>Date</th><th>Status</th></tr></thead><tbody>${recentRows}</tbody></table></div></section>
					<section class="ag-dashboard-card ag-approval-card"><header><b>Pending Approvals</b><small>${data.pending.length} awaiting action</small></header><div class="ag-approval-body">${pending || `<div class="ag-empty-approval">${this.icon("check", "lg")}<b>No pending approvals</b><span>You are all caught up.</span></div>`}</div></section>
				</div>` : ""}
			</div>`);
			this.buildFiscalPicker(content.find(".ag-fy-slot"));
			content.find(".ag-doc-link").on("click", (event) => {
				this.state.kind = $(event.currentTarget).data("kind");
				this.openForm($(event.currentTarget).data("name"));
			});
		} catch (error) {
			content.html(this.errorMarkup(error));
		}
	}

	async dashboardFallback() {
		// the dashboard summarises transactions; master data has nothing to be pending on
		const kinds = Object.keys(this.config).filter((kind) => !NON_SUBMITTABLE_KINDS.includes(kind));
		const [from, to] = this.fiscalRange();
		const lists = await Promise.all(kinds.map((kind) => {
			const dateField = this.boot.doctypes[kind].date_field;
			// `creation` is not a business date, so a fiscal year says nothing about it
			const args = { kind, start: 0, page_length: 4 };
			if (from && to && dateField !== "creation") args.filters = JSON.stringify([[dateField, "between", [from, to]]]);
			return this.api.list(args).catch(() => ({ count: 0, rows: [] }));
		}));
		const recent = [];
		let activeCount = 0;
		const cards = [];
		lists.forEach((result, index) => {
			const kind = kinds[index];
			const config = this.config[kind];
			const dateField = this.boot.doctypes[kind].date_field;
			activeCount += Number(result.count || 0);
			cards.push({ kind, icon: config.icon, label: config.summary, count: Number(result.count || 0) });
			for (const row of result.rows || []) {
				recent.push({ kind, document: this.config[kind].title, reference: row.name, date: row[dateField], status: row.status || "Draft" });
			}
		});
		recent.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
		// the workspace endpoint works out what is actually awaiting this user's workflow
		// action, which the old ToDo lookup could never see
		// the workspace endpoint works out what is awaiting this user's workflow action; with
		// the table hidden there is nothing to show it in, so the round trip is skipped
		const pending = DASHBOARD_TABLES
			? await this.api.dashboard(from, to).then((data) => data?.pending || []).catch(() => [])
			: [];
		return { active_count: activeCount, cards, recent: recent.slice(0, 8), pending };
	}

	dateDefaults() {
		// the last month up to today, not the calendar month: on the 2nd the calendar month
		// showed barely two days of work
		const today = new Date();
		const from = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
		const local = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		return { from: local(from), to: local(today) };
	}

	listFilterDefinitions(meta) {
		const fieldMap = new Map((meta.fields || []).filter((field) => field.fieldname).map((field) => [field.fieldname, field]));
		const pick = (names) => names.find((name) => name === "name" || fieldMap.has(name));
		const titleFields = {
			"material-request": ["title", "name"],
			"purchase-order": ["supplier_name", "supplier", "name"],
			"purchase-receipt": ["supplier_name", "supplier", "name"],
			"purchase-invoice": ["supplier_name", "supplier", "bill_no", "name"],
			"payment-entry": ["party_name", "party", "reference_no", "name"],
			"field-details": ["name_of_field", "name"],
			"labour-details": ["first_name", "name"],
			"supervisor-details": ["name_of_supervisor", "name"],
			"centre-location-details": ["name_of_centrelocation", "name"],
			"category-details": ["agricultural_activity", "name"],
			"attendance-log": ["name_of_person_al", "name"],
			"shift-details": ["centre__location_sd", "name"],
			"harvest-log": ["name_of_field_hl", "name"],
			"spraying-log": ["name_of_field_spl", "name"],
			"sowing-log": ["name_of_field_sl", "name"],
			"fertigation-log": ["name_of_field_fl", "name"],
			"pos-profile": ["warehouse", "name"],
			"stock-entry": ["stock_entry_type", "name"],
			"pos-opening-entry": ["user", "name"],
			"pos-closing-entry": ["user", "name"],
			"pos-invoice-merge-log": ["customer", "name"],
		};
		const purposeFields = {
			"material-request": ["material_request_type", "purpose", "remarks"],
			"purchase-order": ["purchase_type", "purpose", "remarks"],
			"purchase-receipt": ["purchase_type", "purpose", "remarks"],
			"purchase-invoice": ["purchase_type", "purpose", "remarks"],
			"payment-entry": ["payment_type", "mode_of_payment", "purpose", "remarks"],
		};
		const definitions = [];
		const add = (key, label, fieldname) => {
			if (!fieldname) return;
			const statuses = this.listStatusOptions;
			if (key === "status" && statuses && statuses.fieldname) {
				definitions.push({
					key, label,
					fieldname: statuses.fieldname,
					fieldtype: "Autocomplete",
					options: statuses.options || [],
					source: fieldMap.get(statuses.fieldname) || { fieldname: statuses.fieldname, fieldtype: "Select", options: "" },
				});
				return;
			}
			let source;
			if (fieldname.includes(".")) {
				// The field sits on a child row. frappe.get_meta hands back the DocType doc,
				// so the field is looked up in its own `fields` list - the doc carries no
				// get_field() of its own. A plain text box stands in if the child meta has
				// not been loaded, so the filter is never simply missing.
				const [tableField, childField] = fieldname.split(".");
				const table = fieldMap.get(tableField);
				const childMeta = table && table.options ? frappe.get_meta(table.options) : null;
				source = (childMeta?.fields || []).find((field) => field.fieldname === childField)
					|| { fieldname: childField, fieldtype: "Data", options: "" };
			} else {
				source = fieldname === "name" ? { fieldname: "name", fieldtype: "Data", options: "" } : fieldMap.get(fieldname);
			}
			if (!source) return;
			let fieldtype = "Data";
			let options = source.options || "";
			if (source.fieldtype === "Link") fieldtype = "Link";
			else if (source.fieldtype === "Select") {
				fieldtype = "Autocomplete";
				options = String(source.options || "").split("\n").map((value) => value.trim()).filter(Boolean);
			}
			definitions.push({ key, label, fieldname, fieldtype, options, source });
		};
		const override = LIST_FILTERS[this.state.kind];
		if (override) {
			// status is still looked up the same way, so a list under a workflow filters on
			// the state its Status column is actually showing
			for (const [key, label, fieldname] of override) {
				if (fieldname === "status") add(key, label, pick(["status", "workflow_state"]));
				else if (fieldname.includes(".")) add(key, label, fieldname);
				else add(key, label, pick([fieldname]));
			}
			return definitions;
		}
		add("id", "ID", "name");
		add("title", "Title", pick(titleFields[this.state.kind] || ["title", "name"]));
		add("company", "Company", pick(["company"]));
		add("status", "Status", pick(["status", "workflow_state"]));
		add("purpose", "Purpose", pick(purposeFields[this.state.kind] || ["purpose", "remarks"]));
		for (const [key, label, fieldname] of MASTER_FILTERS[this.state.kind] || []) add(key, label, pick([fieldname]));
		return definitions;
	}

	bindComboSearch(control, label, { blank = true } = {}) {
		const COMBO_TYPES = ["Link", "Dynamic Link", "Autocomplete"];
		if (!control || !COMBO_TYPES.includes(control.df?.fieldtype) || control.df?.read_only) return control;
		const input = control.$input;
		if (!input || !input.length || input.data("agCombo")) return control;
		input.data("agCombo", true);

		const node = input[0];
		const idlePlaceholder = input.attr("placeholder") || "";
		const title = String(label || control.df.label || "value").trim().toLowerCase();
		const searchPlaceholder = `Search ${title}...`;
		const state = { stored: "", searching: false };

		const optionValue = (el) => {
			const raw = el.attr("data-value") || el.find(".link-option, strong, b").first().text() || el.text() || "";
			return String(raw).trim().split("\n")[0].trim();
		};

		const markSelected = () => {
			const list = control.$wrapper?.find(".awesomplete > ul > li");
			if (!list || !list.length) return;
			list.each((_, item) => {
				const el = $(item);
				el.toggleClass("ag-combo-selected", Boolean(state.stored) && optionValue(el) === state.stored);
			});
		};

		const openSearch = () => {
			if (state.searching) return;
			state.stored = String(input.val() || control.get_value() || "").trim();
			state.searching = true;
			input.attr("placeholder", searchPlaceholder).val("");
			input.trigger("input");
			window.setTimeout(markSelected, 150);
		};

		const endSearch = (restore) => {
			if (!state.searching) return;
			state.searching = false;
			input.attr("placeholder", idlePlaceholder);
			if (restore && !String(input.val() || "").trim()) input.val(state.stored);
		};

		// runs in the capture phase, i.e. before the control's own blur handler,
		// so the display value is back in place and the stored value is never wiped
		const cancelSearch = (event) => {
			if (!document.body.contains(node)) {
				document.removeEventListener("mousedown", cancelSearch, true);
				document.removeEventListener("touchstart", cancelSearch, true);
				return;
			}
			if (!state.searching || node === event.target || node.contains(event.target)) return;
			endSearch(true);
		};

		// inside a child table the list would be clipped by the horizontal scroller,
		// so it is positioned against the viewport instead while it is open
		const clipped = input.closest(".ag-child-scroll").length > 0;
		const dropdown = () => control.$wrapper?.find(".awesomplete > ul");
		const placeDropdown = () => {
			if (!clipped) return;
			const list = dropdown();
			if (!list || !list.length || list.is("[hidden]")) return;
			const rect = node.getBoundingClientRect();
			const room = window.innerHeight - rect.bottom - 12;
			const height = Math.max(120, Math.min(240, room));
			const above = room < 140 && rect.top > room;
			list.css({
				position: "fixed",
				left: `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`,
				top: above ? "" : `${rect.bottom + 2}px`,
				bottom: above ? `${window.innerHeight - rect.top + 2}px` : "",
				width: `${Math.max(rect.width, 200)}px`,
				"max-height": `${above ? Math.min(240, rect.top - 12) : height}px`,
				"overflow-y": "auto",
				"z-index": 1200,
			});
		};
		// a blank first row, so a chosen value can be unset without the clear icon
		const addBlankOption = () => {
			const list = dropdown();
			if (!list || !list.length || list.children(".ag-combo-blank").length) return;
			const blank = $('<li class="ag-combo-blank" role="option" aria-label="Blank"></li>');
			blank.on("mousedown.agcombo click.agcombo", (event) => {
				event.preventDefault();
				event.stopPropagation();
				state.stored = "";
				state.searching = false;
				input.attr("placeholder", idlePlaceholder).val("");
				control.set_value("");
				control.awesomplete?.close();
				input.trigger("change");
			});
			// appended, never prepended: Awesomplete matches a clicked row to its suggestion by
			// sibling index, so anything inserted above the real rows shifts every selection
			list.append(blank);
		};
		const resetDropdown = () => {
			if (!clipped) return;
			dropdown()?.css({ position: "", left: "", top: "", bottom: "", width: "", "max-height": "", "overflow-y": "", "z-index": "" });
		};
		const trackDropdown = () => {
			if (!document.body.contains(node)) {
				document.removeEventListener("scroll", trackDropdown, true);
				window.removeEventListener("resize", trackDropdown);
				return;
			}
			placeDropdown();
		};
		if (clipped) {
			document.addEventListener("scroll", trackDropdown, true);
			window.addEventListener("resize", trackDropdown);
		}
		input.on("focus.agcombo click.agcombo", openSearch);
		input.on("awesomplete-open.agcombo", () => { if (blank) addBlankOption(); markSelected(); placeDropdown(); });
		input.on("input.agcombodrop", placeDropdown);
		input.on("awesomplete-close.agcombo", resetDropdown);
		input.on("awesomplete-selectcomplete.agcombo", () => { endSearch(false); resetDropdown(); });
		input.on("keydown.agcombo", (event) => {
			if (event.key === "Tab") return endSearch(true);
			if (event.key !== "Escape") return;
			endSearch(true);
			control.awesomplete?.close();
		});
		document.addEventListener("mousedown", cancelSearch, true);
		document.addEventListener("touchstart", cancelSearch, true);
		return control;
	}

	makeListFilter(holder, definition, scheduleFetch) {
		const df = {
			fieldname: `ag_filter_${definition.key}`,
			fieldtype: definition.fieldtype,
			label: definition.label,
			placeholder: "",
			options: definition.options,
			only_select: ["Link", "Autocomplete"].includes(definition.fieldtype),
		};
		const control = frappe.ui.form.make_control({ parent: holder, df, render_input: true });
		control.set_value("");
		control.refresh();
		holder.addClass("ag-list-filter").attr("data-filter-key", definition.key);
		holder.closest(".ag-filter-field").attr("data-filter-key", definition.key);
		// the label now sits above the control, so the box itself stays clean
		control.$input?.attr({ placeholder: "", autocomplete: "off" });
		control.$input?.off("input.aglistfilter change.aglistfilter focus.aglistfilter awesomplete-selectcomplete.aglistfilter");
		if (["Link", "Autocomplete"].includes(definition.fieldtype)) {
			control.$input?.on("change.aglistfilter awesomplete-selectcomplete.aglistfilter", scheduleFetch);
			this.bindComboSearch(control, definition.label);
		} else {
			control.$input?.on("input.aglistfilter", scheduleFetch);
		}
		return { ...definition, control };
	}

	async loadList() {
		const item = this.config[this.state.kind];
		this.setActive("list", this.state.kind);
		this.setCrumb(item.title);
		const dates = this.dateDefaults();
		const content = this.wrapper.find(".ag-content").html('<div class="ag-loading-panel">Loading filters...</div>');
		const doctype = this.boot.doctypes[this.state.kind].doctype;
		await frappe.model.with_doctype(doctype);
		this.listMeta = frappe.get_meta(doctype);
		this.listFilterControls = [];
		const availableFields = new Set((this.listMeta.fields || []).map((field) => field.fieldname).filter(Boolean));
		this.listColumns = (this.boot.doctypes[this.state.kind].columns || []).filter((fieldname) => fieldname === "name" || availableFields.has(fieldname));
		// the Status filter offers exactly what the Status column shows, which under a
		// workflow is its state rather than the doctype's own status
		this.listStatusOptions = await this.api.statusOptions(this.state.kind).catch(() => null);
		const definitions = this.listFilterDefinitions(this.listMeta);
		// every filter - text, dropdown, date and the Clear button - uses the identical
		// wrapper shape, so a grid with align-items:end puts them all on one baseline
		const filterField = (key, label, control, hiddenLabel = false) =>
			`<div class="ag-filter-field ag-filter-field-${key}"><span class="ag-filter-label-slot"${hiddenLabel ? ' aria-hidden="true"' : ""}>${hiddenLabel ? "&nbsp;" : this.escape(label)}</span><div class="ag-filter-control">${control}</div></div>`;
		const filters = definitions.map((definition) => filterField(definition.key, definition.label, `<div class="ag-list-filter-slot" data-filter-slot="${definition.key}"></div>`)).join("");
		// where date_field is `creation` there is no real date to filter on, and the
		// "this month" default would only hide older rows
		const isMaster = this.boot.doctypes[this.state.kind].date_field === "creation";
		const dateFilters = isMaster ? "" : `${filterField("from", "From", `<input class="ag-from" type="date" value="${dates.from}" aria-label="From date">`)}${filterField("to", "To", `<input class="ag-to" type="date" value="${dates.to}" aria-label="To date">`)}`;
		// a read-only kind has nothing to add, so the button would only open a dead form
		const addButton = READ_ONLY_KINDS.includes(this.state.kind)
			? ""
			: `<button class="ag-button ag-button-primary ag-new" type="button">${this.icon("add", "xs")} Add ${item.title}</button>`;
		content.html(`<div class="ag-page-head"><h1>${item.title}</h1>${addButton}</div>
			<div class="ag-filter-toolbar" style="--ag-filter-cols:${definitions.length}" aria-label="${this.escape(item.title)} filters">${filters}${dateFilters}${filterField("clear", "", `<button class="ag-button ag-button-light ag-filter-clear" type="button" title="Clear filters">${this.icon("close", "xs")} Clear</button>`, true)}</div>
			<div class="ag-filter-feedback" aria-live="polite"><span class="ag-filter-error" role="alert"></span><span class="ag-list-progress" role="status">Updating records…</span></div>
			<div class="ag-table-state"><div class="ag-loading-panel">Loading records...</div></div>`);
		content.off(".aglist");
		const scheduleFetch = frappe.utils.debounce(() => { this.state.start = 0; this.fetchList(); }, 275);
		definitions.forEach((definition) => {
			const holder = content.find(`[data-filter-slot="${definition.key}"]`);
			this.listFilterControls.push(this.makeListFilter(holder, definition, scheduleFetch));
		});
		content.on("input.aglist change.aglist", ".ag-from,.ag-to", scheduleFetch);
		content.on("click.aglist", ".ag-filter-clear", () => this.clearListFilters());
		content.on("click.aglist", ".ag-new", () => this.openForm());
		await this.fetchList();
	}

	clearListFilters() {
		// used by both the Clear button and the toolbar refresh
		const content = this.wrapper.find(".ag-content");
		(this.listFilterControls || []).forEach(({ control }) => {
			control.set_value("");
			control.$input?.val("");
		});
		const defaults = this.dateDefaults();
		content.find(".ag-from").val(defaults.from);
		content.find(".ag-to").val(defaults.to);
		this.listDateWarned = false;
		this.showListDateError("");
		this.state.start = 0;
		this.fetchList();
	}

	showListDateError(message) {
		const content = this.wrapper.find(".ag-content");
		content.find(".ag-filter-error").text(message || "").toggle(Boolean(message));
		content.find(".ag-from,.ag-to").toggleClass("is-invalid", Boolean(message));
	}

	setListLoading(loading) {
		this.listLoading = loading;
		const content = this.wrapper.find(".ag-content");
		content.find(".ag-filter-toolbar,.ag-table-state").attr("aria-busy", String(loading)).toggleClass("is-loading", loading);
		content.find(".ag-list-progress").toggle(loading);
		if (loading) {
			content.find(".ag-pager").prop("disabled", true);
			return;
		}
		const to = Math.min(this.state.start + this.state.pageLength, this.listCount);
		content.find(".ag-page-prev").prop("disabled", this.state.start === 0);
		content.find(".ag-page-next").prop("disabled", to >= this.listCount);
	}

	async fetchList() {
		const content = this.wrapper.find(".ag-content");
		const filters = [];
		for (const definition of this.listFilterControls || []) {
			const raw = definition.control.get_value();
			const value = String(raw || "").trim();
			if (!value) continue;
			if (["Link", "Autocomplete"].includes(definition.fieldtype)) filters.push([definition.fieldname, "=", value]);
			else filters.push([definition.fieldname, "like", `%${value}%`]);
		}
		const fromDate = content.find(".ag-from").val() || "";
		const toDate = content.find(".ag-to").val() || "";
		const dateField = this.boot.doctypes[this.state.kind].date_field;
		const requestId = ++this.listRequestId;
		if (fromDate && toDate && fromDate > toDate) {
			const message = __("From Date cannot be after To Date.");
			this.showListDateError(message);
			// the inline message stays put, the popup only interrupts once per bad range
			if (!this.listDateWarned) {
				this.listDateWarned = true;
				frappe.msgprint({ title: __("Invalid date range"), message, indicator: "orange" });
			}
			// the rows on screen belong to the old range, so they go: nothing is shown
			// until the dates make sense again
			this.renderTable({ rows: [], count: 0, columns: this.listColumns, can_delete: false });
			this.setListLoading(false);
			return;
		}
		this.listDateWarned = false;
		this.showListDateError("");
		if (fromDate && toDate) filters.push([dateField, "between", [fromDate, toDate]]);
		else if (fromDate) filters.push([dateField, ">=", fromDate]);
		else if (toDate) filters.push([dateField, "<=", toDate]);
		this.setListLoading(true);
		try {
			const data = await this.api.list({
				kind: this.state.kind,
				filters: JSON.stringify(filters),
				start: this.state.start,
				page_length: this.state.pageLength,
			});
			if (requestId !== this.listRequestId) return;
			this.renderTable(data || { rows: [], count: 0, columns: this.listColumns });
		} catch (error) {
			if (requestId !== this.listRequestId) return;
			content.find(".ag-table-state").html(this.errorMarkup(error));
		} finally {
			if (requestId === this.listRequestId) this.setListLoading(false);
		}
	}

	renderTable(data) {
		const columns = data.columns || this.boot.doctypes[this.state.kind].columns || [];
		data.columns = columns;
		this.listCount = Number(data.count || 0);
		const canDelete = Boolean(data.can_delete);
		const perList = LIST_COLUMN_LABELS[this.state.kind] || {};
		const fieldTypes = new Map((this.listMeta?.fields || []).map((field) => [field.fieldname, field.fieldtype]));
		const label = (fieldname) => perList[fieldname] || ({ name: "ID", transaction_date: "Date", schedule_date: "Required By", posting_date: "Posting Date", custom_department: "Department", grand_total: "Grand Total", outstanding_amount: "Outstanding Amount", mode_of_payment: "Mode of Payment", material_request_type: "Purpose", set_warehouse: "Set Warehouse", party_name: "Party", supplier_name: "Supplier Name" }[fieldname] || frappe.model.unscrub(fieldname));
		// the same test decides the currency format and the centred alignment, so a column
		// can never be formatted as money yet aligned as text
		// "total" alone is not enough: a crop log's totals are quantities, not currency
		const isAmount = (fieldname) => /amount|total/.test(fieldname) && !/quantity|qty/.test(fieldname);
		const value = (row, fieldname) => {
			if (fieldname === "name") return `<button class="ag-doc-link" data-name="${this.escape(row.name)}">${this.escape(row.name)}</button>`;
			// one receipt can carry items from several orders, so this is a comma list -
			// each PO gets its own chip, opening straight into the Purchase Order kind
			if (fieldname === "custom_purchase_orders") {
				const names = String(row.custom_purchase_orders || "").split(",").map((entry) => entry.trim()).filter(Boolean);
				if (!names.length) return "—";
				return names.map((po) => `<button class="ag-po-chip" data-name="${this.escape(po)}">${this.escape(po)}</button>`).join("");
			}
			if (["status", "workflow_state"].includes(fieldname)) return this.statusBadge(row[fieldname] || "Draft");
			// a POS Profile records whether it is switched off; the list says which it is
			if (this.state.kind === "pos-profile" && fieldname === "disabled") {
				return this.statusBadge(Number(row.disabled) ? "Disabled" : "Enabled");
			}
			// a Datetime keeps its time: on a closing entry the shift's start and end are
			// both today, and only the clock tells them apart
			if (fieldTypes.get(fieldname) === "Datetime") return this.formatDateTime(row[fieldname]);
			if (fieldname.includes("date")) return this.formatDate(row[fieldname]);
			return frappe.format(row[fieldname], { fieldtype: isAmount(fieldname) ? "Currency" : "Data" }) || "—";
		};
		// Supplier Quotation is the one list whose rows are alternatives to each other, so
		// the cheapest total is worth spotting without reading down the column. Nothing else
		// gets this: on a Purchase Order or an Invoice the smallest total means nothing.
		const lowestTotal = this.state.kind === "supplier-quotation" && columns.includes("grand_total")
			? data.rows.reduce((least, row) => {
				const amount = Number(row.grand_total);
				if (!Number.isFinite(amount) || amount <= 0) return least;
				return least === null || amount < least ? amount : least;
			}, null)
			: null;
		// paging would otherwise make "lowest" mean "lowest of the twenty you can see", which
		// is a different claim - so the tooltip says which one it is
		const wholePage = this.listCount <= data.rows.length;
		const isLowest = (row, fieldname) => lowestTotal !== null
			&& fieldname === "grand_total" && Number(row.grand_total) === lowestTotal;

		// every cell carries its own column name, so a list can size a column in CSS
		const cellClass = (fieldname, lowest = false) => ` class="ag-col-${this.escape(fieldname)}${isAmount(fieldname) ? " ag-amount-cell" : ""}${lowest ? " ag-lowest" : ""}"`;
		const bodyCell = (row, fieldname) => {
			const lowest = isLowest(row, fieldname);
			const title = lowest
				? ` title="${this.escape(wholePage ? __("Lowest total in this filter") : __("Lowest total on this page"))}"`
				: "";
			return `<td${cellClass(fieldname, lowest)}${title}>${value(row, fieldname)}</td>`;
		};
		const deleteCell = (row) => canDelete ? `<td class="ag-row-actions"><button class="ag-row-delete" type="button" data-name="${this.escape(row.name)}" title="Delete ${this.escape(row.name)}">${this.icon("delete", "xs")}</button></td>` : "";
		const rows = data.rows.map((row, index) => `<tr class="ag-row-open" data-name="${this.escape(row.name)}"><td class="ag-sr-no">${this.state.start + index + 1}</td>${columns.map((column) => bodyCell(row, column)).join("")}${deleteCell(row)}</tr>`).join("") || `<tr><td colspan="${columns.length + (canDelete ? 2 : 1)}" class="ag-empty">No records found</td></tr>`;
		const from = this.listCount ? this.state.start + 1 : 0;
		const to = Math.min(this.state.start + this.state.pageLength, this.listCount);
		this.wrapper.find(".ag-table-state").html(`<div class="ag-table-wrap" data-kind="${this.escape(this.state.kind)}"><table><thead><tr><th class="ag-sr-no">#</th>${data.columns.map((column) => `<th${cellClass(column)}>${label(column)}</th>`).join("")}${canDelete ? '<th class="ag-row-actions"></th>' : ""}</tr></thead><tbody>${rows}</tbody></table></div><footer><span>Showing ${from}–${to} of ${this.listCount}</span><div><button class="ag-pager ag-page-prev" type="button" ${this.state.start ? "" : "disabled"}>${this.icon("left", "xs")}</button><button class="ag-pager ag-page-next" type="button" ${to < this.listCount ? "" : "disabled"}>${this.icon("right", "xs")}</button></div></footer>`);
		this.wrapper.find(".ag-doc-link").off("click").on("click", (event) => this.openForm($(event.currentTarget).data("name")));
		// a PO chip opens the Purchase Order kind specifically, not whatever list this table is
		this.wrapper.find(".ag-po-chip").off("click").on("click", (event) => {
			event.stopPropagation();
			this.state.kind = "purchase-order";
			this.state.start = 0;
			this.openForm($(event.currentTarget).data("name"));
		});
		// anywhere in the row opens it, not just the ID. The delete button keeps its own job,
		// the ID link is left to the handler above, and a drag to select text is not a click.
		this.wrapper.find("tbody tr.ag-row-open").off("click").on("click", (event) => {
			if ($(event.target).closest(".ag-row-delete, .ag-doc-link, .ag-po-chip").length) return;
			if (String(window.getSelection ? window.getSelection() : "")) return;
			this.openForm($(event.currentTarget).data("name"));
		});
		this.wrapper.find(".ag-row-delete").off("click").on("click", (event) => this.deleteRecord($(event.currentTarget).data("name")));
		this.wrapper.find(".ag-page-prev").off("click").on("click", () => { if (this.listLoading) return; this.state.start = Math.max(0, this.state.start - this.state.pageLength); this.fetchList(); });
		this.wrapper.find(".ag-page-next").off("click").on("click", () => { if (this.listLoading) return; this.state.start += this.state.pageLength; this.fetchList(); });
	}

	statusBadge(status) {
		const css = String(status || "Draft").toLowerCase().replaceAll(" ", "-");
		return `<span class="ag-status-pill ${this.escape(css)}"><i></i>${this.escape(status || "Draft")}</span>`;
	}

	formatDateTime(value) {
		if (!value) return "—";
		const text = String(value);
		const time = text.slice(11, 16);
		return time ? `${this.formatDate(text)} ${time}` : this.formatDate(text);
	}

	formatDate(value) {
		// dd/mm/yyyy throughout this workspace, rather than the site-wide dd-mm-yyyy that
		// every other app on this bench shares
		if (!value) return "—";
		const text = String(value).slice(0, 10);
		const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
		const dashed = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
		if (dashed) return `${dashed[1]}/${dashed[2]}/${dashed[3]}`;
		return this.escape(text);
	}

	async loadMetadata(kind) {
		const serverMeta = await this.api.meta(kind);
		if (serverMeta.child_tables && serverMeta.fields.some((field) => ["Tab Break", "Section Break"].includes(field.fieldtype))) return serverMeta;
		const doctype = this.boot.doctypes[kind].doctype;
		const properties = ["fieldname", "label", "fieldtype", "options", "reqd", "read_only", "hidden", "default", "depends_on", "mandatory_depends_on", "read_only_depends_on", "in_list_view", "columns", "length", "precision", "non_negative", "description", "allow_on_submit"];
		const normalize = (field) => Object.fromEntries(properties.map((property) => [property, field[property]]));
		await frappe.model.with_doctype(doctype);
		const parent = frappe.get_meta(doctype);
		const fields = parent.fields.map(normalize);
		const childTables = {};
		for (const field of fields.filter((item) => item.fieldtype === "Table" && item.options)) {
			await frappe.model.with_doctype(field.options);
			const child = frappe.get_meta(field.options);
			childTables[field.fieldname] = { doctype: field.options, fields: child.fields.map(normalize) };
		}
		return { doctype, title: this.config[kind].title, fields, child_tables: childTables };
	}

	async openForm(name = null) {
		this.currentDocumentName = name;
		this.setActive("form", this.state.kind);
		this.setCrumb(name || this.config[this.state.kind].title);
		const content = this.wrapper.find(".ag-content").html('<div class="ag-loading-panel">Loading form…</div>');
		try {
			const [meta, doc] = await Promise.all([
				this.loadMetadata(this.state.kind),
				name ? this.api.get(this.state.kind, name) : Promise.resolve({ doctype: this.boot.doctypes[this.state.kind].doctype }),
			]);
			this.formMeta = meta;
			this.formDoc = doc;
			this.renderForm();
		} catch (error) {
			content.html(this.errorMarkup(error));
		}
	}

	renderForm() {
		this.formControls = [];
		this.formTableSlots = [];
		this.formSectionSlots = [];
		this.tableStates = new Map();
		this.paymentPartyKey = null;
		this.posOpeningLoaded = null;
		this.formDirty = !this.formDoc.name; // a document that does not exist yet always needs saving
		if (!this.formDoc.name) this.pendingAttachments = [];
		this.extraFieldValues = {};
		this.attendanceLastPerson = null;
		const doc = this.formDoc;
		const title = doc.name || this.formMeta.title;
		const content = this.wrapper.find(".ag-content");
		const eyebrow = `<div class="ag-form-eyebrow"><span>${this.escape(this.formMeta.title)}</span>${doc.name ? `<b>${this.escape(doc.name)}</b>` : ""}</div>`;
		const heading = `<div class="ag-form-heading">${eyebrow}<h1>${this.escape(title)}</h1>${this.docStateBadge(doc)}</div>`;
		const showActivity = Boolean(doc.name) && ACTIVITY_KINDS.includes(this.state.kind);
		const aside = showActivity ? `<aside class="ag-activity"><button type="button" class="ag-activity-head" aria-expanded="true"><span class="ag-activity-title"><b>Activity</b><small class="ag-activity-count">…</small></span>${this.icon("down", "xs")}</button><div class="ag-activity-body"><p class="ag-activity-empty">Loading…</p></div></aside>` : "";
		content.html(`<div class="ag-form-head">${heading}<div class="ag-form-actions">${this.formActions(doc)}</div></div><div class="ag-form-tabs"><div class="ag-tab-list" role="tablist"></div><div class="ag-form-body ${showActivity ? "has-activity" : ""}"><div class="ag-form-main"><div class="ag-tab-panels"></div></div>${aside}</div></div>`);
		this.buildMetadataForm(content);
		// every kind lands here, whichever builder drew it: the fields exist, so from now on
		// a change to one of them is the user's. Raised before anything else runs, because a
		// handler that never fires is invisible - the camera simply stops opening.
		this.formReady = true;
		try {
			this.hydrateAddressDisplays();
		} catch (error) {
			console.error(error);
		}
		this.prefillCompany();
		this.renderRejectionRemark(content);
		this.renderAttachments(content);
		this.renderCropPick(content);
		this.renderShiftAssign(content);
		this.renderGeoPicker(content);
		this.renderConnections(content);
		this.lockChildTables(content);
		content.find(".ag-back").on("click", () => this.loadList());
		content.find(".ag-save").on("click", () => this.saveForm(false));
		content.find(".ag-submit").on("click", () => this.saveForm(true));
		content.find(".ag-print").on("click", () => this.openPrintView(false));
		content.find(".ag-pdf").on("click", () => this.openPrintView(true));
		content.find(".ag-cancel-doc").on("click", () => this.cancelDocument());
		content.find(".ag-amend").on("click", () => this.amendDocument());
		content.find(".ag-update-items").on("click", () => this.openUpdateItems());
		content.find(".ag-logout-face").on("click", () => this.runAttendanceLogout());
		content.find(".ag-create").on("click", (event) => {
			const wrap = $(event.currentTarget).closest(".ag-create-wrap");
			// one menu at a time, the way the desk toolbar behaves
			this.wrapper.find(".ag-create-wrap").not(wrap).removeClass("open");
			wrap.toggleClass("open");
		});
		content.find(".ag-getitems").on("click", (event) => {
			const wrap = $(event.currentTarget).closest(".ag-create-wrap");
			// one menu at a time, the way the desk toolbar behaves
			this.wrapper.find(".ag-create-wrap").not(wrap).removeClass("open");
			wrap.toggleClass("open");
		});
		content.off(".agform").off(".agalign");
		content.on("click.agform", ".ag-create-menu button[data-label]", (event) => this.runCreateTarget($(event.currentTarget).data("label")));
		content.on("click.agform", ".ag-create-menu button[data-source]", (event) => this.askItemsSource($(event.currentTarget).data("source")));
		content.on("click.agform", ".ag-create-menu button[data-menu]", (event) => {
			$(event.currentTarget).closest(".ag-create-wrap").removeClass("open");
			this.runDocMenu($(event.currentTarget).data("menu"));
		});
		$(document).off("click.agcreate").on("click.agcreate", (event) => {
			if (!$(event.target).closest(".ag-create-wrap").length) this.wrapper.find(".ag-create-wrap").removeClass("open");
		});
		content.find(".ag-activity-head").on("click", (event) => {
			const panel = $(event.currentTarget).closest(".ag-activity").toggleClass("collapsed");
			$(event.currentTarget).attr("aria-expanded", String(!panel.hasClass("collapsed")));
		});
		this.loadWorkflowActions();
		if (showActivity) {
			this.loadActivity();
			const realign = () => this.alignActivityPanel();
			window.setTimeout(realign, 0);
			content.on("click.agalign", ".ag-tab-button", () => window.setTimeout(realign, 0));
			$(window).off("resize.agalign").on("resize.agalign", frappe.utils.debounce(realign, 120));
		}
	}

	renderAttachments(content) {
		if (!ATTACHMENT_KINDS.includes(this.state.kind)) return;
		// sits directly under Company, in the same metadata column
		const anchor = content.find('.ag-field-slot[data-fieldname="company"]').first();
		if (!anchor.length) return;
		const slot = $(`<div class="ag-field-slot ag-attach-slot">
			<span class="ag-attach-label">${__("Attachments")}</span>
			<div class="ag-attach-body"></div>
		</div>`).insertAfter(anchor);
		this.loadAttachments(slot);
	}

	async linkPendingAttachments(name) {
		const waiting = this.pendingAttachments || [];
		if (!waiting.length || !name) return;
		try {
			await this.api.attachFiles(this.state.kind, name, waiting.map((file) => file.name));
			this.pendingAttachments = [];
		} catch (error) {
			// the document itself saved, so this is a warning rather than a failure
			frappe.show_alert({ message: __("Files could not be attached"), indicator: "orange" });
		}
	}

	async loadAttachments(slot) {
		const body = slot.find(".ag-attach-body");
		const doctype = this.formMeta.doctype;
		const docname = this.formDoc.name;
		if (!docname) {
			// files can still be uploaded now; they are linked to the document on save
			const waiting = this.pendingAttachments || [];
			const list = waiting.map((file) => `<li><span>${this.escape(file.file_name)}</span>
				<button type="button" class="ag-attach-drop" data-file="${this.escape(file.name)}" title="${__("Remove")}">${this.icon("close", "xs")}</button></li>`).join("");
			body.html(`${list ? `<ul class="ag-attach-list">${list}</ul>` : ""}
				<p class="ag-attach-empty">${waiting.length ? __("Will be attached when you save.") : __("Choose files now, they attach when you save.")}</p>
				<button type="button" class="ag-button ag-button-light ag-attach-add">${this.icon("attachment", "xs")} ${__("Attach File")}</button>`);
			body.find(".ag-attach-add").on("click", () => {
				new frappe.ui.FileUploader({
					folder: "Home/Attachments",
					on_success: (file) => {
						this.pendingAttachments = [...(this.pendingAttachments || []), { name: file.name, file_name: file.file_name || file.name }];
						this.loadAttachments(slot);
					},
				});
			});
			body.find(".ag-attach-drop").on("click", (event) => {
				const fid = $(event.currentTarget).data("file");
				this.pendingAttachments = (this.pendingAttachments || []).filter((file) => file.name !== fid);
				this.loadAttachments(slot);
			});
			return;
		}
		let files = [];
		try {
			files = await frappe.db.get_list("File", {
				filters: { attached_to_doctype: doctype, attached_to_name: docname },
				fields: ["name", "file_name", "file_url"],
				limit: 50,
				order_by: "creation desc",
			});
		} catch (error) {
			files = [];
		}
		// Once submitted the attachments are part of the record, the same as every field on
		// the form: they are still there to open, but nothing can be added or taken away.
		const locked = Number(this.formDoc?.docstatus || 0) !== 0;
		const rows = files.map((file) => `<li>
			<a href="${this.escape(file.file_url)}" target="_blank" rel="noopener">${this.escape(file.file_name || file.name)}</a>
			${locked ? "" : `<button type="button" class="ag-attach-remove" data-file="${this.escape(file.name)}" title="${__("Remove")}">${this.icon("close", "xs")}</button>`}
		</li>`).join("");
		body.html(`${rows ? `<ul class="ag-attach-list">${rows}</ul>` : `<p class="ag-attach-empty">${__("No attachments yet.")}</p>`}
			${locked ? "" : `<button type="button" class="ag-button ag-button-light ag-attach-add">${this.icon("attachment", "xs")} ${__("Attach File")}</button>`}`);

		body.find(".ag-attach-add").on("click", () => {
			new frappe.ui.FileUploader({
				doctype,
				docname,
				on_success: () => this.loadAttachments(slot),
			});
		});
		body.find(".ag-attach-remove").on("click", async (event) => {
			const fid = $(event.currentTarget).data("file");
			const ok = await new Promise((resolve) => frappe.confirm(__("Remove this attachment?"), () => resolve(true), () => resolve(false)));
			if (!ok) return;
			try {
				await frappe.call({ method: "frappe.desk.form.utils.remove_attach", args: { fid, doctype, docname } });
				this.loadAttachments(slot);
			} catch (error) {
				frappe.msgprint({ title: __("Unable to remove"), message: this.message(error), indicator: "red" });
			}
		});
	}

	renderRejectionRemark(content) {
		// shown only once a rejection has actually recorded a reason
		const remark = String(this.formDoc[REJECTION_REMARK_FIELD] || "").trim();
		if (!remark) return;
		const panel = content.find(".ag-tab-panel").first();
		if (!panel.length) return;
		panel.append(`<section class="ag-form-section ag-remark-card"><header><h2>${__("Remark")}</h2></header><div class="ag-form-grid"><div class="ag-field-slot ag-field-wide"><p class="ag-remark-text">${this.escape(remark)}</p></div></div></section>`);
	}

	docStateBadge(doc) {
		// the workflow state wins, because that is what the list column shows too —
		// except when the document is cancelled. Workflow state cancel par nahi
		// badalta (jaise "Approved" pada reh jaata hai), is liye docstatus 2 ko
		// sabse pehle dekhte hain, warna cancelled doc "Approved" dikhata tha.
		const state = this.formMeta?.workflow ? doc[this.formMeta.workflow.workflow_state_field] : "";
		const docstatus = Number(doc.docstatus || 0);
		// Without a workflow the list falls back to the doctype's own status - Completed,
		// To Bill, Overdue - so the badge reads from the same place rather than saying a
		// flat "Submitted" the list never shows.
		const label = docstatus === 2
			? "Cancelled"
			: state || doc.status || (docstatus === 1 ? "Submitted" : doc.name ? "Draft" : "Not Saved");
		// A kind that is never submitted has no draft to be in - an Attendance Log is simply
		// recorded. Saying "Draft" there suggests a submit step that does not exist. The
		// unsaved badge stays, because that one is a real state on any form.
		if (label === "Draft" && NON_SUBMITTABLE_KINDS.includes(this.state.kind)) return "";
		const tone = docstatus === 2 ? "red" : docstatus === 1 ? "green" : "amber";
		return `<span class="ag-doc-state ag-doc-state-${tone}">${this.escape(label)}</span>`;
	}

	formActions(doc) {
		const docstatus = Number(doc.docstatus || 0);
		const draft = docstatus === 0;
		const buttons = [`<button class="ag-button ag-button-light ag-back" type="button">${this.icon("left", "xs")} Back to List</button>`];
		// icon only, so the header stays short next to the workflow actions
		if (doc.name && SHOW_PRINT_ACTIONS) {
			buttons.push(`<button class="ag-button ag-button-light ag-icon-button ag-print" type="button" title="${__("Print")}" aria-label="${__("Print")}">${this.icon("printer", "sm")}</button>`);
		}
		// a draft can still be filled from an existing document, exactly like the desk form
		const sources = draft ? GET_ITEMS_SOURCES[this.state.kind] || [] : [];
		if (sources.length) {
			const options = sources.map((source) => `<button type="button" data-source="${source.kind}">${this.escape(source.label)}</button>`).join("");
			buttons.push(`<div class="ag-create-wrap"><button class="ag-button ag-button-light ag-getitems" type="button">Get Items From ${this.icon("down", "xs")}</button><div class="ag-create-menu">${options}</div></div>`);
		}
		// "Request for Quotation" is hidden from the Create menu here rather than in
		// api.py's CREATE_TARGETS, since a Python change needs a restart to take effect
		// and this doesn't
		const HIDDEN_CREATE_TARGETS = ["Request for Quotation"];
		// A target the document has outgrown is dropped, the way the desk form drops it:
		// a fully billed receipt has no invoice left to raise, and a fully received order
		// has no receipt left to make.
		const stillOpen = (percent) => Number(percent || 0) < 100;
		const rules = {
			"purchase-receipt": { "Purchase Invoice": () => stillOpen(doc.per_billed) },
			"purchase-order": {
				"Purchase Receipt": () => stillOpen(doc.per_received),
				"Purchase Invoice": () => stillOpen(doc.per_billed),
			},
		}[this.state.kind] || {};
		// a cancelled document has nothing left to create from; it can only be amended
		const targets = docstatus === 1
			? (this.formMeta?.create_targets || [])
				.filter((target) => !HIDDEN_CREATE_TARGETS.includes(target.doctype || target.label))
				.filter((target) => {
					const rule = rules[target.label] || rules[target.doctype];
					return rule ? rule() : true;
				})
			: [];
		// the desk's own menus, merged with this workspace's Create targets so Create stays
		// one dropdown rather than two
		const menuDoc = {
			docstatus,
			status: doc.status,
			open: docstatus === 1 && !Number(doc.is_return || 0) && doc.status !== "Closed",
		};
		const extras = (DOC_MENUS[this.state.kind] || []).filter((item) => item.when(menuDoc));
		const groups = [
			{ key: "Create", items: [
				...targets.map((target) => `<button type="button" data-label="${this.escape(target.label)}">${this.escape(target.label)}</button>`),
				...extras.filter((item) => item.group === "Create").map((item) => `<button type="button" data-menu="${item.key}">${this.escape(item.label)}</button>`),
			] },
			{ key: "View", items: extras.filter((item) => item.group === "View").map((item) => `<button type="button" data-menu="${item.key}">${this.escape(item.label)}</button>`) },
			{ key: "Status", items: extras.filter((item) => item.group === "Status").map((item) => `<button type="button" data-menu="${item.key}">${this.escape(item.label)}</button>`) },
		];
		for (const group of groups) {
			if (!group.items.length) continue;
			buttons.push(`<div class="ag-create-wrap"><button class="ag-button ag-button-light ag-create" type="button">${__(group.key)} ${this.icon("down", "xs")}</button><div class="ag-create-menu">${group.items.join("")}</div></div>`);
		}
		// logout is only possible on a saved log that has a login and no logout yet
		if (this.state.kind === ATTENDANCE_KIND && doc.name && doc.log_in_al && !doc.log_out_al) {
			buttons.push(`<button class="ag-button ag-button-primary ag-logout-face" type="button">${this.icon("arrow-right", "xs")} ${__("Logout with Face")}</button>`);
		}
		// Amend, exactly where the desk puts it: a cancelled document that carries an
		// amended_from field and has not been amended already
		if (docstatus === 2 && (this.formMeta?.fields || []).some((field) => field.fieldname === "amended_from")) {
			buttons.push(`<button class="ag-button ag-button-primary ag-amend" type="button">${this.icon("edit", "xs")} ${__("Amend")}</button>`);
		}
		if (READ_ONLY_KINDS.includes(this.state.kind)) return buttons.join("");
		buttons.push('<span class="ag-workflow-actions"></span>');
		// Update Items, on the same conditions as purchase_order.js:345 - open, not fully
		// received and not fully billed. can_update_items (a subcontracted order that already
		// has a Subcontracting Order) is left to the server, which refuses it with a message.
		if (this.state.kind === "purchase-order" && docstatus === 1
			&& !["Closed", "Delivered"].includes(doc.status)
			&& Number(doc.per_received || 0) < 100 && Number(doc.per_billed || 0) < 100) {
			buttons.push(`<button class="ag-button ag-button-light ag-update-items" type="button">${__("Update Items")}</button>`);
		}
		if (docstatus === 1) buttons.push(`<button class="ag-button ag-button-danger ag-cancel-doc" type="button">${this.icon("close", "xs")} Cancel</button>`);
		if (draft) {
			buttons.push('<button class="ag-button ag-button-primary ag-save" type="button">Save</button>');
			// with a workflow in charge, submission happens through its own actions instead
			if (doc.name && !this.formMeta?.workflow && !NON_SUBMITTABLE_KINDS.includes(this.state.kind)) buttons.push('<button class="ag-button ag-button-light ag-submit" type="button">Submit</button>');
		}
		return buttons.join("");
	}

	activityMark(type) {
		// Frappe writes these comment types itself, so the map follows its own vocabulary
		const marks = {
			"Workflow": { icon: "workflow", tone: "primary" },
			"Document updated": { icon: "change", tone: "muted" },
			"Label": { icon: "tag", tone: "amber" },
			"Comment": { icon: "small-message", tone: "muted" },
			"Edit": { icon: "edit", tone: "muted" },
			"Assigned": { icon: "assign", tone: "primary" },
			"Assignment Completed": { icon: "check", tone: "teal" },
			"Attachment": { icon: "attachment", tone: "muted" },
			"Attachment Removed": { icon: "attachment", tone: "red" },
			"Shared": { icon: "share", tone: "muted" },
			"Unshared": { icon: "share", tone: "red" },
			"Submitted": { icon: "check", tone: "teal" },
			"Cancelled": { icon: "close", tone: "red" },
		};
		return marks[type] || { icon: "change", tone: "muted" };
	}

	alignActivityPanel() {
		// the Details tab of a Purchase Order opens with a row of reference chips, so a fixed
		// offset would not do; the panel is lined up with whatever the first card turns out to be
		const panel = this.wrapper.find(".ag-activity");
		if (!panel.length) return;
		const body = panel.closest(".ag-form-body");
		if (!body.length || body.css("grid-template-columns").split(" ").length < 2) {
			panel.css("margin-top", "");
			return;
		}
		const card = this.wrapper.find(".ag-tab-panel.active .ag-form-section").first();
		if (!card.length) return;
		// measured against the row itself, never against the margin we are about to set,
		// otherwise every resize would flip the panel between two positions
		const offset = card.offset().top - body.offset().top;
		panel.css("margin-top", `${Math.max(0, Math.round(offset))}px`);
	}

	async loadActivity() {
		const panel = this.wrapper.find(".ag-activity");
		if (!panel.length) return;
		let data;
		try {
			data = await this.api.activity(this.state.kind, this.formDoc.name);
		} catch (error) {
			panel.find(".ag-activity-count").text("");
			panel.find(".ag-activity-body").html('<p class="ag-activity-empty">History is not available for this document.</p>');
			return;
		}
		const counts = data.counts || {};
		panel.find(".ag-activity-count").text(`${counts.events || 0} events · ${counts.files || 0} files · ${counts.assigned || 0} assigned`);
		const events = data.events || [];
		if (!events.length) {
			panel.find(".ag-activity-body").html('<p class="ag-activity-empty">Nothing has happened on this document yet.</p>');
			return;
		}
		panel.find(".ag-activity-body").html(events.map((event) => {
			const when = event.at ? frappe.datetime.comment_when(event.at) : "";
			const mark = this.activityMark(event.type);
			const changes = (event.changes || []).map((change) => `<li>${this.escape(change)}</li>`).join("");
			return `<article class="ag-activity-item">
				<span class="ag-activity-mark ag-activity-mark-${mark.tone}">${this.icon(mark.icon, "xs")}</span>
				<div class="ag-activity-detail">
					<header><b>${this.escape(event.type || "")}</b><time>${when}</time></header>
					${event.by ? `<span class="ag-activity-by">${this.escape(event.by)}</span>` : ""}
					${event.text ? `<p>${this.escape(event.text)}</p>` : ""}
					${changes ? `<ul>${changes}</ul>` : ""}
				</div>
			</article>`;
		}).join(""));
	}

	async loadWorkflowActions() {
		const doc = this.formDoc;
		const holder = this.wrapper.find(".ag-workflow-actions");
		if (!doc.name || !this.formMeta?.workflow || !holder.length) return;
		if (NO_WORKFLOW_ACTION_KINDS.includes(this.state.kind)) return;
		let transitions = [];
		try {
			transitions = (await this.api.transitions(this.state.kind, doc.name)) || [];
		} catch (error) {
			return; // no workflow action is better than a broken header
		}
		if (!transitions.length) return;
		holder.html(transitions.map((transition) => `<button class="ag-button ag-button-light ag-wf-action" type="button" data-action="${this.escape(transition.action)}">${this.escape(transition.action)}</button>`).join(""));
		holder.find(".ag-wf-action").on("click", (event) => this.runWorkflowAction($(event.currentTarget).data("action")));
	}

	markFormDirty() {
		if (this.formDirty) return;
		this.formDirty = true;
		this.wrapper.find(".ag-save").show();
	}

	async deleteRecord(name) {
		const confirmed = await new Promise((resolve) => frappe.confirm(__("Delete {0}?", [name]), () => resolve(true), () => resolve(false)));
		if (!confirmed) return;
		try {
			await this.api.remove(this.state.kind, name);
			frappe.show_alert({ message: `${name} deleted`, indicator: "orange" });
			await this.fetchList();
		} catch (error) {
			frappe.msgprint({ title: __("Unable to delete"), message: this.message(error), indicator: "red" });
		}
	}

	async cancelDocument() {
		const confirmed = await new Promise((resolve) => frappe.confirm(__("Cancel {0}?", [this.formDoc.name]), () => resolve(true), () => resolve(false)));
		if (!confirmed) return;
		const button = this.wrapper.find(".ag-cancel-doc").prop("disabled", true);
		try {
			await this.api.cancel(this.state.kind, this.formDoc.name);
			frappe.show_alert({ message: `${this.formDoc.name} cancelled`, indicator: "orange" });
			await this.loadList();
		} catch (error) {
			frappe.msgprint({ title: __("Unable to cancel"), message: this.message(error), indicator: "red" });
			button.prop("disabled", false);
		}
	}

	askRejectionRemark(action) {
		// a rejection has to say why, so the dialog cannot be dismissed into an empty reason
		return new Promise((resolve) => {
			const dialog = frappe.prompt(
				{
					fieldname: "remark",
					fieldtype: "Small Text",
					label: __("Reason for rejection"),
					reqd: 1,
				},
				(values) => resolve(String(values.remark || "").trim() || null),
				__("{0} {1}", [action, this.formDoc.name]),
				__("Confirm {0}", [action]),
			);
			// cancelling resolves too, otherwise the caller would wait forever
			dialog.$wrapper.on("hidden.bs.modal", () => resolve(null));
		});
	}

	async runWorkflowAction(action) {
		let remark = null;
		if (/reject/i.test(action)) {
			remark = await this.askRejectionRemark(action);
			if (!remark) return;
		}
		const buttons = this.wrapper.find(".ag-wf-action").prop("disabled", true);
		try {
			const updated = await this.api.applyAction(this.state.kind, this.formDoc.name, action, remark);
			frappe.show_alert({ message: `${updated.name}: ${action}`, indicator: "green" });
			await this.loadList();
		} catch (error) {
			frappe.msgprint({ title: __("Unable to apply action"), message: this.message(error), indicator: "red" });
			buttons.prop("disabled", false);
		}
	}

	askItemsSource(sourceKind) {
		this.wrapper.find(".ag-create-wrap").removeClass("open");
		const source = (GET_ITEMS_SOURCES[this.state.kind] || []).find((entry) => entry.kind === sourceKind);
		if (!source) return;

		const filters = { docstatus: 1 };
		const company = this.getFormValue("company");
		const supplier = this.getFormValue("supplier");
		// only submitted documents, narrowed to whatever the form already knows
		if (company) filters.company = company;
		if (supplier) filters.supplier = supplier;

		const canPick = !NO_CHILD_SELECTION.includes(this.state.kind);
		const rows = [];

		const fields = [{
			fieldname: "reference", fieldtype: "Link", options: source.doctype, reqd: 1,
			label: __("Select {0}", [source.label]),
			get_query: () => ({ filters }),
			onchange: () => loadRows(),
		}];
		if (canPick) {
			fields.push({
				fieldname: "children", fieldtype: "Table", label: __("Items"),
				cannot_add_rows: true, cannot_delete_rows: true, in_place_edit: false,
				data: rows, get_data: () => rows,
				// the widths add up to 8, inside Frappe's budget of 11 with the index cell
				fields: [
					{ fieldtype: "Data", fieldname: "docname", hidden: 1 },
					{ fieldtype: "Data", fieldname: "item_code", label: __("Item Code"), read_only: 1, in_list_view: 1, columns: 4 },
					{ fieldtype: "Data", fieldname: "qty", label: __("Qty"), read_only: 1, in_list_view: 1, columns: 2 },
					{ fieldtype: "Data", fieldname: "uom", label: __("UOM"), read_only: 1, in_list_view: 1, columns: 2 },
				],
			});
			fields.push({
				fieldtype: "HTML", fieldname: "hint",
				options: `<p class="small text-muted">${__("Tick the rows to pull. Leave every row unticked to pull all of them.")}</p>`,
			});
		} else {
			fields.push({
				fieldtype: "HTML", fieldname: "hint",
				options: `<p class="small text-muted">${__("A quotation is asked for the whole outstanding quantity, so every remaining item is pulled.")}</p>`,
			});
		}

		const dialog = new frappe.ui.Dialog({
			title: __("Get Items From {0}", [source.label]),
			size: canPick ? "large" : "small",
			fields,
			primary_action_label: __("Get Items"),
			primary_action: async () => {
				const reference = dialog.get_value("reference");
				if (!reference) {
					frappe.msgprint(__("Please select a {0} first", [source.label]));
					return;
				}
				let picked = [];
				if (canPick) {
					this.commitGridEditor();
					picked = (dialog.fields_dict.children.grid.get_selected_children() || [])
						.map((row) => row.docname)
						.filter(Boolean);
				}
				dialog.hide();
				await this.pullItemsFrom(sourceKind, reference, picked);
			},
		});

		const loadRows = async () => {
			if (!canPick) return;
			const reference = dialog.get_value("reference");
			rows.length = 0;
			if (reference) {
				try {
					const document = await this.api.get(sourceKind, reference);
					for (const row of document.items || []) {
						rows.push({ docname: row.name, item_code: row.item_code, qty: row.qty, uom: row.uom });
					}
				} catch (error) {
					// leave the table empty; the message below the picker still applies
				}
			}
			dialog.fields_dict.children.grid.refresh();
		};

		dialog.show();
		dialog.$wrapper.addClass("ag-dialog");
	}

	async pullItemsFrom(sourceKind, sourceName, picked) {
		try {
			// nothing ticked means everything, which is what the desk does too
			const args = picked && picked.length ? { filtered_children: picked } : null;
			const document = await this.api.mapped(sourceKind, sourceName, this.state.kind, args);
			const items = document?.items || [];
			if (!items.length) {
				// ERPNext leaves out rows that are already fully received or billed, so an
				// empty result means there is genuinely nothing left to pull
				frappe.msgprint({
					title: __("Nothing to get"),
					message: __("{0} has no remaining items to pull into this document.", [sourceName]),
					indicator: "orange",
				});
				return;
			}
			this.formDoc = document;
			this.currentDocumentName = null;
			this.renderForm();
			frappe.show_alert({ message: __("{0} item(s) pulled from {1}", [items.length, sourceName]), indicator: "green" });
		} catch (error) {
			frappe.msgprint({ title: __("Unable to get items"), message: this.message(error), indicator: "red" });
		}
	}

	async openDeskDoc(method, args) {
		// the same two steps frappe.model.open_mapped_doc takes: build it, then land on it
		const doc = await frappe.xcall(method, args);
		if (!doc) return;
		const synced = frappe.model.sync(doc);
		const target = Array.isArray(synced) ? synced[0] : synced;
		frappe.set_route("Form", target.doctype, target.name);
	}

	openUpdateItems() {
		// The desk's own dialog, rebuilt here: same fields, same server call
		// (erpnext.utils.update_child_items -> update_child_qty_rate). This is the one way a
		// submitted order's items may still change, and the server keeps every rule.
		const doc = this.formDoc;
		const rows = (doc.items || []).map((row) => ({
			docname: row.name,
			item_code: row.item_code,
			qty: row.qty,
			rate: row.rate,
			uom: row.uom,
			conversion_factor: row.conversion_factor,
			schedule_date: row.schedule_date,
		}));

		const dialog = new frappe.ui.Dialog({
			title: __("Update Items"),
			size: "extra-large",
			fields: [{
				fieldname: "trans_items",
				fieldtype: "Table",
				label: __("Items"),
				cannot_add_rows: false,
				in_place_edit: false,
				reqd: 1,
				data: rows,
				get_data: () => rows,
				// the widths add up to 10, and Frappe budgets 11 including the index cell
				fields: [
					{ fieldtype: "Data", fieldname: "docname", read_only: 1, hidden: 1 },
					{
						fieldtype: "Link", fieldname: "item_code", options: "Item", label: __("Item Code"),
						in_list_view: 1, columns: 3,
						// an item already in the table is not offered again
						get_query: () => {
							const chosen = (dialog.fields_dict.trans_items.df.data || [])
								.map((row) => row.item_code)
								.filter(Boolean);
							const filters = { is_purchase_item: 1 };
							if (chosen.length) filters.name = ["not in", chosen];
							return { filters };
						},
						onchange() {
							// the same lookup the desk dialog runs: UOM, conversion factor,
							// qty and rate all come back together for the chosen item
							const editor = this;
							if (!editor.value) return;
							frappe.xcall("erpnext.stock.get_item_details.get_item_details", {
								doc,
								args: {
									item_code: editor.value,
									set_warehouse: doc.set_warehouse,
									supplier: doc.supplier,
									currency: doc.currency,
									conversion_rate: doc.conversion_rate,
									price_list: doc.buying_price_list,
									price_list_currency: doc.price_list_currency,
									plc_conversion_rate: doc.plc_conversion_rate,
									company: doc.company,
									is_subcontracted: doc.is_subcontracted,
									ignore_pricing_rule: doc.ignore_pricing_rule,
									doctype: doc.doctype,
									name: doc.name,
									qty: editor.doc.qty || 1,
									uom: editor.doc.uom,
									tax_category: doc.tax_category,
									child_doctype: `${doc.doctype} Item`,
								},
							}).then((details) => {
								if (!details) return;
								const target = (dialog.fields_dict.trans_items.df.data || [])
									.find((row) => row.idx === editor.doc.idx);
								if (!target) return;
								// anything the user already typed wins over the fetched value
								Object.assign(target, {
									uom: editor.doc.uom || details.uom,
									conversion_factor: editor.doc.conversion_factor || details.conversion_factor,
									qty: editor.doc.qty || details.qty,
									rate: editor.doc.rate || details.price_list_rate,
								});
								dialog.fields_dict.trans_items.grid.refresh();
							}).catch(() => {});
						},
					},
					{ fieldtype: "Float", fieldname: "qty", label: __("Quantity"), in_list_view: 1, columns: 2 },
					{ fieldtype: "Currency", fieldname: "rate", label: __("Rate"), in_list_view: 1, columns: 2 },
					{ fieldtype: "Date", fieldname: "schedule_date", label: __("Required By"), in_list_view: 1, columns: 2, reqd: 1 },
					{ fieldtype: "Link", fieldname: "uom", options: "UOM", label: __("UOM"), in_list_view: 1, columns: 1, reqd: 1 },
					{ fieldtype: "Float", fieldname: "conversion_factor", label: __("Conversion Factor") },
				],
			}],
			primary_action_label: __("Update"),
			primary_action: async () => {
				this.commitGridEditor();
				const items = (dialog.get_values()?.trans_items || []).filter((row) => row.item_code);
				if (!items.length) {
					frappe.msgprint(__("Please keep at least one item"));
					return;
				}
				// the picker already hides them, but a pasted or stale row is caught here too
				const codes = items.map((row) => row.item_code);
				const duplicate = codes.find((code, index) => codes.indexOf(code) !== index);
				if (duplicate) {
					frappe.msgprint({
						title: __("Duplicate item"),
						message: __("<b>{0}</b> appears more than once. Each item may only have one row.", [duplicate]),
						indicator: "red",
					});
					return;
				}
				try {
					// the server takes this as a JSON string, not an array
					await frappe.xcall("erpnext.controllers.accounts_controller.update_child_qty_rate", {
						parent_doctype: doc.doctype,
						trans_items: JSON.stringify(items),
						parent_doctype_name: doc.name,
						child_docname: "items",
					});
				} catch (error) {
					frappe.msgprint({ title: __("Could not update items"), message: this.message(error), indicator: "red" });
					return;
				}
				dialog.hide();
				frappe.show_alert({ message: __("Items updated"), indicator: "green" });
				this.openForm(doc.name);
			},
		});

		dialog.show();
		dialog.$wrapper.addClass("ag-dialog");
	}

	async amendDocument() {
		try {
			const document = await this.api.amend(this.state.kind, this.formDoc.name);
			this.formDoc = document;
			this.currentDocumentName = null;
			this.setActive("form", this.state.kind);
			this.renderForm();
			frappe.show_alert({ message: __("Amended copy ready - save it to keep it"), indicator: "blue" });
		} catch (error) {
			frappe.msgprint({ title: __("Cannot amend"), message: this.message(error), indicator: "red" });
		}
	}

	async openMappedHere(kind, method, args) {
		// the desk's mapper builds the document; this workspace opens it, unsaved, on its
		// own form instead of handing it to the desk
		const document = await frappe.xcall(method, args);
		if (!document) return;
		this.state.kind = kind;
		this.formMeta = await this.loadMetadata(kind);
		this.formDoc = document;
		this.setActive("form", kind);
		this.setCrumb(this.config[kind].title);
		this.currentDocumentName = null;
		this.renderForm();
	}

	openDeskRoute(view, name, options) {
		frappe.route_options = options;
		frappe.set_route(view, name);
	}

	async setReceiptStatus(status) {
		await frappe.xcall("erpnext.stock.doctype.purchase_receipt.purchase_receipt.update_purchase_receipt_status", {
			docname: this.formDoc.name,
			status,
		});
		frappe.show_alert({ message: status === "Closed" ? __("Closed") : __("Reopened"), indicator: "green" });
		this.openForm(this.formDoc.name);
	}

	async runDocMenu(key) {
		const doc = this.formDoc;
		const PR = "erpnext.stock.doctype.purchase_receipt.purchase_receipt";
		// the window the desk uses for both ledgers: the document's own posting date
		// through the day it was last touched
		const ledger = {
			voucher_no: doc.name,
			from_date: doc.posting_date,
			to_date: String(doc.modified || "").slice(0, 10),
			company: doc.company,
			show_cancelled_entries: Number(doc.docstatus) === 2,
			ignore_prepared_report: true,
		};
		try {
			if (key === "lcv") return await this.openDeskDoc(`${PR}.make_lcv`, { doctype: doc.doctype, docname: doc.name });
			// a return is a Purchase Receipt with is_return set, and that page is right here
			if (key === "return") return await this.openMappedHere("purchase-receipt", `${PR}.make_purchase_return`, { source_name: doc.name });
			if (key === "stock-entry") return await this.openDeskDoc(`${PR}.make_stock_entry`, { source_name: doc.name });
			if (key === "retention") {
				return await this.openDeskDoc("erpnext.stock.doctype.stock_entry.stock_entry.move_sample_to_retention_warehouse", {
					company: doc.company,
					items: doc.items,
				});
			}
			if (key === "stock-ledger") return this.openDeskRoute("query-report", "Stock Ledger", ledger);
			if (key === "accounting-ledger") {
				return this.openDeskRoute("query-report", "General Ledger", { ...ledger, categorize_by: "Categorize by Voucher (Consolidated)" });
			}
			if (key === "asset") return this.openDeskRoute("List", "Asset", { purchase_receipt: doc.name });
			if (key === "asset-movement") return this.openDeskRoute("List", "Asset Movement", { reference_name: doc.name });
			if (key === "close") return await this.setReceiptStatus("Closed");
			if (key === "reopen") return await this.setReceiptStatus("Submitted");
		} catch (error) {
			frappe.msgprint({ title: __("Could not continue"), message: this.message(error), indicator: "red" });
		}
	}

	async runCreateTarget(label) {
		this.wrapper.find(".ag-create-wrap").removeClass("open");
		try {
			const result = await this.api.createTarget(this.state.kind, this.formDoc.name, label);
			if (result.kind) {
				// stays inside the workspace
				this.state.kind = result.kind;
				this.formMeta = await this.loadMetadata(result.kind);
				this.formDoc = result.document;
				this.setActive("form", result.kind);
				this.setCrumb(this.config[result.kind].title);
				this.currentDocumentName = null;
				this.renderForm();
				return;
			}
			// this DocType lives outside the workspace, so hand it to the standard form
			frappe.model.sync(result.document);
			frappe.set_route("Form", result.document.doctype, result.document.name);
		} catch (error) {
			frappe.msgprint({ title: __("Unable to create"), message: this.message(error), indicator: "red" });
		}
	}

	openPrintView(asPdf) {
		const doctype = encodeURIComponent(this.formMeta.doctype);
		const name = encodeURIComponent(this.formDoc.name);
		const url = asPdf
			? `/api/method/frappe.utils.print_format.download_pdf?doctype=${doctype}&name=${name}&no_letterhead=0`
			: `/printview?doctype=${doctype}&name=${name}&trigger_print=1`;
		window.open(url, "_blank", "noopener");
	}


	buildMaterialRequestForm(content) {
		const tabList = content.find(".ag-tab-list");
		const panels = content.find(".ag-tab-panels");
		const fieldMap = new Map(this.formMeta.fields.filter((field) => field.fieldname).map((field) => [field.fieldname, field]));
		let tabIndex = 0;
		const makeTab = (label) => {
			const id = `ag-mr-tab-${tabIndex}`;
			const active = tabIndex++ === 0;
			tabList.append(`<button type="button" class="ag-tab-button ${active ? "active" : ""}" data-tab="${id}">${this.escape(label)}</button>`);
			return $(`<div class="ag-tab-panel ${active ? "active" : ""}" data-panel="${id}"></div>`).appendTo(panels);
		};
		const getField = (names, label = null) => {
			const found = names.map((name) => fieldMap.get(name)).find(Boolean);
			return found ? { ...found, label: label || found.label } : null;
		};
		const addField = (grid, field, wide = false) => {
			if (!field) return null;
			const holder = $(`<div class="ag-field-slot ${wide ? "ag-field-wide" : ""}" data-fieldname="${this.escape(field.fieldname)}"></div>`).appendTo(grid);
			if (field.fieldtype === "Table") this.renderChildTable(holder, field);
			else this.renderControl(holder, field, this.formDoc[field.fieldname]);
			return holder;
		};

		const details = makeTab("Details");
		const detailsCard = $('<section class="ag-form-section ag-mr-form-card"></section>').appendTo(details);
		const primaryGrid = $('<div class="ag-form-grid ag-mr-primary-grid"></div>').appendTo(detailsCard);
		// Customize Form marks Purpose read-only on this site; the Agriventure workspace
		// shows it editable, without touching the DocType itself. Price List stays hidden
		// here, matching the rest of the site.
		const purposeField = getField(["material_request_type"]);
		[
			getField(["naming_series"]),
			getField(["transaction_date"]),
			purposeField && { ...purposeField, read_only: 0, hidden: 0, depends_on: null, read_only_depends_on: null },
			getField(["schedule_date"]),
			getField(["company"]),
		].forEach((field) => addField(primaryGrid, field));

		const itemsSection = $('<section class="ag-mr-items-section"><h2>Items</h2></section>').appendTo(detailsCard);
		const itemDefaults = $('<div class="ag-form-grid ag-mr-item-defaults"></div>').appendTo(itemsSection);
		// Scan Barcode is not part of this workspace's Material Request. scanMaterialBarcode
		// stays where it is: nothing calls it now, and it is the whole scanner behaviour
		// should the field ever be asked for again.
		// Customize Form marks this read only on this site; the workspace lets it be chosen,
		// without touching the DocType itself
		const storeField = getField(["set_warehouse"], "Set Warehouse");
		addField(itemDefaults, storeField && { ...storeField, read_only: 0, read_only_depends_on: null, depends_on: null });
		const itemTable = getField(["items"]);
		if (itemTable) addField(itemsSection, itemTable, true);

		const terms = makeTab("Terms");
		const termsCard = $('<section class="ag-form-section ag-mr-tab-card"><div class="ag-form-grid ag-mr-terms-grid"></div></section>').appendTo(terms);
		const termsGrid = termsCard.find(".ag-form-grid");
		addField(termsGrid, getField(["tc_name"], "Terms and Conditions"));
		addField(termsGrid, getField(["terms"], "Terms and Conditions Content"), true);

		const more = makeTab("More Info");
		const printing = $(`<section class="ag-form-section ag-mr-tab-card ag-collapsible-section"><button type="button" class="ag-collapse-header" aria-expanded="true"><span class="ag-collapse-title"><h2>Printing Details</h2>${this.icon("down", "xs")}</span></button><div class="ag-form-grid ag-collapse-body"></div></section>`).appendTo(more);
		const printingGrid = printing.find(".ag-form-grid");
		addField(printingGrid, getField(["letter_head"]));
		addField(printingGrid, getField(["select_print_heading"], "Print Heading"));

		tabList.on("click", ".ag-tab-button", (event) => {
			const tab = $(event.currentTarget).data("tab");
			tabList.find(".ag-tab-button").removeClass("active");
			$(event.currentTarget).addClass("active");
			panels.find(".ag-tab-panel").removeClass("active").filter(`[data-panel="${tab}"]`).addClass("active");
		});
		printing.find(".ag-collapse-header").on("click", (event) => {
			const section = $(event.currentTarget).closest(".ag-collapsible-section");
			section.toggleClass("collapsed");
			$(event.currentTarget).attr("aria-expanded", String(!section.hasClass("collapsed")));
		});

		// same field engine the metadata-driven forms get: depends_on rules, the
		// parent-to-row copy and the live recalculation all react to an edit here too
		this.bindFieldEngine(content);
	}

	bindFieldEngine(content) {
		const refresh = frappe.utils.debounce(() => this.applyDependsOn(), 40);
		content.off(".agdepends").on("change.agdepends input.agdepends awesomplete-selectcomplete.agdepends", "input, select, textarea", (event) => {
			if (this.applyingCalculation) return;
			// only a real keystroke or click counts as an edit; values we fill in ourselves do not
			if (event.originalEvent) this.markFormDirty();
			refresh();
			this.scheduleRecalculation();
		});
		this.applyDependsOn();
		this.wrapper.find(".ag-save").toggle(Boolean(this.formDirty));
	}

	// ---------- shared report plumbing ----------

	checkReportDates(state, content) {
		// same rule as the list pages: an inline message that stays, and a popup that
		// interrupts only once per bad range
		if (state.from && state.to && state.from > state.to) {
			const message = __("From Date cannot be after To Date.");
			content.find(".ag-filter-error").text(message).show();
			content.find(".ag-rep-from,.ag-rep-to").addClass("is-invalid");
			if (!state.dateWarned) {
				state.dateWarned = true;
				frappe.msgprint({ title: __("Invalid date range"), message, indicator: "orange" });
			}
			return false;
		}
		state.dateWarned = false;
		content.find(".ag-filter-error").text("").hide();
		content.find(".ag-rep-from,.ag-rep-to").removeClass("is-invalid");
		return true;
	}

	reportPage(rows, state) {
		state.pageSize = state.pageSize || REPORT_PAGE_SIZES[0];
		const total = rows.length;
		const pages = Math.max(1, Math.ceil(total / state.pageSize));
		state.page = Math.min(Math.max(1, state.page || 1), pages);
		const start = (state.page - 1) * state.pageSize;
		return { rows: rows.slice(start, start + state.pageSize), total, pages, start };
	}

	reportPagerMarkup(page, state) {
		if (!page.total) return "";
		const options = REPORT_PAGE_SIZES
			.map((size) => `<option value="${size}" ${size === state.pageSize ? "selected" : ""}>${size}</option>`)
			.join("");
		return `<div class="ag-rep-pager">
			<label class="ag-rep-pagesize">${__("Show")}
				<select class="ag-rep-size">${options}</select> ${__("entries")}</label>
			<span class="ag-rep-count">${__("Showing {0} to {1} of {2} entries", [
				page.start + 1, Math.min(page.start + state.pageSize, page.total), page.total])}</span>
			<span class="ag-rep-pagenav">
				<button type="button" class="ag-button ag-button-light ag-rep-prev" ${state.page <= 1 ? "disabled" : ""}>${__("Previous")}</button>
				<b>${__("Page {0} of {1}", [state.page, page.pages])}</b>
				<button type="button" class="ag-button ag-button-light ag-rep-next" ${state.page >= page.pages ? "disabled" : ""}>${__("Next")}</button>
			</span>
		</div>`;
	}

	bindReportPager(content, state, rerender) {
		content.on("change.agpager", ".ag-rep-size", (event) => {
			state.pageSize = Number(event.target.value) || REPORT_PAGE_SIZES[0];
			state.page = 1;
			rerender();
		});
		content.on("click.agpager", ".ag-rep-prev", () => { state.page = Math.max(1, (state.page || 1) - 1); rerender(); });
		content.on("click.agpager", ".ag-rep-next", () => { state.page = (state.page || 1) + 1; rerender(); });
	}

	reportTableMarkup(columns, rows, offset = 0, money = null) {
		const head = columns.map((column) => `<th class="ag-align-${column.align || "left"}">${this.escape(column.label)}</th>`).join("");
		const body = rows.map((row, index) => `<tr><td>${offset + index + 1}</td>${columns
			.map((column) => {
				const raw = row[column.key];
				const text = money && money.includes(column.key) ? this.reportMoney(raw) : this.escape(String(raw ?? ""));
				return `<td class="ag-align-${column.align || "left"}">${text}</td>`;
			}).join("")}</tr>`).join("");
		return `<div class="ag-rep-table"><table><thead><tr><th>#</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
	}

	reportMoney(value) {
		return frappe.format(value, { fieldtype: "Currency", options: this.reportCurrency || "INR" });
	}

	reportNumber(value) {
		const number = Number(value || 0);
		return Number.isInteger(number) ? String(number) : String(parseFloat(number.toFixed(2)));
	}

	reportExportUrl(method, args) {
		const query = Object.entries(args).map(([key, value]) => `${key}=${encodeURIComponent(value ?? "")}`).join("&");
		return `/api/method/agriventure.api.${method}?${query}`;
	}

	async loadAttendanceReport() {
		this.state.view = "attendance-report";
		this.setCrumb(__("Attendance Dashboard"));
		this.wrapper.find(".ag-nav").removeClass("active");
		// the sidebar carries one Report entry, so it stays lit for every report
		this.wrapper.find("[data-action=open-kpi]").addClass("active");
		this.wrapper.find(".agriventure-app").removeClass("ag-menu-open");

		const dates = this.dateDefaults();
		this.attendanceFilters = this.attendanceFilters || { from: dates.from, to: dates.to, view: "present" };
		const state = this.attendanceFilters;

		const slot = (key, label) => `<div class="ag-filter-field"><span class="ag-filter-label-slot">${this.escape(label)}</span>
			<div class="ag-filter-control"><div class="ag-report-slot" data-slot="${key}"></div></div></div>`;

		const content = this.wrapper.find(".ag-content").html(`<div class="ag-page-head"><h1>${__("Attendance Dashboard")}</h1><button type="button" class="ag-button ag-button-light ag-rep-back">${this.icon("left", "xs")} ${__("Back to Report")}</button></div>
			<div class="ag-filter-toolbar" style="--ag-filter-cols:6">
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("From")}</span>
					<div class="ag-filter-control"><input class="ag-rep-from ag-filter-date-input" type="date" value="${this.escape(state.from)}"></div></div>
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("To")}</span>
					<div class="ag-filter-control"><input class="ag-rep-to ag-filter-date-input" type="date" value="${this.escape(state.to)}"></div></div>
				${slot("location", __("Centre / Location"))}
				${slot("worker", __("Worker"))}
				${slot("leave", __("Leave Type"))}
				<div class="ag-filter-field"><span class="ag-filter-label-slot" aria-hidden="true">&nbsp;</span>
					<div class="ag-filter-control"><button class="ag-button ag-button-light ag-rep-clear" type="button">${this.icon("close", "xs")} ${__("Clear")}</button></div></div>
			</div>
			<div class="ag-filter-feedback" aria-live="polite"><span class="ag-filter-error" role="alert"></span></div>
			<div class="ag-report-body"><div class="ag-loading-panel">${__("Loading report...")}</div></div>`);

		// the same searchable controls the list toolbar uses, including the class that hides
		// Frappe's own label - ours already sits above the box
		const control = (key, df) => {
			const holder = content.find(`[data-slot="${key}"]`).addClass("ag-list-filter");
			const made = frappe.ui.form.make_control({ parent: holder, df, render_input: true });
			made.set_value(state[key] || "");
			made.refresh();
            made.$input?.attr({ placeholder: df.placeholder || "", autocomplete: "off" });
			this.bindComboSearch(made, df.label);
			made.$input.on("change awesomplete-selectcomplete", () => {
				state[key] = made.get_value();
				state.page = 1;
				this.renderAttendanceReport();
			});
			return made;
		};
		control("location", { fieldtype: "Link", options: "Centre and Location Details", label: __("Centre / Location"), placeholder: __("All Locations") });
		control("worker", { fieldtype: "Link", options: "Labour Information", label: __("Worker"), placeholder: __("All Workers") });
		// the doctype's own Leave values, not the reference app's Half Day / Full Day
		control("leave", { fieldtype: "Select", options: "\nNo Leave\nFirst Half\nSecond Half", label: __("Leave Type") });

		content.off(".agrep");
		content.on("change.agrep", ".ag-rep-from,.ag-rep-to", () => {
			state.from = content.find(".ag-rep-from").val();
			state.to = content.find(".ag-rep-to").val();
			state.page = 1;
			this.renderAttendanceReport();
		});
		content.on("click.agrep", ".ag-rep-view", (event) => {
			state.view = $(event.currentTarget).data("view");
			state.page = 1;
			this.renderAttendanceReport();
		});
		content.on("click.agrep", ".ag-rep-export", (event) => this.exportAttendanceReport($(event.currentTarget).data("format")));
		this.bindReportPager(content, state, () => this.renderAttendanceReport());
		content.on("click.agrep", ".ag-rep-clear", () => {
			const fresh = this.dateDefaults();
			this.attendanceFilters = { from: fresh.from, to: fresh.to, view: state.view };
			this.loadAttendanceReport();
		});

		this.renderAttendanceReport();
	}

	attendanceArgs() {
		const state = this.attendanceFilters || {};
		return {
			from_date: state.from,
			to_date: state.to,
			location: state.location || "",
			worker: state.worker || "",
			leave_type: state.leave || "",
			view: state.view || "present",
		};
	}

	async renderAttendanceReport() {
		const content = this.wrapper.find(".ag-content");
		const state = this.attendanceFilters;
		const body = content.find(".ag-report-body");

		if (!this.checkReportDates(state, content)) return;

		let data;
		try {
			data = await this.api.attendanceReport(this.attendanceArgs());
		} catch (error) {
			body.html(this.errorMarkup(error));
			return;
		}

		this.reportCurrency = data.currency;
		const number = (value) => this.reportNumber(value);
		const money = (value) => this.reportMoney(value);
		const s = data.summary;
		const page = this.reportPage(data.rows, state);

		const cards = [
			[s.total_workers, __("Total Workers")],
			[number(s.total_present), __("Total Present Days")],
			[number(s.total_absent), __("Total Leave / Absent Days")],
			[money(s.total_amount), __("Total Amount")],
		].map(([value, label]) => `<div class="ag-rep-card"><b>${value}</b><span>${label}</span></div>`).join("");

		const head = data.columns.map((column) => `<th class="ag-align-${column.align}">${this.escape(column.label)}</th>`).join("");
		const rows = page.rows.map((row, index) => `<tr><td>${page.start + index + 1}</td>${data.columns
			.map((column) => {
				const raw = row[column.key];
				const text = ["daily_wages", "amount"].includes(column.key) ? money(raw)
					: ["present", "absent"].includes(column.key) ? number(raw)
					: this.escape(String(raw ?? ""));
				return `<td class="ag-align-${column.align}">${text}</td>`;
			}).join("")}</tr>`).join("");

		// summed over every row the current view shows, not just the page on screen
		const columnTotal = (key) => (data.rows || []).reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
		const footCells = data.columns.map((column, index) => {
			if (["daily_wages", "amount"].includes(column.key)) {
				return `<td class="ag-align-${column.align}">${money(columnTotal(column.key))}</td>`;
			}
			return `<td class="ag-align-${column.align}">${index ? "" : __("Total")}</td>`;
		}).join("");
		const foot = `<tfoot><tr class="ag-rep-total"><td></td>${footCells}</tr></tfoot>`;

		body.html(`<div class="ag-rep-cards">${cards}</div>
			<div class="ag-rep-chart-card"><div class="ag-rep-chart" data-chart="daily"></div>
				<div class="ag-rep-chart-title">${__("Daily Attendance Trend")}</div></div>
			<div class="ag-rep-chart-card"><div class="ag-rep-chart" data-chart="location"></div>
				<div class="ag-rep-chart-title">${__("Location wise Attendance")}</div></div>
			<div class="ag-rep-actions">
				<button type="button" class="ag-button ${state.view === "present" ? "ag-button-primary" : "ag-button-light"} ag-rep-view" data-view="present">${__("Employees Attendance")}</button>
				<button type="button" class="ag-button ${state.view === "absent" ? "ag-button-primary" : "ag-button-light"} ag-rep-view" data-view="absent">${__("Absentees")}</button>
				<button type="button" class="ag-button ag-button-light ag-rep-export" data-format="xlsx">${this.icon("small-file", "xs")} ${__("Excel")}</button>
				<button type="button" class="ag-button ag-button-light ag-rep-export" data-format="pdf">${this.icon("printer", "xs")} ${__("PDF")}</button>
			</div>
			${data.rows.length
				? `<div class="ag-rep-table"><table><thead><tr><th>#</th>${head}</tr></thead><tbody>${rows}</tbody>${foot}</table></div>
					${this.reportPagerMarkup(page, state)}`
				: this.reportEmptyMarkup(state)}`);

		this.drawAttendanceCharts(body, data);
	}

	reportEmptyMarkup(state) {
		// naming the filters that are on turns a blank table from "broken" into "too narrow"
		const active = [
			state.location ? `${__("Centre / Location")}: ${this.escape(state.location)}` : "",
			state.worker ? `${__("Worker")}: ${this.escape(state.worker)}` : "",
			state.leave ? `${__("Leave Type")}: ${this.escape(state.leave)}` : "",
		].filter(Boolean);

		const headline = state.view === "absent" ? __("No absent or leave records here.") : __("No attendance records here.");
		if (!active.length) {
			return `<div class="ag-rep-empty"><b>${headline}</b>
				<span>${__("Nothing was logged between {0} and {1}.", [state.from, state.to])}</span></div>`;
		}
		return `<div class="ag-rep-empty"><b>${headline}</b>
			<span>${__("Between {0} and {1}, with", [state.from, state.to])} ${active.join(" &middot; ")}.</span>
			<button type="button" class="ag-button ag-button-light ag-rep-clear">${this.icon("close", "xs")} ${__("Clear filters")}</button></div>`;
	}

	drawAttendanceCharts(body, data) {
		if (typeof frappe.Chart !== "function") return;
		const paint = (selector, labels, values, kind) => {
			const holder = body.find(selector);
			if (!holder.length || !labels.length) return;
			const colour = kind === "bar" ? CHART_BAR_COLOR : CHART_LINE_COLOR;
			new frappe.Chart(holder[0], {
				data: { labels, datasets: [{ name: __("Present"), values }] },
				type: kind,
				height: window.innerWidth < 768 ? 220 : 260,
				// frappe-charts colours a bar chart point by point, so one colour per label,
				// otherwise it falls back to its own palette from the second bar onwards
				colors: labels.map(() => colour),
				axisOptions: { xAxisMode: "tick", yAxisMode: "span" },
			});
		};
		const days = Object.keys(data.daily_trend);
		// past a fortnight the dates stop fitting, so they become day numbers
		const dayLabels = days.length > 15 ? days.map((_, index) => String(index + 1)) : days.map((day) => day.slice(8) + "-" + day.slice(5, 7));
		paint('[data-chart="daily"]', dayLabels, days.map((day) => data.daily_trend[day]), "line");
		const places = Object.keys(data.location_wise);
		paint('[data-chart="location"]', places, places.map((place) => data.location_wise[place]), "bar");
	}

	exportAttendanceReport(format) {
		// built server side, so the spreadsheet and the PDF carry exactly the table above -
		// every row of it, not only the page on screen
		const method = format === "pdf" ? "attendance_report_pdf" : "attendance_report_xlsx";
		window.open(this.reportExportUrl(method, this.attendanceArgs()), "_blank");
	}

	async loadSalesReport() {
		this.state.view = "sales-report";
		this.setCrumb(__("Sales Dashboard"));
		this.wrapper.find(".ag-nav").removeClass("active");
		// the sidebar carries one Report entry, so it stays lit for every report
		this.wrapper.find("[data-action=open-kpi]").addClass("active");
		this.wrapper.find(".agriventure-app").removeClass("ag-menu-open");

		const dates = this.dateDefaults();
		this.salesFilters = this.salesFilters || { from: dates.from, to: dates.to, mode: "invoice", items: [], columnSearch: {} };
		const state = this.salesFilters;

		const content = this.wrapper.find(".ag-content").html(`<div class="ag-page-head"><h1>${__("Sales Dashboard")}</h1><button type="button" class="ag-button ag-button-light ag-rep-back">${this.icon("left", "xs")} ${__("Back to Report")}</button></div>
			<div class="ag-filter-toolbar" style="--ag-filter-cols:6">
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("From Date")}</span>
					<div class="ag-filter-control"><input class="ag-rep-from ag-filter-date-input" type="date" value="${this.escape(state.from)}"></div></div>
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("To Date")}</span>
					<div class="ag-filter-control"><input class="ag-rep-to ag-filter-date-input" type="date" value="${this.escape(state.to)}"></div></div>
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("Source Warehouse")}</span>
					<div class="ag-filter-control"><div class="ag-report-slot" data-slot="warehouse"></div></div></div>
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("Item")}</span>
					<div class="ag-filter-control"><div class="ag-report-slot" data-slot="items"></div></div></div>
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("Status")}</span>
					<div class="ag-filter-control"><div class="ag-report-slot" data-slot="status"></div></div></div>
				<div class="ag-filter-field ag-sales-customer"><span class="ag-filter-label-slot">${__("Customer")}</span>
					<div class="ag-filter-control"><div class="ag-report-slot" data-slot="customer"></div></div></div>
			</div>
			<div class="ag-filter-feedback" aria-live="polite"><span class="ag-filter-error" role="alert"></span></div>
			<div class="ag-rep-modes">
				<button type="button" class="ag-button ag-rep-mode" data-mode="invoice">${__("Invoice-wise Sales")}</button>
				<button type="button" class="ag-button ag-rep-mode" data-mode="customer">${__("Customer-wise Sales")}</button>
				<span class="ag-rep-mode-spacer"></span>
				<button type="button" class="ag-button ag-button-light ag-rep-export" data-format="xlsx">${this.icon("small-file", "xs")} ${__("Export Excel")}</button>
				<button type="button" class="ag-button ag-button-light ag-rep-export" data-format="pdf">${this.icon("printer", "xs")} ${__("Export PDF")}</button>
			</div>
			<div class="ag-report-body"><div class="ag-loading-panel">${__("Loading report...")}</div></div>`);

		const link = (key, df, label) => {
			const holder = content.find(`[data-slot="${key}"]`).addClass("ag-list-filter");
			const made = frappe.ui.form.make_control({ parent: holder, df, render_input: true });
			made.set_value(state[key] || "");
			made.refresh();
			made.$input?.attr({ placeholder: df.placeholder || "", autocomplete: "off" });
			if (df.fieldtype === "Link") this.bindComboSearch(made, label);
			made.$input.on("change awesomplete-selectcomplete", () => {
				state[key] = made.get_value();
				state.page = 1;
				this.renderSalesReport();
			});
			return made;
		};
		link("warehouse", { fieldtype: "Link", options: "Warehouse", label: __("Source Warehouse"), placeholder: __("All Warehouses") }, __("Source Warehouse"));
		link("status", { fieldtype: "Select", options: "\nPaid\nUnpaid", label: __("Status") }, __("Status"));
		link("customer", { fieldtype: "Link", options: "Customer", label: __("Customer"), placeholder: __("All Customers") }, __("Customer"));

		const itemHolder = content.find('[data-slot="items"]').addClass("ag-list-filter");
		this.salesItemControl = frappe.ui.form.make_control({
			parent: itemHolder,
			df: {
				fieldtype: "MultiSelectList",
				label: __("Item"),
				placeholder: __("Select Item"),
				get_data: (txt) => frappe.db.get_link_options("Item", txt, { disabled: 0 }),
			},
			render_input: true,
		});
		this.salesItemControl.set_value(state.items || []);
		this.salesItemControl.refresh();
		this.salesItemControl.$input?.on("change awesomplete-selectcomplete", () => {
			state.items = this.salesItemControl.get_value() || [];
			state.page = 1;
			this.renderSalesReport();
		});

		content.off(".agsales");
		content.on("change.agsales", ".ag-rep-from,.ag-rep-to", () => {
			state.from = content.find(".ag-rep-from").val();
			state.to = content.find(".ag-rep-to").val();
			state.page = 1;
			this.renderSalesReport();
		});
		content.on("click.agsales", ".ag-rep-mode", (event) => {
			state.mode = $(event.currentTarget).data("mode");
			state.page = 1;
			state.columnSearch = {};
			this.renderSalesReport();
		});
		content.on("click.agsales", ".ag-rep-export", (event) => {
			const format = $(event.currentTarget).data("format");
			window.open(this.reportExportUrl(format === "pdf" ? "sales_report_pdf" : "sales_report_xlsx", this.salesArgs()), "_blank");
		});
		content.on("input.agsales", ".ag-col-search", frappe.utils.debounce((event) => {
			state.columnSearch[$(event.target).data("col")] = String(event.target.value || "").toLowerCase().trim();
			state.page = 1;
			this.renderSalesReport();
		}, 220));
		this.bindReportPager(content, state, () => this.renderSalesReport());

		this.renderSalesReport();
	}

	salesArgs() {
		const state = this.salesFilters || {};
		return {
			from_date: state.from,
			to_date: state.to,
			view: state.mode || "invoice",
			customer: state.mode === "customer" ? state.customer || "" : "",
			warehouse: state.warehouse || "",
			status: state.status || "",
			items: JSON.stringify(state.items || []),
		};
	}

	async renderSalesReport() {
		const content = this.wrapper.find(".ag-content");
		const state = this.salesFilters;
		const body = content.find(".ag-report-body");

		content.find(".ag-rep-mode").each((_, node) => {
			const active = $(node).data("mode") === state.mode;
			$(node).toggleClass("ag-button-primary", active).toggleClass("ag-button-light", !active);
		});
		// the Customer filter only means something on the customer-wise view
		content.find(".ag-sales-customer").toggle(state.mode === "customer");

		if (!this.checkReportDates(state, content)) return;

		let data;
		try {
			data = await this.api.salesReport(this.salesArgs());
		} catch (error) {
			body.html(this.errorMarkup(error));
			return;
		}
		this.reportCurrency = data.currency;

		const searches = state.columnSearch || {};
		const filtered = data.rows.filter((row) => data.columns.every((column) => {
			const needle = searches[column.key];
			return !needle || String(row[column.key] ?? "").toLowerCase().includes(needle);
		}));

		const page = this.reportPage(filtered, state);
		const totalAmount = filtered.reduce((sum, row) => sum + Number(row.amount || 0), 0);
		const totalQty = filtered.reduce((sum, row) => sum + Number(row.qty_value || 0), 0);

		const head = data.columns.map((column) => `<th class="ag-align-${column.align}">${this.escape(column.label)}</th>`).join("");
		const searchRow = data.columns.map((column) => `<td><input class="ag-col-search" type="text" data-col="${column.key}"
			value="${this.escape(searches[column.key] || "")}" placeholder="${__("Search")}" aria-label="${this.escape(column.label)}"></td>`).join("");

		const rows = page.rows.map((row, index) => `<tr><td>${page.start + index + 1}</td>${data.columns
			.map((column) => {
				if (column.key === "invoice") {
					return `<td><a class="ag-rep-link" href="/app/sales-invoice/${encodeURIComponent(row.invoice)}" target="_blank" rel="noopener">${this.escape(row.invoice)}</a></td>`;
				}
				if (column.key === "status") return `<td>${this.salesStatusBadge(row.status)}</td>`;
				if (["rate", "amount"].includes(column.key)) return `<td class="ag-align-right">${this.reportMoney(row[column.key])}</td>`;
				return `<td class="ag-align-${column.align}">${this.escape(String(row[column.key] ?? ""))}</td>`;
			}).join("")}</tr>`).join("");

		// Built from the columns themselves rather than a counted colspan: the customer-wise
		// view had one cell too few, which slid the Total and the amount a column to the left.
		const totals = state.mode === "customer"
			? { amount: this.reportMoney(totalAmount) }
			: { qty: this.reportNumber(totalQty), amount: this.reportMoney(totalAmount) };
		const firstTotal = data.columns.findIndex((column) => column.key in totals);
		// the label spans everything up to the first total, the leading # cell included
		const labelSpan = (firstTotal < 0 ? data.columns.length : firstTotal) + 1;
		const footCells = (firstTotal < 0 ? [] : data.columns.slice(firstTotal))
			.map((column) => `<td class="ag-align-${totals[column.key] ? "right" : column.align}">${totals[column.key] || ""}</td>`)
			.join("");
		const footer = `<tr><td colspan="${labelSpan}" class="ag-align-right">${__("Total")}</td>${footCells}</tr>`;

		body.html(filtered.length
			? `<div class="ag-rep-table"><table>
					<thead><tr><th>#</th>${head}</tr>
						<tr class="ag-col-search-row"><td></td>${searchRow}</tr></thead>
					<tbody>${rows}</tbody>
					<tfoot>${footer}</tfoot>
				</table></div>
				${this.reportPagerMarkup(page, state)}`
			: `<div class="ag-rep-empty"><b>${__("No invoices here.")}</b>
					<span>${__("Nothing was invoiced between {0} and {1} for these filters.", [state.from, state.to])}</span></div>`);
	}

	salesStatusBadge(status) {
		const value = String(status || "").trim();
		if (!value) return `<span class="ag-badge ag-badge-grey">&mdash;</span>`;
		// anything still owed reads as unpaid, Overdue included
		const tone = value === "Paid" ? "green" : ["Unpaid", "Overdue", "Partly Paid"].includes(value) ? "red" : "grey";
		return `<span class="ag-badge ag-badge-${tone}">${this.escape(value)}</span>`;
	}

	async loadProductionReport() {
		this.state.view = "production-report";
		this.setCrumb(__("Production Dashboard"));
		this.wrapper.find(".ag-nav").removeClass("active");
		// the sidebar carries one Report entry, so it stays lit for every report
		this.wrapper.find("[data-action=open-kpi]").addClass("active");
		this.wrapper.find(".agriventure-app").removeClass("ag-menu-open");

		const dates = this.dateDefaults();
		this.productionFilters = this.productionFilters || { from: dates.from, to: dates.to, mode: "graph", items: [], columnSearch: {} };
		const state = this.productionFilters;

		const content = this.wrapper.find(".ag-content").html(`<div class="ag-page-head"><h1>${__("Production Dashboard")}</h1><button type="button" class="ag-button ag-button-light ag-rep-back">${this.icon("left", "xs")} ${__("Back to Report")}</button></div>
			<div class="ag-filter-toolbar" style="--ag-filter-cols:4">
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("From Date")}</span>
					<div class="ag-filter-control"><input class="ag-rep-from ag-filter-date-input" type="date" value="${this.escape(state.from)}"></div></div>
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("To Date")}</span>
					<div class="ag-filter-control"><input class="ag-rep-to ag-filter-date-input" type="date" value="${this.escape(state.to)}"></div></div>
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("Location")}</span>
					<div class="ag-filter-control"><div class="ag-report-slot" data-slot="location"></div></div></div>
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("Item")}</span>
					<div class="ag-filter-control"><div class="ag-report-slot" data-slot="items"></div></div></div>
			</div>
			<div class="ag-filter-feedback" aria-live="polite"><span class="ag-filter-error" role="alert"></span></div>
			<div class="ag-rep-modes">
				<button type="button" class="ag-button ag-rep-mode" data-mode="graph">${__("Graph View")}</button>
				<button type="button" class="ag-button ag-rep-mode" data-mode="table">${__("Table View")}</button>
				<span class="ag-rep-mode-spacer"></span>
				<button type="button" class="ag-button ag-button-light ag-rep-export" data-format="xlsx">${this.icon("small-file", "xs")} ${__("Export Excel")}</button>
				<button type="button" class="ag-button ag-button-light ag-rep-export" data-format="pdf">${this.icon("printer", "xs")} ${__("Export PDF")}</button>
			</div>
			<div class="ag-report-body"><div class="ag-loading-panel">${__("Loading report...")}</div></div>`);

		const locationHolder = content.find('[data-slot="location"]').addClass("ag-list-filter");
		const location = frappe.ui.form.make_control({
			parent: locationHolder,
			df: { fieldtype: "Link", options: "Centre and Location Details", label: __("Location"), placeholder: __("All Locations") },
			render_input: true,
		});
		location.set_value(state.location || "");
		location.refresh();
		location.$input?.attr({ placeholder: __("All Locations"), autocomplete: "off" });
		this.bindComboSearch(location, __("Location"));
		location.$input.on("change awesomplete-selectcomplete", () => {
			state.location = location.get_value();
			state.page = 1;
			this.renderProductionReport();
		});

		// Frappe's own searchable multi-select, rather than a hand-rolled dropdown
		const itemHolder = content.find('[data-slot="items"]').addClass("ag-list-filter");
		this.productionItemControl = frappe.ui.form.make_control({
			parent: itemHolder,
			df: {
				fieldtype: "MultiSelectList",
				label: __("Item"),
				placeholder: __("Select Item"),
				// searched against the Item master, the same way the Location filter offers
				// every centre - an item that was never harvested simply returns no rows
				get_data: (txt) => frappe.db.get_link_options("Item", txt, { disabled: 0 }),
			},
			render_input: true,
		});
		this.productionItemControl.set_value(state.items || []);
		this.productionItemControl.refresh();
		this.productionItemControl.$input?.on("change awesomplete-selectcomplete", () => {
			state.items = this.productionItemControl.get_value() || [];
			state.page = 1;
			this.renderProductionReport();
		});

		content.off(".agprod");
		content.on("change.agprod", ".ag-rep-from,.ag-rep-to", () => {
			state.from = content.find(".ag-rep-from").val();
			state.to = content.find(".ag-rep-to").val();
			state.page = 1;
			this.renderProductionReport();
		});
		content.on("click.agprod", ".ag-rep-mode", (event) => {
			state.mode = $(event.currentTarget).data("mode");
			this.renderProductionReport();
		});
		content.on("click.agprod", ".ag-rep-export", (event) => {
			const format = $(event.currentTarget).data("format");
			window.open(this.reportExportUrl(format === "pdf" ? "production_report_pdf" : "production_report_xlsx", this.productionArgs()), "_blank");
		});
		// a search box under each column header, narrowing what is already loaded
		content.on("input.agprod", ".ag-col-search", frappe.utils.debounce((event) => {
			state.columnSearch[$(event.target).data("col")] = String(event.target.value || "").toLowerCase().trim();
			state.page = 1;
			this.renderProductionReport();
		}, 220));
		content.on("click.agprod", ".ag-se-jump", (event) => this.openPortalDoc("stock-entry", $(event.currentTarget).data("name")));
		this.bindReportPager(content, state, () => this.renderProductionReport());

		this.renderProductionReport();
	}

	productionArgs() {
		const state = this.productionFilters || {};
		return {
			from_date: state.from,
			to_date: state.to,
			location: state.location || "",
			items: (state.items || []).join(","),
		};
	}

	async renderProductionReport() {
		const content = this.wrapper.find(".ag-content");
		const state = this.productionFilters;
		const body = content.find(".ag-report-body");

		content.find(".ag-rep-mode").each((_, node) => {
			const active = $(node).data("mode") === state.mode;
			$(node).toggleClass("ag-button-primary", active).toggleClass("ag-button-light", !active);
		});

		if (!this.checkReportDates(state, content)) return;

		let data;
		try {
			data = await this.api.productionReport(this.productionArgs());
		} catch (error) {
			body.html(this.errorMarkup(error));
			return;
		}

		if (state.mode === "graph") {
			body.html(`<div class="ag-rep-chart-card"><div class="ag-rep-chart" data-chart="production"></div>
				<div class="ag-rep-chart-title">${__("Daily Production Quantity")}</div></div>`);
			this.drawProductionChart(body, data);
			return;
		}

		// column search runs over the loaded rows, exactly what the table shows
		const searches = state.columnSearch || {};
		const filtered = data.rows.filter((row) => data.columns.every((column) => {
			const needle = searches[column.key];
			return !needle || String(row[column.key] ?? "").toLowerCase().includes(needle);
		}));

		const page = this.reportPage(filtered, state);
		const total = filtered.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

		const head = data.columns.map((column) => `<th class="ag-align-${column.align}">${this.escape(column.label)}</th>`).join("");
		const searchRow = data.columns.map((column) => `<td><input class="ag-col-search" type="text" data-col="${column.key}"
			value="${this.escape(searches[column.key] || "")}" aria-label="${this.escape(column.label)}"></td>`).join("");
		const rows = page.rows.map((row, index) => `<tr><td>${page.start + index + 1}</td>${data.columns
			.map((column) => {
				if (column.key === "stock_entry" && row.stock_entry) {
					return `<td><button type="button" class="ag-se-jump" data-name="${this.escape(row.stock_entry)}">${this.escape(row.stock_entry)}</button></td>`;
				}
				const text = column.key === "quantity" ? this.reportNumber(row[column.key]) : this.escape(String(row[column.key] ?? ""));
				return `<td class="ag-align-${column.align}">${text}</td>`;
			}).join("")}</tr>`).join("");

		body.html(filtered.length
			? `<div class="ag-rep-table"><table>
					<thead><tr><th>#</th>${head}</tr>
						<tr class="ag-col-search-row"><td></td>${searchRow}</tr></thead>
					<tbody>${rows}</tbody>
					<tfoot><tr><td colspan="6" class="ag-align-right">${__("Total Quantity")}</td>
						<td class="ag-align-right">${this.reportNumber(total)}</td><td></td></tr></tfoot>
				</table></div>
				${this.reportPagerMarkup(page, state)}`
			: `<div class="ag-rep-empty"><b>${__("No production records here.")}</b>
					<span>${__("Nothing was harvested between {0} and {1} for these filters.", [state.from, state.to])}</span></div>`);
	}

	drawProductionChart(body, data) {
		if (typeof frappe.Chart !== "function") return;
		const holder = body.find('[data-chart="production"]');
		if (!holder.length || !(data.graph || []).length) {
			holder.html(`<p class="ag-rep-nochart">${__("No graph data for these filters.")}</p>`);
			return;
		}

		// one line per item, quantities added up per day
		const labels = [];
		const byItem = {};
		for (const row of data.graph) {
			if (!labels.includes(row.date)) labels.push(row.date);
			byItem[row.item] = byItem[row.item] || {};
			byItem[row.item][row.date] = (byItem[row.item][row.date] || 0) + Number(row.value || 0);
		}
		labels.sort();

		const datasets = Object.keys(byItem).sort().map((item) => ({
			name: item,
			values: labels.map((date) => parseFloat((byItem[item][date] || 0).toFixed(2))),
		}));

		new frappe.Chart(holder[0], {
			type: "line",
			data: { labels: labels.map((date) => date.slice(8) + "-" + date.slice(5, 7)), datasets },
			height: window.innerWidth < 768 ? 260 : 380,
			lineOptions: { regionFill: 0, dotSize: 5, hideDots: 0 },
			axisOptions: { xAxisMode: "tick", yAxisMode: "span" },
			tooltipOptions: { formatTooltipY: (value) => `${value}` },
		});
	}

	async loadKpiDashboard(date = null) {
		this.state.view = "kpi";
		this.kpiDate = date || this.kpiDate || frappe.datetime.get_today();
		this.setCrumb(__("Report"));
		this.wrapper.find(".ag-nav").removeClass("active");
		this.wrapper.find("[data-action=open-kpi]").addClass("active");
		this.wrapper.find(".agriventure-app").removeClass("ag-menu-open");

		const content = this.wrapper.find(".ag-content").html(`<div class="ag-page-head">
				<h1>${__("Report")}</h1>
				<div class="ag-kpi-date"><span>${__("As on")}</span><input type="date" class="ag-kpi-day" value="${this.escape(this.kpiDate)}"></div>
			</div>
			<div class="ag-kpi-body"><div class="ag-loading-panel">${__("Loading figures...")}</div></div>`);

		content.off(".agkpi");
		content.on("change.agkpi input.agkpi", ".ag-kpi-day", (event) => this.loadKpiDashboard(event.target.value));
		content.on("click.agkpi", ".ag-kpi-tile", (event) => {
			const tile = $(event.currentTarget);
			const report = tile.data("report");
			if (report) return this[REPORT_VIEWS[report]]();
			this.state.kind = tile.data("kind");
			this.state.start = 0;
			this.loadList();
		});

		let data;
		try {
			data = await this.api.kpi(this.kpiDate);
		} catch (error) {
			content.find(".ag-kpi-body").html(this.errorMarkup(error));
			return;
		}

		const money = (value) => frappe.format(value, { fieldtype: "Currency", options: data.currency });
		const cards = (data.cards || []).map((card) => `<section class="ag-kpi-card ag-kpi-${this.escape(card.tone || "green")}">
			<span class="ag-kpi-label">${this.escape(card.label)}</span>
			<b class="ag-kpi-value">${card.money ? money(card.value) : this.escape(String(card.value))}${card.suffix || ""}</b>
			${card.note ? `<small>${this.escape(card.note)}</small>` : ""}
		</section>`).join("");

		const tiles = KPI_SHORTCUTS
			.filter((tile) => (tile.report ? REPORT_VIEWS[tile.report] : this.config[tile.kind]))
			.map((tile) => `<button type="button" class="ag-kpi-tile" ${tile.report ? `data-report="${tile.report}"` : `data-kind="${tile.kind}"`}>
				<span class="ag-kpi-tile-icon">${this.icon(tile.icon, "sm")}</span>
				<span>${this.escape(tile.label)}</span>
			</button>`).join("");

		content.find(".ag-kpi-body").html(`<div class="ag-kpi-grid">${cards}</div>
			<h2 class="ag-kpi-heading">${__("Quick Dashboards")}</h2>
			<div class="ag-kpi-tiles">${tiles}</div>`);
	}

	async openPointOfSale() {
		// The till itself is ERPNext's own desk page. This is the landing in between: it
		// gets its own view so the dialog never opens on top of whatever form was there.
		this.setActive("pos");
		this.setCrumb(__("Point of Sale"));
		this.wrapper.find(".ag-nav").removeClass("active");
		this.wrapper.find("[data-action=open-pos]").addClass("active");

		const content = this.wrapper.find(".ag-content").html(`<div class="ag-pos-landing">
			<div class="ag-pos-card">
				<span class="ag-pos-icon">${this.icon("retail", "lg")}</span>
				<h1>${__("Point of Sale")}</h1>
				<p>${__("A shift has to be open before the till can be used.")}</p>
				<button type="button" class="ag-button ag-button-primary ag-pos-start">${__("Open Shift")}</button>
			</div>
		</div>`);
		content.off(".agpos").on("click.agpos", ".ag-pos-start", () => this.startPosShift());

		this.startPosShift();
	}

	async startPosShift() {
		let open = [];
		try {
			open = (await frappe.call({
				method: `${POS_PAGE_METHOD}.check_opening_entry`,
				args: { user: frappe.session.user },
			})).message || [];
		} catch (error) {
			frappe.msgprint({ title: __("Point of Sale"), message: this.message(error), indicator: "red" });
			return;
		}
		this.askPosOpeningEntry(open);
	}

	askPosOpeningEntry(open = []) {
		const rows = [
			{ fieldname: "mode_of_payment", fieldtype: "Link", options: "Mode of Payment", label: __("Mode of Payment"), in_list_view: 1, reqd: 1 },
			{ fieldname: "opening_amount", fieldtype: "Currency", label: __("Opening Amount"), options: "company:company_currency", in_list_view: 1,
				onchange() {
					// the grid keeps its own copy of the row, so write the edit back into it
					(dialog.fields_dict.balance_details.df.data || []).some((row) => {
						if (row.idx !== this.doc.idx) return false;
						row.opening_amount = this.value;
						dialog.fields_dict.balance_details.grid.refresh();
						return true;
					});
				},
			},
		];

		// one row per payment method the chosen profile allows
		const loadPaymentMethods = () => {
			const profile = dialog.fields_dict.pos_profile.get_value();
			if (!profile) return;
			frappe.db.get_doc("POS Profile", profile).then(({ payments }) => {
				dialog.fields_dict.balance_details.df.data = (payments || []).map(({ mode_of_payment }) => ({
					mode_of_payment,
					opening_amount: "0",
				}));
				dialog.fields_dict.balance_details.grid.refresh();
			});
		};

		const dialog = new frappe.ui.Dialog({
			title: __("Create POS Opening Entry"),
			fields: [
				...(open.length
					? [{
						fieldtype: "HTML",
						fieldname: "already_open",
						options: `<div class="ag-pos-open-note"><b>${__("Already open")}</b><ul>${open
							.map((entry) => `<li>${frappe.utils.escape_html(entry.name)} &middot; ${frappe.utils.escape_html(entry.pos_profile || "")}</li>`)
							.join("")}</ul><span>${__("Continue one of these, or declare a new shift below.")}</span></div>`,
					}]
					: []),
				{ fieldtype: "Link", fieldname: "company", label: __("Company"), options: "Company", reqd: 1,
					default: frappe.defaults.get_default("company") },
				{ fieldtype: "Link", fieldname: "pos_profile", label: __("POS Profile"), options: "POS Profile", reqd: 1,
					get_query: () => ({ query: POS_PROFILE_QUERY, filters: { company: dialog.fields_dict.company.get_value() } }),
					onchange: () => loadPaymentMethods() },
				{ fieldname: "balance_details", fieldtype: "Table", label: __("Opening Balance Details"),
					cannot_add_rows: false, in_place_edit: true, reqd: 1, data: [], fields: rows },
			],
			primary_action_label: __("Submit"),
			secondary_action_label: open.length ? __("Continue Open Shift") : null,
			secondary_action: open.length
				? () => {
					dialog.hide();
					frappe.set_route("point-of-sale");
				}
				: null,
			async primary_action({ company, pos_profile, balance_details }) {
				const filled = (balance_details || []).filter((row) => row.mode_of_payment);
				if (!filled.length) {
					frappe.show_alert({ message: __("Please add Mode of payments and opening balance details."), indicator: "red" });
					return;
				}
				try {
					await frappe.call({
						method: `${POS_PAGE_METHOD}.create_opening_voucher`,
						args: { pos_profile, company, balance_details: filled },
						freeze: true,
					});
				} catch (error) {
					return;
				}
				dialog.hide();
				frappe.set_route("point-of-sale");
			},
		});
		dialog.show();
	}

	promptNamed() {
		// "Prompt" naming means the user types the document's name, the way the desk form
		// puts a Name box at the top of a POS Profile
		const meta = frappe.get_meta(this.formMeta?.doctype);
		return meta?.autoname === "Prompt" || meta?.naming_rule === "Set by user";
	}

	withPromptName(fields) {
		if (!this.promptNamed()) return fields;
		const BREAKS = ["Section Break", "Column Break", "Tab Break", "HTML", "Button", "Fold"];
		const at = fields.findIndex((field) => !BREAKS.includes(field.fieldtype));
		const nameField = {
			fieldname: "__newname",
			label: __("Name"),
			fieldtype: "Data",
			reqd: 1,
			read_only: this.formDoc.name ? 1 : 0,
		};
		// alongside Company and Warehouse, not in a card of its own
		return at < 0 ? [...fields, nameField] : [...fields.slice(0, at), nameField, ...fields.slice(at)];
	}

	buildMetadataForm(content) {
		// nothing the form sets while painting itself counts as an edit
		this.formReady = false;
		if (this.state.kind === "material-request") {
			this.buildMaterialRequestForm(content);
			return;
		}
		const tabList = content.find(".ag-tab-list");
		const panels = content.find(".ag-tab-panels");
		let tabIndex = 0;
		let sectionIndex = 0;
		let currentPanel;
		let currentGrid;
		let currentSection = null;
		let currentCollapsible = false;
		let currentColumn = null;
		let pendingColumns = 0;
		// each Column Break in the metadata becomes a real column, so fields stack the way the DocType lays them out
		const addColumn = () => {
			if (!currentGrid) return;
			currentColumn = $('<div class="ag-form-col"></div>').appendTo(currentGrid);
			currentGrid.css("--ag-cols", Math.min(currentGrid.children(".ag-form-col").length, 4));
		};
		const createTab = (label) => {
			const id = `ag-tab-${tabIndex++}`;
			tabList.append(`<button type="button" class="ag-tab-button ${tabIndex === 1 ? "active" : ""}" data-tab="${id}">${this.escape(label || "Details")}</button>`);
			currentPanel = $(`<div class="ag-tab-panel ${tabIndex === 1 ? "active" : ""}" data-panel="${id}"></div>`).appendTo(panels);
			currentGrid = null;
			currentSection = null;
			currentCollapsible = false;
			currentColumn = null;
			pendingColumns = 0;
			sectionIndex = 0; // every tab numbers its own sections from 01
			if (tabIndex === 1 && this.state.kind === "purchase-order") currentPanel.append(this.purchaseOrderLinks());
		};
		const createSection = (label, collapsible = false, dependsOn = null) => {
			if (!currentPanel) createTab("Details");
			const title = String(label || "").trim();
			// an unlabelled section break is just a divider, so it stays inside the card it lands in
			if (!title && currentSection && !currentCollapsible) {
				currentGrid = $('<div class="ag-form-grid"></div>').appendTo(currentSection);
				currentColumn = null;
				addColumn();
				return;
			}
			// collapsible comes straight from the DocType metadata, nothing is hard-coded here
			const heading = title ? `<span>${String(++sectionIndex).padStart(2, "0")}</span><h2>${this.escape(title)}</h2>` : "";
			let section;
			if (title && collapsible) section = $(`<section class="ag-form-section ag-collapsible-section"><button type="button" class="ag-collapse-header" aria-expanded="true">${heading}${this.icon("down", "xs")}</button><div class="ag-form-grid ag-collapse-body"></div></section>`);
			else if (title) section = $(`<section class="ag-form-section"><header>${heading}</header><div class="ag-form-grid"></div></section>`);
			else section = $('<section class="ag-form-section"><div class="ag-form-grid"></div></section>');
			section.appendTo(currentPanel);
			// a whole card can be conditional, not just the fields inside it
			if (dependsOn) this.formSectionSlots.push({ dependsOn, section });
			currentSection = section;
			currentCollapsible = Boolean(title && collapsible);
			currentGrid = section.find(".ag-form-grid").last();
			currentColumn = null;
			addColumn();
		};
		const policy = this.formFieldPolicy(this.state.kind);
		// tabs and sections are created only once a field actually lands in them,
		// so a tab whose fields are all filtered out never shows up
		let pendingTab = "Details";
		let pendingSection = null;
		const flushLayout = () => {
			if (pendingTab !== null) { createTab(pendingTab); pendingTab = null; }
			if (pendingSection !== null) { createSection(pendingSection.label, pendingSection.collapsible, pendingSection.dependsOn); pendingSection = null; }
			if (!currentGrid) createSection("");
			while (pendingColumns > 0) { addColumn(); pendingColumns -= 1; }
		};
		for (const field of this.withPromptName(this.formMeta.fields)) {
			if (field.fieldtype === "Tab Break") { pendingTab = field.label || frappe.model.unscrub(field.fieldname); pendingSection = null; pendingColumns = 0; continue; }
			if (field.fieldtype === "Section Break") { pendingSection = { label: field.label, collapsible: field.collapsible, dependsOn: field.depends_on }; pendingColumns = 0; continue; }
			if (field.fieldtype === "Column Break") {
				if (pendingTab === null && pendingSection === null && currentGrid) addColumn();
				else pendingColumns += 1;
				continue;
			}
			if (["HTML", "Button", "Fold"].includes(field.fieldtype)) continue;
			if ((PORTAL_SKIP_FIELDS[this.state.kind] || []).includes(field.fieldname)) continue;
			if (policy && !policy.fields.has(field.fieldname)) continue;
			if (Number(this.formDoc?.docstatus || 0) !== 0
				&& (HIDE_AFTER_SUBMIT[this.state.kind] || []).includes(field.fieldname)) continue;
			const unhidden = Boolean(policy && policy.unhide.has(field.fieldname));
			const forced = (PORTAL_FORCE_VISIBLE[this.state.kind] || []).includes(field.fieldname);
			if (field.hidden && !unhidden && !forced) continue;
			flushLayout();
			// a half table drops into its own column, so the Column Break between the two
			// puts them beside each other rather than stacking them
			const half = (PORTAL_HALF_TABLES[this.state.kind] || []).includes(field.fieldname);
			const wide = !half && (field.fieldtype === "Table" || ["Text", "Small Text", "Long Text", "Text Editor", "Code"].includes(field.fieldtype));
			const holder = $(`<div class="ag-field-slot ${wide ? "ag-field-wide" : ""}${half ? " ag-field-half" : ""}" data-fieldname="${this.escape(field.fieldname)}"></div>`).appendTo(wide ? currentGrid : (currentColumn || currentGrid));
			const width = policy?.fieldWidths?.[field.fieldname];
			if (width) holder.css("max-width", width);
			let df = unhidden || forced ? { ...field, hidden: 0, depends_on: null } : field;
			const extraRule = policy?.extraDependsOn?.[field.fieldname];
			if (extraRule && !df.depends_on) df = { ...df, depends_on: extraRule };
			if (field.fieldtype === "Table") {
				this.renderChildTable(holder, df);
				this.formTableSlots.push({ field, holder });
			} else {
				this.renderControl(holder, df, this.formDoc[field.fieldname]);
			}
		}
		tabList.on("click", ".ag-tab-button", (event) => {
			const tab = $(event.currentTarget).data("tab");
			tabList.find(".ag-tab-button").removeClass("active");
			$(event.currentTarget).addClass("active");
			panels.find(".ag-tab-panel").removeClass("active").filter(`[data-panel="${tab}"]`).addClass("active");
		});
		panels.on("click", ".ag-po-report", () => frappe.set_route("query-report", "Supplier Quotation Comparison"));
		panels.on("click", ".ag-po-open", (event) => this.openReferenceLink($(event.currentTarget).data("link")));
		const taxTemplate = this.formControls.find((entry) => entry.field.fieldname === "taxes_and_charges")?.control;
		// Link control awesomplete-selectcomplete par abhi docname commit nahi karta —
		// us pal get_value() title deta hai ("12% GST") jabki docname "12% GST  - SIT"
		// hota hai, is liye pehli baar template not found aata tha. setTimeout 0 se
		// hum control ke commit hone ke baad value padhte hain.
		taxTemplate?.$input?.on("change.agtaxes awesomplete-selectcomplete.agtaxes", () => {
			window.setTimeout(() => this.applyTaxTemplate(taxTemplate.get_value()), 0);
		});
		this.bindFieldEngine(content);
		this.collapseEmptyColumns(content, policy?.collapseEmptyColumns);
		panels.on("click", ".ag-collapse-header", (event) => {
			const header = $(event.currentTarget);
			const collapsed = header.closest(".ag-collapsible-section").toggleClass("collapsed").hasClass("collapsed");
			header.attr("aria-expanded", String(!collapsed));
		});
		this.removeEmptyTabs(tabList, panels);
	}

	formFieldPolicy(kind) {
		// exactly the fields shown on the approved Purchase Order reference screens;
		// anything the installed metadata does not have is simply skipped
		const policies = {
			// Amended From and Customer Group are dropped: the first is never set here, and
			// the second only applies when the merge was grouped by Customer Group
			"pos-invoice-merge-log": {
				fields: [
					"company", "pos_closing_entry", "posting_date", "customer", "posting_time",
					"merge_invoices_based_on", "customer_group",
					"pos_invoices",
					"consolidated_invoice", "consolidated_credit_note",
				],
				tables: { pos_invoices: ["pos_invoice", "posting_date", "grand_total"] },
			},
			// exactly what the desk form shows for a Material Receipt, nothing else
			"stock-entry": {
				fields: [
					"stock_entry_type", "company", "posting_date", "posting_time",
					"inspection_required", "apply_putaway_rule",
					"items",
					"total_outgoing_value", "total_incoming_value", "value_difference",
				],
				tables: { items: ["s_warehouse", "t_warehouse", "item_code", "qty", "uom", "basic_rate"] },
			},
			"supplier-quotation": {
				fields: [
					// Details - header
					"naming_series", "status", "supplier", "transaction_date", "company", "valid_till",
					"quotation_number",
					// Details - accounting dimensions
					"cost_center", "project",
					// Details - currency
					"currency", "buying_price_list", "ignore_pricing_rule",
					// Details - items and totals
					"items", "total_qty", "total", "total_net_weight", "net_total",
					// Details - taxes. Tax Category, Shipping Rule and Incoterm sit above the
					// template on the desk form; named_place appears only when the Incoterm
					// asks for it, through its own depends_on.
					"tax_category", "shipping_rule", "incoterm", "named_place",
					"taxes_and_charges", "taxes",
					"taxes_and_charges_added", "taxes_and_charges_deducted", "total_taxes_and_charges",
					// Details - discount and totals
					"apply_discount_on", "additional_discount_percentage", "discount_amount",
					"grand_total", "rounding_adjustment", "rounded_total", "disable_rounded_total",
					// Address & Contact - each picker with the text it fetches
					"supplier_address", "address_display",
					"contact_person", "contact_display", "contact_email", "contact_mobile",
					"shipping_address", "shipping_address_display",
					"billing_address", "billing_address_display",
					// Terms
					"tc_name", "terms",
					// More Info
					"letter_head", "group_same_items", "select_print_heading", "language",
					"is_subcontracted", "opportunity",
				],
				// Customize Form hides these on this site; the reference screens show them
				unhide: ["quotation_number", "cost_center", "project", "image"],
				tables: {
					// amount is read-only and worked out by ERPNext from qty x rate, the same
					// recalculation that already fills the totals below
					items: ["item_code", "qty", "uom", "rate", "amount", "image"],
					taxes: ["charge_type", "account_head", "rate", "cost_center", "tax_amount", "total"],
				},
			},
			"purchase-order": {
				fields: [
					// Details
					"naming_series", "transaction_date", "company", "supplier", "schedule_date",
					"apply_tds", "tax_withholding_category", "is_subcontracted",
					"supplier_warehouse",
					"cost_center",
					"currency", "buying_price_list", "ignore_pricing_rule",
					"set_warehouse", "items",
					"custom_po_status", "po_status",
					"total_qty", "total",
					"taxes_and_charges", "taxes", "total_taxes_and_charges",
					"grand_total", "rounding_adjustment", "rounded_total", "disable_rounded_total", "advance_paid",
					"apply_discount_on", "additional_discount_percentage", "discount_amount",
					// Address & Contact
					"supplier_address", "address_display",
					"contact_person", "contact_display", "contact_email", "contact_mobile",
					"dispatch_address", "dispatch_address_display",
					"shipping_address", "shipping_address_display",
					"billing_address", "billing_address_display",
					// Terms
					"payment_terms_template", "payment_schedule", "tc_name", "terms",
					// More Info
					"status", "letter_head", "group_same_items", "select_print_heading", "language",
					"from_date", "to_date", "is_internal_supplier",
				],
				// child table columns, exactly as the reference screens show them
				// shown for reference only - ERPNext fills these, the user never types them
				readOnly: ["last_purchase_rate"],
				tables: {
					items: ["item_code", "schedule_date", "qty", "uom", "last_purchase_rate", "rate", "amount", "description"],
					taxes: ["charge_type", "account_head", "rate", "tax_amount", "total"],
				},
			},
			"purchase-receipt": {
				fields: [
					// Details - header card
					"naming_series", "supplier", "supplier_delivery_note",
					"posting_date", "posting_time", "set_posting_time",
					"company", "apply_putaway_rule", "is_return",
					// Details - items
					"set_warehouse", "items", "narration", "custom_narration",
					"total_qty", "total",
					// Details - taxes
					"taxes_and_charges", "taxes",
					"taxes_and_charges_added", "taxes_and_charges_deducted", "total_taxes_and_charges",
					// Details - totals and discount
					"grand_total", "rounding_adjustment", "rounded_total", "disable_rounded_total",
					"apply_discount_on", "additional_discount_percentage", "discount_amount",
					"supplied_items",
					// Address & Contact
					"supplier_address", "address_display",
					"contact_person", "contact_display", "contact_email", "contact_mobile",
					"dispatch_address", "dispatch_address_display",
					"shipping_address", "shipping_address_display",
					"billing_address", "billing_address_display",
					// Terms
					"tc_name", "terms",
					// More Info
					"status", "letter_head", "group_same_items", "select_print_heading",
					"transporter_name", "lr_no", "lr_date",
					"instructions", "remarks", "is_internal_supplier",
				],
				// these cards lose most of their metadata columns to the field filter above,
				// so the empty ones are dropped and the remaining fields start at the left
				collapseEmptyColumns: ["Items"],
				// a lone control in a collapsed card would otherwise stretch the whole width
				fieldWidths: { set_warehouse: "40%" },
				tables: {
					// ERPNext makes the rejected warehouse mandatory as soon as a row has a
					// rejected quantity, so the column is shown rather than blocking the save
					items: ["item_code", "qty", "rejected_qty", "rate", "amount", "warehouse", "rejected_warehouse"],
					taxes: ["charge_type", "account_head", "rate", "tax_amount", "total", "cost_center"],
					supplied_items: ["main_item_code", "rm_item_code", "required_qty", "consumed_qty", "current_stock"],
				},
			},
			"purchase-invoice": {
				fields: [
					// Details - header card
					"naming_series", "supplier", "company",
					"posting_date", "posting_time", "set_posting_time", "due_date",
					"is_return",
					// Details - Supplier Invoice
					"bill_no", "bill_date",
					// Details - Accounting Dimensions
					"cost_center",
					// Details - Currency and Price List
					"currency", "use_transaction_date_exchange_rate", "buying_price_list", "ignore_pricing_rule",
					// Details - Items
					"update_stock", "is_subcontracted", "items", "total_qty", "total",
					// Details - Taxes and Charges
					"tax_category", "taxes_and_charges", "taxes",
					"taxes_and_charges_added", "taxes_and_charges_deducted", "total_taxes_and_charges",
					// Details - Totals
					"grand_total", "rounding_adjustment", "use_company_roundoff_cost_center",
					"rounded_total", "total_advance", "outstanding_amount",
					// Details - Additional Discount
					"apply_discount_on", "additional_discount_percentage", "discount_amount",
					// Payments
					"allocate_advances_automatically", "only_include_allocated_payments", "advances",
					"write_off_amount",
					// Address & Contact
					"supplier_address", "address_display",
					"contact_person", "contact_display", "contact_email", "contact_mobile",
					"dispatch_address", "dispatch_address_display",
					"shipping_address", "shipping_address_display",
					"billing_address", "billing_address_display",
					// Terms
					"payment_terms_template", "payment_schedule", "tc_name", "terms",
					// More Info
					"status",
					"credit_to", "is_opening", "unrealized_profit_loss_account",
					"subscription", "from_date", "to_date",
					"letter_head", "group_same_items", "select_print_heading",
					"on_hold", "release_date", "hold_comment",
					"is_internal_supplier", "represents_company", "supplier_group",
					"inter_company_invoice_reference", "remarks",
				],
				collapseEmptyColumns: ["Items"],
				tables: {
					items: ["item_code", "qty", "uom", "rate", "amount"],
					taxes: ["charge_type", "account_head", "rate", "cost_center", "tax_amount", "total"],
					advances: ["reference_name", "remarks", "advance_amount", "allocated_amount", "difference_posting_date"],
					payment_schedule: ["payment_term", "description", "due_date", "payment_amount"],
				},
			},
			"payment-entry": {
				fields: [
					// Type of Payment
					"naming_series", "payment_type", "posting_date", "company", "mode_of_payment",
					// Payment From / To
					"party_type", "party", "party_name",
					"bank_account", "party_bank_account", "contact_person",
					// Accounts - each currency and balance reveals itself once its account is picked
					"party_balance",
					"paid_from", "paid_from_account_currency", "paid_from_account_balance",
					"paid_to", "paid_to_account_currency", "paid_to_account_balance",
					// Amount - the exchange rates stay with ERPNext, which derives them on save
					"paid_amount", "received_amount",
					// Taxes and Charges - the template shown follows the party type
					"sales_taxes_and_charges_template", "purchase_taxes_and_charges_template",
					"apply_tax_withholding_amount", "tax_withholding_category", "taxes",
					// Transaction ID
					"reference_no", "reference_date",
					// Accounting Dimensions
					"project", "cost_center",
				],
				// ERPNext only demands these when a bank account is involved; the workspace asks
				// for them on every payment
				required: ["reference_no", "reference_date"],
				// ERPNext keeps this one in its client controller rather than in metadata:
				// hide_unhide_fields() shows Received Amount for an internal transfer, or
				// whenever the two accounts do not share a currency
				extraDependsOn: {
					received_amount: 'eval:doc.payment_type == "Internal Transfer" || doc.paid_from_account_currency != doc.paid_to_account_currency',
				},
				tables: {
					taxes: ["charge_type", "account_head", "rate", "tax_amount", "total"],
				},
			},
		};
		const policy = policies[kind];
		if (!policy) return null;

		// Customize Form / Custom Field se jode gaye fields is whitelist me nahi
		// hote, is liye portal me dikhte hi nahi the. Unhe apne aap jod dete hain —
		// parent form ke fields aur child tables ke columns, dono.
		const fields = new Set(policy.fields);
		(this.formMeta?.fields || []).forEach((df) => {
			if (df.is_custom_field && df.fieldname) fields.add(df.fieldname);
		});

		const tables = { ...(policy.tables || {}) };
		Object.keys(tables).forEach((tableField) => {
			const child = this.formMeta?.child_tables?.[tableField];
			if (!child) return;
			const extras = (child.fields || [])
				.filter((df) => df.is_custom_field && df.fieldname && !df.hidden)
				.map((df) => df.fieldname)
				.filter((fieldname) => !tables[tableField].includes(fieldname));
			if (extras.length) tables[tableField] = [...tables[tableField], ...extras];
		});

		return {
			fields,
			unhide: new Set(policy.unhide || []),
			readOnly: new Set(policy.readOnly || []),
			required: new Set(policy.required || []),
			fieldWidths: policy.fieldWidths || {},
			extraDependsOn: policy.extraDependsOn || {},
			collapseEmptyColumns: policy.collapseEmptyColumns || [],
			tables,
		};
	}

// 	checkDuplicateItem(state, rowContext) {
// 		const control = rowContext.controls.item_code;
// 		const code = control?.get_value();
// 		if (!code) return;
// 		const duplicate = state.rows.some((row) => row !== rowContext && row.controls.item_code?.get_value() === code);
// 		if (duplicate) {
// 			frappe.msgprint(__("Item already selected"));
// 			control.set_value("");
// 		}
// 	}

	cropItemColumn(state) {
		// Harvest calls it Name of Crop, Spraying and Fertigation call it Agri Input, so the
		// column is found by what it links to rather than by name
		if (!CROP_LOG_CONFIG[this.state.kind]) return null;
		return state.columns.find((column) => column.fieldtype === "Link" && column.options === "Item") || null;
	}

	async fillCropUom(rowContext, itemField) {
		// the same fetch the desk forms do: the item's stock UOM lands in the row, and the
		// UOM search is narrowed to what that item is actually measured in
		const code = rowContext.controls[itemField]?.get_value();
		const uom = rowContext.controls.uom;
		if (!code || !uom) return;
		let result;
		try {
			result = (await frappe.call({ method: `${CROP_OPS_METHOD}.get_item_uoms`, args: { item_code: code } })).message || {};
		} catch (error) {
			return;
		}
		if (rowContext.controls[itemField]?.get_value() !== code) return; // the row moved on already
		rowContext.data.item_uoms = result.uoms || [];
		if (!result.stock_uom) return;
		uom.set_value(result.stock_uom);
		rowContext.data.uom = result.stock_uom;
	}

	async fillItemDefaults(rowContext) {
		const code = rowContext.controls.item_code?.get_value();
		if (!code) return;
		// where ERPNext owns the totals its own set_missing_values fills the row, so just ask for a recalculation
		if (CALCULATED_KINDS.includes(this.state.kind)) return this.scheduleRecalculation();
		let values;
		try {
			const response = await frappe.db.get_value("Item", code, ["stock_uom", "item_name"]);
			values = response?.message || {};
		} catch (error) {
			return;
		}
		if (rowContext.controls.item_code?.get_value() !== code) return; // the row moved on already
		if (values.item_name) rowContext.data.item_name = values.item_name;
		if (!values.stock_uom) return;
		rowContext.data.stock_uom = values.stock_uom;
		const uom = rowContext.controls.uom;
		if (uom && !uom.get_value()) uom.set_value(values.stock_uom);
		rowContext.data.uom = rowContext.data.uom || values.stock_uom;
	}

	scheduleRecalculation() {
		if (!CALCULATED_KINDS.includes(this.state.kind)) return;
		if (this.applyingCalculation) return;
		if (!this.queueRecalculation) this.queueRecalculation = frappe.utils.debounce(() => this.runRecalculation(), 350);
		this.queueRecalculation();
	}

	async runRecalculation() {
		if (this.state.view !== "form" || !this.formMeta) return;
		const token = ++this.calculationToken;
		let calculated;
		try {
			calculated = await this.api.recalculate(this.state.kind, this.collectDocument());
		} catch (error) {
			return; // a half-filled row simply waits for the next edit
		}
		if (token !== this.calculationToken) return;
		this.applyCalculated(calculated);
	}

	applyCalculated(calculated) {
		if (!calculated) return;
		const focused = document.activeElement;
		const assign = (control, value) => {
			if (value === undefined || value === null) return;
			if (control.$input && control.$input[0] === focused) return; // never overwrite what is being typed
			if (String(control.get_value() ?? "") === String(value)) return;
			// forced: the row's data is refreshed just above, and without this Frappe would
			// see the value as unchanged and never repaint the input
			control.set_value(value, true);
		};
		this.applyingCalculation = true;
		try {
			for (const { field, control } of this.formControls) assign(control, calculated[field.fieldname]);
			for (const [fieldname, state] of this.tableStates.entries()) {
				const rows = calculated[fieldname] || [];
				state.rows.forEach((rowContext, index) => {
					const source = rows[index];
					if (!source) return;
					rowContext.data = { ...rowContext.data, ...source };
					for (const [name, control] of Object.entries(rowContext.controls)) assign(control, source[name]);
				});
			}
		} finally {
			this.applyingCalculation = false;
		}
	}

	getLiveItemRows() {
		// formDoc.items is only the snapshot from when the page loaded; rows added or
		// edited afterwards live in the grid's own controls until the document is saved
		const state = this.tableStates.get("items");
		if (!state) return this.formDoc.items || [];
		return state.rows.map((row) => {
			const values = { ...row.data };
			for (const [fieldname, control] of Object.entries(row.controls)) values[fieldname] = control.get_value();
			return values;
		});
	}

	purchaseOrderLinks() {
		// the names come from the document's own item rows, never from a placeholder
		const items = this.getLiveItemRows();
		const names = (fieldname) => [...new Set(items.map((row) => row[fieldname]).filter(Boolean))];
		this.referenceLinks = {
			supplier_quotation: names("supplier_quotation"),
			material_request: names("material_request"),
		};
		const chip = (key, label) => {
			const linked = this.referenceLinks[key];
			return `<button type="button" class="ag-po-link ag-po-open" data-link="${key}" ${linked.length ? "" : "disabled"} title="${linked.length ? this.escape(linked.join(", ")) : `No ${label} linked`}"><b>${linked.length}</b> ${label}</button>`;
		};
		// the comparison report only makes sense once there are quotations to compare
		const quotations = this.referenceLinks.supplier_quotation.length;
		return `<div class="ag-po-links">${chip("supplier_quotation", "Supplier Quotation")}${chip("material_request", "Material Request")}<button type="button" class="ag-po-link ag-po-report" ${quotations ? "" : "disabled"} title="${quotations ? "Compare supplier quotations" : "No Supplier Quotation linked"}">Supplier Quotation Comparison Report</button></div>`;
	}

	openReferenceLink(key) {
		// Material Request aur Supplier Quotation dono isi workspace me hain, is liye
		// dono apne hi custom page par khulte hain — standard desk form par nahi.
		// (Pehle Supplier Quotation desk form par bhej diya jaata tha.)
		const KINDS = {
			material_request: "material-request",
			supplier_quotation: "supplier-quotation",
		};
		const linked = (this.referenceLinks || {})[key] || [];
		if (!linked.length) return;
		const kind = KINDS[key] || null;
		if (!kind) {
			// Koi aisa link jiska portal me page nahi — tab hi desk par jao.
			const doctype = frappe.model.unscrub(key);
			if (linked.length === 1) frappe.set_route("Form", doctype, linked[0]);
			else frappe.set_route("List", doctype);
			return;
		}
		this.state.kind = kind;
		this.state.start = 0;
		if (linked.length === 1) return this.openForm(linked[0]);
		frappe.show_alert({
			message: __("{0} linked {1}", [linked.length, frappe.model.unscrub(key)]),
			indicator: "blue",
		});
		return this.loadList();
	}

	applyPostingTimeRule() {
		// mirrors ERPNext's own rule: the posting date and time stay read only until the
		// matching "edit" checkbox is ticked on a draft document. Stock documents use
		// set_posting_time for both; a POS Opening Entry uses set_posting_date for the date.
		const RULES = [
			{ toggle: "set_posting_time", targets: ["posting_date", "posting_time"] },
			{ toggle: "set_posting_date", targets: ["posting_date"] },
		];
		const draft = Number(this.formDoc.docstatus || 0) === 0;

		for (const rule of RULES) {
			const toggle = this.formControls.find((entry) => entry.field.fieldname === rule.toggle);
			if (!toggle) continue;
			const readOnly = draft && cint(toggle.control.get_value()) ? 0 : 1;
			for (const fieldname of rule.targets) {
				const entry = this.formControls.find((item) => item.field.fieldname === fieldname);
				if (!entry || entry.control.df.read_only === readOnly) continue;
				entry.control.df.read_only = readOnly;
				entry.control.refresh();
			}
		}
	}

	collapseEmptyColumns(content, labels) {
		if (!labels || !labels.length) return;
		content.find(".ag-form-section").each((_, node) => {
			const section = $(node);
			const heading = section.children("header, .ag-collapse-header").find("h2").first().text().trim();
			if (!labels.includes(heading)) return;
			section.children(".ag-form-grid").each((_, gridNode) => {
				const grid = $(gridNode);
				grid.children(".ag-form-col").filter((_, column) => !$(column).children().length).remove();
				const remaining = grid.children(".ag-form-col").length;
				if (remaining) grid.css("--ag-cols", Math.min(remaining, 4));
			});
		});
	}

	bindTaxCategory(control, df) {
		// Tax Category is a matching key, not a charge: ERPNext looks a Tax Rule up by
		// party + company + date + category and fills in the template. The three guards and
		// the lookup are erpnext/public/js/utils/party.js (set_taxes, validate_mandatory),
		// which this workspace does not run, so they are reproduced here.
		if (!["tax_category", "supplier"].includes(df.fieldname) || !control.$input) return;
		control.$input.on("change.agtaxcat awesomplete-selectcomplete.agtaxcat", (event) => {
			if (!event.originalEvent) return;
			this.applyTaxCategory(df.fieldname);
		});
	}

	async applyTaxCategory(trigger) {
		// no taxes table, nothing to fill
		if (!this.tableStates.has("taxes")) return;
		const company = this.getFormValue("company");
		const supplier = this.getFormValue("supplier");
		const date = this.getFormValue("transaction_date") || this.getFormValue("posting_date");

		// Only a category typed by hand is worth complaining about; picking a supplier
		// should not scold the user for a category they never touched.
		if (trigger === "tax_category") {
			const missing = !company ? __("Company") : !supplier ? __("Lead / Customer / Supplier") : !date ? __("Posting / Transaction Date") : "";
			if (missing) {
				// the desk clears the field it was triggered from, so this does too
				this.formControl("tax_category")?.set_value("", true);
				frappe.msgprint({ title: __("Mandatory"), message: __("Please enter {0} first", [missing]), indicator: "red" });
				return;
			}
		} else if (!company || !supplier || !date) {
			return;
		}

		let template = null;
		try {
			template = await frappe.xcall("erpnext.accounts.party.set_taxes", {
				party: supplier,
				party_type: "Supplier",
				posting_date: date,
				company,
				tax_category: this.getFormValue("tax_category") || null,
				billing_address: this.getFormValue("supplier_address") || null,
				shipping_address: this.getFormValue("shipping_address") || null,
			});
		} catch (error) {
			return;
		}
		if (!template) return;
		const control = this.formControl("taxes_and_charges");
		if (!control || control.get_value() === template) return;
		control.set_value(template, true);
		// the template fills the rows itself, exactly as choosing it by hand would
		control.$input?.trigger("change");
		frappe.show_alert({ message: __("Taxes template set to {0}", [template]), indicator: "blue" });
	}

	bindDiscountFields(control, df) {
		// The percentage and the amount are two ways of saying the same thing, so whichever
		// is typed last wins and zeroes the other. Same rule as the desk form
		// (erpnext/public/js/controllers/transaction.js), which this workspace does not run:
		// the server only derives the amount while the percentage is non-zero, so clearing
		// the percentage would otherwise leave the old amount standing.
		if (!["additional_discount_percentage", "discount_amount"].includes(df.fieldname)) return;
		if (!control.$input) return;

		control.$input.on("change.agdiscount", (event) => {
			// only a real edit; the figures the recalculation writes back must not fight it
			if (!event.originalEvent) return;

			if (df.fieldname === "additional_discount_percentage") {
				if (!this.getFormValue("apply_discount_on")) {
					frappe.msgprint(__("Please set 'Apply Additional Discount On'"));
					control.set_value("", true);
					return;
				}
				// the server works the amount out from the percentage; a stale figure is
				// cleared so nothing is left over when the percentage goes to zero
				this.formControl("discount_amount")?.set_value(0, true);
			} else {
				this.formControl("additional_discount_percentage")?.set_value(0, true);
			}
			this.scheduleRecalculation();
		});
	}

	bindParentRowField(control, df) {
		if (!PARENT_ROW_FIELDS[df.fieldname] || !control.$input) return;
		// the header cell drives the rows; a row cell carrying the same fieldname does not
		// A datepicker and an autocomplete both raise a jQuery change carrying no
		// originalEvent - the same shape the form uses when it fills itself in - so
		// Required By never reached the rows. Provenance is the wrong test: what marks a
		// real edit is the form being finished rendering and the value having moved.
		let known = control.get_value();
		const react = () => {
			const current = control.get_value();
			if (!this.formReady || current === known) return;
			known = current;
			this.propagateParentFields(true);
		};
		// the datepicker writes the input and closes without a change event on some paths,
		// and a Link commits its docname a tick after its own select event
		control.$input.on("change.agparent awesomplete-selectcomplete.agparent blur.agparent",
			() => window.setTimeout(react, 0));
		// The DOM events above still miss paths a control can take. Frappe calls df.onchange
		// itself, from inside the routine that writes the model value - so it fires for a
		// datepicker pick, a typed date and a dropdown choice alike, and always after the
		// value has landed. The guard in react makes the overlap with the events harmless.
		const previous = control.df.onchange;
		control.df.onchange = function (...args) {
			const result = previous ? previous.apply(this, args) : undefined;
			react();
			return result;
		};
	}

	bindAddressFetch(control, df) {
		const display = ADDRESS_DISPLAY_FIELDS[df.fieldname];
		const isContact = df.fieldname === "contact_person";
		if ((!display && !isContact) || !control.$input || df.read_only) return;
		// Awesomplete raises its own event with no originalEvent and commits the docname a
		// tick later, so every change is acted on - one tick late - and the fetch is
		// skipped when the value has not actually moved.
		let known = control.get_value();
		const react = () => {
			const current = control.get_value();
			if (current === known) return;
			known = current;
			if (isContact) this.fetchContactDetails(current);
			else this.fetchAddressDisplay(current, display);
		};
		control.$input.on("change.agaddr awesomplete-selectcomplete.agaddr blur.agaddr",
			() => window.setTimeout(react, 0));
	}

	async fetchAddressDisplay(address, displayField) {
		if (!this.formControl(displayField)) return;
		if (!address) { this.setFormValue(displayField, ""); return; }
		const response = await frappe.call({
			method: "frappe.contacts.doctype.address.address.get_address_display",
			args: { address_dict: address },
		}).catch(() => null);
		this.setFormValue(displayField, response?.message || "");
	}

	async fetchContactDetails(contact) {
		if (!contact) {
			CONTACT_DISPLAY_FIELDS.forEach((fieldname) => this.setFormValue(fieldname, ""));
			return;
		}
		const response = await frappe.call({
			method: "frappe.contacts.doctype.contact.contact.get_contact_details",
			args: { contact },
		}).catch(() => null);
		if (!response || !response.message) return;
		CONTACT_DISPLAY_FIELDS.forEach((fieldname) => {
			if (fieldname in response.message) this.setFormValue(fieldname, response.message[fieldname] || "");
		});
	}

	hydrateAddressDisplays() {
		// a document saved before this existed has the picker filled and the text blank;
		// the same fetch fills it in, so an old document reads like a new one
		for (const [picker, display] of Object.entries(ADDRESS_DISPLAY_FIELDS)) {
			if (!this.formControl(picker) || !this.formControl(display)) continue;
			if (this.getFormValue(picker) && !this.getFormValue(display)) {
				this.fetchAddressDisplay(this.getFormValue(picker), display);
			}
		}
		if (this.getFormValue("contact_person") && !this.getFormValue("contact_display")) {
			this.fetchContactDetails(this.getFormValue("contact_person"));
		}
	}

	setFormValue(fieldname, value) {
		// forced: a read-only control writes into the doc it was handed, and Frappe treats a
		// set that already matches that doc as a no-op, leaving the box on screen empty
		this.formControl(fieldname)?.set_value(value, true);
	}

	propagateParentFields(force = false) {
		for (const [parentField, target] of Object.entries(PARENT_ROW_FIELDS)) {
			const value = this.formControls.find((entry) => entry.field.fieldname === parentField)?.control?.get_value();
			if (!value) continue;
			const state = this.tableStates.get(target.table);
			if (!state) continue;
			for (const row of state.rows) {
				// Only empty cells are filled, so a row the user set by hand is left alone.
				// The control is set first and forced: it writes into row.data itself, and
				// writing row.data up front would make Frappe treat the set as a no-op and
				// leave the box on screen empty.
				// force: the header was just changed by hand, so every row follows it. Without
				// it only blank cells are filled, leaving a row the user set by hand alone.
				const control = row.controls[target.field];
				if (control) {
					if (force || !control.get_value()) control.set_value(value, true);
				} else if (force || !row.data[target.field]) {
					row.data[target.field] = value;
				}
			}
		}
	}

	async applyPaymentPartyDetails() {
		// mirrors ERPNext's payment_entry.js party handler: picking a party fills that party's
		// own account, its currency and balance, the party balance and the linked bank accounts
		const control = (fieldname) => this.formControls.find((entry) => entry.field.fieldname === fieldname)?.control;
		const value = (fieldname) => String(control(fieldname)?.get_value() || "");
		if (!control("payment_type") || !control("party")) return;

		const args = {
			company: value("company"),
			party_type: value("party_type"),
			party: value("party"),
			date: value("posting_date"),
			cost_center: value("cost_center"),
		};
		const paymentType = value("payment_type");
		if (!paymentType || !args.company || !args.party_type || !args.party || !args.date) return;

		const key = [paymentType, args.company, args.party_type, args.party, args.date].join("|");
		if (this.paymentPartyKey === key) return; // already looked this combination up
		this.paymentPartyKey = key;

		let details;
		try {
			const response = await frappe.call({
				method: "erpnext.accounts.doctype.payment_entry.payment_entry.get_party_details",
				args,
			});
			details = response.message;
		} catch (error) {
			this.paymentPartyKey = null; // let the next edit try again
			return;
		}
		if (!details || this.paymentPartyKey !== key) return;

		const fill = (fieldname, next) => {
			const target = control(fieldname);
			if (target && next !== undefined && next !== null && next !== "") target.set_value(next);
		};
		if (paymentType === "Receive") {
			fill("paid_from", details.party_account);
			fill("paid_from_account_currency", details.party_account_currency);
			fill("paid_from_account_balance", details.account_balance);
		} else if (paymentType === "Pay") {
			fill("paid_to", details.party_account);
			fill("paid_to_account_currency", details.party_account_currency);
			fill("paid_to_account_balance", details.account_balance);
		}
		fill("party_balance", details.party_balance);
		fill("party_name", details.party_name);
		fill("party_bank_account", details.party_bank_account);
		fill("bank_account", details.bank_account);
		this.applyDependsOn();
	}

	applyPartyTypeDefault() {
		// mirrors ERPNext's set_default_party_type: money received comes from a Customer,
		// money paid goes to a Supplier - unless a party has already been chosen
		const control = (fieldname) => this.formControls.find((entry) => entry.field.fieldname === fieldname)?.control;
		const partyType = control("party_type");
		const paymentType = control("payment_type");
		if (!partyType || !paymentType || control("party")?.get_value()) return;
		const expected = { Receive: "Customer", Pay: "Supplier" }[paymentType.get_value()];
		if (!expected || partyType.get_value() === expected) return;
		partyType.set_value(expected);
	}

	applyDependsOn() {
		if (!this.formControls || !this.formControls.length) return;
		this.applyPartyTypeDefault();
		const doc = { ...this.formDoc };
		for (const { field, control } of this.formControls) doc[field.fieldname] = control.get_value();
		// an unsaved document carries no docstatus, and `undefined == 0` is false in JS,
		// so every rule written as "eval:doc.docstatus==0" would wrongly hide its field
		doc.doctype = this.formMeta.doctype;
		doc.docstatus = Number(this.formDoc.docstatus || 0);
		doc.__islocal = this.formDoc.name ? 0 : 1;
		const truthy = (expression) => {
			try {
				const rule = String(expression);
				if (rule.startsWith("eval:")) return Boolean(frappe.utils.eval(rule.slice(5), { doc, parent: doc }));
				return Boolean(doc[rule]);
			} catch (error) {
				return true; // a rule we cannot read must never hide a field
			}
		};
		for (const { field, control } of this.formControls) {
			if (!field.depends_on) continue;
			const slot = control.$wrapper?.closest(".ag-field-slot");
			if (slot && slot.length) slot.toggle(truthy(field.depends_on));
		}
		for (const { field, holder } of this.formTableSlots || []) {
			if (field.depends_on) holder.toggle(truthy(field.depends_on));
		}
		for (const { dependsOn, section } of this.formSectionSlots || []) section.toggle(truthy(dependsOn));
		this.applyPostingTimeRule();
		this.propagateParentFields();
		this.applyPaymentPartyDetails();
	}

	/** Title mile to usse asli docname nikaalo (company ke hisaab se). */
	async resolveTaxTemplateName(value) {
		const DOCTYPE = "Purchase Taxes and Charges Template";
		const wanted = String(value || "").trim();
		if (!wanted) return value;
		try {
			if (await frappe.db.exists(DOCTYPE, value)) return value;
			const filters = { title: ["like", wanted + "%"] };
			const company = this.formControls?.find((entry) => entry.field.fieldname === "company")?.control?.get_value();
			if (company) filters.company = company;
			const rows = await frappe.db.get_list(DOCTYPE, { filters, fields: ["name"], limit: 1 });
			if (rows && rows.length) return rows[0].name;
		} catch (error) {
			// Resolve na ho to jo mila wahi bhej do — purana behaviour.
		}
		return value;
	}

	async applyTaxTemplate(template) {
		const state = this.tableStates.get("taxes");
		if (!state || !state.holder) return;
		state.holder.find("tbody").empty();
		state.rows = [];
		if (!template) return;
		// Agar title aa gaya ho (docname ke bajaye) to use docname me badal lo.
		template = await this.resolveTaxTemplateName(template);
		try {
			const response = await frappe.call({
				method: "erpnext.controllers.accounts_controller.get_taxes_and_charges",
				args: { master_doctype: "Purchase Taxes and Charges Template", master_name: template },
			});
			for (const row of response.message || []) this.addChildRow(state, state.holder, row);
			this.scheduleRecalculation();
		} catch (error) {
			frappe.show_alert({ message: __("Could not load the selected tax template."), indicator: "red" });
		}
	}

	removeEmptyTabs(tabList, panels) {
		panels.find(".ag-tab-panel").each((_, panel) => {
			if (!$(panel).children().length) {
				const id = $(panel).data("panel");
				tabList.find(`[data-tab="${id}"]`).remove();
				$(panel).remove();
			}
		});
		if (!panels.find(".ag-tab-panel.active").length) {
			tabList.find(".ag-tab-button").first().addClass("active");
			panels.find(".ag-tab-panel").first().addClass("active");
		}
	}

	defaultValue(field, value) {
		// A Time or Datetime carrying fractional seconds - "14:00:19.981350" - makes Frappe's
		// control refuse it as "must be in format: HH:mm:ss". api.py trims what it serves,
		// but a document built by a desk mapper arrives raw, so it is trimmed here too:
		// this is the one place every field on every form passes through.
		if (["Time", "Datetime"].includes(field.fieldtype) && typeof value === "string" && value.includes(".")) {
			value = value.replace(/\.\d+/, "");
		}
		// Material Request se map hokar aaya doc required Select me khaali string
		// bhej deta hai (jaise Supplier Quotation ka status). Usko asli value maan
		// lene se field blank reh jaata tha aur form save nahi hota — is liye aise
		// case me neeche default nikaalne dete hain.
		const blankRequiredSelect = value === "" && field.fieldtype === "Select" && field.reqd;
		if (value !== undefined && value !== null && !blankRequiredSelect) return value;
		// Frappe writes these defaults as words, and any combination is legal: POS Closing
		// Entry has a Datetime whose default is "Today". Leaving one unmapped sends the word
		// itself to the control, which then rejects it as a badly formatted date.
		const keyword = String(field.default || "").trim().toLowerCase();
		if (keyword === "today" || keyword === "now") {
			const today = frappe.datetime.get_today();
			if (field.fieldtype === "Date") return today;
			if (field.fieldtype === "Datetime") return keyword === "now" ? frappe.datetime.now_datetime() : `${today} 00:00:00`;
			if (field.fieldtype === "Time") return frappe.datetime.now_time();
		}
		// Frappe seeds a Link field from the user default for that DocType (Company, Warehouse, ...)
		if (field.fieldtype === "Link" && field.options && !field.default) {
			const userDefault = frappe.defaults.get_user_default(field.options);
			if (userDefault) return userDefault;
		}
		if (typeof field.default === "string" && field.default.startsWith(":")) return frappe.defaults.get_default(field.default.slice(1).toLowerCase()) || "";
		const fallback = field.default ?? "";
		// a Select with no default lands on its first option, the way the standard desk form does
		if (!fallback && field.fieldtype === "Select") {
			const choices = String(field.options || "").split("\n").map((option) => option.trim());
			// Kuch Select options blank line se shuru hote hain — jaise Supplier Quotation
			// ka status ("\nDraft\nSubmitted\nStopped\nCancelled\nExpired"). Aise required
			// field me pehla (khaali) option lene se value blank reh jaati thi aur form save
			// nahi hota tha. Required ho to pehla asli option lo; optional blank hi rahe.
			const first = field.reqd ? choices.find((option) => option) || "" : choices[0];
			if (first) return first;
		}
		return fallback;
	}

	renderControl(holder, field, value, rowContext = null) {
		const df = { ...field };
		// once a document exists, the Series box shows the name it was actually given
		if (field.fieldname === "naming_series" && this.formDoc?.name) {
			df.fieldtype = "Data";
			df.options = "";
			df.read_only = 1;
			value = this.formDoc.name;
		} else if (field.fieldname === "naming_series") {
			// The desk opens a new document with the series already picked. A value can also
			// arrive that the Select has no option for: this site's Purchase Order default is
			// PUR-ORD-.YYYY.-.YY.-.###, which is not among its own options, and a document
			// mapped from a Material Request carries that in - which is why Series came up
			// blank there. So whatever arrives is resolved to one of the offered series.
			const choices = String(df.options || "").split("\n").map((entry) => entry.trim()).filter(Boolean);
			const wanted = String(value || df.default || "").trim();
			value = choices.includes(wanted) ? wanted : (choices[0] || "");
		}
		if (field.fieldname === "__newname" && this.formDoc.name) value = this.formDoc.name;
		const policy = this.formFieldPolicy(this.state.kind);
		if (policy?.readOnly?.has(field.fieldname)) df.read_only = 1;
		if (policy?.required?.has(field.fieldname)) df.reqd = 1;
		// a submitted or cancelled document is a record, not a form - and some kinds are
		// only ever read here, whatever their docstatus
		// A submitted or cancelled document is a record here. Its item rows still change,
		// but only through Update Items, which goes through ERPNext's own checks - so the
		// form itself has nothing left to save and every field stays closed.
		if (Number(this.formDoc?.docstatus || 0) !== 0 || READ_ONLY_KINDS.includes(this.state.kind)) df.read_only = 1;
		// an item that came from an upstream document cannot be swapped; a new row still can
		if (rowContext && field.fieldname === "item_code"
			&& (LINKED_ROW_FIELDS[this.state.kind] || []).some((fieldname) => rowContext.data[fieldname])) {
			df.read_only = 1;
		}
		// rowContext.data, not rowContext: Frappe reads and writes `doc[fieldname]` directly
		// when there is no frm, so handing it the wrapper left every child field invisible to
		// the control - a read-only one then refreshed itself back to blank
		const control = frappe.ui.form.make_control({ parent: holder, df, render_input: true, doc: rowContext ? rowContext.data : this.formDoc });
		// ControlAttach.set_input paints its empty state as `this.$input.toggle(true)` with
		// no guard, and a read-only control never runs make_input, so neither $input nor
		// $value exists - setting an empty value threw "Cannot read properties of undefined
		// (reading 'toggle')" on every unfilled read-only Attach. There is nothing to show
		// when there is no file, so the call is simply not made.
		const emptyReadOnlyAttach = ["Attach", "Attach Image"].includes(df.fieldtype)
			&& df.read_only && !value;
		if (!emptyReadOnlyAttach) control.set_value(this.defaultValue(field, value));
		if (df.read_only) control.df.read_only = 1;
		control.refresh();
		this.scopeLinkToCompany(control, df);
		this.scopeAttendanceLabour(control, df);
		this.steadyLinkArrow(control, df);
		if (!rowContext) this.bindParentRowField(control, df);
		this.bindAddressFetch(control, df);
		this.bindDiscountFields(control, df);
		this.bindTaxCategory(control, df);
		this.scopeShiftCentre(control, df);
		this.bindShiftField(control, df);
		this.bindAttendanceField(control, df);
		this.scopeCropLinks(control, df);
		this.bindCropField(control, df);
		this.bindPosOpeningFetch(control, df);
		this.linkPortalDoc(control, df);
		this.bindComboSearch(control, field.label);
		this.enforceNumeric(control, field);
		if (rowContext) rowContext.controls[field.fieldname] = control;
		// df, not field: the rendered copy carries the read-only and required overrides, so
		// validation and the asterisk agree with what the user actually sees
		else this.formControls.push({ field: df, control });
		return control;
	}

	companyFieldname() {
		// Most documents call it `company`; the crop logs suffix it per log - company_hl,
		// company_spl, company_sl, company_fl - so it is found by what it links to.
		const fields = this.formMeta?.fields || [];
		if (fields.some((field) => field.fieldname === "company")) return "company";
		const link = fields.find((field) => field.fieldtype === "Link" && field.options === "Company");
		return link ? link.fieldname : "company";
	}

	prefillCompany() {
		// The server fills this on save from the user's default Company, falling back to the
		// global one. Putting it in up front means the warehouse search can already be
		// narrowed to that company instead of offering every company's warehouses.
		if (this.formDoc.name) return;
		const control = this.formControl(this.companyFieldname());
		if (!control || control.get_value()) return;
		const company = frappe.defaults.get_user_default("Company") || frappe.defaults.get_default("company");
		if (company) control.set_value(company);
	}

	scopeLinkToCompany(control, df) {
		// a warehouse, cost centre or account only makes sense for the document's own company.
		// Fields that already carry their own link filters are left alone, since Frappe rebuilds
		// get_query for those on every search and would overwrite anything set here.
		if (df.fieldtype !== "Link" || !COMPANY_SCOPED_LINKS.includes(df.options) || df.link_filters) return;
		const existing = control.get_query || df.get_query;
		control.get_query = (...args) => {
			let base = typeof existing === "function" ? existing.apply(control, args) : existing;
			if (typeof base === "string") base = { query: base };
			base = base && typeof base === "object" ? { ...base } : {};
			const filters = { ...(base.filters || {}) };
			const company = this.getFormValue(this.companyFieldname());
			if (company) filters.company = company;
			// a group node is a folder in the tree, never something a document can point at
			if (LEAF_ONLY_LINKS.includes(df.options)) filters.is_group = 0;
			base.filters = filters;
			return base;
		};
	}

	excludeSelectedItems(control, state, rowContext) {
		// Picking an item already used in another row of this table hides it from the
		// search results instead of letting it be picked and complaining afterwards.
		// Each crop log names this column its own way - name_of_crop_ht, agri_input_st -
		// so it is recognised by what it links to rather than by its fieldname.
		if (!control || control.df.fieldtype !== "Link" || control.df.options !== "Item") return;
		const fieldname = control.df.fieldname;
		const existing = control.get_query;
		control.get_query = (...args) => {
			let base = typeof existing === "function" ? existing.apply(control, args) : existing;
			if (typeof base === "string") base = { query: base };
			base = base && typeof base === "object" ? { ...base } : {};
			const filters = { ...(base.filters || {}) };
			const chosen = state.rows
				.filter((row) => row !== rowContext)
				.map((row) => row.controls[fieldname]?.get_value())
				.filter(Boolean);
			if (chosen.length) filters.name = ["not in", chosen];
			base.filters = filters;
			return base;
		};
	}

	enforceNumeric(control, field) {
		if (!["Int", "Float", "Currency", "Percent"].includes(field.fieldtype)) return;
		const input = control.$input;
		if (!input || !input.length) return;
		input.attr({ inputmode: field.fieldtype === "Int" ? "numeric" : "decimal" });
		input.on("input.agriventure", () => {
			let cleaned = input.val().replace(field.fieldtype === "Int" ? /[^0-9-]/g : /[^0-9.\-]/g, "");
			if (field.non_negative) cleaned = cleaned.replace(/-/g, "");
			if (cleaned !== input.val()) input.val(cleaned);
		});
	}


	renderChildTable(holder, field) {
		const definition = this.formMeta.child_tables[field.fieldname];
		if (!definition) return;
		const dropped = (PORTAL_SKIP_CHILD_FIELDS[this.state.kind] || {})[field.fieldname] || [];
		const candidates = definition.fields.filter((df) => df.fieldname && !df.hidden && !dropped.includes(df.fieldname) && !["Section Break", "Column Break", "Tab Break", "HTML", "Button", "Fold", "Table"].includes(df.fieldtype));
		const isMaterialItems = this.state.kind === "material-request" && field.fieldname === "items";
		const pinned = this.formFieldPolicy(this.state.kind)?.tables?.[field.fieldname];
		let columns;
		if (isMaterialItems) {
			columns = ["item_code", "schedule_date", "qty", "warehouse", "uom", "description"]
				.map((fieldname) => candidates.find((df) => df.fieldname === fieldname))
				.filter(Boolean)
				.map((df) => df.fieldname === "description" ? { ...df, label: "Specification", fieldtype: "Small Text" } : df)
				.map((df) => df.fieldname === "warehouse" ? { ...df, label: "Warehouse" } : df);
		} else if (pinned) {
			columns = pinned
				.map((fieldname) => candidates.find((df) => df.fieldname === fieldname)
					|| definition.fields.find((df) => df.fieldname === fieldname))
				.filter(Boolean)
				.map((df) => df.hidden ? { ...df, hidden: 0, depends_on: null } : df)
				.map((df) => df.fieldtype === "Text Editor" ? { ...df, fieldtype: "Small Text" } : df);
		} else {
			columns = candidates.filter((df) => df.in_list_view || df.reqd || ["item_code", "item_name", "qty", "uom", "rate", "amount", "warehouse", "schedule_date", "description"].includes(df.fieldname));
			if (columns.length < 3) columns = candidates.slice(0, 8);
			columns = columns.slice(0, 10);
		}
		const state = { field, definition, columns, rows: [], holder };
		this.tableStates.set(field.fieldname, state);
		if (isMaterialItems) {
			// "Add Multiple" is disabled for Material Request - button markup commented out below
			holder.html(`<div class="ag-child-table ag-material-items-table"><div class="ag-child-head"><div><h3>Items</h3></div><div class="ag-child-head-actions"><button class="ag-button ag-button-light ag-add-row" type="button">${this.icon("add", "xs")} Add Row</button></div></div><div class="ag-child-scroll"><table><thead><tr><th>#</th>${columns.map((column) => `<th>${this.escape(column.label || frappe.model.unscrub(column.fieldname))}${column.reqd ? " *" : ""}</th>`).join("")}<th></th></tr></thead><tbody></tbody></table></div><div class="ag-child-footer"><div></div><div><button class="ag-button ag-button-light ag-download-rows" type="button">Download</button><button class="ag-button ag-button-light ag-upload-rows" type="button">Upload</button></div></div></div>`);
		} else {
			holder.html(`<div class="ag-child-table"><div class="ag-child-head"><div><h3>${this.escape(field.label)}</h3><span>${this.escape(definition.doctype)}</span></div><div class="ag-child-head-actions"><button class="ag-button ag-button-light ag-add-row" type="button">${this.icon("add", "xs")} Add Row</button></div></div><div class="ag-child-scroll"><table><thead><tr><th>#</th>${columns.map((column) => `<th>${this.escape(column.label || frappe.model.unscrub(column.fieldname))}${column.reqd ? " *" : ""}</th>`).join("")}<th></th></tr></thead><tbody></tbody></table></div></div>`);
		}
		const existing = this.formDoc[field.fieldname] || [];
		for (const row of existing) this.addChildRow(state, holder, row);
		if (!existing.length && (isMaterialItems || field.fieldname === "items")) this.addChildRow(state, holder, {});
		holder.find(".ag-add-row").on("click", () => this.addChildRow(state, holder, {}));
		if (isMaterialItems) {
			// holder.find(".ag-add-multiple").on("click", () => this.openItemMultiSelect(state, holder));
			holder.find(".ag-download-rows").on("click", () => this.downloadChildRows(state));
			holder.find(".ag-upload-rows").on("click", () => this.uploadChildRows(state, holder));
		}
	}



	cropConfig() {
		return CROP_LOG_CONFIG[this.state.kind] || null;
	}

	scopeCropLinks(control, df) {
		// Centre and Field are limited to what the day's shifts assigned to this activity,
		// through the same server queries the desk forms use.
		const config = this.cropConfig();
		if (!config) return;
		if (df.fieldname === config.centre) {
			control.get_query = () => ({
				query: `${CROP_OPS_METHOD}.get_centres`,
				filters: { activity: config.activity, date: this.getFormValue(config.date) },
			});
		} else if (df.fieldname === config.field) {
			control.get_query = () => ({
				query: `${CROP_OPS_METHOD}.get_fields`,
				filters: {
					activity: config.activity,
					date: this.getFormValue(config.date),
					centre: this.getFormValue(config.centre),
				},
			});
		}
	}

	linkPortalDoc(control, df) {
		// The reference is read only, so Frappe paints it into `.control-value` as an <a>
		// pointing at /app. That value itself becomes the way through, landing on this
		// workspace's view of the entry instead of the desk form.
		const kind = PORTAL_LINK_FIELDS[df.fieldname];
		if (!kind || !this.boot.doctypes[kind]) return;

		const paint = () => {
			const name = control.get_value();
			const box = control.disp_area ? $(control.disp_area) : control.$wrapper?.find(".control-value").first();
			if (!name || !box || !box.length) return;
			// the desk anchor is replaced with plain text, so nothing navigates on its own
			box.addClass("ag-se-link")
				.empty()
				.text(name)
				.attr({ role: "link", tabindex: 0, title: __("Open {0}", [name]) })
				.off(".agse")
				.on("click.agse", (event) => {
					event.preventDefault();
					event.stopPropagation();
					this.openPortalDoc(kind, name);
				})
				.on("keydown.agse", (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						this.openPortalDoc(kind, name);
					}
				});
		};

		// set_disp_area is what rewrites the box, and it runs after set_formatted_input on
		// every refresh, so the link is laid back over it there rather than earlier.
		const original = control.set_disp_area?.bind(control);
		if (original) {
			control.set_disp_area = (value) => {
				original(value);
				paint();
			};
		}
		paint();
	}

	openPortalDoc(kind, name) {
		this.state.kind = kind;
		this.state.start = 0;
		this.openForm(name);
	}

	bindPosOpeningFetch(control, df) {
		if (this.state.kind !== "pos-closing-entry" || df.fieldname !== "pos_opening_entry" || !control.$input) return;
		// Awesomplete raises its own event, which carries no originalEvent, so the shift is
		// identified by value instead: a saved document is never refilled, and the same
		// opening entry is never pulled twice over typed closing amounts.
		control.$input.on("change.agposfetch awesomplete-selectcomplete.agposfetch blur.agposfetch", () => {
			if (this.formDoc.name) return;
			const opening = control.get_value();
			if (!opening || opening === this.posOpeningLoaded) return;
			this.posOpeningLoaded = opening;
			this.fillPosClosing(opening);
		});
	}

	async fillPosClosing(opening) {
		const freeze = frappe.dom.freeze(__("Loading invoices..."));
		let data;
		try {
			data = (await frappe.call({
				method: "agriventure.api.pos_closing_from_opening",
				// The control still holds its own default at this point - midnight today - and
				// sending that would end the shift before it began, so the invoice window is
				// left to the server, which closes it at now. The answer fills the field in.
				args: { pos_opening_entry: opening, period_end_date: null },
			})).message;
		} catch (error) {
			frappe.dom.unfreeze();
			this.posOpeningLoaded = null;
			frappe.msgprint({ title: __("Could not load the shift"), message: this.message(error), indicator: "red" });
			return;
		}

		const set = (fieldname, value) => {
			const target = this.formControl(fieldname);
			if (target) target.set_value(value ?? "");
		};
		set("period_start_date", data.period_start_date);
		set("period_end_date", data.period_end_date);
		set("company", data.company);
		set("pos_profile", data.pos_profile);
		set("user", data.user);
		set("grand_total", data.grand_total);
		set("net_total", data.net_total);
		set("total_quantity", data.total_quantity);

		this.replaceChildRows("payment_reconciliation", data.payment_reconciliation);
		this.replaceChildRows("pos_transactions", data.pos_transactions);
		// the tax breakdown is not shown in this workspace, but it still has to be saved
		this.extraFieldValues = { ...(this.extraFieldValues || {}), taxes: data.taxes || [] };

		this.applyDependsOn();
		frappe.dom.unfreeze();
		frappe.show_alert({
			message: __("{0} invoice(s) pulled in", [data.invoice_count]),
			indicator: data.invoice_count ? "green" : "orange",
		});
	}

	replaceChildRows(fieldname, rows) {
		const state = this.tableStates.get(fieldname);
		if (!state) return;
		const holder = this.wrapper.find(`.ag-field-slot[data-fieldname="${fieldname}"]`);
		state.rows.length = 0;
		holder.find("tbody").empty();
		(rows || []).forEach((row) => this.addChildRow(state, holder, row));
	}

	bindCropField(control, df) {
		const config = this.cropConfig();
		if (!config || !control.$input) return;
		if (![config.date, config.centre].includes(df.fieldname)) return;

		control.$input.on("change.agcrop awesomplete-selectcomplete.agcrop", (event) => {
			// only a real edit; values the form fills in itself must not clear anything
			if (!event.originalEvent) return;
			const clear = (fieldname) => {
				const target = this.formControl(fieldname);
				if (target && target.get_value()) target.set_value("");
			};
			clear(config.field);
			if (df.fieldname === config.date) {
				clear(config.centre);
				this.announceCropTasks(control.get_value());
			}
		});
	}

	async announceCropTasks(date) {
		const config = this.cropConfig();
		if (!config || !date) return;
		const shown = this.formatDate(date);
		let summary = {};
		try {
			summary = (await frappe.call({
				method: `${CROP_OPS_METHOD}.get_task_summary`,
				args: { activity: config.activity, date },
			})).message || {};
		} catch (error) {
			return;
		}
		const centres = Object.keys(summary).sort();
		if (!centres.length) {
			frappe.msgprint({
				title: __("No {0} Task", [config.label]),
				message: __("No {0} task assigned on {1}.", [config.label, shown]),
				indicator: "orange",
			});
			return;
		}
		const lines = centres
			.map((centre) => `${this.escape(centre)} \u2013 ${this.escape(summary[centre].sort().join(", "))}`)
			.join("<br>");
		frappe.msgprint({
			title: __("{0} Task Assigned", [config.label]),
			message: `<b>${__("Date")}:</b> ${shown} \u2013 ${__(
				"The {0} task has been assigned to the following Centre/Location(s) and Field(s):",
				[config.label]
			)}<br><br>${lines}`,
			indicator: "green",
		});
	}

	lockChildTables(content) {
		// Once submitted, the row set is part of the record. The fields were already
		// read-only; the two buttons that change the row count go as well.
		if (Number(this.formDoc?.docstatus || 0) === 0 && !READ_ONLY_KINDS.includes(this.state.kind)) return;
		content.find(".ag-add-row, .ag-add-multiple, .ag-remove-row, .ag-upload-rows").remove();
	}

	async renderConnections(content) {
		if (!CONNECTION_KINDS.includes(this.state.kind) || !this.formDoc.name) return;
		const tabList = content.find(".ag-tab-list");
		const panels = content.find(".ag-tab-panels");
		if (!tabList.length || !panels.length) return;

		// the tab is added after the metadata tabs, so it always reads last
		const id = "ag-tab-connections";
		tabList.append(`<button type="button" class="ag-tab-button" data-tab="${id}">${__("Connections")}</button>`);
		const panel = $(`<div class="ag-tab-panel" data-panel="${id}"><div class="ag-conn-loading">${__("Loading connections…")}</div></div>`).appendTo(panels);

		let data;
		try {
			data = await this.api.connections(this.state.kind, this.formDoc.name);
		} catch (error) {
			panel.html(this.errorMarkup(error));
			return;
		}
		// the form may have moved on while this was in flight
		if (!panel.closest("body").length) return;

		const groups = (data.groups || []).filter((group) => (group.items || []).length);
		if (!groups.length) {
			panel.html(`<div class="ag-conn-empty">${__("Nothing is linked to this document yet.")}</div>`);
			return;
		}

		const chip = (item, index, groupIndex) => {
			const count = Number(item.count || 0);
			const badge = count ? `<span class="ag-conn-count">${count}</span>` : "";
			return `<button type="button" class="ag-conn-chip${count ? " has-links" : ""}"
				data-group="${groupIndex}" data-item="${index}">${badge}${this.escape(item.doctype)}</button>`;
		};

		panel.html(`<section class="ag-form-section"><div class="ag-conn-wrap">${groups.map((group, groupIndex) => `
			<div class="ag-conn-group">
				<h4>${this.escape(group.label)}</h4>
				<div class="ag-conn-chips">${(group.items || []).map((item, index) => chip(item, index, groupIndex)).join("")}</div>
			</div>`).join("")}</div></section>`);

		panel.find(".ag-conn-chip").on("click", (event) => {
			const el = $(event.currentTarget);
			const item = groups[el.data("group")]?.items[el.data("item")];
			if (item) this.openConnection(item);
		});
	}

	openConnection(item) {
		const names = item.names || [];
		if (!names.length) {
			frappe.show_alert({ message: __("No {0} is linked to this document", [__(item.doctype)]), indicator: "orange" });
			return;
		}
		// a document this workspace has its own page for never sends the user to the desk:
		// one opens straight away, several are offered by name first
		if (item.kind && this.boot.doctypes[item.kind]) {
			if (names.length === 1) this.openPortalDoc(item.kind, names[0]);
			else this.pickConnection(item, names);
			return;
		}
		// nothing of ours to open it with, so the desk list, filtered the way the desk's own
		// Connections panel filters it
		frappe.route_options = item.fieldname
			? { [item.fieldname]: this.formDoc.name }
			: { name: ["in", names] };
		frappe.set_route("List", item.doctype);
	}

	pickConnection(item, names) {
		const dialog = new frappe.ui.Dialog({
			title: __("{0} linked to this document", [__(item.doctype)]),
			size: "small",
			fields: [{
				fieldtype: "HTML", fieldname: "links",
				options: `<div class="ag-conn-list">${names.map((name) =>
					`<button type="button" class="ag-conn-link" data-name="${this.escape(name)}">${this.escape(name)}</button>`).join("")}</div>`,
			}],
		});
		dialog.show();
		dialog.$wrapper.addClass("ag-dialog");
		dialog.$wrapper.on("click", ".ag-conn-link", (event) => {
			dialog.hide();
			this.openPortalDoc(item.kind, $(event.currentTarget).data("name"));
		});
	}

	renderShiftAssign(content) {
		// the assignment grid is filled through Task Assign, never typed into by hand,
		// so its own Add Row goes and the button takes that place
		if (this.state.kind !== "shift-details") return;
		const slot = content.find('.ag-field-slot[data-fieldname="assignment_task"]').first();
		if (!slot.length) return;
		slot.find(".ag-add-row").remove();
		const actions = slot.find(".ag-child-head-actions").first();
		if (!actions.length || actions.find(".ag-task-assign").length) return;
		$(`<button type="button" class="ag-button ag-button-primary ag-task-assign">${this.icon("assign", "xs")} ${__("Task Assign")}</button>`)
			.appendTo(actions)
			.on("click", () => this.openTaskAssign());
	}

	async openTaskAssign() {
		const date = this.getFormValue("date_sd");
		const centre = this.getFormValue("centre__location_sd");
		if (!date || !centre) {
			frappe.msgprint(__("Please select Date and Centre / Location first"));
			return;
		}

		// Every assignment needs a Field, and the Field list is limited to this centre. With
		// none on record the dialog could only ever end in "Incomplete Assignment", so the
		// reason is given here instead.
		let fieldCount = 0;
		try {
			fieldCount = await frappe.db.count("Field Details", { filters: { centre__location_fd: centre } });
		} catch (error) {
			fieldCount = 1; // could not check; let the user carry on
		}
		if (!fieldCount) {
			frappe.msgprint({
				title: __("No fields at this centre"),
				message: __("<b>{0}</b> has no Field Details on record, and every assignment needs one.<br><br>Add a field for this centre under <b>Master Setting &rsaquo; Field Details</b>, then assign the task.", [centre]),
				indicator: "orange",
			});
			return;
		}

		// the source list comes from the centres this site actually has, so a new centre
		// needs no code change to become available
		let centres = [];
		try {
			centres = (await frappe.db.get_list("Centre and Location Details", { fields: ["name"], limit: 200, order_by: "name asc" }))
				.map((row) => row.name);
		} catch (error) {
			centres = [];
		}
		if (!centres.includes(centre)) centres.unshift(centre);

		const dialog = new frappe.ui.Dialog({
			title: __("Task Assign"),
			size: "large",
			fields: [
				{
					fieldtype: "Select", fieldname: "source", label: __("Select Labour Source Location"),
					options: centres.join("\n"), default: centre,
				},
				{
					fieldname: "task_table", fieldtype: "Table", label: __("Attendance"),
					cannot_add_rows: true, cannot_delete_rows: true, in_place_edit: true, show_open_form_button: 0,
					fields: [
						{ fieldtype: "Data", fieldname: "person_name", label: __("Employee"), read_only: 1, in_list_view: 1, columns: 3 },
						// the link value behind the name, carried through but never shown
						{ fieldtype: "Data", fieldname: "name_of_person_al", hidden: 1 },
						{ fieldtype: "Link", fieldname: "name_of_field_lal", label: __("Field Name"), options: "Field Details", in_list_view: 1, columns: 2 },
						{ fieldtype: "Link", fieldname: "task_name_lal", label: __("Task Name"), options: "Category Details", in_list_view: 1, columns: 3 },
						{ fieldtype: "Time", fieldname: "start_time_lal", label: __("Start Time"), in_list_view: 1, columns: 2 },
					],
				},
			],
			primary_action_label: __("Assign"),
			primary_action: () => this.applyTaskAssign(dialog),
		});

		dialog.show();
		dialog.$wrapper.addClass("ag-dialog");
		const grid = dialog.fields_dict.task_table.grid;
		// fields belong to the shift's own centre, whoever the labour was borrowed from
		grid.get_field("name_of_field_lal").get_query = () => ({ filters: { centre__location_fd: centre } });

		const load = async (source) => {
			let rows = [];
			try {
				rows = (await frappe.call({ method: `${SHIFT_METHOD}.get_attendance_logs`, args: { date, centre: source } })).message || [];
			} catch (error) {
				rows = [];
			}
			const now = frappe.datetime.now_time();
			grid.df.data = rows.map((row) => ({ ...row, start_time_lal: row.start_time_lal || now, __checked: 0 }));
			grid.refresh();
			if (!rows.length) {
				frappe.show_alert({ message: __("No attendance logged at {0} on this date", [source]), indicator: "orange" });
			}
		};

		dialog.fields_dict.source.$input?.on("change", () => load(dialog.get_value("source")));
		this.addMultiAssign(dialog, centre);
		load(centre);
	}

	commitGridEditor() {
		// A cell still being edited has not written its value back into the row yet, so a
		// click straight from that cell onto Assign would read the row as still empty.
		const active = document.activeElement;
		if (active && typeof active.blur === "function" && active.tagName !== "BODY") {
			$(active).trigger("change");
			active.blur();
		}
	}

	addMultiAssign(dialog, centre) {
		const grid = dialog.fields_dict.task_table.grid;
		const holder = dialog.$wrapper.find(".grid-footer .grid-buttons").first();
		const button = $(`<button type="button" class="btn btn-xs btn-secondary ml-2 ag-multi-assign">${__("Assign To Multi")}</button>`);
		button.appendTo(holder.length ? holder : dialog.$wrapper.find(".grid-footer").first());

		button.on("click", () => {
			this.commitGridEditor();
			const selected = grid.get_selected_children();
			if (!selected.length) {
				frappe.msgprint(__("Please tick the rows to assign first"));
				return;
			}
			const chosen = new Set(selected.map((row) => row.name_of_person_al));

			const bulk = new frappe.ui.Dialog({
				title: __("Assign Task"),
				fields: [
					{ fieldtype: "Link", fieldname: "field", label: __("Field"), options: "Field Details", reqd: 1 },
					{ fieldtype: "Link", fieldname: "task", label: __("Task"), options: "Category Details", reqd: 1 },
					{ fieldtype: "Time", fieldname: "time", label: __("Start Time"), reqd: 1 },
				],
				primary_action_label: __("Submit"),
				primary_action: (values) => {
					// The values are written into the grid's own data and the ticks are put
					// back: refresh() rebuilds every row from that data, and a lost tick is
					// what left Assign complaining that nothing had been filled in.
					(grid.df.data || []).forEach((row) => {
						if (!chosen.has(row.name_of_person_al)) return;
						row.name_of_field_lal = values.field;
						row.task_name_lal = values.task;
						row.start_time_lal = values.time;
						row.__checked = 1;
					});
					grid.refresh();
					bulk.hide();
				},
			});

			bulk.fields_dict.field.get_query = () => ({ filters: { centre__location_fd: centre } });
			bulk.show();
			bulk.$wrapper.addClass("ag-dialog");
			bulk.set_value("time", frappe.datetime.now_time());
		});
	}

	applyTaskAssign(dialog) {
		this.commitGridEditor();
		const grid = dialog.fields_dict.task_table.grid;
		const rows = grid.get_selected_children();
		if (!rows.length) {
			frappe.msgprint(__("Please tick the rows to assign"));
			return;
		}

		const incomplete = rows
			.map((row, index) => (!row.name_of_field_lal || !row.task_name_lal || !row.start_time_lal ? index + 1 : 0))
			.filter((position) => position);
		if (incomplete.length) {
			frappe.msgprint({
				title: __("Incomplete Assignment"),
				message: __("Please fill <b>Field, Task and Start Time</b> for selected row(s): <b>{0}</b>", [incomplete.join(", ")]),
				indicator: "red",
			});
			return;
		}

		const state = this.tableStates.get("assignment_task");
		if (!state) return;
		// rebuilt rather than appended, so the whole table stays in start-time order
		const merged = this.sortByStartTime([
			...state.rows.map((row) => ({ ...row.data })),
			...rows.map((row) => ({
				name_of_person_lal: row.name_of_person_al,
				name_of_field_lal: row.name_of_field_lal,
				task_name_lal: row.task_name_lal,
				start_time_lal: row.start_time_lal,
			})),
		]);
		this.replaceChildRows("assignment_task", merged);
		this.markFormDirty();
		this.wrapper.find(".ag-save").show();
		frappe.show_alert({ message: __("{0} row(s) assigned", [rows.length]), indicator: "green" });
		dialog.hide();
	}

	renderCropPick(content) {
		const config = this.cropConfig();
		if (!config) return;
		const slot = content.find(`.ag-field-slot[data-fieldname="${config.date}"]`).first();
		if (!slot.length || slot.find(".ag-pick-btn").length) return;
		slot.addClass("ag-has-pick");
		// dropped inside the control's own input row rather than beside the whole control,
		// so it lines up with the date box instead of sitting below the label with it
		const target = slot.find(".control-input-wrapper").first();
		$(`<button type="button" class="ag-button ag-button-primary ag-pick-btn">${this.icon("list-alt", "xs")} ${__("Pick")}</button>`)
			.appendTo(target.length ? target : slot)
			.on("click", () => this.openCropPick());
	}

	openCropPick() {
		const config = this.cropConfig();
		if (!config) return;
		const date = this.getFormValue(config.date);
		const centre = this.getFormValue(config.centre);
		if (!date || !centre) {
			frappe.msgprint(__("Please select Date and Centre Location"));
			return;
		}

		const dialog = new frappe.ui.Dialog({
			title: __("Shift Details"),
			size: "extra-large",
			fields: [
				{
					fieldname: "shift_child_table",
					fieldtype: "Table",
					label: __("Shift Entries"),
					cannot_add_rows: true,
					cannot_delete_rows: true,
					in_place_edit: false,
					show_open_form_button: 0,
					fields: [
						{ fieldtype: "Data", fieldname: "centre", label: __("Centre"), in_list_view: 1, read_only: 1, columns: 2 },
						{ fieldtype: "Data", fieldname: "field_name", label: __("Name of Field"), in_list_view: 1, read_only: 1, columns: 3 },
						{ fieldtype: "Int", fieldname: "number_of_labour", label: __("Labour"), in_list_view: 1, read_only: 1, columns: 1 },
						{ fieldtype: "Data", fieldname: "task", label: __("Task"), in_list_view: 1, read_only: 1, columns: 2 },
						// the link value behind the display name, carried but never shown
						{ fieldtype: "Data", fieldname: "field_id", hidden: 1 },
					],
				},
			],
			primary_action_label: __("Close"),
			primary_action: () => dialog.hide(),
		});
		dialog.show();

		const table = dialog.fields_dict.shift_child_table;
		frappe.call({
			method: `${CROP_OPS_METHOD}.get_shift_summary`,
			args: { activity: config.activity, date, centre },
			callback: (response) => {
				table.df.data = response.message || [];
				table.refresh();
				// ticking a row is how a field gets chosen, same as the desk form
				table.grid.wrapper.off("change.agpick").on("change.agpick", ".grid-row-check", (event) => {
					if (!event.currentTarget.checked) return;
					const index = $(event.currentTarget).closest(".grid-row").attr("data-idx") - 1;
					const row = table.grid.data[index];
					if (!row) return;
					this.formControl(config.field)?.set_value(row.field_id);
					dialog.hide();
				});
			},
		});
	}

	steadyLinkArrow(control, df) {
		// Frappe hides the arrow a moment after the input loses focus, and pressing the
		// mouse down on it is what causes that blur - so the first click lands on nothing.
		// Holding the focus through mousedown lets the very first click through.
		if (df.fieldtype !== "Link" || !control.$link_open) return;
		control.$link_open.on("mousedown.aglink", (event) => event.preventDefault());
	}

	scopeShiftCentre(control, df) {
		// only centres that actually have attendance logged on the chosen date, which is
		// the same link query the desk form uses
		if (this.state.kind !== "shift-details" || df.fieldname !== "centre__location_sd") return;
		control.get_query = () => ({
			query: `${SHIFT_METHOD}.get_today_centres`,
			filters: { date: this.getFormValue("date_sd") },
		});
	}

	bindShiftField(control, df) {
		if (this.state.kind !== "shift-details" || !control.$input) return;
		if (!["date_sd", "centre__location_sd"].includes(df.fieldname)) return;

		control.$input.on("change.agshift awesomplete-selectcomplete.agshift", (event) => {
			// only a real edit; values the form fills in itself must not clear anything
			if (!event.originalEvent) return;
			if (df.fieldname === "date_sd") {
				const value = control.get_value();
				if (value && value > frappe.datetime.get_today()) {
					// the server refuses this too, but saying so now saves a round trip
					frappe.msgprint(__("Shift date cannot be in the future"));
					control.set_value("", true);
					return;
				}
				// which centres are on offer depends on the date, so the centre is picked again
				const centre = this.formControl("centre__location_sd");
				if (centre && centre.get_value()) centre.set_value("", true);
			}
			this.reloadShiftAssignments();
		});
	}

	sortByStartTime(rows) {
		// latest first, the order the desk grid keeps
		return [...rows].sort((a, b) => String(b.start_time_lal || "").localeCompare(String(a.start_time_lal || "")));
	}

	async reloadShiftAssignments() {
		// a saved shift keeps what it has; only a new one is pre-filled from the day's
		// earlier shift at the same centre
		if (this.formDoc.name) return;
		if (!this.tableStates.get("assignment_task")) return;
		const date = this.getFormValue("date_sd");
		const centre = this.getFormValue("centre__location_sd");
		// cleared first, so changing the date never leaves the previous centre's rows behind
		this.replaceChildRows("assignment_task", []);
		if (!date || !centre) return;

		let rows = [];
		try {
			rows = (await frappe.call({
				method: `${SHIFT_METHOD}.get_assignment_tasks_from_existing`,
				args: { date, centre },
			})).message || [];
		} catch (error) {
			return;
		}
		if (!rows.length) return;
		// the request may have been overtaken while it was in flight
		if (this.getFormValue("date_sd") !== date || this.getFormValue("centre__location_sd") !== centre) return;
		this.replaceChildRows("assignment_task", this.sortByStartTime(rows));
		frappe.show_alert({
			message: __("{0} assignment(s) carried over from an earlier shift today", [rows.length]),
			indicator: "blue",
		});
	}

	scopeAttendanceLabour(control, df) {
		// Name of Person offers only labour posted to this centre who have no log for this date,
		// which is exactly what the desk form's link query does.
		if (this.state.kind !== ATTENDANCE_KIND || df.fieldname !== "name_of_person_al") return;
		control.get_query = () => ({
			query: `${ATTENDANCE_METHOD}.get_labour_by_centre`,
			filters: {
				centre_location: this.getFormValue("centre__location_al"),
				date_al: this.getFormValue("date_al"),
			},
		});
	}

	bindAttendanceField(control, df) {
		if (this.state.kind !== ATTENDANCE_KIND || !control.$input) return;
		const EVENTS = "change.agattend awesomplete-selectcomplete.agattend blur.agattend";

		// Picking a person from the dropdown raises Awesomplete's own event, and a date comes
		// from a datepicker - neither carries an originalEvent, which is the very shape the
		// form uses when it fills itself in. Testing for one meant a person chosen from the
		// list never opened the camera at all. What actually marks a real edit is the form
		// being finished rendering and the value having moved.
		let known = control.get_value();
		const moved = () => {
			const current = control.get_value();
			if (!this.formReady || current === known) return false;
			known = current;
			return true;
		};
		// a Link commits its docname a tick after its own select event
		const later = (run) => control.$input.on(EVENTS, () => window.setTimeout(run, 0));

		if (["centre__location_al", "date_al"].includes(df.fieldname)) {
			later(() => {
				if (!moved()) return;
				if (df.fieldname === "date_al" && !this.checkAttendanceDate(control)) return;
				const person = this.formControl("name_of_person_al");
				if (person && person.get_value()) person.set_value("");
				this.attendanceLastPerson = null;
			});
			return;
		}

		if (df.fieldname !== "name_of_person_al") return;
		later(() => {
			if (!moved()) return;
			const person = control.get_value();
			// one camera per newly picked person, not one per keystroke
			if (!person || this.attendanceBusy || person === this.attendanceLastPerson) return;
			// A saved log that already carries a login needs no second verification. A new one
			// cannot - but log_in_al is declared default "Now", and the control writes that
			// straight into formDoc while the form paints, so this read found a time on a
			// brand new form and the camera never opened. Only a document that exists counts.
			if (this.formDoc.name && this.formDoc.log_in_al) return;
			this.attendanceLastPerson = person;
			this.runAttendanceLogin(person);
		});
	}

	checkAttendanceDate(control) {
		const today = frappe.datetime.get_today();
		const selected = control.get_value();
		if (!selected) return true;
		if (selected > today) {
			frappe.msgprint(__("Attendance date cannot be in the future"));
			control.set_value("");
			return false;
		}
		if (selected < today) {
			frappe.msgprint({
				title: __("Past Date Selected"),
				indicator: "orange",
				message: __("You are marking attendance for a previous date. Please verify carefully."),
			});
		}
		return true;
	}

	// One camera dialog, shared by login and logout. onCapture gets the jpeg data url.
	openFaceDialog(title, actionLabel, onCapture) {
		let facingMode = "user";
		const dialog = new frappe.ui.Dialog({
			title,
			fields: [{ fieldtype: "HTML", fieldname: "camera_html" }],
			primary_action_label: actionLabel,
			primary_action() {
				const video = dialog.video_element;
				if (!video || video.readyState !== 4) {
					frappe.msgprint(__("Camera not ready. Please wait..."));
					return;
				}
				const canvas = document.createElement("canvas");
				canvas.width = video.videoWidth;
				canvas.height = video.videoHeight;
				canvas.getContext("2d").drawImage(video, 0, 0);
				const imageData = canvas.toDataURL("image/jpeg", 0.8);
				stopCamera();
				onCapture(imageData, dialog);
			},
		});
		// the stream must stop however the dialog closes, not only on capture
		dialog.onhide = () => stopCamera();
		dialog.show();

		const wrapper = dialog.fields_dict.camera_html.$wrapper;
		const video = document.createElement("video");
		video.style.cssText = "width:100%;border-radius:10px;background:#000";
		video.setAttribute("playsinline", true);
		video.setAttribute("autoplay", true);
		video.setAttribute("muted", true);
		wrapper.append(video);
		dialog.video_element = video;

		const switchButton = $(`<button type="button" class="btn btn-secondary btn-sm mt-2">${__("Switch Camera")}</button>`);
		wrapper.append(switchButton);
		switchButton.on("click", () => {
			facingMode = facingMode === "user" ? "environment" : "user";
			startCamera();
		});

		function stopCamera() {
			if (dialog.stream) dialog.stream.getTracks().forEach((track) => track.stop());
			dialog.stream = null;
		}

		function explain(error) {
			// getUserMedia refuses for several quite different reasons, and "Camera not
			// available" sent every one of them to the same dead end. The name it throws
			// says which, so the message can say what to actually do about it.
			const reasons = {
				NotFoundError: __("No camera is attached to this device."),
				DevicesNotFoundError: __("No camera is attached to this device."),
				NotAllowedError: __("The browser is blocking the camera. Allow camera access for this site from the padlock in the address bar, then try again."),
				PermissionDeniedError: __("The browser is blocking the camera. Allow camera access for this site from the padlock in the address bar, then try again."),
				NotReadableError: __("The camera is already in use by another app or tab. Close it and try again."),
				TrackStartError: __("The camera is already in use by another app or tab. Close it and try again."),
				OverconstrainedError: __("This camera cannot be used in the requested mode."),
				SecurityError: __("The camera needs a secure (https) connection."),
			};
			return reasons[error && error.name] || __("The camera could not be started.") + " " + (error?.message || "");
		}

		async function startCamera() {
			stopCamera();
			// facingMode as a bare value is read as a requirement by some browsers, and a
			// laptop webcam reports no facing at all - so asking for "user" found nothing and
			// threw NotFoundError on every desktop. Asked as `ideal` it is a preference: a
			// phone still opens the front camera, a laptop simply opens the one it has.
			const attempts = [
				{ video: { facingMode: { ideal: facingMode } }, audio: false },
				{ video: true, audio: false },
			];
			let lastError = null;
			for (const constraints of attempts) {
				try {
					const stream = await navigator.mediaDevices.getUserMedia(constraints);
					dialog.stream = stream;
					video.srcObject = stream;
					video.play();
					return;
				} catch (error) {
					lastError = error;
					// a refusal or a missing device will not be cured by relaxing the mode
					if (["NotAllowedError", "PermissionDeniedError", "NotFoundError",
						"DevicesNotFoundError", "SecurityError"].includes(error.name)) break;
				}
			}
			console.error(lastError);
			frappe.msgprint({
				title: __("Camera not available"),
				message: explain(lastError),
				indicator: "red",
			});
		}

		// only a device with more than one camera has anything to switch between
		if (navigator.mediaDevices?.enumerateDevices) {
			navigator.mediaDevices.enumerateDevices()
				.then((devices) => {
					if (devices.filter((device) => device.kind === "videoinput").length < 2) switchButton.hide();
				})
				.catch(() => {});
		}

		startCamera();
		return dialog;
	}

	renderGeoPicker(content) {
		// A centre is named by hand - "chhind" - and no geocoder can turn that into a point.
		// So the coordinates come from where the phone is standing, or from a point picked
		// off a map, which are the two ways anyone actually knows where a field is.
		if (this.state.kind !== "centre-location-details") return;
		const anchor = content.find('.ag-field-slot[data-fieldname="longitude"]').first();
		if (!anchor.length) return;
		const slot = $(`<div class="ag-field-slot ag-field-wide ag-geo-tools">
			<button type="button" class="ag-button ag-button-light ag-geo-here">${__("Use My Location")}</button>
			<button type="button" class="ag-button ag-button-light ag-geo-map">${__("Pick on Map")}</button>
			<span class="ag-geo-note" aria-live="polite"></span>
		</div>`).insertAfter(anchor);
		slot.find(".ag-geo-here").on("click", () => this.useCurrentLocation(slot));
		slot.find(".ag-geo-map").on("click", () => this.openMapPicker());
	}

	async useCurrentLocation(slot) {
		const note = slot.find(".ag-geo-note").text(__("Locating…"));
		try {
			const position = await this.getPosition();
			this.setCoordinates(position.coords.latitude, position.coords.longitude);
			note.text(__("From this device, accurate to about {0} m",
				[Math.round(position.coords.accuracy || 0)]));
		} catch (error) {
			note.text("");
			frappe.msgprint({
				title: __("Location unavailable"),
				message: __("The browser would not share a location. Allow location access for this site, or pick the point on the map instead."),
				indicator: "orange",
			});
		}
	}

	setCoordinates(latitude, longitude) {
		// six decimals is roughly a tenth of a metre, finer than any field boundary needs
		this.setFormValue("latitude", Number(Number(latitude).toFixed(6)));
		this.setFormValue("longitude", Number(Number(longitude).toFixed(6)));
		this.formDirty = true;
	}

	openMapPicker() {
		if (!window.L) {
			frappe.msgprint(__("The map library did not load. Use My Location instead."));
			return;
		}
		const defaults = frappe.utils.map_defaults;
		const startLat = Number(this.getFormValue("latitude")) || 0;
		const startLng = Number(this.getFormValue("longitude")) || 0;
		const hasPoint = Boolean(startLat || startLng);
		const typedName = this.getFormValue("name_of_centrelocation");
		let marker = null;
		let map = null;
		// assigned once the map exists; the search box is wired before that happens
		let place = () => {};

		const dialog = new frappe.ui.Dialog({
			title: __("Pick the location"),
			size: "large",
			fields: [
				{ fieldtype: "HTML", fieldname: "search", options: `
					<div class="ag-geo-search">
						<input type="text" class="ag-geo-query" placeholder="${__("Search a place by name…")}" aria-label="${__("Search a place by name")}">
						<button type="button" class="ag-button ag-button-light ag-geo-go">${__("Search")}</button>
					</div>
					<div class="ag-geo-results"></div>` },
				{ fieldtype: "HTML", fieldname: "map", options: '<div class="ag-geo-map-box"></div>' },
				{ fieldtype: "HTML", fieldname: "readout",
					options: `<p class="ag-geo-readout">${__("Search a name above, or click anywhere on the map, or drag the pin.")}</p>` },
			],
			primary_action_label: __("Use This Point"),
			primary_action: () => {
				if (!marker) {
					frappe.msgprint(__("Pick a point on the map first"));
					return;
				}
				const point = marker.getLatLng();
				dialog.hide();
				this.setCoordinates(point.lat, point.lng);
			},
		});
		dialog.show();
		dialog.$wrapper.addClass("ag-dialog");

		const box = dialog.$wrapper.find(".ag-geo-map-box")[0];
		const readout = dialog.$wrapper.find(".ag-geo-readout");
		const query = dialog.$wrapper.find(".ag-geo-query");
		const results = dialog.$wrapper.find(".ag-geo-results");
		// the name already typed on the form is the obvious first thing to look for
		if (typedName) query.val(typedName);

		let searching = false;
		const search = async () => {
			const text = String(query.val() || "").trim();
			if (!text || searching) return;
			searching = true;
			results.html(`<p class="ag-geo-msg">${__("Searching…")}</p>`);
			try {
				// OpenStreetMap's own gazetteer - the same project whose tiles this map draws.
				// The name leaves the browser, not the server. Its policy asks for at most one
				// request a second, which is why this runs on Enter or the button and never
				// while typing. countrycodes=in keeps a village name from matching a namesake
				// on another continent; drop it if a centre is ever set up outside India.
				const url = "https://nominatim.openstreetmap.org/search"
					+ "?format=jsonv2&limit=6&countrycodes=in&q=" + encodeURIComponent(text);
				const response = await fetch(url, { headers: { Accept: "application/json" } });
				if (!response.ok) throw new Error(String(response.status));
				const found = await response.json();
				if (!found.length) {
					results.html(`<p class="ag-geo-msg">${__("Nothing found for that name. Pick the point on the map instead.")}</p>`);
					return;
				}
				results.html(found.map((row, index) =>
					`<button type="button" class="ag-geo-hit" data-index="${index}">${this.escape(row.display_name)}</button>`).join(""));
				results.find(".ag-geo-hit").on("click", (event) => {
					const row = found[$(event.currentTarget).data("index")];
					const lat = Number(row.lat);
					const lng = Number(row.lon);
					if (map) map.setView([lat, lng], 16);
					place(lat, lng);
					results.find(".ag-geo-hit").removeClass("chosen");
					$(event.currentTarget).addClass("chosen");
				});
			} catch (error) {
				// no network, or the service is refusing - the map still works by hand
				results.html(`<p class="ag-geo-msg">${__("The place search could not be reached. Pick the point on the map instead.")}</p>`);
			} finally {
				searching = false;
			}
		};
		dialog.$wrapper.find(".ag-geo-go").on("click", search);
		query.on("keydown", (event) => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			search();
		});

		// The dialog animates open. Leaflet measures its container as it is built, so a map
		// built too early reads a height of zero and paints the blank grey box that Frappe's
		// own Geolocation control shows in a dialog.
		window.setTimeout(() => {
			// Leaflet guesses its marker images from the script's own URL, which is wrong
			// under Frappe's bundling; the desk control sets the same path.
			L.Icon.Default.imagePath = defaults.image_path;
			map = L.map(box).setView(
				hasPoint ? [startLat, startLng] : defaults.center,
				hasPoint ? 16 : defaults.zoom);
			L.tileLayer(defaults.tiles, defaults.options).addTo(map);

			const show = (lat, lng) => readout.text(
				__("Selected: {0}, {1}", [lat.toFixed(6), lng.toFixed(6)]));
			place = (lat, lng) => {
				if (marker) {
					marker.setLatLng([lat, lng]);
				} else {
					marker = L.marker([lat, lng], { draggable: true }).addTo(map);
					marker.on("dragend", () => {
						const point = marker.getLatLng();
						show(point.lat, point.lng);
					});
				}
				show(lat, lng);
			};
			if (hasPoint) place(startLat, startLng);
			map.on("click", (event) => place(event.latlng.lat, event.latlng.lng));
			map.invalidateSize();
		}, 250);
	}

	getPosition() {
		return new Promise((resolve, reject) => {
			if (!navigator.geolocation) return reject(new Error("no geolocation"));
			navigator.geolocation.getCurrentPosition(resolve, reject, {
				enableHighAccuracy: true,
				timeout: 10000,
				maximumAge: 0,
			});
		});
	}

	async runAttendanceLogin(person) {
		this.attendanceBusy = true;
		let captured = false;
		const camera = this.openFaceDialog(__("Face Verification"), __("Capture & Verify"), async (imageData, dialog) => {
			captured = true;
			try {
				const result = await frappe
					.call({
						method: `${ATTENDANCE_METHOD}.verify_face`,
						args: { labour_name: person, captured_image: imageData },
						freeze: true,
					})
					.then((response) => response.message || {});

				if (result.status !== "success") {
					frappe.msgprint({
						title: __("Face Verification Failed"),
						message: result.message || __("Face Not Matched"),
						indicator: "red",
					});
					dialog.hide();
					this.formControl("name_of_person_al")?.set_value("");
					this.attendanceLastPerson = null;
					return;
				}

				frappe.show_alert({ message: __("Face Matched"), indicator: "green" });
				dialog.hide();
				this.formControl("log_in_al")?.set_value(frappe.datetime.now_time());

				// The face has already been matched. A location the browser will not give is
				// worth saying out loud, but it is not a reason to throw the verified frame
				// away and record no attendance at all - which is what the old flow did: the
				// throw skipped the save and the photo both, and the log that survived was
				// the one saved by hand afterwards, with no coordinates and no picture.
				let coords = null;
				try {
					coords = (await this.getPosition()).coords;
				} catch (locationError) {
					console.error(locationError);
					frappe.show_alert({
						message: __("Location unavailable - attendance saved without it"),
						indicator: "orange",
					});
				}
				if (coords) {
					this.extraFieldValues = {
						...(this.extraFieldValues || {}),
						latitude: coords.latitude,
						longitude: coords.longitude,
						// Frappe stores a Geolocation field as GeoJSON, which is [lng, lat]
						geolocation: JSON.stringify({ type: "Point", coordinates: [coords.longitude, coords.latitude] }),
					};
				}
				await this.saveForm(false);
				// the log has a name only now, so the live frame is attached to it here -
				// failing to keep the photo must not undo an attendance that was accepted
				if (this.formDoc.name) {
					try {
						await frappe.call({
							method: `${ATTENDANCE_METHOD}.save_login_photo`,
							args: { attendance_log: this.formDoc.name, captured_image: imageData },
						});
					} catch (photoError) {
						console.error(photoError);
						frappe.show_alert({ message: __("Attendance saved, but the photo could not be kept"), indicator: "orange" });
					}
				}
			} catch (error) {
				console.error(error);
				dialog.hide();
				frappe.msgprint({
					title: __("Attendance could not be saved"),
					message: this.message(error),
					indicator: "red",
				});
			} finally {
				this.attendanceBusy = false;
			}
		});

		// Closing the camera without capturing - the X, Escape, a click outside - ran no
		// callback at all, so the busy flag stayed raised. That flag is exactly what the
		// person picker tests before opening a camera, so one cancelled dialog meant no
		// camera again for the rest of the page. The person is forgotten too, so picking
		// the same one a second time still counts as a fresh choice.
		const closeCamera = camera.onhide;
		camera.onhide = () => {
			if (closeCamera) closeCamera();
			if (captured) return;
			this.attendanceBusy = false;
			this.attendanceLastPerson = null;
		};
	}

	runAttendanceLogout() {
		const name = this.formDoc.name;
		this.openFaceDialog(__("Logout Face Verification"), __("Capture & Verify Logout"), async (imageData, dialog) => {
			try {
				const position = await this.getPosition();
				const result = await frappe
					.call({
						method: `${ATTENDANCE_METHOD}.mark_logout`,
						args: {
							attendance_log: name,
							captured_image: imageData,
							latitude: position.coords.latitude,
							longitude: position.coords.longitude,
						},
						freeze: true,
					})
					.then((response) => response.message || {});

				dialog.hide();
				if (result.status !== "success") {
					frappe.msgprint({
						title: __("Logout Failed"),
						message: result.message || __("Face Not Matched"),
						indicator: "red",
					});
					return;
				}
				frappe.show_alert({ message: __("Logout Saved Successfully"), indicator: "green" });
				await this.openForm(name);
			} catch (error) {
				console.error(error);
				dialog.hide();
				frappe.msgprint({
					title: __("Location Required"),
					message: __("Please enable GPS permission for logout."),
					indicator: "orange",
				});
			}
		});
	}

	formControl(fieldname) {
		return this.formControls.find((entry) => entry.field.fieldname === fieldname)?.control || null;
	}

	getFormValue(fieldname) {
		return this.formControl(fieldname)?.get_value() || "";
	}

	getMaterialItemsContext() {
		return {
			state: this.tableStates.get("items"),
			holder: this.wrapper.find('.ag-field-slot[data-fieldname="items"]'),
		};
	}

	removeInitialBlankItem(state) {
		if (state.rows.length !== 1) return;
		const first = state.rows[0];
		if (first.controls.item_code?.get_value()) return;
		first.element.remove();
		state.rows = [];
	}

	appendMaterialItems(rows) {
		const { state, holder } = this.getMaterialItemsContext();
		if (!state || !holder.length || !rows.length) return;
		this.removeInitialBlankItem(state);
		rows.forEach((row) => this.addChildRow(state, holder, row));
		frappe.show_alert({ message: __("{0} item(s) added", [rows.length]), indicator: "green" });
		// the "Material Request" / "Supplier Quotation" pills read formDoc.items once at
		// render time, so pulling rows in through this path needs to redraw them by hand
		if (this.state.kind === "purchase-order") this.refreshPurchaseOrderLinks();
	}

	refreshPurchaseOrderLinks() {
		this.wrapper.find(".ag-po-links").replaceWith(this.purchaseOrderLinks());
	}

	scanMaterialBarcode(control) {
		const searchValue = String(control.get_value() || control.$input.val() || "").trim();
		if (!searchValue) return;
		control.$input.prop("disabled", true);
		frappe.call({
			method: "erpnext.stock.utils.scan_barcode",
			args: { search_value: searchValue },
		}).then(async (response) => {
			const scanned = response.message || {};
			if (scanned.warehouse && !scanned.item_code) {
				const warehouseControl = this.formControls.find((entry) => entry.field.fieldname === "set_warehouse")?.control;
				if (warehouseControl) await warehouseControl.set_value(scanned.warehouse);
				await control.set_value("");
				frappe.show_alert({ message: __("Warehouse selected"), indicator: "green" });
				return;
			}
			if (!scanned.item_code) {
				frappe.msgprint(__("No Item found for this barcode."));
				return;
			}
			const itemResponse = await frappe.call({ method: "frappe.client.get", args: { doctype: "Item", name: scanned.item_code } });
			const item = itemResponse.message || {};
			this.appendMaterialItems([{
				item_code: scanned.item_code,
				schedule_date: this.getFormValue("schedule_date") || frappe.datetime.get_today(),
				qty: 1,
				warehouse: this.getFormValue("set_warehouse") || scanned.default_warehouse || "",
				uom: scanned.uom || item.stock_uom || "",
				stock_uom: item.stock_uom || scanned.uom || "",
				conversion_factor: 1,
				description: item.description || "",
			}]);
			await control.set_value("");
		}).catch(() => {
			frappe.msgprint(__("Unable to read this barcode."));
		}).finally(() => {
			control.$input.prop("disabled", false).trigger("focus");
		});
	}

// 	openItemMultiSelect(state, holder) {
// 		const pageSize = 10;
// 		let dialog;
// 		let items = [];
// 		let selectedItem = null;
// 		let requestId = 0;
// 		let searchTimer;
// 		let loadingMore = false;
// 
// 		const resultsHolder = () => dialog.fields_dict.item_results.$wrapper;
// 		const resetSelection = () => {
// 			selectedItem = null;
// 			dialog.set_value("qty", 1);
// 			dialog.fields_dict.qty.$wrapper.hide();
// 			dialog.get_primary_btn().prop("disabled", true);
// 			resultsHolder().find(".ag-item-choice").removeClass("selected").attr("aria-pressed", "false");
// 		};
// 		const selectItem = (itemName) => {
// 			selectedItem = items.find((item) => item.name === itemName) || null;
// 			if (!selectedItem) return;
// 			resultsHolder().find(".ag-item-choice").removeClass("selected").attr("aria-pressed", "false");
// 			resultsHolder().find(`[data-item="${encodeURIComponent(itemName)}"]`).addClass("selected").attr("aria-pressed", "true");
// 			dialog.set_value("qty", 1);
// 			dialog.fields_dict.qty.$wrapper.show();
// 			dialog.get_primary_btn().prop("disabled", false);
// 			setTimeout(() => dialog.fields_dict.qty?.$input?.trigger("focus").select(), 0);
// 		};
// 		const renderItems = (hasMore) => {
// 			const list = items.length
// 				? items.map((item) => `<button type="button" class="ag-item-choice" data-item="${encodeURIComponent(item.name)}" aria-pressed="false">${this.escape(item.item_name || item.name)}</button>`).join("")
// 				: '<div class="ag-item-picker-empty">No items found</div>';
// 			const more = hasMore ? '<div class="ag-item-picker-more-wrap"><button type="button" class="ag-item-picker-more">More</button></div>' : "";
// 			resultsHolder().html(`<div class="ag-item-picker-list">${list}</div>${more}`);
// 			resultsHolder().off("click.agriventureItems")
// 				.on("click.agriventureItems", ".ag-item-choice", (event) => selectItem(decodeURIComponent($(event.currentTarget).attr("data-item"))))
// 				.on("click.agriventureItems", ".ag-item-picker-more", () => loadItems(true));
// 		};
// 		const loadItems = async (append = false) => {
// 			if (append && loadingMore) return;
// 			if (append) loadingMore = true;
// 			const currentRequest = ++requestId;
// 			const searchText = String(dialog.get_value("search_text") || "").trim();
// 			const limitStart = append ? items.length : 0;
// 			if (!append) {
// 				items = [];
// 				resetSelection();
// 				resultsHolder().html('<div class="ag-item-picker-empty">Loading items...</div>');
// 			}
// 			try {
// 				const args = {
// 					doctype: "Item",
// 					fields: ["name", "item_name"],
// 					filters: [["Item", "disabled", "=", 0]],
// 					limit_start: limitStart,
// 					limit_page_length: pageSize + 1,
// 					order_by: "item_name asc",
// 				};
// 				if (searchText) {
// 					args.or_filters = [
// 						["Item", "name", "like", `%${searchText}%`],
// 						["Item", "item_name", "like", `%${searchText}%`],
// 					];
// 				}
// 				const response = await frappe.call({ method: "frappe.client.get_list", args });
// 				if (currentRequest !== requestId) return;
// 				const rows = response.message || [];
// 				const hasMore = rows.length > pageSize;
// 				const page = rows.slice(0, pageSize);
// 				items = append ? items.concat(page) : page;
// 				renderItems(hasMore);
// 			} catch (error) {
// 				if (currentRequest === requestId) resultsHolder().html('<div class="ag-item-picker-empty ag-item-picker-error">Unable to load items</div>');
// 			} finally {
// 				if (currentRequest === requestId) loadingMore = false;
// 			}
// 		};
// 
// 		dialog = new frappe.ui.Dialog({
// 			title: __("Select Item"),
// 			fields: [
// 				{ fieldname: "search_text", fieldtype: "Data", label: __("Beginning with"), description: __("Items filter automatically as you type.") },
// 				{ fieldname: "item_results", fieldtype: "HTML" },
// 				{ fieldname: "qty", fieldtype: "Float", label: __("Quantity"), reqd: 1, default: 1 },
// 			],
// 			primary_action_label: __("Add Item"),
// 			primary_action: async () => {
// 				if (!selectedItem) return;
// 				const qty = Number(dialog.get_value("qty"));
// 				if (!Number.isFinite(qty) || qty <= 0) {
// 					frappe.msgprint(__("Quantity must be greater than zero."));
// 					return;
// 				}
// 				if (state.rows.some((row) => row.controls.item_code?.get_value() === selectedItem.name)) {
// 					frappe.msgprint(__("Item already selected"));
// 					return;
// 				}
// 				dialog.get_primary_btn().prop("disabled", true);
// 				try {
// 					const response = await frappe.call({ method: "frappe.client.get", args: { doctype: "Item", name: selectedItem.name } });
// 					const item = response.message || selectedItem;
// 					this.removeInitialBlankItem(state);
// 					this.addChildRow(state, holder, {
// 						item_code: item.name,
// 						schedule_date: this.getFormValue("schedule_date") || frappe.datetime.get_today(),
// 						qty,
// 						warehouse: this.getFormValue("set_warehouse"),
// 						uom: item.stock_uom || "",
// 						stock_uom: item.stock_uom || "",
// 						conversion_factor: 1,
// 						description: item.description || "",
// 					});
// 					frappe.show_alert({ message: __("Item added"), indicator: "green" });
// 					resetSelection();
// 				} catch (error) {
// 					dialog.get_primary_btn().prop("disabled", false);
// 				}
// 			},
// 			secondary_action_label: __("Done"),
// 			secondary_action: () => dialog.hide(),
// 		});
// 		dialog.show();
// 		dialog.$wrapper.addClass("ag-item-select-dialog");
// 		dialog.fields_dict.qty.$wrapper.hide();
// 		dialog.get_primary_btn().prop("disabled", true);
// 		dialog.fields_dict.search_text.$input.on("input.agriventureItems", () => {
// 			clearTimeout(searchTimer);
// 			searchTimer = setTimeout(() => loadItems(false), 250);
// 		});
// 		dialog.$wrapper.on("hidden.bs.modal.agriventureItems", () => clearTimeout(searchTimer));
// 		loadItems(false);
// 		setTimeout(() => dialog.fields_dict.search_text?.$input?.trigger("focus"), 0);
// 	}

	openGetItemsFrom(doctype) {
		const picker = new frappe.ui.form.MultiSelectDialog({
			doctype,
			target: this.wrapper.get(0),
			add_filters_group: 1,
			primary_action_label: __("Get Items"),
			action: async (selections) => {
				if (!selections.length) {
					frappe.msgprint(__("Please select at least one {0}.", [doctype]));
					return;
				}
				picker.dialog.hide();
				const sourceDocs = await Promise.all(selections.map((name) => frappe.call({
					method: "frappe.client.get",
					args: { doctype, name },
				}).then((response) => response.message)));
				const scheduleDate = this.getFormValue("schedule_date");
				const warehouse = this.getFormValue("set_warehouse");
				const rows = [];
				sourceDocs.forEach((source) => {
					(source.items || []).forEach((item) => rows.push({
						item_code: item.item_code,
						schedule_date: item.delivery_date || item.schedule_date || scheduleDate,
						qty: item.qty || item.stock_qty || 1,
						warehouse: item.warehouse || item.target_warehouse || warehouse,
						uom: item.uom || item.stock_uom,
						stock_uom: item.stock_uom || item.uom,
						conversion_factor: item.conversion_factor || 1,
						description: item.description || "",
						sales_order: doctype === "Sales Order" ? source.name : undefined,
						bom_no: doctype === "BOM" ? source.name : undefined,
						// purchaseOrderLinks() reads these two fields back off each row to
						// build the "Material Request" pill at the top of the PO - without
						// them the pill stays stuck at 0 even after items are pulled in.
						material_request: doctype === "Material Request" ? source.name : undefined,
						material_request_item: doctype === "Material Request" ? item.name : undefined,
					}));
				});
				if (!rows.length) {
					frappe.msgprint(__("No items found in the selected {0}.", [doctype]));
					return;
				}
				this.appendMaterialItems(rows);
			},
		});
	}

	downloadChildRows(state) {
		// a plain sheet: one header row of labels, then the rows as they stand on screen
		const cell = (row, field) => {
			const value = row.controls[field.fieldname]?.get_value();
			return value !== undefined && value !== null && value !== "" ? value : (row.data[field.fieldname] ?? "");
		};
		const data = [state.columns.map((field) => field.label || frappe.model.unscrub(field.fieldname))];
		state.rows.forEach((row) => data.push(state.columns.map((field) => cell(row, field))));
		const title = `${this.formDoc.name || this.formMeta.title} ${state.field.label || ""}`.trim();
		frappe.tools.downloadify(data, null, title);
	}

	uploadChildRows(state, holder) {
		frappe.flags.no_socketio = true;
		new frappe.ui.FileUploader({
			as_dataurl: true,
			allow_multiple: false,
			restrictions: { allowed_file_types: [".csv"] },
			on_success: (file) => {
				const csv = frappe.utils.csv_to_array(frappe.utils.get_decoded_string(file.dataurl));
				const fieldnames = new Set(state.columns.map((field) => field.fieldname));
				const headerIndex = csv.findIndex((row) => row.some((cell) => fieldnames.has(String(cell || "").trim())));
				if (headerIndex < 0) {
					frappe.msgprint({ title: __("Invalid CSV"), message: __("The uploaded file does not contain the Material Request item field headers."), indicator: "red" });
					return;
				}
				const headers = csv[headerIndex].map((cell) => String(cell || "").trim());
				const separatorIndex = csv.findIndex((row, index) => index > headerIndex && String(row[0] || "").trim() === "------");
				const start = separatorIndex >= 0 ? separatorIndex + 1 : headerIndex + 1;
				const imported = [];
				csv.slice(start).forEach((row) => {
					const values = {};
					headers.forEach((fieldname, index) => {
						if (!fieldnames.has(fieldname)) return;
						const df = state.columns.find((field) => field.fieldname === fieldname);
						let value = row[index] ?? "";
						if (df?.fieldtype === "Date" && value) value = frappe.datetime.user_to_str(value);
						if (["Int", "Float", "Currency", "Percent"].includes(df?.fieldtype) && value !== "") value = Number(value);
						values[fieldname] = value;
					});
					if (values.item_code || Object.values(values).some(Boolean)) imported.push(values);
				});
				if (!imported.length) {
					frappe.msgprint(__("No item rows found in the uploaded CSV."));
					return;
				}
				state.rows.forEach((row) => row.element.remove());
				state.rows = [];
				imported.forEach((row) => this.addChildRow(state, holder, row));
				frappe.show_alert({ message: __("Item table updated"), indicator: "green" });
			},
		});
	}

	clearTaxTemplate(reason) {
		// The template is a one-time copy, not a live link: once the rows are edited by hand
		// its name no longer describes the document, so it is cleared rather than left
		// claiming a rate the document does not charge.
		const control = this.formControl("taxes_and_charges");
		if (!control || !control.get_value()) return;
		control.set_value("", true);
		this.markFormDirty();
		frappe.show_alert({
			message: __("Taxes template cleared - the charges no longer match it ({0})", [reason]),
			indicator: "orange",
		});
	}

	bindTaxRowEdits(state, rowContext) {
		if (state.field?.fieldname !== "taxes") return;
		for (const control of Object.values(rowContext.controls)) {
			if (!control.$input) continue;
			control.$input.on("change.agtaxtpl awesomplete-selectcomplete.agtaxtpl", (event) => {
				// only a real edit; the rows the template itself fills in must not clear it
				if (!event.originalEvent) return;
				this.clearTaxTemplate(__("row edited"));
			});
		}
	}

	addChildRow(state, holder, data) {
		const rowContext = { data: { ...data }, controls: {} };
		state.rows.push(rowContext);
		const row = $(`<tr><td class="ag-row-index">${state.rows.length}</td>${state.columns.map((column) => `<td data-child-field="${this.escape(column.fieldname)}"></td>`).join("")}<td><button class="ag-remove-row" type="button" title="Remove row">${this.icon("delete", "xs")}</button></td></tr>`).appendTo(holder.find("tbody"));
		rowContext.element = row;
		for (const column of state.columns) this.renderControl(row.find(`[data-child-field="${column.fieldname}"]`), column, data[column.fieldname], rowContext);
		const itemControl = rowContext.controls.item_code;
		// items already chosen in other rows are filtered out of this row's own search
		// results instead of being caught after the fact - see excludeSelectedItems()
		this.excludeSelectedItems(itemControl, state, rowContext);
		if (itemControl?.$input?.length) itemControl.$input.on("awesomplete-selectcomplete.agitem change.agitem", () => {
			// this.checkDuplicateItem(state, rowContext);
			this.fillItemDefaults(rowContext);
		});
		const cropItem = this.cropItemColumn(state);
		if (cropItem) {
			const cropControl = rowContext.controls[cropItem.fieldname];
			const uomControl = rowContext.controls.uom;
			if (uomControl) {
				uomControl.get_query = () => {
					const allowed = rowContext.data.item_uoms;
					return allowed?.length ? { filters: { name: ["in", allowed] } } : {};
				};
			}
			// the same rule the desk form applies: an item used above is not offered again
			this.excludeSelectedItems(cropControl, state, rowContext);
			if (cropControl?.$input?.length) {
				cropControl.$input.on("awesomplete-selectcomplete.agcropitem change.agcropitem", () =>
					this.fillCropUom(rowContext, cropItem.fieldname)
				);
			}
			// a row loaded with an item but no UOM still gets one, without touching saved rows
			if (cropControl?.get_value() && !uomControl?.get_value()) this.fillCropUom(rowContext, cropItem.fieldname);
		}
		this.bindTaxRowEdits(state, rowContext);
		if (Number(this.formDoc?.docstatus || 0) !== 0 || READ_ONLY_KINDS.includes(this.state.kind)) {
			row.find(".ag-remove-row").remove();
		}
		row.find(".ag-remove-row").on("click", () => {
			// removing a charge is always the user's own doing, so the template goes with it
			if (state.field?.fieldname === "taxes") this.clearTaxTemplate(__("row removed"));
			state.rows = state.rows.filter((item) => item !== rowContext);
			row.remove();
			holder.find(".ag-row-index").each((index, element) => $(element).text(index + 1));
			this.scheduleRecalculation();
		});
		this.propagateParentFields();
		this.scheduleRecalculation();
	}

	collectDocument() {
		const payload = { doctype: this.formMeta.doctype };
		if (this.formDoc.name) payload.name = this.formDoc.name;
		for (const { field, control } of this.formControls) {
			// the Series box shows the document name once it has one; sending that back would
			// read as an attempt to change the series, which Frappe refuses outright
			if (field.fieldname === "naming_series" && this.formDoc.name) continue;
			// a typed name is only meaningful on the document that is being created
			if (field.fieldname === "__newname" && this.formDoc.name) continue;
			const current = control.get_value();
			// Frappe returns `this.value || undefined` for a read-only control, so a zero or
			// an empty string comes back as nothing at all. The document's own value is kept
			// in that case rather than being blanked on the way out.
			payload[field.fieldname] = control.df?.read_only && current === undefined && this.formDoc[field.fieldname] !== undefined
				? this.formDoc[field.fieldname]
				: current;
		}
		// values written by code rather than typed - GPS coordinates, for instance - belong to
		// hidden fields that never become controls, so they are merged last and win
		Object.assign(payload, this.extraFieldValues || {});
		// amended_from is read-only and never rendered, so the loop above cannot see it.
		// Lost on the way out, Frappe names the copy from the series instead of
		// <original>-1, and the amendment trail is broken. The server re-checks it.
		if (this.formDoc.amended_from && !payload.amended_from) {
			payload.amended_from = this.formDoc.amended_from;
		}
		// a mapped document can arrive with child tables this workspace never renders, such as
		// the payment references on a payment raised from an invoice; they are passed through
		// untouched rather than silently dropped
		for (const field of this.formMeta.fields || []) {
			if (field.fieldtype !== "Table" || this.tableStates.has(field.fieldname)) continue;
			const rows = this.formDoc[field.fieldname];
			if (Array.isArray(rows) && rows.length) payload[field.fieldname] = rows;
		}
		for (const [fieldname, state] of this.tableStates.entries()) {
			payload[fieldname] = state.rows.map((row) => {
				const value = { doctype: state.definition.doctype };
				for (const df of state.definition.fields) {
					if (df.fieldname && row.data[df.fieldname] !== undefined) value[df.fieldname] = row.data[df.fieldname];
				}
				if (row.data.name) value.name = row.data.name;
				for (const [name, control] of Object.entries(row.controls)) {
					const current = control.get_value();
					// same as above: an Opening Amount of 0 must survive the trip
					if (control.df?.read_only && current === undefined && value[name] !== undefined) continue;
					value[name] = current;
				}
				return value;
			});
		}
		return payload;
	}

	isChildRowFilled(state, row) {
		// mirrors the server's _is_blank_row: a saved row always counts, while a brand
		// new row only counts once something in it has actually been entered
		const values = { ...row.data };
		for (const [fieldname, control] of Object.entries(row.controls)) values[fieldname] = control.get_value();
		if (values.name) return true;
		return Object.entries(values).some(([fieldname, value]) => {
			if (fieldname === "doctype" || fieldname === "name") return false;
			return value !== undefined && value !== null && value !== "" && value !== 0 && value !== false;
		});
	}

	validateForm() {
		const missing = [];
		for (const { field, control } of this.formControls) {
			if (field.reqd && !control.get_value()) missing.push(field.label);
		}
		for (const state of this.tableStates.values()) {
			if (state.field.reqd && !state.rows.length) missing.push(state.field.label);
			state.rows.forEach((row, index) => {
				// a row the user never filled is dropped before saving, so it is not validated either
				if (!this.isChildRowFilled(state, row)) return;
				for (const column of state.columns) if (column.reqd && !row.controls[column.fieldname]?.get_value()) missing.push(`${state.field.label} row ${index + 1}: ${column.label}`);
			});
		}
		if (missing.length) {
			frappe.msgprint({ title: "Required fields", message: missing.map((field) => `<div>${this.escape(field)}</div>`).join(""), indicator: "orange" });
			return false;
		}
		return true;
	}

	async saveForm(submitAfterSave) {
		if (!this.validateForm()) return;
		if (submitAfterSave && !(await this.confirmSubmit())) return;
		const button = this.wrapper.find(submitAfterSave ? ".ag-submit" : ".ag-save").prop("disabled", true);
		try {
			const saved = await this.api.save(this.state.kind, this.collectDocument());
			await this.linkPendingAttachments(saved.name);
			if (!submitAfterSave) {
				frappe.show_alert({ message: `${saved.name} saved`, indicator: "green" });
				// a master record has no submit step, so there is nothing left to do here
				// nothing here can be submitted, so a save is the end of the edit - logout is
				// picked up again by reopening the log from the list
				if (NON_SUBMITTABLE_KINDS.includes(this.state.kind)) return await this.loadList();
				// stay on the document, which can now be submitted from here
				return await this.openForm(saved.name);
			}
			const result = await this.api.submit(this.state.kind, saved.name);
			frappe.show_alert({ message: `${result.name} submitted`, indicator: "green" });
			// a submitted document is done being edited, so back to the list
			await this.loadList();
		} catch (error) {
			frappe.msgprint({ title: "Unable to save", message: this.message(error), indicator: "red" });
		} finally {
			button.prop("disabled", false);
		}
	}

	confirmSubmit() {
		// the same wording the standard desk uses, because submitting cannot be undone
		const name = this.formDoc.name || this.formMeta.title;
		return new Promise((resolve) => frappe.confirm(
			__("Permanently Submit {0}?", [name]),
			() => resolve(true),
			() => resolve(false),
		));
	}

	confirmLogout() {
		// the arrow sits right under the sidebar links, so a mis-click must not end the
		// session - No leaves everything exactly as it was
		frappe.confirm(
			__("Log out of Agriventure?"),
			() => this.logout(),
			() => {}
		);
	}

	async logout() {
		try { await frappe.call({ method: "logout" }); } finally { window.location.assign("/login"); }
	}

	message(error) {
		if (error?._server_messages) {
			try { return JSON.parse(error._server_messages).map((item) => JSON.parse(item).message || item).join("<br>"); } catch (_) { return error._server_messages; }
		}
		return error?.message || __("An unexpected error occurred.");
	}

	errorMarkup(error) {
		return `<div class="ag-error">${this.icon("error", "md")}<b>Something went wrong</b><span>${this.escape(this.message(error))}</span></div>`;
	}

	renderFatal(error) {
		this.wrapper.html(this.errorMarkup(error));
	}
}
