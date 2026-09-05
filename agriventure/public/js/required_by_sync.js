// erpnext.utils.copy_value_in_all_rows (used by core's own set_schedule_date) only
// fills a row whose date is still empty - `if (!cl[i][fieldname]) ...` - so once every
// row already carries some default date, changing the header no longer visibly does
// anything. This overwrites every row unconditionally instead, the way Set Warehouse
// already behaves for its own field.
function apply_schedule_date_to_items(frm) {
	if (!frm.doc.schedule_date) return;
	(frm.doc.items || []).forEach((row) => {
		frappe.model.set_value(row.doctype, row.name, "schedule_date", frm.doc.schedule_date);
	});
}

frappe.ui.form.on("Material Request", {
	schedule_date(frm) {
		apply_schedule_date_to_items(frm);
	},
});

frappe.ui.form.on("Purchase Order", {
	schedule_date(frm) {
		apply_schedule_date_to_items(frm);
	},
});
