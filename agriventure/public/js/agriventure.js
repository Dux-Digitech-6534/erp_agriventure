frappe.pages["agriventure-portal"].on_page_load = function (wrapper) {
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

frappe.pages["agriventure-portal"].on_page_show = function () {
	document.body.classList.add("ag-portal-active");
	// Frappe reuses this page's existing DOM/instance on every return visit instead of
	// reloading it, so a route change while it was already open (e.g. Dux Portal linking
	// to a different kind than the one already on screen) would otherwise go unnoticed -
	// the route is normally only ever read once, in openInitialRoute(). Re-run that here
	// whenever the route has actually moved on since the last time it was read.
	const portal = window.__agPortal;
	// not booted yet: start() reads the route itself once the boot is in, so there is
	// nothing to do here and everything to break by trying
	if (!portal || !portal.boot) return;
	const routeStr = frappe.get_route_str ? frappe.get_route_str() : "";
	if (routeStr === portal.lastRouteStr) return;
	portal.openInitialRoute();
};

if (frappe.router && frappe.router.on) {
	frappe.router.on("change", () => {
		const route = frappe.get_route_str ? frappe.get_route_str() : "";
		// startsWith, not ===: a shortcut/bookmark landing on /agriventure-portal/purchase-order
		// (or deeper, e.g. .../purchase-order/PO-2026-00001) is still this same portal.
		document.body.classList.toggle("ag-portal-active", route === "agriventure-portal" || route.startsWith("agriventure-portal/"));
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
		// lcv/stock-entry/retention forced off (when: () => false) rather than removed, so the
		// erpnext-sourced conditions above stay on record - per request 2026-09-05 this portal's
		// Create menu on Purchase Receipt shows Purchase Return only
		{ key: "lcv", group: "Create", label: "Landed Cost Voucher", when: () => false },
		{ key: "return", group: "Create", label: "Purchase Return", when: (doc) => doc.open },
		{ key: "stock-entry", group: "Create", label: "Make Stock Entry", when: () => false },
		{ key: "retention", group: "Create", label: "Retention Stock Entry", when: () => false },
		{ key: "stock-ledger", group: "View", label: "Stock Ledger", when: (doc) => doc.docstatus > 0 },
		{ key: "accounting-ledger", group: "View", label: "Accounting Ledger", when: (doc) => doc.docstatus > 0 },
		{ key: "asset", group: "View", label: "Asset", when: (doc) => doc.docstatus > 0 },
		{ key: "asset-movement", group: "View", label: "Asset Movement", when: (doc) => doc.docstatus > 0 },
		{ key: "close", group: "Status", label: "Close", when: (doc) => doc.open },
		{ key: "reopen", group: "Status", label: "Reopen", when: (doc) => doc.docstatus === 1 && doc.status === "Closed" },
	],
	"journal-entry": [
		// the desk's View > Ledger: the General Ledger narrowed to this voucher. The
		// handler is the one Purchase Receipt already uses - same report, same window,
		// and it reads show_cancelled_entries off the docstatus by itself.
		{ key: "accounting-ledger", group: "View", label: "Ledger", when: (doc) => doc.docstatus > 0 },
	],
	"pos-invoice": [
		// the same condition the desk uses - pos_invoice.js:78 offers Return on a
		// submitted invoice that is not itself a return
		{ key: "pos-return", group: "Create", label: "Return", when: (doc) => doc.open },
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
const CONNECTION_KINDS = ["payment-request", "material-request", "supplier-quotation", "purchase-order",
	"purchase-receipt", "purchase-invoice", "payment-entry"];

const PARENT_ROW_FIELDS = {
	schedule_date: { table: "items", field: "schedule_date" },
	set_warehouse: { table: "items", field: "warehouse" },
};

// Series and Status are the document's own account of itself. Once it is submitted both
// are settled and read as clutter, and the badge beside the title already carries the
// state - so the form drops them, the way the reference screens show them dropped.
// The mirror of the map below: fields with nothing in them until the document exists.
// A Stock Entry reference is written by after_insert, and the two amounts are derived
// from quantity and rate - all three sit blank on a form nobody has saved yet. They
// are still computed and still sent; they simply are not shown until there is
// something to show.
const HIDE_UNTIL_SAVED = {
	"fuel-for-stock": ["stock_entry_reference", "amountffs", "aamountffs"],
	// the total is added up from the rows below it, so on a blank form it is a zero
	// nobody needs to look at - still computed, still sent, just not shown yet
	"fuel-for-distribution": ["stock_entry_reference", "issued_quantity_ltr"],
};

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

// A section the DocType's own form script shows or hides, rather than declaring a
// depends_on the metadata carries. Attendance Log does exactly this in its attendance_log.js:
//     frm.toggle_display("logout_section", !!frm.doc.log_out_al)
// The portal never loads that script, so the same rule is restated here in the form the
// portal already understands - and it stays the doctype's rule, not a new one.
const SECTION_DEPENDS_ON = {
	"attendance-log": { logout_section: "eval:doc.log_out_al" },
};

// Where the app's own name at the top of the sidebar leads. On this install the
// workspace sits inside a larger portal, so the logo goes back to that rather than
// to the bare Desk. One line to change if that ever moves.
// where the collapsed/expanded choice is remembered for this browser
const RAIL_KEY = "agriventure:sidebar-rail";

const PORTAL_ROUTE = "agriventure-portal";

const BRAND_HOME = "/app/dux-portal";

const SHOW_PRINT_ACTIONS = true;

// The print format each kind is printed with - this site's own where it has one, so
// the portal puts out the same paper the desk has always put out rather than a second
// design of its own. Anything not named here falls through to Frappe's Standard, which
// is exactly what the desk does for it too (Material Request, for one, has no custom
// format on this site).
//
// Purchase Order and Purchase Receipt each have two near-identical formats, one of them
// a misspelt copy. The live one is named here: New PO Format was last edited in August
// and is the one the desk shows; New PO Formate has sat untouched since February.
const PRINT_FORMATS = {
	"purchase-order": "New PO Format",
	"purchase-receipt": "New Purchase Receipt",
};

// The portal used to draw its own print layout - printLayout() and the document_print /
// document_pdf endpoints behind it. All of that is still here and still works; setting
// this to false brings it straight back.
const PRINT_VIA_DESK = true;

// documents that carry an approval trail worth showing beside the form
const ACTIVITY_KINDS = ["payment-request", "material-request", "supplier-quotation", "purchase-order",
	"purchase-receipt", "purchase-invoice", "payment-entry", "journal-entry"];

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
const POS_KINDS = ["pos-profile", "pos-opening-entry", "pos-closing-entry", "pos-invoice", "pos-invoice-merge-log"];

// only the profile is plain configuration; the two shift entries are submittable
const POS_CONFIG_KINDS = ["pos-profile"];

// Stock movements, reached from the sidebar and from a crop log's reference.
const STOCK_KINDS = ["stock-entry"];

// Transport: fuel bought into a warehouse, then issued out to vehicles, and the
// vehicles themselves. Owned by agriventure_nagpur_erp - this workspace shows them
// and calls its two whitelisted methods, and changes nothing over there.
const TRANSPORT_KINDS = ["fuel-for-stock", "fuel-for-distribution", "vehicle-details"];

// The two that move stock. Each posts its Stock Entry from after_insert and its own
// desk form then calls frm.disable_save(), because by the time it exists the stock
// has already moved. Same rule here rather than a different one.
const FUEL_LOCKED_KINDS = ["fuel-for-stock", "fuel-for-distribution"];

// The proof of purchase: the only part of a saved fuel entry that can still be filled
// in. Neither writes stock, so adding one changes nothing that has already happened.
const FUEL_ATTACH_FIELDS = ["upload_invoice__invoice_copy",
	"upload_fuel_station_proof__fuel_station_receipt"];

const FUEL_NS = "agriventure_nagpur_erp.agriventure_nagpur_erp.doctype";
const FUEL_STOCK_METHOD = `${FUEL_NS}.fuel_for_stock.fuel_for_stock.get_fuel_stock_by_warehouse`;
const VEHICLE_READING_METHOD = `${FUEL_NS}.fuel_for_distribution.fuel_for_distribution.get_last_vehicle_reading_child`;

// What counts as running low, in litres. Both desk scripts use 30 for diesel; they
// disagree on petrol (3 in one, 5 in the other, and 3 and 5 within one block of the
// same file), so the more cautious of the two is used.
const FUEL_FLOOR = { Diesel: 30, Petrol: 5 };

// Which crop log posts a Stock Entry, and the field each keeps the reference in. Read
// when one is about to be cancelled: that entry is the log's stock, and un-posting it
// leaves the log pointing at a cancelled document. Nothing is blocked - the
// confirmation just says whose stock it is instead of only the docname.
const CROP_LOG_STOCK_REFERENCES = [
	["Harvest Log", "stock_entry_reference_hl"],
	["Spraying Log", "stock_entry_reference_spl"],
	["Sowing Log", "stock_entry_reference_sl"],
	["Fertigation Log", "stock_entry_reference_fl"],
];

// ERPNext's setup masters, grouped the way its own Settings pages group them:
// the company first, then what is bought and stocked, then who it is bought from
// and sold to, then how it is priced and paid for. Order here is the sidebar order.
const SETUP_KINDS = ["company",
	"item", "item-group", "warehouse", "uom", "brand",
	"supplier", "supplier-group", "customer", "customer-group",
	"price-list", "item-price", "mode-of-payment", "address", "account", "cost-center"];

// The four the sidebar actually lists, in this order. The others above stay carried by
// the workspace - their lists and forms still exist and still answer a Link click - they
// are simply not offered as a menu entry, the same way the old till button is kept.
// Account sits beside Cost Center: the two masters every posting reaches for.
const SETUP_NAV_KINDS = ["item", "warehouse", "supplier", "customer", "address",
	"account", "cost-center"];

// Documents this workspace only ever reads. A Stock Entry is posted by a crop log, so
// the form must not offer Save, Submit or Cancel - cancelling one would unpost stock.
// Written by ERPNext itself, so this workspace shows them and never edits them
const READ_ONLY_KINDS = ["pos-invoice", "pos-invoice-merge-log"];

// Cancel is the exception to that. The desk offers it on a POS Invoice and ERPNext
// refuses one that has already been consolidated, so the rule stays its own. A Stock
// Entry is deliberately left out - cancelling it would unpost the stock a crop log put
// there - and so is a merge log, which would unconsolidate a day of sales.
const CANCELLABLE_READ_ONLY_KINDS = ["pos-invoice"];
const POS_PAGE_METHOD = "erpnext.selling.page.point_of_sale.point_of_sale";

// Tiles under the KPI cards. Every one opens a list this workspace actually has - a
// dashboard with nothing behind it is worse than no tile.
const KPI_SHORTCUTS = [
	// `report` opens a dashboard in this workspace; `kind` falls back to that doctype's list
	{ report: "attendance", label: "Attendance", icon: "users" },
	{ report: "production", label: "Production", icon: "crop" },
	{ report: "sales", label: "Sales", icon: "money-coins-1" },
	{ report: "fuel-stock", label: "Fuel Stock", icon: "stock" },
	{ report: "fuel-issue", label: "Fuel Distribution", icon: "tool" },
	// `desk` opens ERPNext's own report on the desk. These three are the accounts
	// team's, with filters and drilldowns this workspace has no version of, so they
	// are handed over whole rather than half-rebuilt.
	{ desk: "General Ledger", label: "General Ledger", icon: "money-coins-1" },
	{ desk: "Stock Ledger", label: "Stock Ledger", icon: "stock" },
	{ desk: "Trial Balance", label: "Trial Balance", icon: "list" },
];

// each report the tiles can reach, so a tile never points at something unbuilt
const REPORT_VIEWS = {
	attendance: "loadAttendanceReport",
	production: "loadProductionReport",
	sales: "loadSalesReport",
	"fuel-stock": "loadFuelStockReport",
	"fuel-issue": "loadFuelIssueReport",
	"general-ledger": "loadGeneralLedger",
	"stock-ledger": "loadStockLedger",
};

// Bookmarkable entry points for the report views above (plus the KPI board itself) - lets
// a Dux Portal tile link straight to one of these the same way it links to a doctype kind.
// Views that are reached by a URL segment rather than by a document kind, so a Dux
// Portal tile can link straight to one. openInitialRoute checks this before it looks
// for a kind, and syncRoute puts the address back to the plain portal URL afterwards.
const VIEW_ROUTES = {
	report: "loadKpiDashboard",
	"attendance-report": "loadAttendanceReport",
	"production-report": "loadProductionReport",
	"sales-report": "loadSalesReport",
	"fuel-stock-report": "loadFuelStockReport",
	"fuel-distribution-report": "loadFuelIssueReport",
	"general-ledger": "loadGeneralLedger",
	"stock-ledger": "loadStockLedger",
	// the till: a shift has to be open, and openPosCheckoutLanding is what asks for one
	"point-of-sale": "openPosCheckoutLanding",
};

// The two fuel dashboards differ only in what they filter by, what they add up and
// what they call. One implementation reads both from here.
const FUEL_REPORTS = {
	"fuel-stock": {
		title: "Fuel Stock Dashboard",
		method: "fuel_stock_report",
		load: "fuelStockReport",
		chart: "Fuel Purchased Daily",
		// the columns that carry money, so the screen formats them as the exports do
		money: ["rate", "amount"],
		totals: [{ key: "quantity", label: "Total Quantity (Ltr)" },
			{ key: "amount", label: "Total Amount", money: true }],
		filters: [
			{ key: "item", label: "Fuel Type", doctype: "Item", empty: "All Fuels", query: { item_group: "Fuel" } },
			{ key: "warehouse", label: "Warehouse", doctype: "Warehouse", empty: "All Warehouses" },
			{ key: "vendor", label: "Supplier", doctype: "Supplier", empty: "All Suppliers" },
		],
		empty: "Nothing was bought between {0} and {1} for these filters.",
		emptyTitle: "No fuel purchases here.",
	},
	"fuel-issue": {
		title: "Fuel Distribution Dashboard",
		method: "fuel_issue_report",
		load: "fuelIssueReport",
		chart: "Fuel Issued Daily",
		money: [],
		totals: [{ key: "run", label: "Total Run (KM)" },
			{ key: "quantity", label: "Total Issued (Ltr)" }],
		filters: [
			{ key: "item", label: "Fuel Type", doctype: "Item", empty: "All Fuels", query: { item_group: "Fuel" } },
			{ key: "warehouse", label: "Warehouse", doctype: "Warehouse", empty: "All Warehouses" },
			{ key: "vehicle", label: "Vehicle", doctype: "Vehicle Details", empty: "All Vehicles" },
		],
		empty: "Nothing was issued between {0} and {1} for these filters.",
		emptyTitle: "No fuel issues here.",
	},
};

// ERPNext's own General Ledger and Stock Ledger, drawn here instead of on the desk.
// The columns come from the report itself - whatever it returns is what is shown - so
// only the filters worth offering are named here. Company and the period are common to
// both and are added to every request.
const LEDGER_REPORTS = {
	"general-ledger": {
		title: "General Ledger",
		filters: [
			{ key: "account", label: "Account", doctype: "Account", empty: "All Accounts" },
			{ key: "voucher_no", label: "Voucher No", empty: "Any Voucher" },
		],
	},
	"stock-ledger": {
		title: "Stock Ledger",
		filters: [
			{ key: "item_code", label: "Item", doctype: "Item", empty: "All Items" },
			{ key: "warehouse", label: "Warehouse", doctype: "Warehouse", empty: "All Warehouses" },
		],
	},
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
// Counted, but not given a card of their own: most Stock Entries here are posted by a
// crop log, and a Merge Log is written by the till - neither is a
// number anyone opens this page to see. They stay in Recent Activity, and in the kinds
// the dashboard totals, so nothing else about the page changes.
const DASHBOARD_HIDE_CARDS = ["stock-entry", "pos-invoice-merge-log"];

const DASHBOARD_TABLES = false;

const CHART_BAR_COLOR = "#ded9fb";
const CHART_LINE_COLOR = "#7b68ee";
// ERPNext's own query hides every profile an administrator is not named on; this one
// keeps that rule for cashiers and lifts it for a System Manager. See portal_extras.
const POS_PROFILE_QUERY = "agriventure.portal_extras.pos_profiles_for_company";
// The till itself: item search/pricing/stock come straight from ERPNext's own stock POS
// screen's whitelisted methods (same ones erpnext.public.js.point-of-sale calls), so pricing,
// tax and stock rules never drift from what the desk POS would compute for the same profile.
const POS_INVOICE_METHOD = "erpnext.accounts.doctype.pos_invoice.pos_invoice";
// items[].item_code missing per row is fine - `get_items` returns whatever it has
const POS_ITEM_PAGE_SIZE = 20;

// Each crop log reads the day's Shift Details for its own activity, so only the field
// names and that activity differ. crop_ops.py serves all of them.
const CROP_OPS_METHOD = "agriventure.crop_ops";
const CROP_LOG_CONFIG = {
	"harvest-log": { activity: "Harvesting", label: "Harvest", date: "date_hl", centre: "centre__location_hl", field: "name_of_field_hl" },
	"spraying-log": { activity: "Spraying", label: "Spraying", date: "date_spl", centre: "centre__location_spl", field: "name_of_field_spl" },
	"sowing-log": { activity: "Sowing", label: "Sowing", date: "date_sl", centre: "centre__location_sl", field: "name_of_field_sl" },
	"fertigation-log": { activity: "Fertigation", label: "Fertigation", date: "date_fl", centre: "centre__location_fl", field: "name_of_field_fl" },
};

const NON_SUBMITTABLE_KINDS = [...MASTER_KINDS, ...ATTENDANCE_KINDS, ...CROP_KINDS, ...POS_CONFIG_KINDS,
	...SETUP_KINDS, ...TRANSPORT_KINDS];

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
// The attendance and shift logic belongs to this site's own app, which has run it for
// 6,982 logs. The portal calls that code rather than shipping a second copy - same
// face matching, same timings, same results as the desk form beside it.
const ATTENDANCE_METHOD = "agriventure_nagpur_erp.agriventure_nagpur_erp.doctype.attendance_log.attendance_log";
const SAVE_LOGIN_PHOTO = false;
// The list's Face Attendance screen replaced the pick-then-scan flow on the form.
// Set this to false to put the old camera-on-person-select back, unchanged.
const FACE_ATTENDANCE_ONLY = true;
const SHIFT_METHOD = "agriventure_nagpur_erp.agriventure_nagpur_erp.doctype.shift_details.shift_details";

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
	"purchase-order": { pr_status: "PR Status" },
	// Paid here means the bill carries no outstanding, whatever mode settled it - so
	// the two money columns sit side by side rather than the status speaking alone
	"pos-invoice": { grand_total: "Total", paid_amount: "Paid", outstanding_amount: "Outstanding" },
	// the field records the exception, the column reads as the state
	"pos-profile": { disabled: "Status" },
	"pos-opening-entry": { period_start_date: "Period Start Date", period_end_date: "Period End Date" },
	"pos-closing-entry": { period_start_date: "Period Start Date", period_end_date: "Period End Date" },
	// each person paired with the task they were put on, joined from the shift's own
	// labour table; the Name of Person and Task Name filters still search it
	"shift-details": { assignments: "Assignment" },
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

// ERPNext's own client controllers never run in this workspace - they need a real frm -
// so the plain field-to-field rules a form actually depends on are restated here, each
// against the line of ERPNext that defines it. Only "fill while still empty" rules
// belong here: anything that recalculates totals already goes through the server's
// recalculate, and anything metadata already describes is handled by fetch_from below.
//
//   kind: { sourceFieldname: [targetFieldname, ...] }
const DERIVED_FIELDS = {
	// erpnext/stock/doctype/item/item.js:282 - the Item Code stands in as the name until
	// one is typed. The server agrees on save (item.py:185), so this only means the field
	// stops sitting blank while the form is still open.
	"item": { item_code: ["item_name"] },
};

// Which column carries the link into the form. `name` unless the list does not show
// it - a Supplier list shows the supplier's name instead, and that is what should be
// clickable rather than nothing at all.
const LIST_LINK_COLUMN = {
	supplier: "supplier_name",
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
	// the setup masters with enough rows to need narrowing down
	"item": [["id", "Item Code", "name"], ["itemname", "Item Name", "item_name"],
		["group", "Item Group", "item_group"]],
	"item-price": [["item", "Item Code", "item_code"], ["pricelist", "Price List", "price_list"]],
	"customer": [["id", "ID", "name"], ["name", "Customer Name", "customer_name"],
		["group", "Customer Group", "customer_group"]],
	"supplier": [["id", "ID", "name"], ["name", "Supplier Name", "supplier_name"],
		["group", "Supplier Group", "supplier_group"]],
	"warehouse": [["id", "ID", "name"], ["company", "Company", "company"]],
	"address": [["id", "ID", "name"], ["type", "Address Type", "address_type"],
		["city", "City", "city"], ["country", "Country", "country"]],
	"account": [["id", "ID", "name"], ["parent", "Parent Account", "parent_account"],
		["root", "Root Type", "root_type"]],
	"cost-center": [["id", "ID", "name"], ["centre", "Cost Center", "cost_center_name"],
		["company", "Company", "company"]],
	"uom": [["id", "UOM", "name"]],
	"pos-invoice": [["id", "ID", "name"], ["customer", "Customer", "customer"],
		["status", "Status", "status"], ["profile", "POS Profile", "pos_profile"]],
	"purchase-order": [["id", "ID", "name"], ["supplier", "Supplier", "supplier"],
		["status", "Status", "status"]],
	"purchase-receipt": [["id", "ID", "name"], ["supplier", "Supplier", "supplier"], ["company", "Company", "company"],
		["status", "Status", "status"]],
	"purchase-invoice": [["id", "ID", "name"], ["supplier", "Supplier", "supplier"], ["company", "Company", "company"],
		["status", "Status", "status"]],
	"payment-request": [["id", "ID", "name"], ["party", "Party", "party"],
		["reference", "Reference Name", "reference_name"], ["status", "Status", "status"]],
	"journal-entry": [["id", "ID", "name"], ["type", "Entry Type", "voucher_type"],
		["reference", "Reference Number", "cheque_no"]],
	"payment-entry": [["id", "ID", "name"], ["paymenttype", "Payment Type", "payment_type"],
		["partytype", "Party Type", "party_type"], ["party", "Party", "party"]],
	"attendance-log": [["id", "ID", "name"], ["person", "Person", "name_of_person_al"],
		["centre", "Centre / Location", "centre__location_al"], ["loginstatus", "Login Status", "login_status_al"]],
	// the centre already stands in for the title here, so there is nothing left for one
	"shift-details": [["id", "ID", "name"], ["centre", "Centre / Location", "centre__location_sd"],
		// the labour table, filtered the way the crop logs filter theirs
		["person", "Name of Person", "assignment_task.name_of_person_lal"],
		["task", "Task Name", "assignment_task.task_name_lal"]],
	// the title filter was the entry type, which Purpose already is - and now that the
	// list is no longer pinned to receipts, that is the filter that separates them
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
	quotationsForRequests(names) { return this.call("quotations_for_requests", { material_requests: JSON.stringify(names) }); }
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
	fuelStockReport(args) { return this.call("fuel_stock_report", args); }
	fuelIssueReport(args) { return this.call("fuel_issue_report", args); }
	deskReport(key, filters) { return this.call("desk_report", { key, filters: JSON.stringify(filters) }); }
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
			"payment-request": { title: "Payment Request", badge: "PRQ", icon: "money-coins-1", summary: "Payment Requests" },
			"journal-entry": { title: "Journal Entry", badge: "JE", icon: "small-file", summary: "Journal Entries" },
			"field-details": { title: "Field Details", badge: "FD", icon: "crop", summary: "Field Details" },
			"labour-details": { title: "Labour Details", badge: "LD", icon: "users", summary: "Labour Details" },
			"supervisor-details": { title: "Supervisor Details", badge: "SD", icon: "assign", summary: "Supervisor Details" },
			"centre-location-details": { title: "Centre and Location Details", badge: "CL", icon: "map", summary: "Centre and Location Details" },
			"category-details": { title: "Category Details", badge: "CD", icon: "tag", summary: "Category Details" },
			"attendance-log": { title: "Attendance Log", badge: "AL", icon: "calendar", summary: "Attendance Logs" },
			"shift-details": { title: "Shift Details", badge: "SD", icon: "list", summary: "Shift Details" },
			"harvest-log": { title: "Harvest Log", badge: "HL", icon: "crop", summary: "Harvest Logs" },
			"spraying-log": { title: "Spraying Log", badge: "SP", icon: "tool", summary: "Spraying Logs" },
			"sowing-log": { title: "Sowing Log", badge: "SW", icon: "milestone", summary: "Sowing Logs" },
			"fertigation-log": { title: "Fertigation Log", badge: "FL", icon: "filter", summary: "Fertigation Logs" },
			"stock-entry": { title: "Stock Entry", badge: "SE", icon: "stock", summary: "Stock Entries" },
			"fuel-for-stock": { title: "Fuel for Stock", badge: "FS", icon: "stock", summary: "Fuel for Stock" },
			"fuel-for-distribution": { title: "Fuel for Distribution", badge: "FD", icon: "tool", summary: "Fuel for Distribution" },
			"vehicle-details": { title: "Vehicle Details", badge: "VD", icon: "list", summary: "Vehicle Details" },
			"pos-profile": { title: "POS Profile", badge: "PP", icon: "setting-gear", summary: "POS Profiles" },
			"pos-opening-entry": { title: "POS Opening Entry", badge: "PO", icon: "today", summary: "POS Opening Entries" },
			"pos-closing-entry": { title: "POS Closing Entry", badge: "PC", icon: "check", summary: "POS Closing Entries" },
			"pos-invoice": { title: "POS Invoice", badge: "PSI", icon: "retail", summary: "POS Invoices" },
			// ---- Setup masters, shown under SETTINGS in the sidebar ----
			"company": { title: "Company", badge: "CO", icon: "organization", summary: "Companies" },
			"item": { title: "Item", badge: "IT", icon: "stock", summary: "Items" },
			"item-group": { title: "Item Group", badge: "IG", icon: "tag", summary: "Item Groups" },
			"warehouse": { title: "Warehouse", badge: "WH", icon: "branch", summary: "Warehouses" },
			"uom": { title: "UOM", badge: "UM", icon: "quantity-1", summary: "UOMs" },
			"brand": { title: "Brand", badge: "BR", icon: "sell", summary: "Brands" },
			"supplier": { title: "Supplier", badge: "SU", icon: "buying", summary: "Suppliers" },
			"supplier-group": { title: "Supplier Group", badge: "SG", icon: "users", summary: "Supplier Groups" },
			"customer": { title: "Customer", badge: "CU", icon: "customer", summary: "Customers" },
			"customer-group": { title: "Customer Group", badge: "CG", icon: "share-people", summary: "Customer Groups" },
			"price-list": { title: "Price List", badge: "PL", icon: "list", summary: "Price Lists" },
			"item-price": { title: "Item Price", badge: "IP", icon: "money-coins-1", summary: "Item Prices" },
			"mode-of-payment": { title: "Mode of Payment", badge: "MP", icon: "card", summary: "Modes of Payment" },
			"address": { title: "Address", badge: "AD", icon: "map", summary: "Addresses" },
			"account": { title: "Account", badge: "AC", icon: "money-coins-1", summary: "Accounts" },
			"cost-center": { title: "Cost Center", badge: "CC", icon: "expenses", summary: "Cost Centers" },
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
		const href = "/assets/agriventure/css/agriventure.css?v=perms30c";
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
			await this.openInitialRoute();
		} catch (error) {
			this.renderFatal(error);
		}
	}

	// A shortcut/bookmark can point straight at a kind - and optionally a specific document -
	// via extra segments after the page name, e.g. /app/agriventure-portal/purchase-order or
	// .../purchase-order/PO-2026-00001. Read once here, on first load only; internal
	// navigation from here on never touches the URL (see the history-guard note up top), so
	// nothing else in the app needs to know or care that it was opened this way.
	async openInitialRoute() {
		// every path in here needs the boot - the kinds it checks against live on it
		if (!this.boot) return;
		this.lastRouteStr = frappe.get_route_str ? frappe.get_route_str() : "";
		const route = frappe.get_route ? frappe.get_route() : [];
		const kind = route[1];
		if (kind && VIEW_ROUTES[kind]) {
			this.backGuard = true;
			this.deepLinkEntry = true;
			await this[VIEW_ROUTES[kind]]();
			return;
		}
		if (kind && this.config[kind]) {
			this.state.kind = kind;
			if (route[2]) {
				await this.openForm(route[2]);
			} else {
				// A real browser entry (e.g. a Dux Portal tile linking straight to this kind's
				// list) already put a distinct entry in history - that already covers what the
				// guard below exists for, so skip pushing another one, and let the first Back
				// press here exit to wherever the user actually came from instead of bouncing
				// through this portal's own dashboard first.
				this.backGuard = true;
				this.deepLinkEntry = true;
				await this.loadList();
			}
			return;
		}
		await this.loadDashboard();
	}

	renderShell() {
		const navFor = (keys) => keys.map((key) => `
			<button class="ag-nav" type="button" data-kind="${key}" title="${this.escape(this.config[key].title)}">
				<span class="ag-doc-icon">${this.icon(this.config[key].icon, "sm")}</span><span>${this.config[key].title}</span>
			</button>`).join("");
		const keys = Object.keys(this.config);
		const grouped = [...MASTER_KINDS, ...ATTENDANCE_KINDS, ...CROP_KINDS, ...POS_KINDS, ...STOCK_KINDS,
			...TRANSPORT_KINDS,
			...SETUP_KINDS];
		const nav = navFor(keys.filter((key) => !grouped.includes(key)));
		// a group is listed in the order its own array gives, and skips anything the server
		// did not advertise - so moving an entry is a matter of moving it in that array
		const groupNav = (kinds) => navFor(kinds.filter((key) => this.config[key]));
		const masterNav = groupNav(MASTER_KINDS);
		const attendanceNav = groupNav(ATTENDANCE_KINDS);
		const cropNav = groupNav(CROP_KINDS);
		// Hidden from the sidebar per request 2026-09-05 (kept, not deleted - data-action=open-pos
		// below still binds it in bindShellEvents, so it still works if ever re-added to posNav).
		const tillButton = `<button class="ag-nav" type="button" data-action="open-pos"><span class="ag-doc-icon">${this.icon("retail", "sm")}</span><span>Point of Sale</span></button>`;
		// The new custom checkout is now the only "Point of Sale" entry shown in the sidebar -
		// labelled plainly since it's no longer sitting next to the old one.
		const tillButtonNew = `<button class="ag-nav" type="button" data-action="open-pos-new"><span class="ag-doc-icon">${this.icon("retail", "sm")}</span><span>Point of Sale</span></button>`;
		const posKeys = POS_KINDS.filter((key) => this.config[key]);
		const afterKey = posKeys.includes("pos-profile") ? "pos-profile" : posKeys[posKeys.length - 1];
		const posNav = posKeys.length
			? posKeys.map((key) => navFor([key]) + (key === afterKey ? tillButtonNew : "")).join("")
			: tillButtonNew;
		const stockNav = groupNav(STOCK_KINDS);
		const transportNav = groupNav(TRANSPORT_KINDS);
		const setupNav = groupNav(SETUP_NAV_KINDS);
		this.wrapper.html(`<div class="agriventure-app ag-setup-collapsed">
			<div class="ag-mobile-backdrop" data-action="close-menu"></div>
			<aside class="ag-sidebar">
				<a class="ag-brand${this.boot.brand_logo ? " ag-brand-logo" : ""}" href="${BRAND_HOME}">${this.boot.brand_logo
					? `<img src="${this.escape(this.boot.brand_logo)}" alt="Agriventure">`
					: `<strong>Agriventure</strong><small>WORK</small>`}</a>
				<div class="ag-menu-search"><span>${this.icon("search", "xs")}</span><input aria-label="Search menu" placeholder="Search menu…"><kbd class="ag-kbd">Ctrl K</kbd></div>
				<nav>
					<button class="ag-nav ag-dashboard-nav active" type="button" data-view="dashboard"><span class="ag-doc-icon">${this.icon("dashboard", "sm")}</span><span>Dashboard</span></button>
					<button class="ag-nav-heading" type="button" data-action="toggle-transactions" aria-expanded="true"><span>TRANSACTIONS</span>${this.icon("down", "xs")}</button>
					<div class="ag-transaction-list">${nav}</div>
					<button class="ag-nav-heading" type="button" data-action="toggle-attendance" aria-expanded="true"><span>ATTENDANCE</span>${this.icon("down", "xs")}</button>
					<div class="ag-attendance-list">${attendanceNav}</div>
					<button class="ag-nav-heading" type="button" data-action="toggle-pos" aria-expanded="true"><span>POINT OF SALE</span>${this.icon("down", "xs")}</button>
					<div class="ag-pos-list">${posNav}</div>
					<button class="ag-nav-heading" type="button" data-action="toggle-crop" aria-expanded="true"><span>CROP OPERATIONS</span>${this.icon("down", "xs")}</button>
					<div class="ag-crop-list">${cropNav}</div>
					<div class="ag-reports-list">
						<button class="ag-nav-heading ag-nav-heading-link" type="button" data-action="open-kpi"><span>REPORT</span></button>
					</div>
					<button class="ag-nav-heading" type="button" data-action="toggle-stock" aria-expanded="true"><span>STOCK</span>${this.icon("down", "xs")}</button>
					<div class="ag-stock-list">${stockNav}</div>
					<button class="ag-nav-heading" type="button" data-action="toggle-transport" aria-expanded="true"><span>TRANSPORT</span>${this.icon("down", "xs")}</button>
					<div class="ag-transport-list">${transportNav}</div>
					<button class="ag-nav-heading" type="button" data-action="toggle-masters" aria-expanded="true"><span>MASTER SETTING</span>${this.icon("down", "xs")}</button>
					<div class="ag-master-list">${masterNav}</div>
					<button class="ag-nav-heading" type="button" data-action="toggle-setup" aria-expanded="false"><span>SETTINGS</span>${this.icon("down", "xs")}</button>
					<div class="ag-setup-list">${setupNav}</div>
				</nav>
				<button class="ag-collapse-toggle" type="button" data-action="toggle-rail"><span class="ag-collapse-icon">${this.icon("sidebar-collapse", "sm")}</span><span>${__("Collapse")}</span></button>
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
		// restored before the first paint the user sees, so the rail never flashes open
		try {
			if (window.localStorage.getItem(RAIL_KEY) === "1") this.wrapper.find(".agriventure-app").addClass("ag-rail");
		} catch (error) { /* private window */ }
		this.bindShellEvents();
		this.bindLinkRedirects();
	}

	// Which portal kind, if any, owns a given DocType. Built once from what the server
	// actually advertised, so a kind whose name differs from its DocType (category-details
	// -> Category Master) is matched just as reliably as one where they agree. Both the
	// DocType name and its route slug are registered, since a Link's href carries the slug
	// while a read-only Link's data-doctype carries the name.
	kindForDoctype(doctype) {
		if (!this.boot || !this.boot.doctypes) return null;
		if (!this.doctypeKinds) {
			this.doctypeKinds = new Map();
			Object.keys(this.boot.doctypes).forEach((kind) => {
				const name = this.boot.doctypes[kind] && this.boot.doctypes[kind].doctype;
				if (!name || !this.config[kind]) return;
				const plain = String(name).toLowerCase();
				this.doctypeKinds.set(plain, kind);
				this.doctypeKinds.set(plain.replace(/ /g, "-"), kind);
			});
		}
		return this.doctypeKinds.get(String(doctype || "").toLowerCase()) || null;
	}

	bindLinkRedirects() {
		// its own namespace, so bindShellEvents' off(".agriventure") never drops it
		this.wrapper.off(".aglink").on("click.aglink", "a[href^='/app/']", (event) => {
			const anchor = $(event.currentTarget);
			// the brand goes to Dux Portal on purpose, and a report's links open a new tab
			if (anchor.is(".ag-brand, .ag-rep-link") || anchor.attr("target")) return;
			// a modified click means "new tab" - that belongs to the browser, not to us
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			let doctype = anchor.attr("data-doctype");
			let name = anchor.attr("data-name");
			if (!doctype || !name) {
				// the editable control's open arrow carries only an href
				const parts = String(anchor.attr("href") || "").split("?")[0].split("/").filter(Boolean);
				if (parts[0] !== "app" || parts.length < 3) return;
				doctype = decodeURIComponent(parts[1]);
				name = decodeURIComponent(parts.slice(2).join("/"));
			}
			const kind = this.kindForDoctype(doctype);
			if (!kind) return;
			event.preventDefault();
			event.stopPropagation();
			this.state.kind = kind;
			this.state.start = 0;
			this.openForm(String(name));
		});
	}

	bindShellEvents() {
		this.wrapper.off(".agriventure");
		this.wrapper.on("click.agriventure", "[data-view=dashboard]", (event) => {
			// the brand is an anchor so it can still be opened in a new tab; a plain click
			// belongs to the portal, not to the browser
			event.preventDefault();
			this.loadDashboard();
		});
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
		this.wrapper.on("click.agriventure", "[data-action=open-pos-new]", () => this.openPosCheckoutLanding());
		this.wrapper.on("click.agriventure", "[data-action=open-kpi]", () => this.loadKpiDashboard());
		// the reports are reached from the board, so each one offers the way back
		this.wrapper.on("click.agriventure", ".ag-rep-back", () => this.loadKpiDashboard());
		this.wrapper.on("click.agriventure", "[data-action=toggle-pos]", (event) => {
			const app = this.wrapper.find(".agriventure-app");
			app.toggleClass("ag-pos-collapsed");
			$(event.currentTarget).attr("aria-expanded", String(!app.hasClass("ag-pos-collapsed")));
		});
		this.wrapper.on("click.agriventure", "[data-action=toggle-setup]", (event) => {
			const app = this.wrapper.find(".agriventure-app");
			app.toggleClass("ag-setup-collapsed");
			$(event.currentTarget).attr("aria-expanded", String(!app.hasClass("ag-setup-collapsed")));
		});
		this.wrapper.on("click.agriventure", "[data-action=toggle-transport]", (event) => {
			const app = this.wrapper.find(".agriventure-app");
			app.toggleClass("ag-transport-collapsed");
			$(event.currentTarget).attr("aria-expanded", String(!app.hasClass("ag-transport-collapsed")));
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
		// The rail: the sidebar narrows to its icons and the main area widens with it.
		// Both read --ag-sidebar, so one variable moves the whole layout; the transition
		// lives on width and margin-left, which do animate.
		this.wrapper.on("click.agriventure", "[data-action=toggle-rail]", () => {
			const app = this.wrapper.find(".agriventure-app");
			const railed = app.toggleClass("ag-rail").hasClass("ag-rail");
			try { window.localStorage.setItem(RAIL_KEY, railed ? "1" : "0"); } catch (error) { /* private window */ }
		});
		// Ctrl+K / Cmd+K puts the cursor in the menu search, which is what the badge says
		$(document).off("keydown.agsearch").on("keydown.agsearch", (event) => {
			if (!(event.ctrlKey || event.metaKey) || String(event.key).toLowerCase() !== "k") return;
			if (!this.wrapper.find(".agriventure-app").length) return;
			event.preventDefault();
			// searching is pointless while the labels are hidden, so the rail opens first
			this.wrapper.find(".agriventure-app").removeClass("ag-rail");
			this.wrapper.find(".ag-menu-search input").trigger("focus").trigger("select");
		});
		this.wrapper.on("click.agriventure", "[data-action=open-menu]", () => this.wrapper.find(".agriventure-app").addClass("ag-menu-open"));
		this.wrapper.on("click.agriventure", "[data-action=close-menu]", () => this.wrapper.find(".agriventure-app").removeClass("ag-menu-open"));
		this.wrapper.on("click.agriventure", "[data-action=logout]", () => this.confirmLogout());
		this.wrapper.on("input.agriventure", ".ag-menu-search input", (event) => {
			const query = event.target.value.trim().toLowerCase();
			this.wrapper.find(".ag-transaction-list .ag-nav,.ag-master-list .ag-nav,.ag-attendance-list .ag-nav,.ag-crop-list .ag-nav,.ag-pos-list .ag-nav,.ag-stock-list .ag-nav,.ag-transport-list .ag-nav,.ag-setup-list .ag-nav,.ag-reports-list .ag-nav-heading-link").each((_, item) => $(item).toggle($(item).text().toLowerCase().includes(query)));
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
			// remembered separately from backGuard, because the flag is also raised for a
			// deep-link entry where nothing was pushed - see below
			this.guardPushed = true;
			history.pushState({ agriventure: true }, "");
			return;
		}
		this.backGuard = false;
		// Landing straight on a list from Dux Portal raises backGuard without pushing
		// anything (openInitialRoute says so itself). Spending a history.back() that was
		// never pushed walks the browser out of this page entirely - which is exactly how
		// opening Material Request from Dux Portal and then clicking Dashboard ended up
		// back on Dux Portal. There is nothing to spend here, so nothing is spent.
		if (!this.guardPushed) {
			this.deepLinkEntry = false;
			return;
		}
		// back on the dashboard by some other route - the sidebar, say - so the guard is
		// spent now rather than costing the user a wasted press later
		this.guardPushed = false;
		this.skipBack = true;
		history.back();
	}

	handleBack() {
		// true means this was ours to handle and the browser should be told no more
		if (this.skipBack) {
			this.skipBack = false;
			return true;
		}
		if (this.deepLinkEntry) {
			// First Back press after landing straight on a list view from outside (see
			// openInitialRoute) - no guard entry was pushed for it, so let the browser
			// genuinely navigate away instead of redirecting into this portal's dashboard.
			this.deepLinkEntry = false;
			this.backGuard = false;
			return false;
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
		this.syncRoute();
	}

	syncRoute() {
		// One address for the whole workspace. A Dux Portal tile may link deeper -
		// /app/agriventure-portal/purchase-order - and openInitialRoute opens exactly that
		// view; the moment it has, the extra segments have done their job and the address
		// bar is put back to the plain portal URL. Leaving them there was what made a
		// Material Request read .../purchase-invoice: a link that had been spent already.
		//
		// replaceState, never push: syncBackGuard owns the history stack and spends a single
		// guard entry on Back. An entry per click here would fight it.
		if (!this.boot) return;
		const path = "/app/" + PORTAL_ROUTE;
		if (window.location.pathname === path) return;
		try {
			history.replaceState(history.state, "", path);
		} catch (error) {
			return; // a browser that refuses this is no reason to break the view
		}
		// on_page_show compares the route it reads against this; without the update it would
		// treat the URL we just wrote as somewhere the user asked to go, and navigate again
		this.lastRouteStr = PORTAL_ROUTE;
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
			if (!DASHBOARD_HIDE_CARDS.includes(kind)) {
				cards.push({ kind, icon: config.icon, label: config.summary, count: Number(result.count || 0) });
			}
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
		// a read-only kind has nothing to add, so the button would only open a dead
		// form - and neither has anyone without create rights on it
		const addButton = READ_ONLY_KINDS.includes(this.state.kind) || !this.perms().create
			? ""
			: `<button class="ag-button ag-button-primary ag-new" type="button">${this.icon("add", "xs")} Add ${item.title}</button>`;
		// the fast way in: no centre, no name, just the face. The Add button stays for
		// anyone whose photo cannot be matched.
		const faceButton = this.state.kind === ATTENDANCE_KIND
			? `<button class="ag-button ag-button-light ag-face-attendance" type="button">${this.icon("users", "xs")} ${__("Face Attendance")}</button>`
			: "";
		content.html(`<div class="ag-page-head"><h1>${item.title}</h1><div class="ag-page-head-actions">${faceButton}${addButton}</div></div>
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
		content.on("click.aglist", ".ag-face-attendance", () => this.openFaceAttendance());
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
			if (fieldname === (LIST_LINK_COLUMN[this.state.kind] || "name")) {
				// data-name stays the docname; only what is printed on it changes
				return `<button class="ag-doc-link" data-name="${this.escape(row.name)}">${this.escape(row[fieldname] || row.name)}</button>`;
			}
			// one receipt can carry items from several orders, so this is a comma list -
			// each PO gets its own chip, opening straight into the Purchase Order kind
			if (fieldname === "custom_purchase_orders") {
				const names = String(row.custom_purchase_orders || "").split(",").map((entry) => entry.trim()).filter(Boolean);
				if (!names.length) return "—";
				return names.map((po) => `<button class="ag-po-chip" data-name="${this.escape(po)}">${this.escape(po)}</button>`).join("");
			}
			if (["status", "workflow_state", "pr_status"].includes(fieldname)) return this.statusBadge(row[fieldname] || "Draft");
			// a POS Profile records whether it is switched off; the list says which it is
			if (this.state.kind === "pos-profile" && fieldname === "disabled") {
				return this.statusBadge(Number(row.disabled) ? "Disabled" : "Enabled");
			}
			// a Datetime keeps its time: on a closing entry the shift's start and end are
			// both today, and only the clock tells them apart
			if (fieldTypes.get(fieldname) === "Datetime") return this.formatDateTime(row[fieldname]);
			// The name test alone missed every date not called one - Valid Till printed its
			// raw 2026-09-05. The field's own type is what decides it; the name stays as a
			// fallback for a column the meta does not describe.
			if (fieldTypes.get(fieldname) === "Date" || fieldname.includes("date")) return this.formatDate(row[fieldname]);
			// A Time column reads HH:MM:SS on the desk; a value saved with microseconds still
			// carries them into this list otherwise, since the generic Data format below
			// leaves a string untouched. Sliced rather than reformatted - a stored value is
			// already zero-padded HH:MM:SS(.ffffff), never anything a parser is needed for.
			if (fieldTypes.get(fieldname) === "Time") return row[fieldname] ? String(row[fieldname]).slice(0, 8) : "—";
			return frappe.format(row[fieldname], { fieldtype: isAmount(fieldname) ? "Currency" : "Data" }) || "—";
		};
		// The cheapest quotation is decided on the server, per Material Request and on the
		// items the competing quotations actually share - not by whichever total on this page
		// happens to be smallest, which said nothing except that someone asked for less.
		const isLowest = (row, fieldname) => fieldname === "grand_total" && Number(row.is_cheapest) === 1;

		// every cell carries its own column name, so a list can size a column in CSS
		const cellClass = (fieldname, lowest = false) => ` class="ag-col-${this.escape(fieldname)}${isAmount(fieldname) ? " ag-amount-cell" : ""}${lowest ? " ag-lowest" : ""}"`;
		const bodyCell = (row, fieldname) => {
			const lowest = isLowest(row, fieldname);
			const title = lowest
				? ` title="${this.escape(__("Cheapest for {0}, compared on the items these quotations share", [row.cheapest_for || ""]))}"`
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
		this.renderFuelStockCard(content);
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

	// A POS Invoice is written by the till, so its form only reads it. The exception is
	// a return: it is begun here from the Create menu and arrives as an unsaved draft,
	// and a draft that cannot be saved would be a dead end. Anything already submitted
	// stays untouchable, and the list's Add button stays gone either way.
	// What this user may do with the kind on screen, as the server worked it out
	// and sent with the boot. A flag that is missing counts as allowed: the server
	// still refuses the write, and an older cached boot should not lock anyone out
	// of a screen they are entitled to.
	perms(kind) {
		const entry = this.boot?.doctypes?.[kind || this.state.kind] || {};
		return {
			create: entry.can_create !== false,
			write: entry.can_write !== false,
			remove: entry.can_delete !== false,
			submit: entry.can_submit !== false,
			cancel: entry.can_cancel !== false,
			amend: entry.can_amend !== false,
		};
	}

	formReadOnly() {
		// read but not write: the document is shown, not opened for editing, exactly
		// as the desk does it. Every edit control hangs off this one answer.
		if (!this.perms().write) return true;
		// Both fuel forms post their Stock Entry on insert and then lock themselves
		// (frm.disable_save() in each refresh handler). Once one exists the stock has
		// already moved, so there is nothing left here to change.
		if (FUEL_LOCKED_KINDS.includes(this.state.kind) && this.formDoc?.name) return true;
		if (!READ_ONLY_KINDS.includes(this.state.kind)) return false;
		return !(this.state.kind === "pos-invoice" && Number(this.formDoc?.docstatus || 0) === 0);
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
				// forced off rather than removed, so the erpnext condition it replaces stays
				// on record: an invoice is raised from the receipt here, not from the order
				"Purchase Invoice": () => false,
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
		if (docstatus === 2 && this.perms().amend
			&& (this.formMeta?.fields || []).some((field) => field.fieldname === "amended_from")) {
			buttons.push(`<button class="ag-button ag-button-primary ag-amend" type="button">${this.icon("edit", "xs")} ${__("Amend")}</button>`);
		}
		// pushed before the read-only gate, which is what would otherwise cut it off
		if (docstatus === 1 && this.perms().cancel && CANCELLABLE_READ_ONLY_KINDS.includes(this.state.kind)) {
			buttons.push(`<button class="ag-button ag-button-danger ag-cancel-doc" type="button">${this.icon("close", "xs")} Cancel</button>`);
		}
		// pushed before the gate for the same reason Cancel is: a locked fuel entry can
		// still take its invoice photos, so it still needs somewhere to save them
		if (this.fuelAttachOpen() && this.perms().write) {
			buttons.push('<button class="ag-button ag-button-primary ag-save" type="button">Save</button>');
		}
		if (this.formReadOnly()) return buttons.join("");
		buttons.push('<span class="ag-workflow-actions"></span>');
		// Update Items, on the same conditions as purchase_order.js:345 - open, not fully
		// received and not fully billed. can_update_items (a subcontracted order that already
		// has a Subcontracting Order) is left to the server, which refuses it with a message.
		if (this.state.kind === "purchase-order" && docstatus === 1
			&& !["Closed", "Delivered"].includes(doc.status)
			&& Number(doc.per_received || 0) < 100 && Number(doc.per_billed || 0) < 100) {
			buttons.push(`<button class="ag-button ag-button-light ag-update-items" type="button">${__("Update Items")}</button>`);
		}
		if (docstatus === 1 && this.perms().cancel) buttons.push(`<button class="ag-button ag-button-danger ag-cancel-doc" type="button">${this.icon("close", "xs")} Cancel</button>`);
		if (draft) {
			buttons.push('<button class="ag-button ag-button-primary ag-save" type="button">Save</button>');
			// with a workflow in charge, submission happens through its own actions instead
			if (doc.name && this.perms().submit && !this.formMeta?.workflow && !NON_SUBMITTABLE_KINDS.includes(this.state.kind)) buttons.push('<button class="ag-button ag-button-light ag-submit" type="button">Submit</button>');
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
			// A field like Remarks holds ERPNext's own auto-generated block of text (amount,
			// party, reference number, date, all in one string) - not read-only, so the
			// backend's own filtering can't drop it, and it dwarfs every real headline change
			// next to it. Dropped here instead of server-side because that needs a Python edit
			// plus a restart to take effect, and this workspace is not to be restarted for it.
			const allChanges = event.changes || [];
			const visibleChanges = allChanges.filter((change) => !/^Remarks:/i.test(change) && change.length <= 160);
			const hiddenCount = allChanges.length - visibleChanges.length;
			const changes = visibleChanges.map((change) => `<li>${this.escape(change)}</li>`).join("")
				+ (hiddenCount ? `<li>${__("+{0} more update(s)", [hiddenCount])}</li>` : "");
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
		// A workflow can list the same action more than once, one row per role allowed to
		// take it: this site's Purchase Order workflow has Rejected --Re-open--> Pending
		// written twice, for PO Approver L1 and for L2. Anyone holding both roles got both
		// rows back from get_transitions (workflow.py:67 filters by role, nothing else) and
		// so got two identical buttons. Frappe's own toolbar does not collapse them either.
		//
		// Collapsing by action is not just cosmetic: apply_workflow is given the action name
		// alone, so duplicate rows cannot be told apart when one is applied. One button is
		// therefore all that can honestly be offered - and pressing it does what pressing
		// either of the two did.
		const unique = [];
		const seen = new Set();
		transitions.forEach((transition) => {
			const action = transition && transition.action;
			if (!action || seen.has(action)) return;
			seen.add(action);
			unique.push(transition);
		});
		holder.html(unique.map((transition) => `<button class="ag-button ag-button-light ag-wf-action" type="button" data-action="${this.escape(transition.action)}">${this.escape(transition.action)}</button>`).join(""));
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

	async cropLogOwner(name) {
		// only a Stock Entry can be one, and only a saved one can be referenced
		if (this.state.kind !== "stock-entry" || !name) return null;
		for (const [doctype, fieldname] of CROP_LOG_STOCK_REFERENCES) {
			try {
				const found = await frappe.db.get_list(doctype,
					{ filters: { [fieldname]: name }, fields: ["name"], limit: 1 });
				if (found && found.length) return { doctype, name: found[0].name };
			} catch (error) {
				// a log this user cannot read is not worth stopping the cancel over;
				// they simply get the plain question instead of the named one
			}
		}
		return null;
	}

	async cancelDocument() {
		const owner = await this.cropLogOwner(this.formDoc.name);
		const question = owner
			? __("{0} was posted by {1} {2}. Cancelling it will un-post that stock. Cancel anyway?",
				[this.formDoc.name, __(owner.doctype), owner.name])
			: __("Cancel {0}?", [this.formDoc.name]);
		const confirmed = await new Promise((resolve) => frappe.confirm(question, () => resolve(true), () => resolve(false)));
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

	async openMappedHere(kind, method, args, prepare) {
		// the desk's mapper builds the document; this workspace opens it, unsaved, on its
		// own form instead of handing it to the desk
		const document = await frappe.xcall(method, args);
		if (!document) return;
		// a caller may still have to correct the copy, the way the desk's own form does
		// in its refresh handler
		if (prepare) prepare(document);
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
			// A POS Invoice return is a POS Invoice with is_return set, so it opens right here
			// rather than in the desk. make_sales_return is the whitelisted wrapper the desk
			// calls too (pos_invoice.py:913); make_return_doc itself is not whitelisted.
			if (key === "pos-return") {
				return await this.openMappedHere("pos-invoice",
					"erpnext.accounts.doctype.pos_invoice.pos_invoice.make_sales_return",
					{ source_name: doc.name },
					// the copy must not inherit the consolidation of the sale it reverses -
					// pos_invoice.js:85 clears the same field on a new return
					(draft) => { draft.consolidated_invoice = ""; });
			}
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

	// The layout is read off the form that is on screen rather than kept as a second list
	// somebody has to remember to update: formControls holds every header field this
	// workspace drew, in the order it drew them, and :visible drops whatever a depends_on
	// rule has hidden. So the page that prints is the page the user was just looking at.
	printLayout() {
		// print plumbing, and the fieldtypes that have nothing to say on paper
		const SKIP = ["naming_series", "letter_head", "select_print_heading", "amended_from", "__newname"];
		const MUTE = ["Attach", "Attach Image", "Signature", "Password", "Geolocation", "Code", "HTML"];
		// applyDependsOn hides a field by putting display:none on its own slot, so that
		// inline style is the exact test. :visible would have been wrong - it walks up to
		// the tab panel, so printing while the Terms tab was open would have dropped every
		// field on Details.
		const shown = (slot) => !slot || !slot.length || slot[0].style.display !== "none";
		const fields = (this.formControls || [])
			.filter(({ field, control }) => field && field.fieldname
				&& !SKIP.includes(field.fieldname) && !MUTE.includes(field.fieldtype)
				&& control && control.$wrapper
				&& shown(control.$wrapper.closest(".ag-field-slot")))
			.map(({ field }) => field.fieldname);
		const policy = this.formFieldPolicy(this.state.kind);
		const tables = {};
		// formTableSlots is filled by buildMetadataForm alone, and the Material Request form
		// is hand-built and renders its own items table - so the slot is looked for in the
		// DOM instead, which both paths do create.
		(this.formMeta.fields || []).forEach((field) => {
			if (field.fieldtype !== "Table" || !field.fieldname) return;
			const slot = this.wrapper.find(`.ag-content .ag-field-slot[data-fieldname="${field.fieldname}"]`);
			if (!slot.length || !shown(slot)) return;
			// the policy's own column list where there is one; null lets the server fall back
			// to whatever the child table itself marks in_list_view
			tables[field.fieldname] = (policy && policy.tables && policy.tables[field.fieldname]) || null;
		});
		return { fields, tables };
	}

	// Both of these used to hand the browser a Desk URL. That took the user out of the
	// workspace, and it printed whatever each DocType's default format happened to be - on
	// a Purchase Order that is a custom format with no letter head, so its PDF came out
	// with no logo while every other document had one.
	openDeskPrint(asPdf) {
		const doctype = this.formMeta.doctype;
		const name = this.formDoc.name;
		const format = PRINT_FORMATS[this.state.kind] || "";
		const query = (extra) => Object.entries({ doctype, name, format, ...extra })
			.filter(([, value]) => value !== "" && value !== undefined && value !== null)
			.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
		// Frappe's own two: the print view carries the same format picker and the same
		// Compact / UOM / zero-tax switches the desk shows, and download_pdf returns the
		// identical file the desk downloads - letterhead and all.
		const url = asPdf
			? `/api/method/frappe.utils.print_format.download_pdf?${query({ no_letterhead: 0 })}`
			: `/printview?${query({ trigger_print: 1 })}`;
		window.open(url, "_blank");
	}

	async openPrintView(asPdf) {
		if (!this.formDoc || !this.formDoc.name) {
			frappe.msgprint(__("Save the document before printing it."));
			return;
		}
		// the paper this site already prints on, rather than the portal's own layout
		if (PRINT_VIA_DESK) return this.openDeskPrint(asPdf);
		const args = {
			kind: this.state.kind,
			name: this.formDoc.name,
			layout: JSON.stringify(this.printLayout()),
		};
		try {
			if (asPdf) {
				const response = await this.api.call("document_pdf", args);
				if (!response || !response.content) throw new Error(__("The PDF came back empty."));
				this.savePdf(response.filename, response.content);
			} else {
				const response = await this.api.call("document_print", args);
				if (!response || !response.html) throw new Error(__("Nothing to print."));
				this.printHtml(response.html);
			}
		} catch (error) {
			frappe.msgprint({ title: __("Unable to print"), message: this.message(error), indicator: "red" });
		}
	}

	savePdf(filename, base64) {
		const binary = window.atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
		const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = filename || "document.pdf";
		document.body.appendChild(link);
		link.click();
		link.remove();
		// revoking straight away can cancel the save on some browsers
		window.setTimeout(() => URL.revokeObjectURL(url), 20000);
	}

	printHtml(html) {
		const view = window.open("", "_blank");
		if (!view) {
			frappe.msgprint(__("Allow pop-ups for this site to print."));
			return;
		}
		view.document.write(`<!doctype html><html><head><meta charset="utf-8">
			<title>${this.escape(this.formDoc.name)}</title></head><body>${html}</body></html>`);
		view.document.close();
		// the letter head's logo is an image, and printing before it has loaded prints a gap
		const images = Array.from(view.document.images || []);
		Promise.all(images.map((image) => image.complete
			? null
			: new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; })))
			.then(() => { view.focus(); view.print(); });
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
		// a saved fuel entry is never dirty on open, but its proofs are still missing,
		// so Save has to stay reachable rather than wait for an edit that cannot happen
		this.wrapper.find(".ag-save").toggle(Boolean(this.formDirty) || this.fuelAttachOpen());
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

		// Keep column searches available when they hide every loaded record.
		body.html(data.rows.length
			? `<div class="ag-rep-table"><table>
					<thead><tr><th>#</th>${head}</tr>
						<tr class="ag-col-search-row"><td></td>${searchRow}</tr></thead>
					<tbody>${rows || `<tr><td colspan="${data.columns.length + 1}">${__("No matching records. Clear a column search to see all records.")}</td></tr>`}</tbody>
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

	// ---- ERPNext's own ledgers, drawn here ------------------------------------

	loadGeneralLedger() { return this.loadLedgerReport("general-ledger"); }

	loadStockLedger() { return this.loadLedgerReport("stock-ledger"); }

	async loadLedgerReport(key) {
		const config = LEDGER_REPORTS[key];
		this.state.view = key;
		this.setCrumb(__(config.title));
		this.wrapper.find(".ag-nav").removeClass("active");
		this.wrapper.find(`[data-ledger="${key}"]`).addClass("active");
		this.wrapper.find(".agriventure-app").removeClass("ag-menu-open");

		const dates = this.dateDefaults();
		this.ledgerFilters = this.ledgerFilters || {};
		this.ledgerFilters[key] = this.ledgerFilters[key] || {
			from: dates.from, to: dates.to,
			company: frappe.defaults.get_user_default("Company") || "",
			page: 1, pageSize: REPORT_PAGE_SIZES[0], columnSearch: {},
		};
		const state = this.ledgerFilters[key];

		const pickers = [{ key: "company", label: "Company", doctype: "Company", empty: "All Companies" },
			...config.filters];
		const slots = pickers.map((filter) =>
			`<div class="ag-filter-field"><span class="ag-filter-label-slot">${__(filter.label)}</span>
				<div class="ag-filter-control"><div class="ag-report-slot" data-slot="${filter.key}"></div></div></div>`).join("");

		const content = this.wrapper.find(".ag-content").html(`<div class="ag-page-head"><h1>${__(config.title)}</h1><button type="button" class="ag-button ag-button-light ag-rep-back">${this.icon("left", "xs")} ${__("Back to Report")}</button></div>
			<div class="ag-filter-toolbar" style="--ag-filter-cols:${pickers.length + 2}">
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("From Date")}</span>
					<div class="ag-filter-control"><input class="ag-rep-from ag-filter-date-input" type="date" value="${this.escape(state.from)}"></div></div>
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("To Date")}</span>
					<div class="ag-filter-control"><input class="ag-rep-to ag-filter-date-input" type="date" value="${this.escape(state.to)}"></div></div>
				${slots}
			</div>
			<div class="ag-filter-feedback" aria-live="polite"><span class="ag-filter-error" role="alert"></span></div>
			<div class="ag-rep-modes"><span class="ag-rep-mode-spacer"></span>
				<button type="button" class="ag-button ag-button-light ag-rep-export" data-format="xlsx">${this.icon("small-file", "xs")} ${__("Export Excel")}</button>
				<button type="button" class="ag-button ag-button-light ag-rep-export" data-format="pdf">${this.icon("printer", "xs")} ${__("Export PDF")}</button>
			</div>
			<div class="ag-report-body"><div class="ag-loading-panel">${__("Loading report...")}</div></div>`);

		for (const filter of pickers) {
			const holder = content.find(`[data-slot="${filter.key}"]`).addClass("ag-list-filter");
			const control = frappe.ui.form.make_control({
				parent: holder,
				df: {
					fieldtype: filter.doctype ? "Link" : "Data",
					options: filter.doctype,
					label: __(filter.label),
					placeholder: __(filter.empty),
				},
				render_input: true,
			});
			control.set_value(state[filter.key] || "");
			control.refresh();
			control.$input?.attr({ placeholder: __(filter.empty), autocomplete: "off" });
			if (filter.doctype) this.bindComboSearch(control, __(filter.label));
			control.$input.on("change awesomplete-selectcomplete", () => {
				state[filter.key] = control.get_value();
				state.page = 1;
				this.renderLedgerReport(key);
			});
		}

		content.off(".agledger");
		content.on("change.agledger", ".ag-rep-from,.ag-rep-to", () => {
			state.from = content.find(".ag-rep-from").val();
			state.to = content.find(".ag-rep-to").val();
			state.page = 1;
			this.renderLedgerReport(key);
		});
		content.on("click.agledger", ".ag-rep-export", (event) => {
			const format = $(event.currentTarget).data("format");
			window.open(this.reportExportUrl(`desk_report_${format}`,
				{ key, filters: JSON.stringify(this.ledgerArgs(key)) }), "_blank");
		});
		content.on("input.agledger", ".ag-col-search", frappe.utils.debounce((event) => {
			state.columnSearch[$(event.target).data("col")] = String(event.target.value || "").toLowerCase().trim();
			state.page = 1;
			this.renderLedgerReport(key);
		}, 220));
		this.bindReportPager(content, state, () => this.renderLedgerReport(key));

		this.renderLedgerReport(key);
	}

	ledgerArgs(key) {
		const state = (this.ledgerFilters || {})[key] || {};
		const args = { from_date: state.from, to_date: state.to, company: state.company };
		for (const filter of LEDGER_REPORTS[key].filters) args[filter.key] = state[filter.key] || "";
		return args;
	}

	ledgerCell(column, value) {
		if (value === null || value === undefined || value === "") return "";
		if (["Currency", "Float", "Int", "Percent"].includes(column.fieldtype)) {
			return frappe.format(value, { fieldtype: column.fieldtype, options: column.options });
		}
		if (["Date", "Datetime"].includes(column.fieldtype)) return frappe.datetime.str_to_user(String(value));
		// a Link would render as an anchor into the desk, which is the one place this
		// workspace does not want to send anyone - the name itself is what matters
		return this.escape(String(value));
	}

	async renderLedgerReport(key) {
		const content = this.wrapper.find(".ag-content");
		const state = this.ledgerFilters[key];
		const body = content.find(".ag-report-body");

		if (!this.checkReportDates(state, content)) return;

		let data;
		try {
			data = await this.api.deskReport(key, this.ledgerArgs(key));
		} catch (error) {
			body.html(this.errorMarkup(error));
			return;
		}

		const columns = data.columns || [];
		const searches = state.columnSearch || {};
		const filtered = (data.rows || []).filter((row) => columns.every((column) => {
			const needle = searches[column.fieldname];
			return !needle || String(row[column.fieldname] ?? "").toLowerCase().includes(needle);
		}));

		const page = this.reportPage(filtered, state);
		const align = (column) => (["Currency", "Float", "Int", "Percent"].includes(column.fieldtype) ? "right" : "left");
		const head = columns.map((column) => `<th class="ag-align-${align(column)}">${this.escape(column.label || column.fieldname)}</th>`).join("");
		const searchRow = columns.map((column) => `<td><input class="ag-col-search" type="text" data-col="${column.fieldname}"
			value="${this.escape(searches[column.fieldname] || "")}" aria-label="${this.escape(column.label || column.fieldname)}"></td>`).join("");
		const rows = page.rows.map((row, index) => `<tr><td>${page.start + index + 1}</td>${columns
			.map((column) => `<td class="ag-align-${align(column)}">${this.ledgerCell(column, row[column.fieldname])}</td>`).join("")}</tr>`).join("");

		body.html(filtered.length
			? `<div class="ag-rep-table"><table>
					<thead><tr><th>#</th>${head}</tr>
						<tr class="ag-col-search-row"><td></td>${searchRow}</tr></thead>
					<tbody>${rows}</tbody>
				</table></div>
				${this.reportPagerMarkup(page, state)}`
			: `<div class="ag-rep-empty"><b>${__("Nothing on this ledger.")}</b>
					<span>${__("No entries between {0} and {1} for these filters.", [state.from, state.to])}</span></div>`);
	}

	// ---- fuel dashboards -----------------------------------------------------

	loadFuelStockReport() { return this.loadFuelReport("fuel-stock"); }

	loadFuelIssueReport() { return this.loadFuelReport("fuel-issue"); }

	async loadFuelReport(report) {
		const config = FUEL_REPORTS[report];
		this.state.view = `${report}-report`;
		this.setCrumb(__(config.title));
		this.wrapper.find(".ag-nav").removeClass("active");
		// the sidebar carries one Report entry, so it stays lit for every report
		this.wrapper.find("[data-action=open-kpi]").addClass("active");
		this.wrapper.find(".agriventure-app").removeClass("ag-menu-open");

		const dates = this.dateDefaults();
		this.fuelFilters = this.fuelFilters || {};
		this.fuelFilters[report] = this.fuelFilters[report] || {
			from: dates.from, to: dates.to, mode: "table",
			page: 1, pageSize: REPORT_PAGE_SIZES[0], columnSearch: {},
		};
		const state = this.fuelFilters[report];

		const slots = config.filters.map((filter) =>
			`<div class="ag-filter-field"><span class="ag-filter-label-slot">${__(filter.label)}</span>
				<div class="ag-filter-control"><div class="ag-report-slot" data-slot="${filter.key}"></div></div></div>`).join("");

		const content = this.wrapper.find(".ag-content").html(`<div class="ag-page-head"><h1>${__(config.title)}</h1><button type="button" class="ag-button ag-button-light ag-rep-back">${this.icon("left", "xs")} ${__("Back to Report")}</button></div>
			<div class="ag-filter-toolbar" style="--ag-filter-cols:${config.filters.length + 2}">
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("From Date")}</span>
					<div class="ag-filter-control"><input class="ag-rep-from ag-filter-date-input" type="date" value="${this.escape(state.from)}"></div></div>
				<div class="ag-filter-field"><span class="ag-filter-label-slot">${__("To Date")}</span>
					<div class="ag-filter-control"><input class="ag-rep-to ag-filter-date-input" type="date" value="${this.escape(state.to)}"></div></div>
				${slots}
			</div>
			<div class="ag-filter-feedback" aria-live="polite"><span class="ag-filter-error" role="alert"></span></div>
			<div class="ag-rep-modes">
				<button type="button" class="ag-button ag-rep-mode" data-mode="table">${__("Table View")}</button>
				<button type="button" class="ag-button ag-rep-mode" data-mode="graph">${__("Graph View")}</button>
				<span class="ag-rep-mode-spacer"></span>
				<button type="button" class="ag-button ag-button-light ag-rep-export" data-format="xlsx">${this.icon("small-file", "xs")} ${__("Export Excel")}</button>
				<button type="button" class="ag-button ag-button-light ag-rep-export" data-format="pdf">${this.icon("printer", "xs")} ${__("Export PDF")}</button>
			</div>
			<div class="ag-report-body"><div class="ag-loading-panel">${__("Loading report...")}</div></div>`);

		for (const filter of config.filters) {
			const holder = content.find(`[data-slot="${filter.key}"]`).addClass("ag-list-filter");
			const control = frappe.ui.form.make_control({
				parent: holder,
				df: { fieldtype: "Link", options: filter.doctype, label: __(filter.label), placeholder: __(filter.empty) },
				render_input: true,
			});
			if (filter.query) control.get_query = () => ({ filters: filter.query });
			control.set_value(state[filter.key] || "");
			control.refresh();
			control.$input?.attr({ placeholder: __(filter.empty), autocomplete: "off" });
			this.bindComboSearch(control, __(filter.label));
			control.$input.on("change awesomplete-selectcomplete", () => {
				state[filter.key] = control.get_value();
				state.page = 1;
				this.renderFuelReport(report);
			});
		}

		content.off(".agfuelrep");
		content.on("change.agfuelrep", ".ag-rep-from,.ag-rep-to", () => {
			state.from = content.find(".ag-rep-from").val();
			state.to = content.find(".ag-rep-to").val();
			state.page = 1;
			this.renderFuelReport(report);
		});
		content.on("click.agfuelrep", ".ag-rep-mode", (event) => {
			state.mode = $(event.currentTarget).data("mode");
			this.renderFuelReport(report);
		});
		content.on("click.agfuelrep", ".ag-rep-export", (event) => {
			const format = $(event.currentTarget).data("format");
			window.open(this.reportExportUrl(`${config.method}_${format}`, this.fuelArgs(report)), "_blank");
		});
		// a search box under each column header, narrowing what is already loaded
		content.on("input.agfuelrep", ".ag-col-search", frappe.utils.debounce((event) => {
			state.columnSearch[$(event.target).data("col")] = String(event.target.value || "").toLowerCase().trim();
			state.page = 1;
			this.renderFuelReport(report);
		}, 220));
		// the entry itself, and the Stock Entry it posted, both open inside the workspace
		// the entry cell wears both classes so it looks like a link; :not() keeps this
		// handler off it, or one click would open the Stock Entry as well
		content.on("click.agfuelrep", ".ag-se-jump:not(.ag-fuel-jump)", (event) => this.openPortalDoc("stock-entry", $(event.currentTarget).data("name")));
		content.on("click.agfuelrep", ".ag-fuel-jump", (event) => this.openPortalDoc(
			report === "fuel-stock" ? "fuel-for-stock" : "fuel-for-distribution", $(event.currentTarget).data("name")));
		this.bindReportPager(content, state, () => this.renderFuelReport(report));

		this.renderFuelReport(report);
	}

	fuelArgs(report) {
		const state = (this.fuelFilters || {})[report] || {};
		const args = { from_date: state.from, to_date: state.to };
		for (const filter of FUEL_REPORTS[report].filters) args[filter.key] = state[filter.key] || "";
		return args;
	}

	async renderFuelReport(report) {
		const config = FUEL_REPORTS[report];
		const content = this.wrapper.find(".ag-content");
		const state = this.fuelFilters[report];
		const body = content.find(".ag-report-body");

		content.find(".ag-rep-mode").each((_, node) => {
			const active = $(node).data("mode") === state.mode;
			$(node).toggleClass("ag-button-primary", active).toggleClass("ag-button-light", !active);
		});

		if (!this.checkReportDates(state, content)) return;

		let data;
		try {
			data = await this.api[config.load](this.fuelArgs(report));
		} catch (error) {
			body.html(this.errorMarkup(error));
			return;
		}

		if (state.mode === "graph") {
			body.html(`<div class="ag-rep-chart-card"><div class="ag-rep-chart" data-chart="fuel"></div>
				<div class="ag-rep-chart-title">${__(config.chart)}</div></div>`);
			this.drawFuelChart(body, data);
			return;
		}

		const searches = state.columnSearch || {};
		const filtered = data.rows.filter((row) => data.columns.every((column) => {
			const needle = searches[column.key];
			return !needle || String(row[column.key] ?? "").toLowerCase().includes(needle);
		}));

		const page = this.reportPage(filtered, state);
		const cell = (row, column) => {
			if (column.key === "stock_entry" && row.stock_entry) {
				return `<button type="button" class="ag-se-jump" data-name="${this.escape(row.stock_entry)}">${this.escape(row.stock_entry)}</button>`;
			}
			if (column.key === "entry" && row.entry) {
				return `<button type="button" class="ag-se-jump ag-fuel-jump" data-name="${this.escape(row.entry)}">${this.escape(row.entry)}</button>`;
			}
			if (config.money.includes(column.key)) return this.reportMoney(row[column.key]);
			if (column.align === "right") return this.reportNumber(row[column.key]);
			return this.escape(String(row[column.key] ?? ""));
		};

		const head = data.columns.map((column) => `<th class="ag-align-${column.align}">${this.escape(column.label)}</th>`).join("");
		const searchRow = data.columns.map((column) => `<td><input class="ag-col-search" type="text" data-col="${column.key}"
			value="${this.escape(searches[column.key] || "")}" aria-label="${this.escape(column.label)}"></td>`).join("");
		const rows = page.rows.map((row, index) => `<tr><td>${page.start + index + 1}</td>${data.columns
			.map((column) => `<td class="ag-align-${column.align}">${cell(row, column)}</td>`).join("")}</tr>`).join("");

		// the totals follow the column search, so they describe the table on screen
		const foot = config.totals.map((total) => {
			const sum = filtered.reduce((running, row) => running + Number(row[total.key] || 0), 0);
			const shown = total.money ? this.reportMoney(sum) : this.reportNumber(sum);
			return `<tr><td colspan="${data.columns.length}" class="ag-align-right">${__(total.label)}</td>
				<td class="ag-align-right">${shown}</td></tr>`;
		}).join("");

		body.html(filtered.length
			? `<div class="ag-rep-table"><table>
					<thead><tr><th>#</th>${head}</tr>
						<tr class="ag-col-search-row"><td></td>${searchRow}</tr></thead>
					<tbody>${rows}</tbody>
					<tfoot>${foot}</tfoot>
				</table></div>
				${this.reportPagerMarkup(page, state)}`
			: `<div class="ag-rep-empty"><b>${__(config.emptyTitle)}</b>
					<span>${__(config.empty, [state.from, state.to])}</span></div>`);
	}

	drawFuelChart(body, data) {
		if (typeof frappe.Chart !== "function") return;
		const holder = body.find('[data-chart="fuel"]');
		if (!holder.length || !(data.graph || []).length) {
			holder.html(`<p class="ag-rep-nochart">${__("No graph data for these filters.")}</p>`);
			return;
		}

		// one line per fuel, litres added up per day - the same shape as Production
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
			tooltipOptions: { formatTooltipY: (value) => `${value} L` },
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
			const desk = tile.data("desk");
			if (desk) {
				// the company is the one filter every one of them asks for first
				return this.openDeskRoute("query-report", desk,
					{ company: frappe.defaults.get_user_default("Company") || "" });
			}
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
			// a tile is only offered when there is something behind it: a report this
			// workspace draws, a list it has, or a report name for the desk
			.filter((tile) => (tile.desk ? true : tile.report ? REPORT_VIEWS[tile.report] : this.config[tile.kind]))
			.map((tile) => `<button type="button" class="ag-kpi-tile" ${tile.desk
				? `data-desk="${this.escape(tile.desk)}"`
				: tile.report ? `data-report="${tile.report}"` : `data-kind="${tile.kind}"`}>
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

	// ---------- new custom checkout (additive - the classic flow above is untouched) ----------

	async openPosCheckoutLanding() {
		this.setActive("pos-new");
		this.setCrumb(__("Point of Sale"));
		this.wrapper.find(".ag-nav").removeClass("active");
		this.wrapper.find("[data-action=open-pos-new]").addClass("active");

		const content = this.wrapper.find(".ag-content").html(`<div class="ag-pos-landing">
			<div class="ag-pos-card">
				<span class="ag-pos-icon">${this.icon("retail", "lg")}</span>
				<h1>${__("Point of Sale")}</h1>
				<p>${__("A shift has to be open before the till can be used.")}</p>
				<button type="button" class="ag-button ag-button-primary ag-pos-start-new">${__("Open Shift")}</button>
			</div>
		</div>`);
		content.off(".agposnew").on("click.agposnew", ".ag-pos-start-new", () => this.startPosShiftNew());

		this.startPosShiftNew();
	}

	async startPosShiftNew() {
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
		this.askPosOpeningEntryNew(open);
	}

	// A near-duplicate of askPosOpeningEntry above, on purpose: the only difference is where
	// it goes after the shift is ready (this workspace's own checkout, not ERPNext's desk POS).
	askPosOpeningEntryNew(open = []) {
		const rows = [
			{ fieldname: "mode_of_payment", fieldtype: "Link", options: "Mode of Payment", label: __("Mode of Payment"), in_list_view: 1, reqd: 1 },
			{ fieldname: "opening_amount", fieldtype: "Currency", label: __("Opening Amount"), options: "company:company_currency", in_list_view: 1,
				onchange() {
					(dialog.fields_dict.balance_details.df.data || []).some((row) => {
						if (row.idx !== this.doc.idx) return false;
						row.opening_amount = this.value;
						dialog.fields_dict.balance_details.grid.refresh();
						return true;
					});
				},
			},
		];

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
				{ fieldtype: "Link", fieldname: "company", label: __("Company"), options: "Company", reqd: 1,
					default: frappe.defaults.get_default("company") },
				{ fieldtype: "Link", fieldname: "pos_profile", label: __("POS Profile"), options: "POS Profile", reqd: 1,
					get_query: () => ({ query: POS_PROFILE_QUERY, filters: { company: dialog.fields_dict.company.get_value() } }),
					onchange: () => loadPaymentMethods() },
				{ fieldname: "balance_details", fieldtype: "Table", label: __("Opening Balance Details"),
					cannot_add_rows: false, in_place_edit: true, reqd: 1, data: [], fields: rows },
			],
			primary_action_label: __("Submit"),
			// the button names the shift it will continue, since nothing on the form does
			// any more. open[0] is the newest - check_opening_entry orders by start date desc
			secondary_action_label: open.length ? __("Continue {0}", [open[0].name]) : null,
			secondary_action: open.length
				? () => {
					const chosen = open[0];
					dialog.hide();
					this.openPosCheckout(chosen.pos_profile, chosen.name);
				}
				: null,
			primary_action: async ({ company, pos_profile, balance_details }) => {
				const filled = (balance_details || []).filter((row) => row.mode_of_payment);
				if (!filled.length) {
					frappe.show_alert({ message: __("Please add Mode of payments and opening balance details."), indicator: "red" });
					return;
				}
				let opened;
				try {
					opened = await frappe.call({
						method: `${POS_PAGE_METHOD}.create_opening_voucher`,
						args: { pos_profile, company, balance_details: filled },
						freeze: true,
					}).then((response) => response.message);
				} catch (error) {
					return;
				}
				dialog.hide();
				this.openPosCheckout(pos_profile, opened && opened.name);
			},
		});
		dialog.show();
		dialog.$wrapper.addClass("ag-dialog");
	}

	async openPosCheckout(posProfile, openingEntryName) {
		this.setActive("pos-new");
		this.setCrumb(__("Point of Sale"));
		this.wrapper.find(".ag-nav").removeClass("active");
		this.wrapper.find("[data-action=open-pos-new]").addClass("active");

		const content = this.wrapper.find(".ag-content").html(`<div class="ag-loading-panel">${__("Loading till...")}</div>`);
		let profile;
		try {
			profile = await frappe.call({
				method: `${POS_PAGE_METHOD}.get_pos_profile_data`,
				args: { pos_profile: posProfile },
			}).then((response) => response.message);
		} catch (error) {
			content.html(this.errorMarkup(error));
			return;
		}

		this.posCart = {
			step: "cart",
			openingEntry: openingEntryName || null,
			posProfile,
			profile,
			company: profile.company,
			warehouse: profile.warehouse,
			// The standard ERPNext POS screen falls back to the site's default selling price
			// list whenever the POS Profile leaves this blank (confirmed against
			// Selling Settings.selling_price_list on this site) - matched here so rates aren't
			// silently read as null/0 just because the profile itself never set one.
			priceList: profile.selling_price_list || frappe.defaults.get_default("selling_price_list") || "Standard Selling",
			currency: profile.currency || "INR",
			customer: profile.customer || "",
			itemGroup: "",
			searchTerm: "",
			itemsStart: 0,
			itemsHasMore: false,
			allowRateChange: Boolean(profile.allow_rate_change),
			items: [],
			payments: (profile.payments || []).map((row) => ({ mode_of_payment: row.mode_of_payment, amount: 0 })),
			invoiceName: null,
		};

		content.html(`<div class="ag-pos-checkout">
			<section class="ag-pos-catalog">
				<div class="ag-pos-catalog-head">
					<div class="ag-search-control">${this.icon("search", "xs")}<input class="ag-pos-search" type="text" placeholder="${__("Search item code, name or barcode")}"></div>
					<select class="ag-pos-item-group"><option value="">${__("All Item Groups")}</option></select>
				</div>
				<div class="ag-pos-item-grid"><div class="ag-loading-panel">${__("Loading items...")}</div></div>
				<div class="ag-pos-item-more-wrap"></div>
			</section>
			<aside class="ag-pos-cart">
				<div class="ag-pos-cart-head"><b>${__("Item Cart")}</b></div>
				<div class="ag-pos-cart-customer" data-fieldname="pos_customer"></div>
				<div class="ag-pos-cart-lines"><div class="ag-pos-cart-empty">${__("No items in cart")}</div></div>
				<div class="ag-pos-cart-totals">
					<div><span>${__("Total Quantity")}</span><b class="ag-pos-total-qty">0</b></div>
					<div><span>${__("Net Total")}</span><b class="ag-pos-net-total">${this.reportMoney(0)}</b></div>
					<div class="ag-pos-grand"><span>${__("Grand Total")}</span><b class="ag-pos-grand-total">${this.reportMoney(0)}</b></div>
				</div>
				<button type="button" class="ag-button ag-button-primary ag-pos-checkout-btn" disabled>${__("Checkout")}</button>
			</aside>
		</div>`);

		this.bindPosCheckoutEvents(content);
		this.renderPosCustomerControl();
		await this.loadPosItemGroups();
		await this.loadPosItems(true);
		this.renderPosCart();
	}

	bindPosCheckoutEvents(content) {
		content.off(".agposcart");
		const search = frappe.utils.debounce(() => {
			this.posCart.searchTerm = content.find(".ag-pos-search").val().trim();
			this.loadPosItems(true);
		}, 300);
		content.on("input.agposcart", ".ag-pos-search", search);
		content.on("change.agposcart", ".ag-pos-item-group", (event) => {
			this.posCart.itemGroup = $(event.currentTarget).val();
			this.loadPosItems(true);
		});
		content.on("click.agposcart", ".ag-pos-item-tile", (event) => {
			const tile = $(event.currentTarget);
			this.addToPosCart({
				item_code: tile.data("item-code"),
				item_name: tile.data("item-name"),
				uom: tile.data("uom"),
				rate: Number(tile.data("rate") || 0),
				actual_qty: Number(tile.data("qty") || 0),
			});
		});
		content.on("click.agposcart", ".ag-pos-item-more", () => this.loadPosItems(false));
		content.on("click.agposcart", ".ag-pos-line-remove", (event) => this.removePosCartLine($(event.currentTarget).data("item-code")));
		content.on("click.agposcart", ".ag-pos-line-minus", (event) => this.changePosCartQty($(event.currentTarget).data("item-code"), -1));
		content.on("click.agposcart", ".ag-pos-line-plus", (event) => this.changePosCartQty($(event.currentTarget).data("item-code"), 1));
		content.on("change.agposcart", ".ag-pos-line-qty", (event) => {
			const input = $(event.currentTarget);
			this.setPosCartQty(input.data("item-code"), Number(input.val()));
		});
		content.on("change.agposcart", ".ag-pos-line-rate", (event) => {
			const input = $(event.currentTarget);
			const line = this.posCart.items.find((row) => row.item_code === input.data("item-code"));
			if (line) { line.rate = Number(input.val()) || 0; this.renderPosCart(); }
		});
		content.on("click.agposcart", ".ag-pos-checkout-btn", () => this.openPosCheckoutPayment());
	}

	renderPosCustomerControl() {
		const holder = this.wrapper.find('[data-fieldname="pos_customer"]').empty();
		if (!holder.length) return;
		const control = frappe.ui.form.make_control({
			parent: holder[0],
			df: { fieldtype: "Link", fieldname: "customer", options: "Customer", placeholder: __("Select Customer") },
			render_input: true,
		});
		control.refresh();
		if (this.posCart.customer) control.set_value(this.posCart.customer);
		control.$input.on("change.agposcart awesomplete-selectcomplete.agposcart", () => {
			this.posCart.customer = control.get_value();
		});
		this.posCustomerControl = control;
	}

	async loadPosItemGroups() {
		let root;
		try {
			root = await frappe.call({ method: `${POS_PAGE_METHOD}.get_parent_item_group` }).then((response) => response.message);
		} catch (error) {
			root = null;
		}
		let groups = [];
		try {
			groups = await frappe.db.get_list("Item Group", {
				filters: root ? { parent_item_group: root } : {},
				fields: ["name"],
				limit: 100,
				order_by: "name asc",
			});
		} catch (error) {
			groups = [];
		}
		const select = this.wrapper.find(".ag-pos-item-group");
		groups.forEach((group) => select.append(`<option value="${this.escape(group.name)}">${this.escape(group.name)}</option>`));
	}

	async loadPosItems(reset) {
		const cart = this.posCart;
		if (reset) cart.itemsStart = 0;
		const grid = this.wrapper.find(".ag-pos-item-grid");
		const moreWrap = this.wrapper.find(".ag-pos-item-more-wrap");
		if (reset) grid.html(`<div class="ag-loading-panel">${__("Loading items...")}</div>`);
		let response;
		try {
			response = await frappe.call({
				method: `${POS_PAGE_METHOD}.get_items`,
				args: {
					start: cart.itemsStart,
					page_length: POS_ITEM_PAGE_SIZE,
					price_list: cart.priceList,
					item_group: cart.itemGroup || "",
					pos_profile: cart.posProfile,
					search_term: cart.searchTerm || "",
				},
			}).then((res) => res.message);
		} catch (error) {
			grid.html(this.errorMarkup(error));
			moreWrap.html("");
			return;
		}
		const items = response.items || [];
		cart.itemsHasMore = items.length === POS_ITEM_PAGE_SIZE;
		const tiles = items.map((item) => {
			const rate = item.price_list_rate || 0;
			const qty = Number(item.actual_qty || 0);
			// only 41 of the 493 items carry a picture, so a tile without one keeps the
			// letter tile instead of leaving a hole - which is what the Desk POS does too
			const image = item.item_image
				? `<img src="${this.escape(item.item_image)}" alt="" loading="lazy">`
				: `<b>${this.escape((item.item_name || item.item_code || "?").trim().charAt(0).toUpperCase())}</b>`;
			return `<button type="button" class="ag-pos-item-tile" data-item-code="${this.escape(item.item_code)}"
					data-item-name="${this.escape(item.item_name || item.item_code)}" data-uom="${this.escape(item.uom || item.stock_uom || "")}"
					data-rate="${rate}" data-qty="${qty}">
				<span class="ag-pos-item-thumb">${image}<span class="ag-pos-item-qty">${this.reportNumber(qty)}</span></span>
				<span class="ag-pos-item-name">${this.escape(item.item_name || item.item_code)}</span>
				<span class="ag-pos-item-rate">${this.reportMoney(rate)} / ${this.escape(item.uom || item.stock_uom || "")}</span>
			</button>`;
		}).join("");
		if (reset) {
			grid.html(tiles || `<div class="ag-item-picker-empty">${__("No items found")}</div>`);
		} else {
			grid.append(tiles);
		}
		cart.itemsStart += items.length;
		moreWrap.html(cart.itemsHasMore
			? `<button type="button" class="ag-button ag-button-light ag-pos-item-more">${__("More")}</button>`
			: "");
	}

	async addToPosCart(item) {
		const cart = this.posCart;
		const existing = cart.items.find((row) => row.item_code === item.item_code);
		let available = item.actual_qty;
		try {
			const result = await frappe.call({
				method: `${POS_INVOICE_METHOD}.get_stock_availability`,
				args: { item_code: item.item_code, warehouse: cart.warehouse },
			}).then((res) => res.message);
			// [actual_qty, is_stock_item, allow_negative_stock]
			if (Array.isArray(result)) [available] = result;
		} catch (error) {
			// stock could not be checked; let the add through rather than block the sale
		}
		const nextQty = (existing ? existing.qty : 0) + 1;
		if (available !== undefined && available !== null && nextQty > available) {
			frappe.show_alert({ message: __("Only {0} {1} available for {2}", [this.reportNumber(available), item.uom || "", item.item_name]), indicator: "orange" });
			return;
		}
		if (existing) {
			existing.qty += 1;
		} else {
			cart.items.push({ item_code: item.item_code, item_name: item.item_name, uom: item.uom, rate: item.rate || 0, qty: 1 });
		}
		this.renderPosCart();
	}

	changePosCartQty(itemCode, delta) {
		const line = this.posCart.items.find((row) => row.item_code === itemCode);
		if (!line) return;
		this.setPosCartQty(itemCode, line.qty + delta);
	}

	setPosCartQty(itemCode, qty) {
		const cart = this.posCart;
		if (!(qty > 0)) {
			this.removePosCartLine(itemCode);
			return;
		}
		const line = cart.items.find((row) => row.item_code === itemCode);
		if (line) { line.qty = qty; this.renderPosCart(); }
	}

	removePosCartLine(itemCode) {
		this.posCart.items = this.posCart.items.filter((row) => row.item_code !== itemCode);
		this.renderPosCart();
	}

	posCartTotals() {
		const items = this.posCart.items;
		const qty = items.reduce((sum, row) => sum + Number(row.qty || 0), 0);
		const net = items.reduce((sum, row) => sum + Number(row.qty || 0) * Number(row.rate || 0), 0);
		return { qty, net };
	}

	renderPosCart() {
		const cart = this.posCart;
		const lines = this.wrapper.find(".ag-pos-cart-lines");
		const rateEditable = cart.allowRateChange;
		lines.html(cart.items.length
			? cart.items.map((row) => `<div class="ag-pos-cart-line">
					<div class="ag-pos-line-name">${this.escape(row.item_name || row.item_code)}<small>${this.escape(row.uom || "")}</small></div>
					<div class="ag-pos-line-qty">
						<button type="button" class="ag-pos-line-minus" data-item-code="${this.escape(row.item_code)}">&minus;</button>
						<input type="number" min="0" step="any" class="ag-pos-line-qty-input" data-item-code="${this.escape(row.item_code)}" value="${row.qty}">
						<button type="button" class="ag-pos-line-plus" data-item-code="${this.escape(row.item_code)}">+</button>
					</div>
					<div class="ag-pos-line-rate">${rateEditable
						? `<input type="number" min="0" step="any" class="ag-pos-line-rate" data-item-code="${this.escape(row.item_code)}" value="${row.rate}">`
						: this.reportMoney(row.rate)}</div>
					<div class="ag-pos-line-amount">${this.reportMoney(Number(row.qty) * Number(row.rate))}</div>
					<button type="button" class="ag-pos-line-remove" data-item-code="${this.escape(row.item_code)}" title="${__("Remove")}">${this.icon("delete", "xs")}</button>
				</div>`).join("")
			: `<div class="ag-pos-cart-empty">${__("No items in cart")}</div>`);
		// the qty <input> above is re-rendered from renderPosCart itself, so its own
		// change listener lives on the delegated content handler (bindPosCheckoutEvents),
		// not here - this only ever redraws markup
		this.wrapper.find(".ag-pos-cart-lines .ag-pos-line-qty-input").off("change.agposqty").on("change.agposqty", (event) => {
			const input = $(event.currentTarget);
			this.setPosCartQty(input.data("item-code"), Number(input.val()));
		});
		const totals = this.posCartTotals();
		// reportMoney (frappe.format for Currency) returns a right-aligned <div>-wrapped
		// string, not plain text - .html() renders it, .text() would print the tags literally
		this.wrapper.find(".ag-pos-total-qty").text(this.reportNumber(totals.qty));
		this.wrapper.find(".ag-pos-net-total").html(this.reportMoney(totals.net));
		this.wrapper.find(".ag-pos-grand-total").html(this.reportMoney(totals.net));
		this.wrapper.find(".ag-pos-checkout-btn").prop("disabled", !cart.items.length);
	}

	async openPosCheckoutPayment() {
		const cart = this.posCart;
		if (!cart.items.length) return;
		if (!cart.customer) {
			frappe.show_alert({ message: __("Please select a customer first"), indicator: "orange" });
			return;
		}

		const content = this.wrapper.find(".ag-content");
		const freeze = frappe.dom.freeze(__("Preparing invoice..."));
		let doc;
		try {
			const payload = {
				doctype: "POS Invoice",
				is_pos: 1,
				pos_profile: cart.posProfile,
				company: cart.company,
				customer: cart.customer,
				selling_price_list: cart.priceList || undefined,
				set_warehouse: cart.warehouse,
				items: cart.items.map((row) => ({
					item_code: row.item_code,
					qty: row.qty,
					rate: row.rate,
					warehouse: cart.warehouse,
				})),
				// POS Invoice's own validate() requires at least one payments row to exist even
				// before any amount is entered ("At least one mode of payment is required") -
				// the actual split is only filled in once the payment step itself has totals.
				payments: (cart.payments.length ? cart.payments : [{ mode_of_payment: (cart.profile.payments || [])[0]?.mode_of_payment }])
					.map((row) => ({ mode_of_payment: row.mode_of_payment, amount: 0 })),
			};
			doc = cart.invoiceName
				? await frappe.call({ method: "frappe.client.save", args: { doc: { ...payload, name: cart.invoiceName, docstatus: 0 } } }).then((res) => res.message)
				: await frappe.call({ method: "frappe.client.insert", args: { doc: payload } }).then((res) => res.message);
		} catch (error) {
			frappe.dom.unfreeze();
			frappe.msgprint({ title: __("Could not prepare invoice"), message: this.message(error), indicator: "red" });
			return;
		}
		frappe.dom.unfreeze();
		cart.invoiceName = doc.name;
		cart.serverDoc = doc;
		cart.step = "payment";
		if (!cart.payments.length) cart.payments = [{ mode_of_payment: "Cash", amount: 0 }];
		if (cart.payments.length === 1) cart.payments[0].amount = flt(doc.grand_total);

		content.html(`<div class="ag-pos-payment">
			<div class="ag-pos-payment-head">
				<button type="button" class="ag-button ag-button-light ag-pos-payment-back">${this.icon("left", "xs")} ${__("Back to Cart")}</button>
				<h2>${__("Checkout")} &middot; ${this.escape(doc.name)}</h2>
			</div>
			<div class="ag-pos-payment-summary">
				<div><span>${__("Grand Total")}</span><b>${this.reportMoney(doc.grand_total)}</b></div>
				<div class="ag-pos-payment-remaining"><span>${__("Remaining")}</span><b>${this.reportMoney(doc.grand_total)}</b></div>
			</div>
			<div class="ag-pos-payment-rows"></div>
			<button type="button" class="ag-button ag-button-light ag-pos-payment-add-row">${__("Add Payment Method")}</button>
			<button type="button" class="ag-button ag-button-primary ag-pos-payment-submit">${__("Complete Order")}</button>
		</div>`);

		content.off(".agpospay");
		content.on("click.agpospay", ".ag-pos-payment-back", () => {
			cart.step = "cart";
			this.openPosCheckout(cart.posProfile, cart.openingEntry);
		});
		content.on("click.agpospay", ".ag-pos-payment-add-row", () => {
			cart.payments.push({ mode_of_payment: "", amount: 0 });
			this.renderPosPayment();
		});
		content.on("click.agpospay", ".ag-pos-payment-row-remove", (event) => {
			cart.payments.splice(Number($(event.currentTarget).data("index")), 1);
			this.renderPosPayment();
		});
		content.on("change.agpospay", ".ag-pos-payment-amount", (event) => {
			const input = $(event.currentTarget);
			cart.payments[Number(input.data("index"))].amount = flt(input.val());
			this.renderPosPayment();
		});
		content.on("change.agpospay", ".ag-pos-payment-mode", (event) => {
			const input = $(event.currentTarget);
			cart.payments[Number(input.data("index"))].mode_of_payment = input.val();
		});
		content.on("click.agpospay", ".ag-pos-payment-submit", () => this.submitPosInvoice());

		this.renderPosPayment();
	}

	renderPosPayment() {
		const cart = this.posCart;
		const modes = (cart.profile.payments || []).map((row) => row.mode_of_payment);
		const rows = this.wrapper.find(".ag-pos-payment-rows");
		rows.html(cart.payments.map((row, index) => `<div class="ag-pos-payment-row">
				<select class="ag-pos-payment-mode" data-index="${index}">
					<option value="">${__("Select")}</option>
					${modes.map((mode) => `<option value="${this.escape(mode)}" ${mode === row.mode_of_payment ? "selected" : ""}>${this.escape(mode)}</option>`).join("")}
				</select>
				<input type="number" min="0" step="any" class="ag-pos-payment-amount" data-index="${index}" value="${row.amount}">
				${cart.payments.length > 1 ? `<button type="button" class="ag-pos-payment-row-remove" data-index="${index}">${this.icon("delete", "xs")}</button>` : ""}
			</div>`).join(""));
		const paid = cart.payments.reduce((sum, row) => sum + flt(row.amount), 0);
		const remaining = flt(cart.serverDoc.grand_total) - paid;
		this.wrapper.find(".ag-pos-payment-remaining b").html(this.reportMoney(remaining));
		this.wrapper.find(".ag-pos-payment-remaining").toggleClass("ag-pos-payment-over", remaining < -0.005);
	}

	async submitPosInvoice() {
		const cart = this.posCart;
		const partial = Boolean(cart.profile.allow_partial_payment);
		// with partial payment on, a row is kept for the mode it names even when nothing
		// was taken on it - that is how a sale goes out fully unpaid
		const validRows = cart.payments.filter((row) => row.mode_of_payment
			&& (partial || flt(row.amount) > 0));
		if (!validRows.length) {
			frappe.show_alert({ message: partial
				? __("Please choose a mode of payment")
				: __("Please enter at least one payment amount"), indicator: "orange" });
			return;
		}
		const paid = validRows.reduce((sum, row) => sum + flt(row.amount), 0);
		if (paid < flt(cart.serverDoc.grand_total) - 0.005 && !partial) {
			frappe.show_alert({ message: __("Paid amount must cover the grand total"), indicator: "orange" });
			return;
		}

		const freeze = frappe.dom.freeze(__("Submitting order..."));
		let submitted;
		try {
			const saved = await frappe.call({
				method: "frappe.client.save",
				args: {
					doc: {
						...cart.serverDoc,
						payments: validRows.map((row) => ({ mode_of_payment: row.mode_of_payment, amount: flt(row.amount) })),
						// A POS Invoice is left out of the server's calculate_paid_amount and
						// calculate_outstanding_amount (taxes_and_totals.py:877, :894), so these two
						// are the till's to send - exactly as ERPNext's own does in pos_payment.js.
						// Without them outstanding stays 0 and an unpaid sale is marked Paid.
						paid_amount: paid,
						base_paid_amount: paid * flt(cart.serverDoc.conversion_rate || 1),
						// paying over the total is change owed, not a negative debt
						outstanding_amount: Math.max(flt(cart.serverDoc.grand_total) - paid, 0),
					},
				},
			}).then((res) => res.message);
			submitted = await frappe.call({
				method: "frappe.client.submit",
				args: { doc: saved },
			}).then((res) => res.message);
		} catch (error) {
			frappe.dom.unfreeze();
			frappe.msgprint({ title: __("Could not submit order"), message: this.message(error), indicator: "red" });
			return;
		}
		frappe.dom.unfreeze();
		this.showPosOrderSummary(submitted);
	}

	showPosOrderSummary(doc) {
		const cart = this.posCart;
		const content = this.wrapper.find(".ag-content");
		content.off(".agpospay").off(".agposcart");
		content.html(`<div class="ag-pos-summary">
			<span class="ag-pos-summary-icon">${this.icon("check", "lg")}</span>
			<h1>${__("Order Complete")}</h1>
			<p>${this.escape(doc.name)}</p>
			<div class="ag-pos-summary-totals">
				<div><span>${__("Grand Total")}</span><b>${this.reportMoney(doc.grand_total)}</b></div>
				<div><span>${__("Paid Amount")}</span><b>${this.reportMoney(doc.paid_amount)}</b></div>
			</div>
			<div class="ag-pos-summary-actions">
				<a class="ag-button ag-button-light" target="_blank" rel="noopener" href="/printview?doctype=POS%20Invoice&name=${encodeURIComponent(doc.name)}">${__("View / Print Invoice")}</a>
				<button type="button" class="ag-button ag-button-primary ag-pos-new-sale">${__("New Sale")}</button>
			</div>
		</div>`);
		content.off(".agpossummary").on("click.agpossummary", ".ag-pos-new-sale", () => {
			this.openPosCheckout(cart.posProfile, cart.openingEntry);
		});
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
			if (field.fieldtype === "Section Break") { pendingSection = { label: field.label, collapsible: field.collapsible, dependsOn: field.depends_on || (SECTION_DEPENDS_ON[this.state.kind] || {})[field.fieldname] }; pendingColumns = 0; continue; }
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
			if (!this.formDoc?.name
				&& (HIDE_UNTIL_SAVED[this.state.kind] || []).includes(field.fieldname)) continue;
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
		panels.on("click", ".ag-po-report", () => this.openQuotationComparison());
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
			// A POS Invoice as the till wrote it. Read only, so this is a record to look at:
			// who bought what, what was charged, and what actually settled it.
			"pos-invoice": {
				fields: [
					// Details
					"naming_series", "customer", "customer_name", "pos_profile",
					"consolidated_invoice", "is_pos", "is_return", "return_against",
					"company", "posting_date", "posting_time", "due_date",
					// Accounting dimensions
					"cost_center", "project",
					// Currency
					"currency", "selling_price_list",
					// Warehouse and items
					"set_warehouse", "update_stock", "items",
					"total_qty", "total", "net_total",
					// Taxes
					"taxes_and_charges", "taxes", "total_taxes_and_charges",
					// Discount
					"apply_discount_on", "additional_discount_percentage", "discount_amount",
					// Totals - outstanding sits here because it is what decides the status
					"grand_total", "rounding_adjustment", "rounded_total",
					"total_advance", "outstanding_amount",
					// Payments - the modes the cashier actually entered
					"payments", "paid_amount", "change_amount",
					// Address & Contact
					"customer_address", "address_display", "contact_person", "contact_display",
					"shipping_address_name", "shipping_address", "territory",
					// More Info
					"status", "po_no", "po_date",
				],
				unhide: ["consolidated_invoice", "outstanding_amount", "status"],
				tables: {
					items: ["item_code", "qty", "uom", "rate", "amount", "warehouse"],
					taxes: ["charge_type", "account_head", "rate", "tax_amount", "total"],
					payments: ["mode_of_payment", "amount", "base_amount"],
				},
			},
			// the desk's own Stock Entry form. The rest of what it carries - BOM, work
			// order, subcontracting, job cards - belongs to manufacturing, which this
			// workspace does not run, and the server fills every one of them itself.
			"stock-entry": {
				fields: [
					"naming_series", "stock_entry_type", "company",
					// the checkbox is what lets the two beside it be typed on the desk form
					"set_posting_time", "posting_date", "posting_time",
					"inspection_required", "apply_putaway_rule",
					// Default Warehouse: fills every row's source or target in one go
					"from_warehouse", "to_warehouse",
					"items",
					"total_outgoing_value", "total_incoming_value", "value_difference",
					// Accounting Dimensions tab
					"project",
					// Other Info tab: Printing Settings, then More Information. The read-only
					// trackers beside them - per_transferred, job_card, total_amount - are
					// manufacturing's, written by a work order rather than typed here.
					"select_print_heading", "letter_head",
					"is_opening", "remarks",
				],
				tables: { items: ["s_warehouse", "t_warehouse", "item_code", "qty", "uom", "basic_rate"] },
			},
			// Fuel bought in. amountffs is the rounded figure it bills on and aamountffs
			// the exact one; both are read-only and filled as the two above them change.
			// location_ffs and payment_entry_reference are left out: the first is hidden on
			// the desk form too, and nothing writes the second (its Payment Entry code is
			// commented out in fuel_for_stock.py).
			"fuel-for-stock": {
				fields: [
					"date_ffs", "item", "company",
					"vendor_name", "quantity_ffs",
					"warehouse", "rateltr_ffs",
					"aamountffs", "amountffs",
					"upload_invoice__invoice_copy", "upload_fuel_station_proof__fuel_station_receipt",
					"stock_entry_reference",
				],
			},
			// Fuel issued out. diesel_in_stockltr is hidden on the desk form as well - it
			// holds what the warehouse has, read from Bin, and only the save check uses it.
			"fuel-for-distribution": {
				fields: [
					"date", "location", "company",
					"item", "warehouse",
					"fuel_distribution_to_vehicle", "issued_quantity_ltr", "purpose",
					"stock_entry_reference",
				],
				tables: {
					fuel_distribution_to_vehicle: ["vehicle_details", "last_readingkm",
						"current_readingkm", "issued_quantity_ct"],
				},
			},
			"vehicle-details": {
				fields: [
					"location_centre_vd", "vehicle_type", "make",
					"license_plate", "model_name", "employee_name",
					// the name is built from the three above it, exactly as vehicle_details.js
					// builds it, and is what the record is named after
					"vehicle_display_name",
				],
			},
			// The desk's own Journal Entry. What is left off is ERPNext machinery this
			// workspace has no screen for - a Write Off entry's Get Outstanding Invoices
			// dialog, a template to pull rows from - or fields the server fills itself
			// (the deferred-accounting, inter-company and reversal links).
			// The desk's own New Account form. root_type and report_type are left off:
			// both are read-only there and the server fills them from the parent, so a
			// box for either would only ever sit blank and grey.
			"account": {
				fields: [
					"disabled", "account_name", "account_number", "is_group",
					"company", "account_currency",
					"parent_account", "account_type", "tax_rate", "balance_must_be",
				],
			},
			"journal-entry": {
				fields: [
					// Entry Type and Date
					"voucher_type", "naming_series", "company", "posting_date",
					// Accounting Entries
					"accounts",
					// the reference pair the server insists on for a Bank or Cash entry,
					// and the two sides that have to meet before it will submit
					"cheque_no", "cheque_date", "user_remark",
					"total_debit", "total_credit", "difference", "multi_currency",
					// Reference
					"clearance_date", "remark", "bill_no", "bill_date", "due_date",
					// Printing Settings
					"pay_to_recd_from", "letter_head", "select_print_heading",
					// More Information
					"mode_of_payment", "is_opening",
				],
				tables: {
					accounts: ["account", "party_type", "party",
						"debit_in_account_currency", "credit_in_account_currency"],
				},
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
					items: ["item_code", "schedule_date", "qty", "received_qty", "uom", "last_purchase_rate", "rate", "amount", "description"],
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
					// Details - Items. update_stock is left off: an invoice raised here follows a
					// Purchase Receipt, which has already taken the stock in, and ticking it would
					// take it in a second time.
					"is_subcontracted", "items", "total_qty", "total",
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
			// A Payment Request as the desk lays it out: what is being asked for, from whom,
			// against which document, and where the money should land.
			"payment-request": {
				fields: [
					// Details
					"payment_request_type", "naming_series", "transaction_date", "mode_of_payment", "company",
					// Party Details - the reference is what ties it to an invoice or an order
					"party_type", "party", "party_name", "reference_doctype", "reference_name",
					// Transaction Details
					"grand_total", "outstanding_amount", "currency", "party_account_currency",
					"is_a_subscription", "subscription_plans",
					// Bank Account Details - the read-only ones fill themselves from the bank account
					"bank_account", "bank", "bank_account_no", "account", "iban", "branch_code", "swift_number",
					// Accounting Dimensions
					"cost_center", "project",
					// Recipient and Message
					"print_format", "email_to", "subject", "message", "mute_email", "payment_url",
					// More Info
					"status", "payment_order", "phone_number",
				],
				// status and outstanding are what the list column shows, so they are worth
				// seeing on the form as well
				unhide: ["status", "outstanding_amount"],
				tables: {
					subscription_plans: ["plan", "qty"],
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
					// What this payment settles, and how much of each. Saving is always allowed -
					// it is Payment Entry.on_submit that throws "Difference Amount must be zero",
					// so a draft can sit with 500 paid against a 1000 allocation and refuse only
					// to submit. Paying 500 against a 1000 invoice means editing the Allocated
					// cell down to 500, impossible without these rows on screen. The three totals
					// below then say plainly what is still unmatched.
					"references", "total_allocated_amount", "unallocated_amount", "difference_amount",
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
					references: ["reference_doctype", "reference_name", "due_date",
						"total_amount", "outstanding_amount", "allocated_amount"],
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

	// Item.description is a Text Editor; the grid shows Small Text, where markup would
	// read as literal tags. This leaves the words the Desk grid renders.
	plainText(value) {
		if (!value) return "";
		const holder = document.createElement("div");
		holder.innerHTML = String(value);
		return (holder.textContent || "").replace(/\s+/g, " ").trim();
	}

	async fillItemDefaults(rowContext) {
		const code = rowContext.controls.item_code?.get_value();
		if (!code) return;
		// where ERPNext owns the totals its own set_missing_values fills the row, so just ask for a recalculation
		if (CALCULATED_KINDS.includes(this.state.kind)) return this.scheduleRecalculation();
		let values;
		try {
			const response = await frappe.db.get_value("Item", code, ["stock_uom", "item_name", "description"]);
			values = response?.message || {};
		} catch (error) {
			return;
		}
		if (rowContext.controls.item_code?.get_value() !== code) return; // the row moved on already
		if (values.item_name) rowContext.data.item_name = values.item_name;
		// Specification: the same copy ERPNext makes in get_item_details.py:441. Written
		// on every item change, which is what the Desk does too - a description typed by
		// hand survives until the item itself is swapped.
		const specification = this.plainText(values.description);
		if (specification) {
			rowContext.data.description = specification;
			const control = rowContext.controls.description;
			if (control) control.set_value(specification);
		}
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
			// the quotations the rows themselves name, plus the ones raised against the same
			// requests but not chosen - those arrive from loadRequestQuotations below
			supplier_quotation: [...new Set([...names("supplier_quotation"), ...(this.requestQuotations || [])])],
			material_request: names("material_request"),
		};
		this.loadRequestQuotations();
		const chip = (key, label) => {
			const linked = this.referenceLinks[key];
			return `<button type="button" class="ag-po-link ag-po-open" data-link="${key}" ${linked.length ? "" : "disabled"} title="${linked.length ? this.escape(linked.join(", ")) : `No ${label} linked`}"><b>${linked.length}</b> ${label}</button>`;
		};
		// the comparison report only makes sense once there are quotations to compare
		const quotations = this.referenceLinks.supplier_quotation.length;
		return `<div class="ag-po-links">${chip("supplier_quotation", "Supplier Quotation")}${chip("material_request", "Material Request")}<button type="button" class="ag-po-link ag-po-report" ${quotations ? "" : "disabled"} title="${quotations ? "Compare supplier quotations" : "No Supplier Quotation linked"}">Supplier Quotation Comparison Report</button></div>`;
	}

	async loadRequestQuotations() {
		// asked once per set of requests: the answer depends on nothing else
		const requests = this.referenceLinks.material_request || [];
		const key = requests.slice().sort().join("|");
		if (!requests.length || this.requestQuotationsKey === key) return;
		this.requestQuotationsKey = key;
		try {
			const found = await this.api.quotationsForRequests(requests);
			const known = new Set(this.referenceLinks.supplier_quotation || []);
			if (!(found || []).some((name) => !known.has(name))) return;
			this.requestQuotations = found || [];
			this.refreshPurchaseOrderLinks();
		} catch (error) {
			// the chip still shows what the rows themselves name
			console.error(error);
		}
	}

	async openQuotationComparison() {
		// Opened from a Purchase Order, this report should be about THIS order's quotations.
		// ERPNext's own defaults answer a different question - a rolling month, and expired
		// quotations left out - so on an order of any age it showed either the wrong month or
		// nothing at all. The quotations are named outright instead, and the window is
		// stretched back to cover the oldest of them: a quotation is almost always older than
		// the order it produced, so today alone would come back empty.
		const quotations = (this.referenceLinks?.supplier_quotation || []).slice();
		const options = {};
		const company = this.getFormValue("company");
		if (company) options.company = company;

		if (quotations.length) {
			options.supplier_quotation = quotations;
			// a quotation past its Valid Till is exactly the history being looked at here
			options.include_expired = 1;
			let earliest = null;
			try {
				const rows = await frappe.db.get_list("Supplier Quotation", {
					filters: { name: ["in", quotations] },
					fields: ["transaction_date"],
					order_by: "transaction_date asc",
					limit: 1,
				});
				earliest = rows?.[0]?.transaction_date || null;
			} catch (error) {
				earliest = null; // fall back to the month below
			}
			options.from_date = earliest || frappe.datetime.add_months(frappe.datetime.get_today(), -1);
			options.to_date = frappe.datetime.get_today();
		}

		frappe.route_options = options;
		frappe.set_route("query-report", "Supplier Quotation Comparison");
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

	bindPartyDetails(control, df) {
		// Picking a Supplier by hand should refresh its address/contact the way ERPNext's own
		// buying forms do (erpnext.utils.get_party_details). Gated on event.originalEvent so
		// opening an already-saved document never re-fetches and overwrites an address the
		// user deliberately chose away from the supplier's default.
		if (df.fieldname !== "supplier" || !control.$input) return;
		control.$input.on("change.agparty awesomplete-selectcomplete.agparty", (event) => {
			if (!event.originalEvent) return;
			this.applyBuyingPartyDetails();
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

	// ---------- fields that fill themselves ----------

	// Frappe fills a `fetch_from` field the instant its source Link is picked. The server
	// fills the very same fields again on save (base_document.py:830), so nothing that gets
	// stored changes here - this only stops a form sitting blank until Save, which is what
	// the Desk form never does. It matters most for the read-only ones: those cannot be
	// typed, so until now they showed nothing at all until the document came back saved.
	//
	// Header fields only. A child row's fetch_from is already filled by the server's
	// recalculate, which runs ERPNext's own set_missing_values over the whole document.
	fetchTargets(sourceField) {
		return ((this.formMeta && this.formMeta.fields) || []).filter((df) => df.fieldname
			&& df.fetch_from && df.fetch_from.split(".")[0] === sourceField);
	}

	bindFetchFrom(control, df) {
		if (df.fieldtype !== "Link" || !control.$input) return;
		const targets = this.fetchTargets(df.fieldname);
		if (!targets.length) return;
		// same provenance-free test the other binders use: the form has finished rendering
		// and the value has actually moved. A Link commits its docname a tick after its own
		// select event, hence the setTimeout.
		let known = control.get_value();
		const react = () => {
			const current = control.get_value();
			if (!this.formReady || current === known) return;
			known = current;
			this.applyFetchFrom(df.options, current, targets);
		};
		control.$input.on("change.agfetch awesomplete-selectcomplete.agfetch blur.agfetch",
			() => window.setTimeout(react, 0));
		const previous = control.df.onchange;
		control.df.onchange = function (...args) {
			const result = previous ? previous.apply(this, args) : undefined;
			react();
			return result;
		};
	}

	async applyFetchFrom(doctype, name, targets) {
		if (!doctype) return;
		if (!name) {
			// clearing the source clears what was fetched from it, as the Desk form does
			targets.forEach((target) => this.setFormValue(target.fieldname, ""));
			return;
		}
		const wanted = [...new Set(targets.map((target) => target.fetch_from.split(".").slice(1).join(".")))];
		const response = await frappe.db.get_value(doctype, name, wanted).catch(() => null);
		const values = response && response.message;
		if (!values) return;
		// the answer can arrive after the user has moved on to another source
		targets.forEach((target) => {
			const source = target.fetch_from.split(".").slice(1).join(".");
			if (!(source in values)) return;
			// fetch_if_empty marks a fetched value as a mere default - Frappe leaves such a
			// field alone once it holds something, so a typed value is never overwritten
			if (target.fetch_if_empty && !target.read_only && this.formDoc[target.fieldname]) return;
			this.setFormValue(target.fieldname, values[source] === null || values[source] === undefined ? "" : values[source]);
		});
	}

	bindDerivedFields(control, df) {
		const targets = (DERIVED_FIELDS[this.state.kind] || {})[df.fieldname];
		if (!targets || !control.$input) return;
		let known = control.get_value();
		const filled = new Map();
		const react = () => {
			const current = control.get_value();
			if (!this.formReady || current === known) return;
			known = current;
			if (!current) return;
			targets.forEach((target) => {
				const existing = this.formDoc[target];
				// anything there that this rule did not put there is the user's own text, and
				// the source stops driving the field for good once that happens
				if (existing && existing !== filled.get(target)) return;
				filled.set(target, current);
				this.setFormValue(target, current);
			});
		};
		control.$input.on("change.agderive awesomplete-selectcomplete.agderive blur.agderive",
			() => window.setTimeout(react, 0));
		// A typed Data field raises no change until it loses focus. ERPNext fills on that
		// blur alone; watching keystrokes as well makes the name appear as it is typed,
		// which the guard above makes safe.
		control.$input.on("input.agderive", () => window.setTimeout(react, 0));
		const previous = control.df.onchange;
		control.df.onchange = function (...args) {
			const result = previous ? previous.apply(this, args) : undefined;
			react();
			return result;
		};
	}

	// ---------- "Create a new ..." stays inside this workspace ----------

	// A Link's dropdown offers "Create a new X", and Frappe answers it with a quick-entry
	// dialog only when the DocType is marked quick_entry - otherwise it calls set_route and
	// the user lands on the Desk form (quick_entry.js:48). Most masters are not marked, so
	// creating an Item Group or a Warehouse from here walked straight out of the workspace.
	//
	// Forcing the dialog keeps them here, and force has a second effect worth having: the
	// "Edit Full Form" button is not rendered at all when it is set (quick_entry.js:137), so
	// the dialog carries no way back out to the Desk either.
	bindCreateNew(control, df) {
		if (df.fieldtype !== "Link" || df.only_select || typeof control.new_doc !== "function") return;
		// awesomplete stores `action: me.new_doc` when it builds the dropdown, and calls it
		// with apply(control) - so replacing the property before any dropdown opens is enough,
		// and an arrow function here simply ignores the `this` that gets applied.
		const original = control.new_doc.bind(control);
		control.new_doc = () => {
			this.createFromLink(control, original);
			return false;
		};
	}

	// A dialog can only stand in for the form when it can actually hold every field the
	// insert needs: no mandatory child table, at least one field to show, and no more than
	// Frappe's own ceiling of seven (quick_entry.js:93). Anything heavier belongs on the
	// workspace's own form, which is the themed place for it.
	mandatoryFields(meta) {
		return ((meta && meta.fields) || []).filter((field) => (field.reqd || field.allow_in_quick_entry)
			&& !field.read_only && !field.is_virtual && field.fieldtype !== "Tab Break");
	}

	quickEntryFits(meta) {
		if (!meta) return false;
		const mandatory = this.mandatoryFields(meta);
		// a mandatory child table cannot be filled in a dialog at all, whatever else is true
		if (mandatory.some((field) => field.fieldtype === "Table")) return false;
		// Frappe puts a __newname box in front of a prompt-named dialog (quick_entry.js:117),
		// so such a dialog always has that one field to show even with nothing else mandatory
		const prompt = String(meta.autoname || "").toLowerCase() === "prompt";
		const count = mandatory.length + (prompt ? 1 : 0);
		return count >= 1 && count <= 7;
	}

	// whichever field a new record is actually named by, so the half-typed text is not lost
	nameFieldFor(meta) {
		const autoname = String(meta.autoname || "");
		if (autoname.toLowerCase() === "prompt") return "__newname";
		if (autoname.startsWith("field:")) return autoname.slice(6).trim();
		if (meta.title_field) return meta.title_field;
		const stem = String(meta.name || "").toLowerCase().replace(/ /g, "_");
		const named = [stem + "_name", stem + "_title"]
			.find((fieldname) => (meta.fields || []).some((field) => field.fieldname === fieldname));
		return named || null;
	}

	async createFromLink(control, original) {
		const doctype = control.get_options && control.get_options();
		if (!doctype) return;
		const kind = this.kindForDoctype(doctype);
		// not carried here - the Desk is the only place it exists, so Frappe's own path stands
		if (!kind) { original(); return; }
		const typed = control.get_label_value ? String(control.get_label_value() || "").trim() : "";
		let meta = null;
		try {
			await new Promise((resolve) => frappe.model.with_doctype(doctype, resolve));
			meta = frappe.get_meta(doctype);
		} catch (error) {
			console.error(error);
		}
		if (!this.quickEntryFits(meta)) {
			await this.openPortalCreate(kind, doctype);
			return;
		}
		// no _from_link: that is Frappe's route back from the Desk form, and there is no such
		// trip any more. after_insert writes the new name into the link that asked for it.
		frappe._from_link = null;
		const entry = await frappe.ui.form.make_quick_entry(doctype,
			(doc) => control.set_value(doc.name), null, null, true).catch((error) => {
				console.error(error);
				return null;
			});
		if (!entry || !entry.dialog) return;
		// a failed insert otherwise falls back to open_doc, which routes to the Desk form
		entry.skip_redirect_on_error = true;
		// and if anything still reaches for the Desk, send it to this workspace instead
		entry.open_doc = () => {
			entry.dialog.hide();
			this.openPortalCreate(kind, doctype);
		};
		// carry over what was already typed into the link
		const nameField = this.nameFieldFor(meta);
		const target = nameField && entry.dialog.fields_dict[nameField];
		if (typed && target && !target.get_value()) target.set_value(typed);
	}

	async openPortalCreate(kind, doctype) {
		// leaving a half-filled form is the user's call, not a side effect of a stray click
		if (this.formDirty) {
			const leave = await new Promise((resolve) => frappe.confirm(
				__("This form has unsaved changes. Leave it and create a new {0}?", [__(doctype)]),
				() => resolve(true), () => resolve(false)));
			if (!leave) return;
		}
		this.state.kind = kind;
		this.state.start = 0;
		await this.openForm(null);
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

	async applyBuyingPartyDetails() {
		// mirrors ERPNext's erpnext.utils.get_party_details for Supplier Quotation/Purchase
		// Order/Purchase Receipt/Purchase Invoice: picking a supplier fills its address,
		// contact and currency/tax defaults the same way the desk form does
		const control = (fieldname) => this.formControls.find((entry) => entry.field.fieldname === fieldname)?.control;
		const value = (fieldname) => String(control(fieldname)?.get_value() || "");
		if (!control("supplier")) return;

		const company = value("company");
		const supplier = value("supplier");
		const date = value("posting_date") || value("transaction_date");
		if (!company || !supplier) return;

		let details;
		try {
			const response = await frappe.call({
				method: "erpnext.accounts.party.get_party_details",
				args: {
					party: supplier,
					party_type: "Supplier",
					company,
					posting_date: date || undefined,
					doctype: this.formMeta.doctype,
				},
			});
			details = response.message;
		} catch (error) {
			return;
		}
		if (!details) return;

		const fill = (fieldname, next) => {
			const target = control(fieldname);
			if (target && next !== undefined && next !== null) target.set_value(next);
		};
		fill("supplier_address", details.supplier_address);
		fill("address_display", details.address_display);
		fill("contact_person", details.contact_person);
		fill("contact_display", details.contact_display);
		fill("contact_email", details.contact_email);
		fill("contact_mobile", details.contact_mobile);
		fill("dispatch_address", details.dispatch_address);
		fill("dispatch_address_display", details.dispatch_address_display);
		fill("shipping_address", details.shipping_address);
		fill("shipping_address_display", details.shipping_address_display);
		fill("billing_address", details.billing_address);
		fill("billing_address_display", details.billing_address_display);
		fill("currency", details.currency);
		fill("taxes_and_charges", details.taxes_and_charges);
		fill("payment_terms_template", details.payment_terms_template);
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
		if (Number(this.formDoc?.docstatus || 0) !== 0 || this.formReadOnly()) df.read_only = 1;
		// ...except the proof of purchase, which is the whole point of the exception
		if (this.fuelAttachOpen(field.fieldname)) df.read_only = 0;
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
		if (!rowContext) this.bindFetchFrom(control, df);
		this.bindCreateNew(control, df);
		if (!rowContext) this.bindDerivedFields(control, df);
		if (!rowContext) this.bindFuelFields(control, df);
		this.bindAddressFetch(control, df);
		this.bindDiscountFields(control, df);
		this.bindTaxCategory(control, df);
		this.bindPartyDetails(control, df);
		this.scopeModeOfPayment(control, df);
		this.scopeShiftCentre(control, df);
		this.bindShiftField(control, df);
		this.bindAttendanceField(control, df);
		this.bindFullName(control, df);
		this.scopeCropLinks(control, df);
		this.bindCropField(control, df);
		this.bindPosProfileBalance(control, df);
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

	bindPosProfileBalance(control, df) {
		if (this.state.kind !== "pos-opening-entry" || df.fieldname !== "pos_profile") return;
		if (!control.$input) return;
		// a saved shift keeps whatever it was opened with; only a new one is filled in
		control.$input.on("change.agposbal awesomplete-selectcomplete.agposbal blur.agposbal", () => {
			if (this.formDoc.name) return;
			const profile = control.get_value();
			if (!profile || profile === this.posProfileLoaded) return;
			this.posProfileLoaded = profile;
			this.fillOpeningBalance(profile);
		});
	}

	async fillOpeningBalance(profile) {
		let payments;
		try {
			payments = (await frappe.db.get_doc("POS Profile", profile)).payments || [];
		} catch (error) {
			this.posProfileLoaded = null;
			return; // a profile that will not load is not worth an interruption here
		}
		// the row moved on to another profile while this was in flight
		if (this.formControl("pos_profile")?.get_value() !== profile) return;
		this.replaceChildRows("balance_details", payments.map((row) => ({
			mode_of_payment: row.mode_of_payment,
			// the float is counted by the cashier, so it starts at nothing
			opening_amount: 0,
		})));
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
		if (Number(this.formDoc?.docstatus || 0) === 0 && !this.formReadOnly()) return;
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
						{ fieldtype: "Link", fieldname: "task_name_lal", label: __("Task Name"), options: "Category Master", in_list_view: 1, columns: 3 },
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
			// get_attendance_logs (agriventure_nagpur_erp) hands back only the Labour
			// Information ID in name_of_person_al - never a display name - so the Employee
			// column needs its own lookup here, one batch call rather than one per row.
			const ids = [...new Set(rows.map((row) => row.name_of_person_al).filter(Boolean))];
			let names = {};
			if (ids.length) {
				try {
					const people = await frappe.db.get_list("Labour Information", {
						filters: { name: ["in", ids] },
						fields: ["name", "name_of_person"],
						limit: ids.length,
					});
					names = Object.fromEntries(people.map((person) => [person.name, person.name_of_person]));
				} catch (error) {
					names = {};
				}
			}
			const now = frappe.datetime.now_time();
			grid.df.data = rows.map((row) => ({
				...row,
				person_name: names[row.name_of_person_al] || row.name_of_person_al || "",
				start_time_lal: row.start_time_lal || now,
				__checked: 0,
			}));
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
					{ fieldtype: "Link", fieldname: "task", label: __("Task"), options: "Category Master", reqd: 1 },
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

	scopeModeOfPayment(control, df) {
		// A mode without an account for this company can be picked today and then
		// refuses to save ("Please set default Cash or Bank account in Mode of Payments
		// ..."). Both of these forms run that same check, so both are given the list of
		// modes that will actually go through.
		if (df.fieldname !== "mode_of_payment") return;
		if (!["pos-profile", "pos-opening-entry"].includes(this.state.kind)) return;
		control.get_query = () => ({
			query: "agriventure.portal_extras.modes_for_company",
			// read at search time, not now: the company may still be empty while the
			// form is being drawn, and is often chosen after the first row is added
			filters: { company: this.getFormValue("company") },
		});
	}

	scopeShiftCentre(control, df) {
		// only centres that actually have attendance logged on the chosen date, which is
		// the same link query the desk form uses
		if (this.state.kind !== "shift-details" || df.fieldname !== "centre__location_sd") return;
		control.get_query = () => ({
			query: `agriventure.portal_extras.get_today_centres`,
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
		// ---- superseded by Face Attendance, kept on record --------------------
		// Picking a person used to open the camera and check that one face. The face
		// screen on the list does the same check without the two pickers in front of
		// it, so this no longer runs. The form itself is untouched: it is still how
		// somebody with no usable photo gets marked, and uncommenting the block below
		// brings the old behaviour back exactly as it was.
		if (!FACE_ATTENDANCE_ONLY) later(() => {
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

	bindFullName(control, df) {
		// Labour Information's own client script (labour_information.js, which this portal
		// does not load) builds Name of Person from these three on every edit, capitalizing
		// each one's first letter along the way. Reproduced here so a record created through
		// the portal reads the same as one created through the desk - and so Name of Person,
		// which the doctype requires, is never left blank the way it was before this existed.
		if (this.state.kind !== "labour-details" || !["first_name", "middle_name", "last_name"].includes(df.fieldname) || !control.$input) return;
		control.$input.on("change.agfullname", (event) => {
			if (!event.originalEvent) return;
			this.applyFullName();
		});
	}

	applyFullName() {
		const control = (fieldname) => this.formControls.find((entry) => entry.field.fieldname === fieldname)?.control;
		const capitalize = (value) => value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;
		const parts = ["first_name", "middle_name", "last_name"].map((fieldname) => {
			const target = control(fieldname);
			if (!target) return "";
			const capitalized = capitalize(target.get_value() || "");
			if (capitalized !== target.get_value()) target.set_value(capitalized, true);
			return capitalized;
		});
		control("name_of_person")?.set_value(parts.filter(Boolean).join(" "), true);
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
	// ---- Face attendance -----------------------------------------------------
	//
	// The desk form asks the centre and the name and then checks one face. This asks
	// the face: one scan, and both answers fall out of it. The form is untouched and
	// is still how anyone without a usable photo gets marked.

	setFaceStatus(panel, text, tone) {
		panel.find(".ag-face-status").attr("data-tone", tone || "muted").text(text);
	}

	renderFacePrepared(panel, prepared, coords) {
		// the reading, always - a centre named with no distance beside it is what made
		// a missing GPS look like a real answer
		const reading = coords
			? __("GPS {0}, {1}", [Number(coords.latitude).toFixed(5), Number(coords.longitude).toFixed(5)])
			: __("no GPS reading");
		const away = (meters) => meters === null || meters === undefined
			? ""
			: meters > 2000 ? __(" - {0} km away", [(meters / 1000).toFixed(0)])
				: __(" - {0} m away", [Math.round(meters)]);

		const select = panel.find(".ag-face-centre-pick");
		const centres = prepared?.centres || [];
		if (centres.length && !select.find("option").length) {
			select.html(`<option value="">${__("Pick a centre")}</option>`
				+ centres.map((name) => `<option value="${this.escape(name)}">${this.escape(name)}</option>`).join(""));
		}
		if (prepared?.centre) select.val(prepared.centre);

		if (!prepared?.ok) {
			// nobody can be identified without a centre, so the scan is not offered - it
			// would only compare the face against a list it was never going to be in
			const near = prepared?.nearest
				? __(" - nearest {0}{1}", [prepared.nearest, away(prepared.distance_meter)])
				: "";
			this.setFaceStatus(panel,
				`${prepared?.message || __("Could not work out the centre.")} (${reading}${near})`,
				"red");
			return;
		}

		// The nearest centre is never named here. It is only a hint, and each person's
		// attendance goes to their own posted centre instead - naming the nearest one
		// made a scan that went to Chhindwara look like it had gone to Saikheda.
		// no count, no greeting: an empty line until there is something to report
		this.setFaceStatus(panel, "", "muted");
		// A photo that will not encode is still worth knowing about, but not as a
		// popup over the camera every time it opens - it covered the frame and said
		// the same thing on every scan. face_attendance_readiness() has the list
		// whenever it is actually wanted.
	}

	async openFaceAttendance() {
		const marked = [];
		// the Scan button fired twice in a tenth of a second and wrote two logs for
		// one person; a scan already on its way is not started again
		let scanning = false;
		let prepared = null;
		let coords = null;

		// named, so the same handler serves the button and the watcher below
		const handle = async (imageData) => {
			const panel = dialog.fields_dict.camera_html.$wrapper;
			const say = (text, tone) => panel.find(".ag-face-status")
				.attr("data-tone", tone || "muted").text(text);
			// no centre needed to scan: every reference face on the site is in the
			// running, and where they work is read off the person afterwards
			if (!prepared?.ok) {
				return say(prepared?.message || __("No faces are on file yet."), "red");
			}
			if (scanning) return;
			scanning = true;
			// last scan's names must not sit there looking like this scan's answer
			panel.find(".ag-face-choices").attr("hidden", "hidden").empty();
			say(__("Checking..."), "muted");

			let result;
			try {
				result = await frappe.xcall("agriventure.portal_extras.face_mark_attendance", {
					captured_image: imageData,
					latitude: coords?.latitude,
					longitude: coords?.longitude,
					centre: prepared?.centre,
				});
			} catch (error) {
				console.error(error);
				say(this.message(error), "red");
				return;
			} finally {
				scanning = false;
			}

			this.showFaceResult(dialog, result, marked, imageData, coords, prepared);
		};

		const dialog = this.openFaceDialog(__("Face Attendance"), __("Next"), handle, true);

		const panel = dialog.fields_dict.camera_html.$wrapper;
		panel.prepend(`<div class="ag-face-status" data-tone="muted">${__("Starting camera...")}</div>`);
		// hidden: the centre comes off each person's own record, so a control asking
		// for one only reads as a step that has to be done first. It is revealed by
		// the one case that cannot be settled - somebody posted to several farms.
		panel.append(`<div class="ag-face-centre" hidden>
				<label>${__("Centre")}</label><select class="ag-face-centre-pick"></select>
			</div>
			<div class="ag-face-choices" hidden></div>
			<div class="ag-face-marked"><b>${__("Marked in this session")}</b><ol></ol></div>`);

		// GPS is a suggestion here, not the last word: a reading the device could not
		// take reads as 0,0, and the centre nearest to 0,0 is a real centre - so it
		// comes back looking like an answer. Whoever is running the camera can say.
		panel.find(".ag-face-centre-pick").on("change", async (event) => {
			const chosen = event.target.value;
			if (!chosen) { prepared = null; return; }
			this.setFaceStatus(panel, __("Loading {0}...", [chosen]), "muted");
			try {
				prepared = await frappe.xcall("agriventure.portal_extras.face_attendance_prepare", { centre: chosen });
			} catch (error) {
				console.error(error);
				return this.setFaceStatus(panel, this.message(error), "red");
			}
			this.renderFacePrepared(panel, prepared, coords);
		});

		// ---- it scans by itself ----------------------------------------------
		//
		// Nothing here recognises a face - that is the server's job. This only watches
		// how much the middle of the picture is changing, which is enough to tell
		// somebody stepping up from an empty room: a big change, then stillness.
		//
		// There was a guide box drawn over the video whose corners went green at that
		// moment. It is commented out below rather than deleted - it cost a wait that
		// bought nothing, since it could only ever report what the watcher already
		// knew, and the name coming back a moment later says the same thing.

		const video = dialog.video_element;
		// const stage = $('<div class="ag-face-stage"></div>').insertBefore(video);
		// stage.append(video);
		// const guide = $('<div class="ag-face-guide" data-state="wait">'
		//     + '<i></i><i></i><i></i><i></i></div>').appendTo(stage);

		// the part of the picture that is watched, as a fraction of it - the middle,
		// so somebody walking past the edge of the frame does not set it off
		const BOX = { x: 0.22, y: 0.13, w: 0.56, h: 0.70 };
		// mean change per pixel, 0-255: above MOVED somebody is arriving or leaving,
		// below STILL the picture has settled
		const MOVED = 7;
		const STILL = 2.5;
		// the long edge of the frame that is sent - see the note above the capture
		const SEND_EDGE = 800;

		const sampler = document.createElement("canvas");
		sampler.width = 64;
		sampler.height = 48;
		const sctx = sampler.getContext("2d", { willReadFrequently: true });
		let previous = null;
		// "clear" nobody there, "arriving" something moved, "spent" just scanned
		let watch = "clear";

		const change = () => {
			if (!video || video.readyState !== 4 || !video.videoWidth) return null;
			sctx.drawImage(video,
				video.videoWidth * BOX.x, video.videoHeight * BOX.y,
				video.videoWidth * BOX.w, video.videoHeight * BOX.h,
				0, 0, 64, 48);
			const now = sctx.getImageData(0, 0, 64, 48).data;
			if (!previous) { previous = now; return null; }
			let total = 0;
			// one channel is plenty for 'how different is this picture'
			for (let index = 0; index < now.length; index += 4) {
				total += Math.abs(now[index] - previous[index]);
			}
			previous = now;
			return total / (64 * 48);
		};

		// 120ms and a single quiet sample. Two samples are needed to see somebody
		// arrive and stop, so the tick is half the wait before a scan starts: 400ms
		// with two quiet samples read as a camera that was not working, 250ms still
		// cost half a second. The sample is 64x48 - taking it more often is free.
		const watcher = window.setInterval(async () => {
			const moved = change();
			if (moved === null || scanning) return;

			// scanned already: nothing more happens until this person steps away
			if (watch === "spent") {
				if (moved > MOVED) watch = "clear";
				return;
			}
			if (moved > MOVED) { watch = "arriving"; return; }
			if (watch !== "arriving" || moved > STILL) return;

			watch = "spent";
			// scaled down on the way out: the detector's time is the frame's size, and a
			// frame bigger than the reference photos cannot match any better
			const shrink = Math.min(1,
				SEND_EDGE / Math.max(video.videoWidth, video.videoHeight));
			const canvas = document.createElement("canvas");
			canvas.width = Math.round(video.videoWidth * shrink);
			canvas.height = Math.round(video.videoHeight * shrink);
			canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
			await handle(canvas.toDataURL("image/jpeg", 0.8));
		}, 120);

		// the stream and the watcher both stop with the dialog, however it is closed
		const closeDialog = dialog.onhide;
		dialog.onhide = () => {
			window.clearInterval(watcher);
			if (closeDialog) closeDialog();
		};

		// ---- the button moves the queue on, it does not take the picture -----
		//
		// The camera fires by itself, so a Scan button had nothing left to do -
		// pressing it only photographed somebody already dealt with. Next clears
		// the last answer and puts the watcher back to waiting, so whoever steps
		// up after this person is the one scanned.
		dialog.set_primary_action(__("Next"), () => {
			panel.find(".ag-face-choices").attr("hidden", "hidden").empty();
			watch = "clear";
			// the last frame is forgotten too, so the next sample is a baseline and
			// not a difference against whoever was standing here before
			previous = null;
			this.renderFacePrepared(panel, prepared, coords);
		});

		// the location and the centre's faces are both wanted before anyone steps up,
		// so the first scan does not pay for either
		try {
			coords = (await this.getPosition()).coords;
		} catch (error) {
			console.error(error);
		}
		try {
			prepared = await frappe.xcall("agriventure.portal_extras.face_attendance_prepare", {
				latitude: coords?.latitude,
				longitude: coords?.longitude,
			});
		} catch (error) {
			console.error(error);
			prepared = { ok: false, message: this.message(error) };
		}

		this.renderFacePrepared(panel, prepared, coords);
		return dialog;
	}

	showFaceResult(dialog, result, marked, imageData, coords, prepared) {
		const panel = dialog.fields_dict.camera_html.$wrapper;
		const status = panel.find(".ag-face-status");
		const choices = panel.find(".ag-face-choices").attr("hidden", "hidden").empty();
		const say = (text, tone) => status.attr("data-tone", tone).text(text);
		// seconds are enough to read - the microseconds the server sends are cut
		const clock = (value) => String(value || "").split(".")[0];

		if (result?.ok) {
			// One scan does both: the first of the day marks in, the next marks out.
			// Nobody at the camera has to say which - the line just reports what it did.
			const out = result.action === "logout";
			const line = out
				? __("{0} - {1} - Logout successful", [result.centre, result.labour_name])
				: __("{0} - {1} - Login successful", [result.centre, result.labour_name]);
			// on the way out the hours are the thing worth reading back
			const detail = out
				? [clock(result.log_out), __("worked {0}", [result.working_hours ?? "-"]), result.leave]
					.filter(Boolean).join(" - ")
				: clock(result.log_in);
			say(`${line} - ${detail}`, "green");
			frappe.show_alert({ message: line, indicator: out ? "blue" : "green" });
			marked.unshift({ ...result,
				when: clock(out ? result.log_out : result.log_in),
				note: out ? __("out") : __("in") });
			panel.find(".ag-face-marked ol").html(marked.map((row) =>
				`<li>${this.escape(row.labour_name)} <small>${this.escape(row.centre)} - ${this.escape(row.note)} ${this.escape(row.when)}</small></li>`).join(""));
			return;
		}

		// Most people here are posted to four farms, so the face alone cannot say which
		// one today is. Tapping it once sets the camera to that farm, and everyone else
		// posted there goes through without being asked again.
		// two different reasons, one answer: tap where you are. "centre_choice" is
		// somebody posted to several farms; "no_centre" is somebody posted to none,
		// and there every centre is offered so the queue is not held up by a master
		// that has not been filled in yet.
		if (["centre_choice", "no_centre"].includes(result?.code) && result.centres?.length) {
			say(result.message, "orange");
			// the buttons below are the answer, and they are already narrowed to this
			// person's own centres - the dropdown offered all eight, so it is left
			// hidden. Uncomment to bring it back.
			// panel.find(".ag-face-centre").removeAttr("hidden");
			choices.removeAttr("hidden").html(result.centres.map((name) =>
				`<button type="button" class="ag-button ag-button-light" data-centre="${this.escape(name)}">${this.escape(name)}</button>`).join(""));
			choices.find("button").on("click", async (event) => {
				const chosen = $(event.currentTarget).data("centre");
				// remembered for the rest of the session - this is the farm we are standing at
				if (prepared) prepared.centre = chosen;
				panel.find(".ag-face-centre-pick").val(chosen);
				say(__("Checking..."), "muted");
				try {
					const again = await frappe.xcall("agriventure.portal_extras.face_mark_attendance", {
						captured_image: imageData,
						latitude: coords?.latitude,
						longitude: coords?.longitude,
						// as a decision, not a hint: this is the only thing that can settle a
						// centre for somebody whose record does not name one
						chosen_centre: chosen,
					});
					this.showFaceResult(dialog, again, marked, imageData, coords, prepared);
				} catch (error) {
					console.error(error);
					say(this.message(error), "red");
				}
			});
			return;
		}

		// a tie the scan could not settle: the names it had in mind, for a person to pick
		if (result?.code === "not_confident" && result.candidates?.length) {
			say(result.message, "orange");
			choices.removeAttr("hidden").html(result.candidates.map((row) =>
				`<button type="button" class="ag-button ag-button-light" data-labour="${this.escape(row.labour)}">${this.escape(row.labour_name)}</button>`).join(""));
			choices.find("button").on("click", async (event) => {
				const labour = $(event.currentTarget).data("labour");
				say(__("Checking..."), "muted");
				try {
					// the same frame, re-checked - the tap settles the tie, it does not skip
					// the match: the server still refuses a name the scan never put forward
					const again = await frappe.xcall("agriventure.portal_extras.face_mark_attendance", {
						captured_image: imageData,
						latitude: coords?.latitude,
						longitude: coords?.longitude,
						centre: prepared?.centre,
						labour,
					});
					this.showFaceResult(dialog, again, marked, imageData, coords, prepared);
				} catch (error) {
					console.error(error);
					say(this.message(error), "red");
				}
			});
			return;
		}

		// already marked is not a failure, it is an answer - a different colour says so
		say(result?.message || __("Face did not match."), result?.code === "already_marked" ? "orange" : "red");
	}

	openFaceDialog(title, actionLabel, onCapture, keepOpen = false) {
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
				// a queue keeps the stream running - stopping it between people is most of
				// the wait, and the next person is already standing there
				if (!keepOpen) stopCamera();
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
				// image_of_person on this site is fetch_from the person's master photo, and there
				// is no separate field for the live frame - so there is nowhere to keep it and
				// the portal does not pretend otherwise.
				if (SAVE_LOGIN_PHOTO && this.formDoc.name) {
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

	// ---- Transport -----------------------------------------------------------
	//
	// Everything below mirrors agriventure_nagpur_erp's own two form scripts: the same
	// filters, the same arithmetic, the same stock check, and its own two whitelisted
	// methods called as they are. Nothing in that app is touched.

	// With no fieldname: does this form have anything left that can be filled in at all.
	// With one: is that the field. Used both to unlock the control and to keep Save on
	// screen for a document that is otherwise a record.
	fuelAttachOpen(fieldname = null) {
		if (this.state.kind !== "fuel-for-stock" || !this.formDoc?.name) return false;
		return fieldname === null || FUEL_ATTACH_FIELDS.includes(fieldname);
	}

	fuelValue(fieldname) {
		const live = this.formControl(fieldname)?.get_value();
		if (this.hasValue(live)) return live;
		// not typed yet - the same default renderControl is in the middle of applying
		const field = (this.formMeta?.fields || []).find((entry) => entry.fieldname === fieldname);
		return (field ? this.defaultValue(field, this.formDoc[fieldname]) : this.formDoc[fieldname]) || "";
	}

	renderFuelStockCard(content) {
		if (!FUEL_LOCKED_KINDS.includes(this.state.kind)) return;
		this.fuelAvailable = null;
		const panel = $('<div class="ag-fuel-stock" hidden></div>').insertAfter(content.find(".ag-form-head"));
		this.drawFuelStock = async () => {
			const warehouse = this.fuelValue("warehouse");
			if (!warehouse) return void panel.attr("hidden", "hidden").empty();
			let stock;
			try {
				stock = await frappe.xcall(FUEL_STOCK_METHOD, { warehouse });
			} catch (error) {
				// not worth interrupting the form over, but not worth hiding either
				console.error("fuel stock card", error);
				return void panel.attr("hidden", "hidden").empty();
			}
			if (this.fuelValue("warehouse") !== warehouse) return; // moved on already
			const tile = (fuel) => {
				const litres = flt((stock || {})[fuel]);
				return `<div class="ag-fuel-tile${litres < FUEL_FLOOR[fuel] ? " is-low" : ""}"><span>${__(fuel)}</span><b>${litres} L</b></div>`;
			};
			panel.html(`<div class="ag-fuel-stock-head">${__("Stock in {0}", [this.escape(warehouse)])}</div><div class="ag-fuel-stock-grid">${tile("Diesel")}${tile("Petrol")}</div>`).removeAttr("hidden");
		};
		this.drawFuelStock();
		// read once on open as well: the warehouse arrives with a default on it, so the
		// save check would otherwise have nothing to compare against until it is changed
		this.readFuelAvailability();
	}

	bindFuelFields(control, df) {
		if (!FUEL_LOCKED_KINDS.includes(this.state.kind)) return;
		// the two narrowings both desk forms apply in their onload handlers
		if (df.fieldname === "item") control.get_query = () => ({ filters: { item_group: "Fuel" } });
		if (df.fieldname === "location") control.get_query = () => ({ filters: [["name", "not in", ["Mahurzari"]]] });
		if (!control.$input) return;
		if (["warehouse", "item"].includes(df.fieldname)) {
			control.$input.on("change.agfuel awesomplete-selectcomplete.agfuel", () => {
				if (df.fieldname === "warehouse") this.drawFuelStock?.();
				this.readFuelAvailability();
			});
		}
		// quantity x rate, kept twice over: the exact figure and the rounded one it
		// bills on, exactly as calculate_amountffs does
		if (["quantity_ffs", "rateltr_ffs"].includes(df.fieldname)) {
			control.$input.on("change.agfuel input.agfuel", () => {
				const amount = flt(this.getFormValue("quantity_ffs")) * flt(this.getFormValue("rateltr_ffs"));
				this.extraFieldValues.aamountffs = amount;
				this.extraFieldValues.amountffs = Math.ceil(amount);
				this.formControl("aamountffs")?.set_value(amount);
				this.formControl("amountffs")?.set_value(Math.ceil(amount));
			});
		}
	}

	async readFuelAvailability() {
		if (this.state.kind !== "fuel-for-distribution") return;
		const item = this.fuelValue("item");
		const warehouse = this.fuelValue("warehouse");
		if (!item || !warehouse) return;
		let bin;
		try {
			bin = await frappe.db.get_value("Bin", { item_code: item, warehouse }, "actual_qty");
		} catch (error) {
			return; // nothing to compare against; the server still refuses a short issue
		}
		if (this.fuelValue("item") !== item || this.fuelValue("warehouse") !== warehouse) return;
		this.fuelAvailable = flt(bin?.message?.actual_qty);
		// hidden on the desk form too, and only the save check reads it
		this.extraFieldValues.diesel_in_stockltr = this.fuelAvailable;
	}

	issuedFuelTotal() {
		const state = this.tableStates.get("fuel_distribution_to_vehicle");
		if (!state) return flt(this.formDoc.issued_quantity_ltr);
		return state.rows.reduce((sum, row) => sum
			+ flt(this.fieldValue(row.controls.issued_quantity_ct, row.data, "issued_quantity_ct")), 0);
	}

	syncIssuedTotal() {
		if (this.state.kind !== "fuel-for-distribution") return 0;
		const total = this.issuedFuelTotal();
		// the field is read-only, so its own control is not what gets sent out - a
		// read-only control reads back as undefined and collectDocument keeps the old
		// value. extraFieldValues is merged last and wins.
		this.extraFieldValues.issued_quantity_ltr = total;
		this.formControl("issued_quantity_ltr")?.set_value(total);
		return total;
	}

	syncJournalTotals() {
		if (this.state.kind !== "journal-entry") return;
		const state = this.tableStates.get("accounts");
		if (!state) return;
		const side = (fieldname) => state.rows.reduce((running, row) => running
			+ flt(this.fieldValue(row.controls[fieldname], row.data, fieldname)), 0);
		const debit = side("debit_in_account_currency");
		const credit = side("credit_in_account_currency");
		// read-only boxes, and the server works all three out again on save; these are
		// here so the difference can be watched closing rather than found at submit
		this.formControl("total_debit")?.set_value(debit);
		this.formControl("total_credit")?.set_value(credit);
		this.formControl("difference")?.set_value(debit - credit);
	}

	bindJournalRow(state, rowContext) {
		if (this.state.kind !== "journal-entry") return;
		for (const fieldname of ["debit_in_account_currency", "credit_in_account_currency"]) {
			const control = rowContext.controls[fieldname];
			if (control?.$input?.length) control.$input.on("change.agje input.agje", () => this.syncJournalTotals());
		}
	}

	bindVehicleRow(state, rowContext) {
		if (this.state.kind !== "fuel-for-distribution") return;
		const vehicle = rowContext.controls.vehicle_details;
		if (vehicle?.$input?.length) {
			vehicle.$input.on("change.agvehicle awesomplete-selectcomplete.agvehicle", async () => {
				const name = vehicle.get_value();
				let reading = 0;
				if (name) {
					try {
						reading = await frappe.xcall(VEHICLE_READING_METHOD, { vehicle: name });
					} catch (error) {
						reading = 0; // a vehicle with no history reads the same as no reading
					}
				}
				if (vehicle.get_value() !== name) return; // the row moved on
				rowContext.data.last_readingkm = reading || 0;
				rowContext.controls.last_readingkm?.set_value(reading || 0);
			});
		}
		const issued = rowContext.controls.issued_quantity_ct;
		if (issued?.$input?.length) issued.$input.on("change.agvehicle input.agvehicle", () => this.syncIssuedTotal());
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
		this.bindVehicleRow(state, rowContext);
		this.bindJournalRow(state, rowContext);
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
		if (Number(this.formDoc?.docstatus || 0) !== 0 || this.formReadOnly()) {
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

	collectedValue(df, value) {
		if (!frappe.model.numeric_fieldtypes.includes(df?.fieldtype)) return value;
		return value === undefined || value === null || value === "" ? 0 : value;
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
			const resolved = control.df?.read_only && current === undefined && this.formDoc[field.fieldname] !== undefined
				? this.formDoc[field.fieldname]
				: current;
			payload[field.fieldname] = this.collectedValue(control.df || field, resolved);
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
		// A return says so through these two. is_return is on the form and can be
		// unticked, so a 0 that came from the control is left alone; return_against is
		// behind depends_on, never becomes a control, and would be lost without this.
		for (const fieldname of ["is_return", "return_against"]) {
			if (this.formDoc[fieldname] !== undefined && !this.hasValue(payload[fieldname])) {
				payload[fieldname] = this.formDoc[fieldname];
			}
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
					value[name] = this.collectedValue(control.df, current);
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

	// Frappe's own rule for an empty required field: cstr(value) stripped of markup -
	// so 0 and false are values, not blanks (base_document.py:758). Plain !value in JS
	// disagrees on exactly those two, which is what made a zero opening float unsavable.
	// What a field really holds. The control is asked first, but a read-only one answers
	// `this.value || undefined` (base_control.js:266) - so a genuine 0 comes back as
	// undefined and would read as blank. The doc behind the control still has it.
	fieldValue(control, data, fieldname) {
		const live = control ? control.get_value() : undefined;
		if (this.hasValue(live)) return live;
		return data ? data[fieldname] : undefined;
	}

	hasValue(value) {
		return !(value === undefined || value === null || value === "" ||
			(Array.isArray(value) && !value.length));
	}

	validateForm() {
		const missing = [];
		// What the vehicles were issued is the document's own total, and no more can go
		// out than the warehouse holds. validate_stock() in fuel_for_distribution.js does
		// both; recomputing here also covers a row removed after the last edit.
		this.syncJournalTotals();
		const issuedFuel = this.syncIssuedTotal();
		if (this.state.kind === "fuel-for-distribution" && issuedFuel
			&& this.fuelAvailable !== null && issuedFuel > flt(this.fuelAvailable)) {
			frappe.msgprint({
				title: __("Stock Error"), indicator: "red",
				message: `${__("Available Stock")}: <b>${flt(this.fuelAvailable)}</b> Ltr<br>${__("Total Issued")}: <b>${issuedFuel}</b> Ltr`,
			});
			return false;
		}
		for (const { field, control } of this.formControls) {
			if (field.reqd && !this.hasValue(this.fieldValue(control, this.formDoc, field.fieldname))) missing.push(field.label);
		}
		for (const state of this.tableStates.values()) {
			if (state.field.reqd && !state.rows.length) missing.push(state.field.label);
			state.rows.forEach((row, index) => {
				// a row the user never filled is dropped before saving, so it is not validated either
				if (!this.isChildRowFilled(state, row)) return;
				for (const column of state.columns) if (column.reqd && !this.hasValue(this.fieldValue(row.controls[column.fieldname], row.data, column.fieldname))) missing.push(`${state.field.label} row ${index + 1}: ${column.label}`);
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

/* ===== AGRIVENTURE APP-ONLY ENHANCE LOADER (Dux Digitech) =====
   Loads the app-only enhancement (colour + native feel) ONLY inside the
   Capacitor app. The website never loads it. Cache-busted so edits to
   agriventure-app.js/.css always show on the next app open.
   Safe to keep across agriventure.js redeploys — re-append if it goes missing. */
(function () {
  try {
    var isApp = (window.Capacitor && (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : true)) ||
                /AgriventureApp/i.test(navigator.userAgent || "");
    if (!isApp) return;
    var s = document.createElement("script");
    s.src = "/assets/agriventure/js/agriventure-app.js?v=" + Date.now();
    document.head.appendChild(s);
  } catch (e) {}
})();
