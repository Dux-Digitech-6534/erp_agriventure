"""Helpers the portal needs that this site's own app does not provide.

Nothing here owns a DocType or changes one. get_today_centres only reads Attendance Log,
which is why it can live in the portal rather than being added to another app.
"""

import frappe
from frappe import _
from frappe.utils import flt, get_datetime, nowdate, nowtime


@frappe.whitelist()
def get_today_centres(doctype, txt, searchfield, start, page_len, filters):
	"""Link query: only centres that actually have attendance on the chosen date.

	A Link field is searched server side, so this cannot be filtered in the browser.
	"""
	if isinstance(filters, str):
		filters = frappe.parse_json(filters)

	date = (filters or {}).get("date")
	if not date:
		return []

	return frappe.db.sql(
		"""
		SELECT DISTINCT al.centre__location_al
		FROM `tabAttendance Log` al
		WHERE al.date_al = %(date)s
			AND IFNULL(al.centre__location_al, '') != ''
			AND al.centre__location_al LIKE %(txt)s
		ORDER BY al.centre__location_al
		LIMIT %(limit)s OFFSET %(offset)s
		""",
		{"date": date, "txt": f"%{txt or ''}%", "limit": page_len, "offset": start},
	)


@frappe.whitelist()
def modes_for_company(doctype, txt, searchfield, start, page_len, filters):
	"""Link query: Modes of Payment that carry an account for this company.

	A POS Profile and a POS Opening Entry are both refused on save when a chosen mode has
	no Mode of Payment Account row for their company - pos_profile.py's
	validate_payment_methods and pos_opening_entry.py's validate_payment_method_account
	each look up exactly that row. On this site four of the eleven modes have no row at
	all (Bank, Bank Draft, CHEQUE, Wire Transfer), so they could be picked and would then
	always fail. Offering only what can succeed turns that error into something that
	cannot happen.

	The join is why this has to run on the server: a Link field is searched there, and the
	account lives on a child table of the mode rather than on the mode itself.
	"""
	if isinstance(filters, str):
		filters = frappe.parse_json(filters)

	company = (filters or {}).get("company")
	if not company:
		# with no company chosen yet there is nothing to check against, so nothing is
		# hidden - the save-time message still explains anything that does not fit
		return frappe.db.sql(
			"""
			SELECT name FROM `tabMode of Payment`
			WHERE enabled = 1 AND name LIKE %(txt)s
			ORDER BY name LIMIT %(limit)s OFFSET %(offset)s
			""",
			{"txt": f"%{txt or ''}%", "limit": page_len, "offset": start},
		)

	return frappe.db.sql(
		"""
		SELECT mp.name
		FROM `tabMode of Payment` mp
		INNER JOIN `tabMode of Payment Account` mpa
			ON mpa.parent = mp.name
			AND mpa.company = %(company)s
			AND IFNULL(mpa.default_account, '') != ''
		WHERE mp.enabled = 1 AND mp.name LIKE %(txt)s
		ORDER BY mp.name
		LIMIT %(limit)s OFFSET %(offset)s
		""",
		{"company": company, "txt": f"%{txt or ''}%", "limit": page_len, "offset": start},
	)


@frappe.whitelist()
def pos_profiles_for_company(doctype, txt, searchfield, start, page_len, filters):
	"""Link query: POS Profiles, with the whole list for whoever administers the site.

	ERPNext's own pos_profile_query narrows to the profiles a user is named on and only
	falls back to the unrestricted ones when that finds nothing (pos_profile.py:294). That
	is the right rule for a cashier - their own till and nobody else's - but it also caught
	the administrator, who is named on one profile and so could reach only that one.

	So the rule is kept for everyone except a System Manager, who gets every enabled
	profile for the company. Nothing about the profiles themselves changes; a cashier still
	sees exactly what they saw before.
	"""
	if isinstance(filters, str):
		filters = frappe.parse_json(filters)
	filters = filters or {}
	company = filters.get("company") or frappe.defaults.get_user_default("company")

	if "System Manager" not in frappe.get_roles():
		from erpnext.accounts.doctype.pos_profile.pos_profile import pos_profile_query

		return pos_profile_query(doctype, txt, searchfield, start, page_len, filters)

	return frappe.db.sql(
		"""
		SELECT name FROM `tabPOS Profile`
		WHERE disabled = 0 AND company = %(company)s AND name LIKE %(txt)s
		ORDER BY name LIMIT %(limit)s OFFSET %(offset)s
		""",
		{"company": company, "txt": f"%{txt or ''}%", "limit": page_len, "offset": start},
	)

# ---------------------------------------------------------------------------
# Face-first attendance
#
# The desk form asks who you are and then checks the one face. This asks the face who you
# are: one scan, and the person and the centre both fall out of it. Nothing here replaces
# that form - it stays exactly as it is, and is still the way anyone without a photo on
# file gets marked.
#
# The engine is the one this site already runs. attendance_log.verify_face has been
# matching against Labour Information.person_image for 6,982 logs at tolerance 0.45; the
# same library, the same reference photo and the same threshold are used here. Only two
# things are added, and both are what 1-to-many needs that 1-to-1 did not:
#
#   * the reference photos are encoded once and cached, instead of being read off disk
#     and run through dlib on every single scan - that per-scan work is the slow part
#   * a margin rule, because "nearest wins" is not an answer when thirty faces are in
#     the running: the best match has to be clearly better than the second best, or the
#     scan is handed back for a person to decide
# ---------------------------------------------------------------------------

# the figure attendance_log.verify_face already uses; identification is no place to loosen it
FACE_TOLERANCE = 0.45
# A second scan closes the day, but not one taken moments after the first - a double
# tap at the camera would otherwise end somebody's day with nothing worked.
FACE_LOGOUT_GAP_MIN = 2

# how much clearer than the runner-up the winner has to be. Below this the two faces are
# too close to call and the caller is given both rather than a guess.
FACE_MARGIN = 0.08
# a scan taken further than this from every centre cannot say which centre it belongs to
CENTRE_RADIUS_M = 500
FACE_CACHE = "agriventure:face-encodings"


def _face_engine():
	try:
		import face_recognition
		return face_recognition
	except Exception:
		return None


def _face_setting(key, fallback):
	try:
		return float(frappe.conf.get(key, fallback))
	except Exception:
		return fallback


def _reference_path(person_image):
	"""Where the labour's photo actually sits. Their own helper, called rather than copied."""
	from agriventure_nagpur_erp.agriventure_nagpur_erp.doctype.attendance_log.attendance_log import (
		get_person_image_path,
	)

	return get_person_image_path(person_image)


def _centre_labour(centre):
	"""Labour posted to this centre who have a photo to match against."""
	return frappe.db.sql(
		"""
		SELECT l.name, l.name_of_person, l.person_image, l.modified
		FROM `tabLabour Information` l
		INNER JOIN `tabMultiple Centre and Location` c
			ON c.parent = l.name AND c.parenttype = 'Labour Information'
		WHERE c.name_of_centre_and_location = %(centre)s
			AND IFNULL(l.person_image, '') != ''
		ORDER BY l.name
		""",
		{"centre": centre},
		as_dict=True,
	)


def _centre_encodings(centre):
	"""The centre's reference faces as numbers, encoded once and kept.

	Keyed on how many labour the centre has and when one of them last changed, so a new
	photo or a new person rebuilds it by itself and nobody has to remember to clear it.
	"""
	import json

	rows = _centre_labour(centre)
	if not rows:
		return []

	fingerprint = "%d:%s" % (len(rows), max(str(row.modified) for row in rows))
	cached = frappe.cache().hget(FACE_CACHE, centre)
	if cached and cached.get("fingerprint") == fingerprint:
		return cached.get("faces") or []

	engine = _face_engine()
	if not engine:
		frappe.throw(_("Face recognition is not installed on this server."))

	faces = []
	for row in rows:
		try:
			image = engine.load_image_file(_reference_path(row.person_image))
			encodings = engine.face_encodings(image)
		except Exception:
			# a missing or unreadable file is that one person's problem, not the whole
			# centre's - face_attendance_readiness() lists them
			continue
		if not encodings:
			continue
		faces.append({
			"labour": row.name,
			"labour_name": row.name_of_person or row.name,
			"encoding": [float(value) for value in encodings[0]],
		})

	frappe.cache().hset(FACE_CACHE, centre, {"fingerprint": fingerprint, "faces": faces})
	return faces


def _all_encodings():
	"""Every labour with a usable photo, encoded once and kept.

	Keyed the same way a centre's list is - count and last change - so a new photo or a
	new person rebuilds it by itself.
	"""
	rows = frappe.db.sql(
		"""
		SELECT name, name_of_person, person_image, modified
		FROM `tabLabour Information`
		WHERE IFNULL(person_image, '') != ''
		ORDER BY name
		""",
		as_dict=True,
	)
	if not rows:
		return []

	fingerprint = "%d:%s" % (len(rows), max(str(row.modified) for row in rows))
	cached = frappe.cache().hget(FACE_CACHE, "__all__")
	if cached and cached.get("fingerprint") == fingerprint:
		return cached.get("faces") or []

	engine = _face_engine()
	if not engine:
		return []

	faces = []
	for row in rows:
		try:
			image = engine.load_image_file(_reference_path(row.person_image))
			encodings = engine.face_encodings(image)
		except Exception:
			continue
		if not encodings:
			continue
		faces.append({
			"labour": row.name,
			"labour_name": row.name_of_person or row.name,
			"encoding": [float(value) for value in encodings[0]],
		})

	frappe.cache().hset(FACE_CACHE, "__all__", {"fingerprint": fingerprint, "faces": faces})
	return faces


def _labour_centres(labour):
	return frappe.get_all(
		"Multiple Centre and Location",
		filters={"parent": labour, "parenttype": "Labour Information"},
		pluck="name_of_centre_and_location",
	)


def _resolve_labour_centre(labour, latitude, longitude, hint=None, chosen=None):
	"""Where this person is, once the face has said who they are.

	Their own record is asked first, and it answers outright for anyone posted to a single
	centre. Most people here are posted to four, so the record alone cannot say - and then
	the question is only ever between those four, never all eight:

	  * the centre the camera is already set to, if they are posted to it - a supervisor
	    standing at one farm sets that once and never answers again
	  * failing that, whichever of their own centres the device is actually near
	  * and only if neither settles it, their centres are handed back to be tapped
	"""
	theirs = _labour_centres(labour)
	if chosen:
		# somebody at the camera said so, and that outranks any guess
		return chosen, theirs
	if not theirs:
		# Nothing posted against them, and a guess is not an answer: the nearest
		# centre would be recorded as where they work, which nobody has said.
		return None, []
	if len(theirs) == 1:
		return theirs[0], theirs
	if hint and hint in theirs:
		return hint, theirs

	if latitude not in (None, "") and longitude not in (None, ""):
		import math

		try:
			lat, lng = float(latitude), float(longitude)
		except Exception:
			lat = lng = None
		if lat is not None and (lat or lng):
			limit = _face_setting("agriventure_centre_radius_m", CENTRE_RADIUS_M)
			best, best_m = None, None
			for name in theirs:
				point = frappe.db.get_value(
					"Centre and Location Details", name, ["latitude", "longitude"], as_dict=True
				)
				if not point or not point.latitude or not point.longitude:
					continue
				dlat = math.radians(float(point.latitude) - lat)
				dlng = math.radians(float(point.longitude) - lng)
				a = (math.sin(dlat / 2) ** 2
					+ math.cos(math.radians(lat)) * math.cos(math.radians(float(point.latitude)))
					* math.sin(dlng / 2) ** 2)
				meters = 2 * 6371000 * math.asin(math.sqrt(a))
				if best_m is None or meters < best_m:
					best, best_m = name, meters
			if best and best_m is not None and best_m <= limit:
				return best, theirs

	return None, theirs


def _nearest_centre(latitude, longitude):
	import math

	if latitude in (None, "") or longitude in (None, ""):
		return None, None
	try:
		lat, lng = float(latitude), float(longitude)
	except Exception:
		return None, None

	nearest, best = None, None
	for centre in frappe.get_all(
		"Centre and Location Details",
		fields=["name", "latitude", "longitude"],
	):
		if not centre.latitude or not centre.longitude:
			continue
		radius = 6371000
		dlat = math.radians(float(centre.latitude) - lat)
		dlng = math.radians(float(centre.longitude) - lng)
		a = (math.sin(dlat / 2) ** 2
			+ math.cos(math.radians(lat)) * math.cos(math.radians(float(centre.latitude)))
			* math.sin(dlng / 2) ** 2)
		meters = 2 * radius * math.asin(math.sqrt(a))
		if best is None or meters < best:
			nearest, best = centre.name, meters
	return nearest, best


def _face_log(stage, **context):
	"""Everything the centre decision was made from, in one line in the log.

	Without it a wrong centre is invisible: the screen names one, and there is no
	way to see whether the device gave a reading at all.
	"""
	import json

	context["stage"] = stage
	context["user"] = frappe.session.user
	frappe.logger("agriventure.face", allow_site=True).info(
		json.dumps(context, default=str, sort_keys=True))


def _face_fail(code, message, **extra):
	payload = {"ok": False, "code": code, "message": message}
	payload.update(extra)
	return payload


@frappe.whitelist()
def face_mark_attendance(captured_image=None, latitude=None, longitude=None, centre=None,
		labour=None, chosen_centre=None):
	"""One scan in, one attendance out: who it is and where, without either being typed.

	Everything this writes, the desk form writes too - the same doctype, the same fields.
	It is only the two questions in front of it that this answers by itself.
	"""
	import base64
	import json
	import os
	import tempfile

	if not captured_image or "," not in captured_image:
		return _face_fail("invalid_image", _("No image captured."))

	engine = _face_engine()
	if not engine:
		return _face_fail("engine_missing", _("Face recognition is not installed on this server."))

	# the face is asked first; where they are is settled afterwards, from the person
	# the face turned out to be. The centre that arrives here is only a hint.
	distance_m = None
	_face_log("scan", centre_hint=centre, latitude=latitude, longitude=longitude)

	faces = _all_encodings()
	if not faces:
		return _face_fail("no_reference", _("No labour has a usable photo yet."))

	# the live frame - the only encoding worked out per scan
	temp = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
	try:
		temp.write(base64.b64decode(captured_image.split(",")[1]))
		temp.close()
		frame = engine.load_image_file(temp.name)
		# upsample 0: see the note above - the face is found without doubling
		# the frame first, which is over half the time of a scan
		boxes = engine.face_locations(frame, number_of_times_to_upsample=0)
		live = engine.face_encodings(frame, known_face_locations=boxes) if boxes else []
	except Exception:
		# a frame the camera cut short, or anything that is not really a JPEG. The
		# person is standing right there - they get an instruction, not a traceback.
		frappe.log_error(frappe.get_traceback(), "Face attendance: unreadable frame")
		return _face_fail("invalid_image", _("That frame could not be read. Scan again."))
	finally:
		try:
			os.unlink(temp.name)
		except Exception:
			pass

	if not live:
		return _face_fail("no_face_detected", _("No face detected. Keep the full face inside the frame."))
	if len(live) > 1:
		return _face_fail("multiple_faces", _("More than one face in the frame. One person at a time."))

	import numpy as np

	known = np.array([face["encoding"] for face in faces], dtype="float64")
	distances = engine.face_distance(known, np.array(live[0], dtype="float64"))
	order = list(np.argsort(distances))
	best = int(order[0])
	best_distance = float(distances[best])
	runner_up = float(distances[int(order[1])]) if len(order) > 1 else None

	tolerance = _face_setting("agriventure_face_tolerance", FACE_TOLERANCE)
	margin = _face_setting("agriventure_face_margin", FACE_MARGIN)

	if best_distance > tolerance:
		return _face_fail(
			"not_matched",
			_("Face did not match anyone on file. Face the camera and scan again."),
			centre=centre, distance=round(best_distance, 4), threshold=tolerance,
		)

	# A tie the scan could not settle, settled by whoever is running the camera. The
	# name still has to be one the scan itself put forward and still within tolerance.
	if labour:
		# the same shortlist the scan offered: matches only, best first
		shortlist = {faces[int(i)]["labour"]: int(i) for i in order
			if float(distances[int(i)]) <= tolerance}
		if labour not in shortlist:
			return _face_fail("not_matched", _("That person is not one the scan found."), centre=centre)
		chosen = shortlist[labour]
		if float(distances[chosen]) > tolerance:
			return _face_fail("not_matched", _("Face did not match that person."), centre=centre)
		best, best_distance = chosen, float(distances[chosen])
	# Only faces that are themselves matches can be confused with the winner. A
	# runner-up outside the tolerance is not a candidate at all, and measuring the
	# margin against it turned clean recognitions into a list of names to pick from.
	else:
		contenders = [int(i) for i in order if float(distances[int(i)]) <= tolerance]
		if len(contenders) > 1 and (float(distances[contenders[1]]) - best_distance) < margin:
			return _face_fail(
				"not_confident",
				_("Two faces are too close to tell apart. Choose the right one."),
				centre=centre,
				candidates=[
					{"labour": faces[i]["labour"], "labour_name": faces[i]["labour_name"],
						"distance": round(float(distances[i]), 4)}
					for i in contenders[:3]
				],
			)

	match = faces[best]

	today = nowdate()
	# Read-then-write is two steps, and two requests can land between them. This
	# claim makes it one: the second scan of the same person cannot take it, and
	# says so instead of writing a second log for the day.
	claim = "agriventure:face-claim:%s:%s" % (match["labour"], today)
	if not frappe.cache().setnx(claim, 1):
		return _face_fail(
			"in_progress",
			_("{0}'s last scan is still going through. Scan again in a moment.")
				.format(match["labour_name"]),
		)
	# a safety net only - every path below releases it deliberately
	frappe.cache().expire(claim, 20)

	# Already in today? Then this scan is the way out, and the centre question does
	# not arise - the log being closed already carries one.
	existing = frappe.db.get_value(
		"Attendance Log",
		{"name_of_person_al": match["labour"], "date_al": today},
		["name", "log_in_al", "log_out_al", "centre__location_al"],
		as_dict=True,
	)
	if existing and existing.log_out_al:
		frappe.cache().delete(claim)
		return _face_fail(
			"already_done",
			_("{0} is already in and out for today.").format(match["labour_name"]),
			centre=existing.centre__location_al, labour=match["labour"],
			labour_name=match["labour_name"], attendance_log=existing.name,
		)
	if existing:
		minutes_in = (get_datetime("%s %s" % (today, nowtime()))
			- get_datetime("%s %s" % (today, existing.log_in_al))).total_seconds() / 60
		gap = _face_setting("agriventure_face_logout_gap_min", FACE_LOGOUT_GAP_MIN)
		if minutes_in < gap:
			frappe.cache().delete(claim)
			return _face_fail(
				"too_soon",
				_("{0} was marked in a moment ago. Scan again after {1} minutes to mark out.")
					.format(match["labour_name"], int(gap)),
				centre=existing.centre__location_al, labour_name=match["labour_name"],
			)

		from agriventure_nagpur_erp.agriventure_nagpur_erp.doctype.attendance_log.attendance_log import (
			mark_logout,
		)

		outcome = mark_logout(existing.name, captured_image, latitude, longitude)
		if (outcome or {}).get("status") != "success":
			frappe.cache().delete(claim)
			return _face_fail(
				"logout_failed",
				(outcome or {}).get("message") or _("Could not mark out."),
				centre=existing.centre__location_al, labour_name=match["labour_name"],
			)
		frappe.cache().delete(claim)
		closed = frappe.get_doc("Attendance Log", existing.name)
		return {
			"ok": True,
			"action": "logout",
			"labour": match["labour"],
			"labour_name": match["labour_name"],
			"centre": closed.centre__location_al,
			"attendance_log": closed.name,
			"log_in": str(closed.log_in_al or ""),
			"log_out": str(closed.log_out_al or ""),
			"working_hours": closed.working_hours_al,
			"leave": closed.leave,
			"distance": round(best_distance, 4),
		}

	# their own record decides the centre now - the camera never has to be told
	resolved, theirs = _resolve_labour_centre(
		match["labour"], latitude, longitude, hint=centre, chosen=chosen_centre)
	if not resolved:
		if theirs:
			frappe.cache().delete(claim)
			return _face_fail(
				"centre_choice",
				_("{0} is posted to more than one centre. Tap the one you are at.").format(match["labour_name"]),
				labour=match["labour"], labour_name=match["labour_name"], centres=theirs,
			)
		# no centre on the record and none from the device: every centre is offered,
		# so the day's attendance is not held up by a master nobody has filled in yet
		frappe.cache().delete(claim)
		return _face_fail(
			"no_centre",
			_("{0} has no centre on their record. Tap the one you are at, and add it to their master.").format(match["labour_name"]),
			labour=match["labour"], labour_name=match["labour_name"],
			centres=frappe.get_all("Centre and Location Details", pluck="name", order_by="name"),
		)
	centre = resolved

	log = frappe.new_doc("Attendance Log")
	log.date_al = today
	log.centre__location_al = centre
	log.name_of_person_al = match["labour"]
	log.log_in_al = nowtime()
	if latitude not in (None, "") and longitude not in (None, ""):
		log.latitude = flt(latitude)
		log.longitude = flt(longitude)
		# Frappe keeps a Geolocation field as GeoJSON, which is [lng, lat]
		log.geolocation = json.dumps({"type": "Point", "coordinates": [flt(longitude), flt(latitude)]})
	log.insert()
	frappe.cache().delete(claim)

	return {
		"ok": True,
		"action": "login",
		"labour": match["labour"],
		"labour_name": match["labour_name"],
		"centre": centre,
		"attendance_log": log.name,
		"log_in": str(log.log_in_al),
		"distance": round(best_distance, 4),
		"runner_up": round(runner_up, 4) if runner_up is not None else None,
		"centre_distance_meter": round(distance_m, 1) if distance_m is not None else None,
	}


@frappe.whitelist()
def face_attendance_prepare(latitude=None, longitude=None, centre=None):
	"""Have every reference face encoded before the queue starts moving.

	The first scan would otherwise pay for encoding every photo on the site - seconds,
	with somebody standing in front of the camera. Asking for it while the camera is still
	warming up moves that wait to where nobody is waiting.

	A centre is only ever a suggestion here, and the camera is ready with or without one.
	Who the face is does not depend on it, and where they are is settled afterwards from
	their own record.
	"""
	if not _face_engine():
		return _face_fail("engine_missing", _("Face recognition is not installed on this server."))

	faces = _all_encodings()
	nearest, distance_m = None, None
	if not centre:
		nearest, distance_m = _nearest_centre(latitude, longitude)
		limit = _face_setting("agriventure_centre_radius_m", CENTRE_RADIUS_M)
		# near enough to be believed; anything else is left as a suggestion only, and a
		# device that could not fix a position reports 0,0 and lands thousands of km out
		if nearest and distance_m is not None and distance_m <= limit:
			centre = nearest

	_face_log("prepare", latitude=latitude, longitude=longitude,
		nearest=nearest, distance_m=distance_m, centre=centre, ready=len(faces))

	usable = {face["labour"] for face in faces}
	with_photo = frappe.db.sql(
		"""SELECT name FROM `tabLabour Information` WHERE IFNULL(person_image, '') != ''""",
		pluck=True,
	)
	return {
		"ok": bool(faces),
		"message": None if faces else _("No labour has a usable photo yet."),
		"centre": centre,
		"nearest": nearest,
		"centre_distance_meter": round(distance_m, 1) if distance_m is not None else None,
		"ready_count": len(faces),
		"photo_count": len(with_photo),
		# a photo that will not encode is a person this camera cannot mark - worth saying
		# now rather than when they are standing in front of it
		"unusable": [name for name in with_photo if name not in usable],
		# handed back so the screen can show what the device actually reported: a blank
		# or a zero here is the whole answer when a centre looks wrong
		"latitude": latitude,
		"longitude": longitude,
		"centres": frappe.get_all("Centre and Location Details", pluck="name", order_by="name"),
	}


@frappe.whitelist()
def face_attendance_readiness():
	"""Who can be marked by face today, and who still cannot - and why.

	A photo on file is not the same as a usable reference: it has to have one clear,
	forward-facing face in it. This runs every photo through the encoder once and says
	which ones came back empty, so the list of people to re-photograph is a fact rather
	than a guess.
	"""
	engine = _face_engine()
	centres = frappe.get_all("Centre and Location Details", fields=["name", "latitude", "longitude"])
	no_photo = frappe.db.sql(
		"""
		SELECT name, name_of_person FROM `tabLabour Information`
		WHERE IFNULL(person_image, '') = '' ORDER BY name_of_person
		""",
		as_dict=True,
	)

	ready, unusable = [], []
	for centre in centres:
		if not engine:
			break
		usable = {face["labour"] for face in _centre_encodings(centre.name)}
		for row in _centre_labour(centre.name):
			(ready if row.name in usable else unusable).append({
				"labour": row.name, "labour_name": row.name_of_person, "centre": centre.name,
			})

	return {
		"engine": bool(engine),
		"centres_without_coordinates": [c.name for c in centres if not c.latitude or not c.longitude],
		"ready": sorted({row["labour"] for row in ready}),
		"photo_unusable": unusable,
		"no_photo": no_photo,
		"tolerance": _face_setting("agriventure_face_tolerance", FACE_TOLERANCE),
		"margin": _face_setting("agriventure_face_margin", FACE_MARGIN),
	}
