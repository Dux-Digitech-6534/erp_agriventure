/* ============================================================
   Agriventure — APP-ONLY enhancement (native app feel)
   Loaded from agriventure.js ONLY inside the Capacitor app.
   Everything here is gated behind isInApp(); the website never runs it.
   OTA: served at /assets/agriventure/js/agriventure-app.js — edit + clear-cache.
   Native bits (status bar, hardware back, haptics) light up once the
   v1.0.3+ APK (with @capacitor/app, /haptics, /status-bar) is installed.
   ============================================================ */
(function () {
  "use strict";
  if (window.__agriAppEnhanced) return;

  var CAP = window.Capacitor;
  var isApp = (CAP && (CAP.isNativePlatform ? CAP.isNativePlatform() : true)) ||
              /AgriventureApp/i.test(navigator.userAgent || "");
  if (!isApp) return;                       // <-- website & mobile-web untouched
  window.__agriAppEnhanced = true;

  var P = (CAP && CAP.Plugins) || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };

  document.documentElement.classList.add("agri-app");
  document.body && document.body.classList.add("agri-app");

  /* pull in the app-only stylesheet (cache-busted so edits always show) */
  try {
    if (!document.getElementById("agriventure-app-css")) {
      var l = document.createElement("link");
      l.id = "agriventure-app-css"; l.rel = "stylesheet";
      l.href = "/assets/agriventure/css/agriventure-app.css?v=" + Date.now();
      document.head.appendChild(l);
    }
  } catch (e) {}

  /* lock zoom / give it an app viewport ------------------------------- */
  try {
    var vp = document.querySelector('meta[name="viewport"]');
    if (!vp) { vp = document.createElement("meta"); vp.name = "viewport"; document.head.appendChild(vp); }
    vp.setAttribute("content",
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
  } catch (e) {}

  /* native status bar: keep the WebView BELOW the status bar --------- */
  try {
    if (P.StatusBar) {
      P.StatusBar.setOverlaysWebView({ overlays: false });
      P.StatusBar.setStyle({ style: "LIGHT" });               // white icons
      P.StatusBar.setBackgroundColor({ color: "#2E8B46" });   // brand green
    }
  } catch (e) {}

  var haptic = function (style) {
    try { if (P.Haptics) P.Haptics.impact({ style: style || "Light" }); } catch (e) {}
  };

  /* ---- icons ---- */
  var IC = {
    home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M2.5 20c0-3.3 2.9-5.5 6.5-5.5S15.5 16.7 15.5 20"/><path d="M16 5.2a3 3 0 0 1 0 5.6M21.5 20c0-2.4-1.3-4.2-3.4-5"/>',
    cart:'<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.3 12.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L22 7H6"/>',
    chart:'<path d="M4 20V4M4 20h16"/><rect x="7" y="12" width="3" height="5"/><rect x="12" y="8" width="3" height="9"/><rect x="17" y="5" width="3" height="12"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'
  };
  var svg = function (p) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  };

  /* proxy a click onto one of the portal's existing controls ---------- */
  function click(sel) { var el = $(sel); if (el) { el.click(); return true; } return false; }
  function openHome() { click(".ag-dashboard-nav") || click('[data-view="dashboard"]'); }
  function openAttendance() { click('.ag-nav[data-kind="attendance-log"]'); }
  function openPOS() { click('[data-action="open-pos-new"]') || click('[data-action="open-pos"]'); }
  function openReports() { click('[data-action="open-kpi"]'); }
  function openMenu() { click('[data-action="open-menu"]') || click(".ag-mobile-menu"); }
  function closeMenu() { click('[data-action="close-menu"]') || click(".ag-mobile-backdrop"); }

  /* ---- bottom tab bar ---- */
  var TABS = [
    { key:"home",  label:"Home",       ic:IC.home,  go:openHome },
    { key:"att",   label:"Attendance", ic:IC.users, go:openAttendance },
    { key:"pos",   label:"Sell",       ic:IC.cart,  go:openPOS, primary:true },
    { key:"rep",   label:"Reports",    ic:IC.chart, go:openReports },
    { key:"more",  label:"Menu",       ic:IC.grid,  go:openMenu }
  ];
  var bar, drawerOpen = false;

  function buildBar() {
    if ($(".agapp-tabbar")) return;
    bar = document.createElement("nav");
    bar.className = "agapp-tabbar";
    bar.innerHTML = TABS.map(function (t) {
      var inner = t.primary
        ? '<span class="agapp-ic">' + svg(t.ic) + '</span><span>' + t.label + '</span>'
        : svg(t.ic) + '<span>' + t.label + '</span>';
      return '<button class="agapp-tab' + (t.primary ? ' agapp-primary' : '') +
             '" data-tab="' + t.key + '" type="button">' + inner + '</button>';
    }).join("");
    // append INSIDE .agriventure-app so it inherits --ag-* vars and the .ag-dark theme
    (document.querySelector(".agriventure-app") || document.body).appendChild(bar);
    bar.addEventListener("click", function (e) {
      var b = e.target.closest(".agapp-tab"); if (!b) return;
      var t = TABS.filter(function (x) { return x.key === b.dataset.tab; })[0];
      if (!t) return;
      haptic("Light");
      if (drawerOpen && t.key !== "more") closeMenu();
      t.go();
      setActive(t.key);
    });
    setActive("home");
  }
  function setActive(key) {
    if (!bar) return;
    [].forEach.call(bar.querySelectorAll(".agapp-tab"), function (b) {
      b.classList.toggle("on", b.dataset.tab === key);
    });
  }
  /* keep the active tab in sync with whatever screen the portal shows */
  function tabForCrumb(text) {
    text = (text || "").toLowerCase();
    if (/dashboard/.test(text) && !/attendance|production|sales/.test(text)) return "home";
    if (/attendance|shift/.test(text)) return "att";
    if (/point of sale|pos|checkout|sell/.test(text)) return "pos";
    if (/report|production|sales|dashboard/.test(text)) return "rep";
    return null;
  }

  /* ---- track drawer open/close + sync tab, via click delegation ---- */
  function setDrawer(open) {
    drawerOpen = open;
    try { document.body.classList.toggle("agri-drawer-open", open); } catch (e) {}
  }
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.closest('[data-action="open-menu"], .ag-mobile-menu')) setDrawer(true);
    else if (t.closest('[data-action="close-menu"], .ag-mobile-backdrop, .ag-nav[data-kind], [data-view], [data-action="open-kpi"], [data-action="open-pos-new"]')) setDrawer(false);
  }, true);

  /* ---- hardware back = ONE predictable step (needs @capacitor/app) -- */
  try {
    if (P.App && P.App.addListener) {
      P.App.addListener("backButton", function () {
        if (closeFSheet()) { haptic("Light"); return; }       // close the POS/grid edit sheet
        if (closeItemSheet()) { haptic("Light"); return; }    // close the item edit sheet
        if (closeDocOverlay()) { haptic("Light"); return; }   // close an open Print/PDF view
        if (drawerOpen) { closeMenu(); setDrawer(false); return; }
        // a document detail/form view has its own "Back to List" → single step back
        var back = document.querySelector(".ag-back");
        if (back && back.offsetParent !== null) { haptic("Light"); back.click(); return; }
        var crumb = $(".ag-crumb-title");
        var onHome = crumb && /dashboard/i.test(crumb.textContent || "") && !/attendance|production|sales/i.test(crumb.textContent || "");
        // any other report/list view: send them home in a single press
        if (!onHome) { haptic("Light"); openHome(); return; }
        try { P.App.exitApp(); } catch (e) {}
      });
    }
  } catch (e) {}

  /* ---- offline banner ---- */
  var offEl;
  function offline(show) {
    if (!offEl) {
      offEl = document.createElement("div");
      offEl.className = "agapp-offline";
      offEl.textContent = "You're offline — reconnect to keep working.";
      (document.querySelector(".agriventure-app") || document.body).appendChild(offEl);
    }
    offEl.classList.toggle("show", show);
  }
  window.addEventListener("offline", function () { offline(true); });
  window.addEventListener("online", function () { offline(false); });

  /* ---- refresh: pull latest from the server. Uses the native hard reload
          (clears the WebView cache + reloads) so ANY backend change — data OR
          portal code/UI — shows up on refresh, never a stale cached copy.
          Falls back to the portal's in-place data refresh on older shells. ---- */
  var refreshing = false;
  function doRefresh() {
    if (refreshing) return; refreshing = true;
    try {
      if (window.AndroidDownloader && window.AndroidDownloader.hardReload) {
        window.AndroidDownloader.hardReload(); return;   // page reloads → state resets
      }
    } catch (e) {}
    // fallback (web / old shell): in-place data refresh, then a soft reload for code
    if (!click('[data-action="refresh"]')) { try { location.reload(); } catch (e2) {} }
    setTimeout(function () { refreshing = false; }, 1500);
  }

  /* pull-to-refresh: swipe down from the top of any screen. Document-level so it
     works whether the body or .ag-main is the scroller; disabled inside sheets. */
  function wirePTR() {
    if (window.__agriPTR) return; window.__agriPTR = true;
    var host = document.querySelector(".agriventure-app") || document.body;
    var ptr = document.createElement("div");
    ptr.className = "agapp-ptr"; ptr.innerHTML = '<div class="agapp-ptr-spin"></div>';
    host.appendChild(ptr);
    var startY = 0, pulling = false, dist = 0, TH = 70;
    function blocked() {
      var c = document.body.classList;
      return c.contains("agri-sheet-open") || c.contains("agri-fsheet-open") ||
             c.contains("agri-doc-open") || c.contains("agri-pos-open");
    }
    function scrollTop() {
      var se = document.scrollingElement, m = document.querySelector(".ag-main");
      return Math.max(se ? se.scrollTop : 0, window.pageYOffset || 0, m ? m.scrollTop : 0);
    }
    document.addEventListener("touchstart", function (e) {
      if (blocked() || e.touches.length !== 1 || scrollTop() > 0) { pulling = false; return; }
      startY = e.touches[0].clientY; pulling = true; dist = 0;
    }, { passive: true });
    document.addEventListener("touchmove", function (e) {
      if (!pulling) return;
      dist = e.touches[0].clientY - startY;
      if (dist > 0) {
        ptr.style.opacity = Math.min(dist / TH, 1);
        ptr.style.transform = "translateY(" + Math.min(dist * 0.5, 66) + "px)";
        ptr.classList.toggle("ready", dist > TH);
      }
    }, { passive: true });
    document.addEventListener("touchend", function () {
      if (pulling && dist > TH) {
        ptr.classList.add("spin"); ptr.classList.remove("ready"); haptic("Medium");
        doRefresh();
        setTimeout(function () { ptr.classList.remove("spin"); ptr.style.transform = ""; ptr.style.opacity = 0; }, 1200);
      } else { ptr.style.transform = ""; ptr.style.opacity = 0; }
      pulling = false; dist = 0;
    }, { passive: true });
  }

  /* ---- haptic on the portal's own submit/primary buttons ---- */
  document.addEventListener("click", function (e) {
    if (e.target.closest(".ag-form-actions .ag-button, .ag-button-primary, .ag-fab")) haptic("Medium");
  }, true);

  /* ---- in-app document viewer: keep Print/PDF INSIDE the app with a
          Back + "Print / Save PDF" bar, so hardware/UI back always works ---- */
  var docOverlay = null;
  function closeDocOverlay() {
    if (docOverlay) {
      try { docOverlay.remove(); } catch (e) {}
      docOverlay = null;
      try { document.body.classList.remove("agri-doc-open"); } catch (e) {}
      return true;
    }
    return false;
  }
  function openDocOverlay(title) {
    closeDocOverlay();
    docOverlay = document.createElement("div");
    docOverlay.className = "agapp-docview";
    docOverlay.innerHTML =
      '<div class="agapp-docbar">' +
        '<button class="agapp-docback" type="button">‹ Back</button>' +
        '<span class="agapp-doctitle"></span>' +
        '<button class="agapp-docprint" type="button">Print / PDF</button>' +
      '</div><iframe class="agapp-docframe" title="Document"></iframe>';
    (document.querySelector(".agriventure-app") || document.body).appendChild(docOverlay);
    try { document.body.classList.add("agri-doc-open"); } catch (e) {}
    docOverlay.querySelector(".agapp-doctitle").textContent = title || "Document";
    var frame = docOverlay.querySelector(".agapp-docframe");
    docOverlay.querySelector(".agapp-docback").addEventListener("click", function () { haptic("Light"); closeDocOverlay(); });
    docOverlay.querySelector(".agapp-docprint").addEventListener("click", function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) {}
    });
    return frame;
  }
  // Route the portal's print popup + printview/pdf links into the overlay.
  var _open = window.open;
  window.open = function (url, name) {
    try {
      if (!url || url === "" || url === "about:blank") {   // printHtml's window.open("","_blank")
        var f = openDocOverlay(document.querySelector(".ag-crumb-title") ? document.querySelector(".ag-crumb-title").textContent : "Document");
        try { f.contentWindow.print = function () {}; } catch (e) {}   // stop the auto-print; user taps Print/PDF
        return f.contentWindow;
      }
      // report Excel/PDF exports (server file URLs) → native downloader with the session cookie
      if (window.AndroidDownloader && window.AndroidDownloader.downloadUrl && /(_xlsx|_pdf|_csv|\.xlsx|\.csv)(\?|$)/i.test(String(url))) {
        window.AndroidDownloader.downloadUrl(String(url), ""); return null;
      }
      if (/printview|print_format|\.pdf/i.test(String(url))) {   // print/pdf only → overlay
        var f2 = openDocOverlay("Document"); f2.src = url; return f2.contentWindow;
      }
      // any other real URL (e.g. the update link) → let the native handler open it
    } catch (e) {}
    return _open ? _open.apply(window, arguments) : null;
  };
  // printview links (render HTML) → overlay. Leave blob/pdf downloads alone.
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (/printview|print_format/i.test(href)) {
      e.preventDefault();
      var f = openDocOverlay("Document"); f.src = href;
    }
  }, true);

  // native PDF save (v1.0.4+ shell): the portal's "PDF" button makes a blob
  // <a download>; read it as base64 and hand it to the native saver so it
  // lands in the phone's Downloads (and opens). No-op on older shells.
  document.addEventListener("click", function (e) {
    if (!window.AndroidDownloader || !window.AndroidDownloader.saveBase64) return;
    var a = e.target.closest && e.target.closest("a[download]");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (!/^blob:|^data:/i.test(href)) return;
    e.preventDefault(); e.stopPropagation();
    var filename = a.getAttribute("download") || "document.pdf";
    fetch(href).then(function (r) { return r.blob(); }).then(function (blob) {
      var fr = new FileReader();
      fr.onload = function () {
        var res = String(fr.result || "");
        var b64 = res.indexOf(",") >= 0 ? res.slice(res.indexOf(",") + 1) : res;
        try { window.AndroidDownloader.saveBase64(b64, filename, blob.type || "application/pdf"); } catch (err) {}
      };
      fr.readAsDataURL(blob);
    }).catch(function () {});
  }, true);

  /* ---- app version + "update available" notification -------------- */
  // use the ORIGINAL window.open so the update link opens in the phone browser
  // (where the APK download works), not the in-app document overlay
  function openExt(url) { try { (_open || window.open).call(window, url, "_blank"); } catch (e) { try { location.href = url; } catch (e2) {} } }
  function injectVersionChip(cur) {
    var side = $(".ag-sidebar"); if (!side || $(".agapp-ver")) return;
    var el = document.createElement("button");
    el.className = "agapp-ver"; el.type = "button";
    el.innerHTML = '<span class="agapp-ver-dot"></span><b>v' + cur + '</b><small>checking…</small>';
    side.appendChild(el);
    el.addEventListener("click", function () { if (el.dataset.url) { haptic("Light"); openExt(el.dataset.url); } });
  }
  function markVersion(cur, outdated, lv, url) {
    var el = $(".agapp-ver"); if (!el) return;
    el.classList.toggle("outdated", !!outdated);
    var s = el.querySelector("small");
    if (s) s.textContent = outdated ? ("Update to v" + lv) : "Up to date";
    if (outdated && url) el.dataset.url = url;
  }
  function showUpdate(lv, url, notes) {
    if ($(".agapp-update")) return;
    var b = document.createElement("div");
    b.className = "agapp-update";
    b.innerHTML =
      '<div class="agapp-update-txt"><b>Update available · v' + lv + '</b><span>' + (notes || "Get the latest version") + '</span></div>' +
      '<button class="agapp-update-btn" type="button">Update</button>' +
      '<button class="agapp-update-x" type="button" aria-label="Dismiss">×</button>';
    (document.querySelector(".agriventure-app") || document.body).appendChild(b);
    requestAnimationFrame(function () { b.classList.add("show"); });
    b.querySelector(".agapp-update-btn").addEventListener("click", function () { haptic("Medium"); openExt(url); });
    b.querySelector(".agapp-update-x").addEventListener("click", function () {
      b.classList.remove("show"); setTimeout(function () { try { b.remove(); } catch (e) {} }, 300);
    });
  }
  function setupVersion() {
    if (!P.App || !P.App.getInfo) return;              // needs @capacitor/app (v1.0.3+)
    P.App.getInfo().then(function (info) {
      var cur = info.version || "?";
      var curBuild = parseInt(info.build || "0", 10) || 0;
      injectVersionChip(cur);
      fetch("/assets/agriventure/app/version.json?v=" + Date.now(), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (latest) {
          var lc = parseInt(latest.versionCode || "0", 10) || 0;
          var outdated = lc > curBuild;
          markVersion(cur, outdated, latest.version, latest.url);
          if (outdated) showUpdate(latest.version, latest.url, latest.notes);
        })
        .catch(function () { markVersion(cur, false); });
    }).catch(function () {});
  }

  /* ---- mobile: copy each items-table column header onto its cells so the
          CSS can render the row as a labelled card (no horizontal scroll) ---- */
  function labelChildTables(root) {
    try {
      (root || document).querySelectorAll(".ag-child-table table").forEach(function (table) {
        var ths = [].map.call(table.querySelectorAll("thead th"), function (th) { return th.textContent.trim(); });
        if (!ths.length) return;
        table.querySelectorAll("tbody tr").forEach(function (tr) {
          [].forEach.call(tr.children, function (td, i) {
            if (ths[i] != null && td.getAttribute("data-label") !== ths[i]) td.setAttribute("data-label", ths[i]);
          });
        });
      });
    } catch (e) {}
  }

  /* ============================================================
     MOBILE ITEM ENTRY: summary cards + full-screen edit sheet.
     Reuses the portal's REAL Frappe controls (moved into the sheet and
     back), so data binding / validation are unchanged. No sideways scroll,
     and every field is a full-width, tappable input.
     ============================================================ */
  function esc(s) { var d = document.createElement("div"); d.textContent = (s == null ? "" : String(s)); return d.innerHTML; }
  function isPhone() { try { return window.matchMedia("(max-width:720px)").matches; } catch (e) { return false; } }
  function colLabels(table) { return [].map.call(table.querySelectorAll("thead th"), function (th) { return th.textContent.replace(/\*/g, "").trim(); }); }

  function rowSummary(tr, labels) {
    var tds = [].slice.call(tr.children);
    var sr = tds[0] ? tds[0].textContent.trim() : "";
    var fields = [];
    for (var i = 1; i < tds.length - 1; i++) {
      var inp = tds[i].querySelector("input, select, textarea");
      fields.push({ label: labels[i] || "", val: inp ? String(inp.value || "").trim() : tds[i].textContent.trim() });
    }
    var itemF = null, first = null;
    fields.forEach(function (f) { if (!itemF && /item/i.test(f.label)) itemF = f; if (!first && f.val) first = f; });
    var title = (itemF && itemF.val) || (first && first.val) || "New item";
    var chips = [];
    fields.forEach(function (f) { if (f.val && f !== itemF && chips.length < 3) chips.push(f.val); });
    return { title: title, chips: chips, sr: sr };
  }

  function renderCards(table) {
    try {
      if (document.body.classList.contains("agri-sheet-open")) return;
      var scroll = table.closest(".ag-child-scroll") || table.parentNode;
      var host = scroll.parentNode.querySelector(":scope > .agapp-items");
      if (!host) { host = document.createElement("div"); host.className = "agapp-items"; scroll.parentNode.insertBefore(host, scroll.nextSibling); }
      var labels = colLabels(table);
      var trs = [].slice.call(table.querySelectorAll("tbody tr")).filter(function (tr) { return !tr.querySelector(".ag-empty"); });
      host.innerHTML = "";
      trs.forEach(function (tr) {
        var s = rowSummary(tr, labels);
        var card = document.createElement("button"); card.className = "agapp-itemcard"; card.type = "button";
        card.innerHTML = '<span class="agapp-inum">' + esc(s.sr) + '</span>' +
          '<span class="agapp-iinfo"><b>' + esc(s.title) + '</b>' +
          (s.chips.length ? '<span class="agapp-ichips">' + s.chips.map(function (c) { return '<span class="agapp-ichip">' + esc(c) + '</span>'; }).join("") + '</span>' : '') +
          '</span>' +
          '<span class="agapp-idel" role="button" aria-label="Remove">' + svg('<path d="M7.5 7l.8 12.2a1 1 0 0 0 1 .8h5.4a1 1 0 0 0 1-.8L17.5 7M6 7h12M9.5 7V4.8h5V7M10.5 11v6M13.5 11v6"/>') + '</span>' +
          '<span class="agapp-igo">' + svg('<path d="m9 18 6-6-6-6"/>') + '</span>';
        var remove = card.querySelector(".agapp-idel");
        var realRemove = tr.querySelector(".ag-remove-row,.ag-row-delete");
        if (!realRemove || realRemove.disabled) remove.remove();
        else remove.addEventListener("click", function (e) { e.stopPropagation(); haptic("Light"); realRemove.click(); setTimeout(function () { renderCards(table); }, 60); });
        card.addEventListener("click", function () { haptic("Light"); openItemSheet(table, tr); });
        host.appendChild(card);
      });
      var sourceAdd = table.closest(".ag-child-table").querySelector(".ag-add-row");
      if (!sourceAdd || sourceAdd.disabled) return;
      var add = document.createElement("button"); add.className = "agapp-additem"; add.type = "button";
      add.innerHTML = svg('<path d="M12 5v14M5 12h14"/>') + '<span>Add Item</span>';
      add.addEventListener("click", function () {
        haptic("Medium");
        var realAdd = table.closest(".ag-child-table").querySelector(".ag-add-row");
        if (realAdd) { realAdd.click(); setTimeout(function () { var rows = table.querySelectorAll("tbody tr"); var last = rows[rows.length - 1]; if (last) openItemSheet(table, last); }, 90); }
      });
      host.appendChild(add);
    } catch (e) {}
  }

  var itemSheet = null;
  function openItemSheet(table, tr) {
    closeItemSheet();
    var labels = colLabels(table);
    var tds = [].slice.call(tr.children);
    itemSheet = document.createElement("div"); itemSheet.className = "agapp-itemsheet";
    itemSheet.innerHTML = '<div class="agapp-sheet-grab"></div>' +
      '<div class="agapp-sheet-head"><button class="agapp-sheet-x" type="button">' + svg('<path d="m15 18-6-6 6-6"/>') + 'Back</button>' +
      '<b>' + (tds[0] ? "Item " + esc(tds[0].textContent.trim()) : "Item") + '</b>' +
      '<button class="agapp-sheet-done" type="button">Done</button></div><div class="agapp-sheet-body"></div>';
    var body = itemSheet.querySelector(".agapp-sheet-body");
    var moved = [];
    for (var i = 1; i < tds.length - 1; i++) {
      var td = tds[i];
      var field = document.createElement("div"); field.className = "agapp-field";
      field.innerHTML = '<span class="agapp-flabel">' + esc(labels[i] || "") + '</span>';
      var ctrl = td.querySelector(".frappe-control");
      if (ctrl) { ctrl._agHome = td; field.appendChild(ctrl); moved.push(ctrl); }
      else { var v = document.createElement("div"); v.className = "agapp-fval"; v.textContent = td.textContent.trim(); field.appendChild(v); }
      body.appendChild(field);
    }
    itemSheet._moved = moved; itemSheet._table = table;
    (document.querySelector(".agriventure-app") || document.body).appendChild(itemSheet);
    document.body.classList.add("agri-sheet-open");
    requestAnimationFrame(function () { itemSheet.classList.add("show"); });
    itemSheet.querySelector(".agapp-sheet-x").addEventListener("click", function () { haptic("Light"); closeItemSheet(); });
    itemSheet.querySelector(".agapp-sheet-done").addEventListener("click", function () { haptic("Medium"); closeItemSheet(); });
  }
  function closeItemSheet() {
    if (!itemSheet) return false;
    var sh = itemSheet; itemSheet = null;
    (sh._moved || []).forEach(function (c) { try { if (c._agHome) { c._agHome.appendChild(c); c._agHome = null; } } catch (e) {} });
    try { document.body.classList.remove("agri-sheet-open"); } catch (e) {}
    sh.classList.remove("show");
    setTimeout(function () { try { sh.remove(); } catch (e) {} }, 260);
    if (sh._table) setTimeout(function () { try { renderCards(sh._table); } catch (e) {} }, 40);
    return true;
  }
  function enhanceItemTables() {
    if (!isPhone() || document.body.classList.contains("agri-sheet-open")) return;
    document.querySelectorAll(".ag-child-table").forEach(function (ct) {
      var table = ct.querySelector("table"); if (!table) return;
      ct.classList.add("agapp-cardmode");
      renderCards(table);
    });
  }

  /* ---- LIST views (.ag-table-wrap) → record cards (Phase 2). The native
          wide table is hidden; each row becomes a tap-to-open card. ---- */
  function pillClass(p) {
    if (!p) return "";
    if (p.classList.contains("draft")) return "agapp-lp-d";
    if (p.classList.contains("cancelled") || p.classList.contains("rejected")) return "agapp-lp-e";
    return "agapp-lp-ok";
  }
  function enhanceLists() {
    if (!isPhone()) return;
    document.querySelectorAll(".ag-table-wrap").forEach(function (wrap) {
      try {
        var table = wrap.querySelector("table"); if (!table) return;
        var ths = [].map.call(table.querySelectorAll("thead th"), function (th) { return th.textContent.trim(); });
        var trs = [].slice.call(table.querySelectorAll("tbody tr.ag-row-open"));
        var host = wrap.parentNode.querySelector(":scope > .agapp-listcards");
        if (!host) { host = document.createElement("div"); host.className = "agapp-listcards"; wrap.parentNode.insertBefore(host, wrap.nextSibling); }
        wrap.classList.add("agapp-fhide");
        var kind = (wrap.getAttribute("data-kind") || "").replace(/-/g, " ");
        var badge = (kind.split(" ").map(function (w) { return w[0] || ""; }).join("").toUpperCase().slice(0, 3)) || "•";
        host.innerHTML = "";
        if (!trs.length) { host.innerHTML = '<div class="agapp-listempty">No records found</div>'; return; }
        trs.forEach(function (tr) {
          var tds = [].slice.call(tr.children);
          var idEl = tr.querySelector(".ag-doc-link");
          var pill = tr.querySelector(".ag-status-pill");
          var cells = [];
          tds.forEach(function (td, i) {
            if (td.classList.contains("ag-sr-no") || td.classList.contains("ag-row-actions")) return;
            cells.push({ label: ths[i] || "", text: td.textContent.trim() });
          });
          var title = idEl ? idEl.textContent.trim() : (tr.getAttribute("data-name") || (cells[0] && cells[0].text) || "—");
          var amt = cells.filter(function (c) { return c.text && (/amount|total|grand|outstanding|paid|value|qty|quantity|balance/i.test(c.label) || /^[₹]|^[\d,]+(\.\d+)?$/.test(c.text)); }).pop();
          var sub = cells.filter(function (c) { return c.text && c !== amt && c.text !== title && !/status/i.test(c.label) && /supplier|party|customer|title|name|field|centre|location|item|purpose|person|warehouse|shift/i.test(c.label); })[0]
                 || cells.filter(function (c) { return c.text && c !== amt && c.text !== title && !/status/i.test(c.label) && !/^[₹\d]/.test(c.text); })[0];
          var card = document.createElement("button"); card.className = "agapp-lcard"; card.type = "button";
          card.innerHTML = '<span class="agapp-lb">' + esc(badge) + '</span><span class="agapp-lc"><b>' + esc(title) + '</b>' +
            (sub ? '<span class="agapp-ls">' + esc(sub.text) + '</span>' : '') + '</span><span class="agapp-lr">' +
            (amt ? '<span class="agapp-la">' + esc(amt.text) + '</span>' : '') +
            (pill ? '<span class="agapp-lp ' + pillClass(pill) + '">' + esc(pill.textContent.trim()) + '</span>' : '') + '</span>';
          card.addEventListener("click", function () { haptic("Light"); try { tr.click(); } catch (e) {} });
          host.appendChild(card);
        });
      } catch (e) {}
    });
  }

  /* ---- Phase 3: tag the shell with the current view type so the CSS can give
          document-detail and report screens their own app-native styling. ---- */
  function enhanceDetail() {
    try {
      var c = document.querySelector(".ag-content"); if (!c) return;
      var isForm = !!c.querySelector(".ag-form-head");
      var isReport = !!c.querySelector(".ag-kpi-body, .ag-report-body, .ag-rep-modes");
      document.body.classList.toggle("agapp-detail-view", isForm);
      document.body.classList.toggle("agapp-report-view", isReport);
    } catch (e) {}
  }

  /* ============================================================
     Frappe STANDARD grids inside a frappe.ui.Dialog (POS Opening/Closing
     "Opening Balance Details" etc.) → OUR summary cards + edit sheet.
     We hide the native grid and drive its data via the grid API, so saving/
     validation stay the desk's own. Same look as the item table.
     ============================================================ */
  function fgGrids() {
    var out = [];
    try {
      var d = window.cur_dialog;
      if (d && d.fields_dict) Object.keys(d.fields_dict).forEach(function (fn) {
        var f = d.fields_dict[fn];
        if (f && f.df && f.df.fieldtype === "Table" && f.grid && f.grid.wrapper) out.push(f.grid);
      });
    } catch (e) {}
    return out;
  }
  function fgEl(grid) { try { return grid.wrapper[0].querySelector(".form-grid"); } catch (e) { return null; } }
  function fgLabel(grid) { try { return String((grid.df && grid.df.label) || "Row").replace(/s$/, "") || "Row"; } catch (e) { return "Row"; } }
  function fgCols(grid, el) {
    var cols = [], dfMap = {};
    try { (grid.docfields || []).forEach(function (df) { dfMap[df.fieldname] = df; }); } catch (e) {}
    try {
      el.querySelectorAll(".grid-heading-row .grid-static-col[data-fieldname]").forEach(function (h) {
        var fn = h.getAttribute("data-fieldname"); if (!fn) return;
        var df = dfMap[fn] || {};
        cols.push({ fieldname: fn, label: (h.querySelector(".static-area") || h).textContent.replace(/\*/g, "").trim(),
          fieldtype: h.getAttribute("data-fieldtype") || df.fieldtype || "Data", options: df.options, reqd: df.reqd });
      });
    } catch (e) {}
    return cols;
  }
  var NUMTYPES = ["Currency", "Float", "Int", "Percent"];
  function fgFmt(v) { try { return window.format_number ? format_number(v, null, 2) : v; } catch (e) { return v; } }

  function renderFCards(grid, el) {
    if (!el || document.body.classList.contains("agri-fsheet-open")) return;
    el.classList.add("agapp-fhide");
    var host = el.parentNode.querySelector(":scope > .agapp-fcards");
    if (!host) { host = document.createElement("div"); host.className = "agapp-fcards"; el.parentNode.insertBefore(host, el.nextSibling); }
    var cols = fgCols(grid, el);
    var titleCol = cols[0], amtCol = cols.filter(function (c) { return NUMTYPES.indexOf(c.fieldtype) >= 0; })[0];
    var rows = grid.grid_rows || [];
    host.innerHTML = "";
    rows.forEach(function (gr, i) {
      var doc = gr.doc || {};
      var title = titleCol ? (doc[titleCol.fieldname] || "") : "";
      var amt = amtCol ? fgFmt(doc[amtCol.fieldname] || 0) : "";
      var card = document.createElement("button"); card.className = "agapp-itemcard"; card.type = "button";
      card.innerHTML = '<span class="agapp-inum">' + (i + 1) + '</span><span class="agapp-iinfo"><b>' + esc(title || "New") + '</b>' +
        (amtCol ? '<span class="agapp-ichips"><span class="agapp-ichip">' + esc(amtCol.label) + ': ' + esc(amt) + '</span></span>' : '') +
        '</span><span class="agapp-idel">' + svg('<path d="M7.5 7l.8 12.2a1 1 0 0 0 1 .8h5.4a1 1 0 0 0 1-.8L17.5 7M6 7h12M9.5 7V4.8h5V7"/>') + '</span><span class="agapp-igo">' + svg('<path d="m9 18 6-6-6-6"/>') + '</span>';
      card.querySelector(".agapp-idel").addEventListener("click", function (e) { e.stopPropagation(); haptic("Light"); try { gr.remove(); } catch (err) {} setTimeout(function () { renderFCards(grid, el); }, 90); });
      card.addEventListener("click", function () { haptic("Light"); openFSheet(grid, el, i); });
      host.appendChild(card);
    });
    var add = document.createElement("button"); add.className = "agapp-additem"; add.type = "button";
    add.innerHTML = svg('<path d="M12 5v14M5 12h14"/>') + '<span>Add ' + esc(fgLabel(grid)) + '</span>';
    add.addEventListener("click", function () {
      haptic("Medium");
      try { grid.add_new_row(); } catch (e) {}
      setTimeout(function () { var n = (grid.grid_rows || []).length; renderFCards(grid, el); openFSheet(grid, el, n - 1); }, 110);
    });
    host.appendChild(add);
  }

  var fSheet = null;
  function openFSheet(grid, el, idx) {
    closeFSheet();
    var gr = (grid.grid_rows || [])[idx]; if (!gr) return;
    var doc = gr.doc || {}; var cols = fgCols(grid, el);
    fSheet = document.createElement("div"); fSheet.className = "agapp-itemsheet";
    fSheet.innerHTML = '<div class="agapp-sheet-grab"></div><div class="agapp-sheet-head"><button class="agapp-sheet-x" type="button">' + svg('<path d="m15 18-6-6 6-6"/>') + 'Back</button><b>' + esc(fgLabel(grid)) + ' ' + (idx + 1) + '</b><button class="agapp-sheet-done" type="button">Save</button></div><div class="agapp-sheet-body"></div>';
    var body = fSheet.querySelector(".agapp-sheet-body");
    var inputs = [];
    cols.forEach(function (c) {
      var field = document.createElement("div"); field.className = "agapp-field";
      field.innerHTML = '<span class="agapp-flabel">' + esc(c.label) + (c.reqd ? ' *' : '') + '</span>';
      var input, cur = doc[c.fieldname] != null ? doc[c.fieldname] : "";
      if (c.fieldtype === "Link" || c.fieldtype === "Select") {
        input = document.createElement("select"); input.className = "agapp-fin";
        input.innerHTML = '<option value="">— select —</option>' + (cur ? '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>' : '');
        if (c.fieldtype === "Select") { input.innerHTML = '<option value="">— select —</option>' + String(c.options || "").split("\n").map(function (o) { return o ? '<option' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>' : ''; }).join(""); }
        else if (c.options) { try { frappe.db.get_list(c.options, { limit: 0, order_by: "name asc" }).then(function (list) { input.innerHTML = '<option value="">— select —</option>' + list.map(function (r) { return '<option' + (r.name === cur ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join(""); }); } catch (e) {} }
      } else if (NUMTYPES.indexOf(c.fieldtype) >= 0) {
        input = document.createElement("input"); input.type = "number"; input.inputMode = "decimal"; input.className = "agapp-fin"; input.value = cur;
      } else if (c.fieldtype === "Date") {
        input = document.createElement("input"); input.type = "date"; input.className = "agapp-fin"; input.value = cur;
      } else {
        input = document.createElement("input"); input.type = "text"; input.className = "agapp-fin"; input.value = cur;
      }
      inputs.push({ c: c, el: input }); field.appendChild(input); body.appendChild(field);
    });
    (document.querySelector(".agriventure-app") || document.body).appendChild(fSheet);
    document.body.classList.add("agri-fsheet-open");
    requestAnimationFrame(function () { fSheet.classList.add("show"); });
    function save() {
      try {
        inputs.forEach(function (it) { var v = it.el.value; if (NUMTYPES.indexOf(it.c.fieldtype) >= 0) v = (v === "" ? 0 : Number(v)); gr.doc[it.c.fieldname] = v; });
        if (grid.refresh) grid.refresh();
      } catch (e) {}
      closeFSheet(); renderFCards(grid, el);
    }
    fSheet.querySelector(".agapp-sheet-x").addEventListener("click", function () { haptic("Light"); closeFSheet(); renderFCards(grid, el); });
    fSheet.querySelector(".agapp-sheet-done").addEventListener("click", function () { haptic("Medium"); save(); });
  }
  function closeFSheet() {
    if (!fSheet) return false; var s = fSheet; fSheet = null;
    try { document.body.classList.remove("agri-fsheet-open"); } catch (e) {}
    s.classList.remove("show"); setTimeout(function () { try { s.remove(); } catch (e) {} }, 260);
    return true;
  }
  function enhanceFrappeGrids() {
    if (!isPhone()) return;
    fgGrids().forEach(function (grid) {
      var el = fgEl(grid); if (!el || el.closest(".ag-child-table")) return;
      var modal = el.closest(".modal"); if (modal) modal.classList.add("agapp-has-fgrid");
      renderFCards(grid, el);
    });
  }

  /* Ignore our generated cards: rebuilding them must not schedule another rebuild.
     Real table/control mutations still refresh the mobile representation. */
  function hasPortalChanges(records) {
    var generated = ".agapp-items, .agapp-listcards, .agapp-fcards, .agapp-itemsheet";
    return records.some(function (record) {
      var target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target && target.closest(generated)) return false;
      return [].slice.call(record.addedNodes).concat([].slice.call(record.removedNodes)).some(function (node) {
        return node.nodeType !== 1 || !node.matches(generated);
      });
    });
  }

  /* ---- boot once the portal shell exists; keep syncing tabs -------- */
  var tries = 0;
  var boot = setInterval(function () {
    var main = $(".ag-main");
    if (main) {
      buildBar();
      wirePTR();
      setupVersion();
      // hide the tab bar whenever the full-screen POS checkout is on screen
      var syncPos = function () {
        try { document.body.classList.toggle("agri-pos-open", !!document.querySelector(".ag-pos-checkout")); } catch (e) {}
      };
      var posT, posObs = new MutationObserver(function (records) {
        if (!hasPortalChanges(records)) return;
        clearTimeout(posT); posT = setTimeout(function () {
          syncPos(); enhanceItemTables(); enhanceLists(); enhanceDetail();
        }, 140);
      });
      posObs.observe(main, { childList: true, subtree: true });
      syncPos(); enhanceItemTables(); enhanceLists(); enhanceDetail();
      // Frappe dialogs mount in <body> and render their grid a beat later;
      // watch the whole body subtree (debounced) so we catch the grid whenever it appears
      var gridT, gridObs = new MutationObserver(function (records) { if (!hasPortalChanges(records)) return; clearTimeout(gridT); gridT = setTimeout(enhanceFrappeGrids, 150); });
      gridObs.observe(document.body, { childList: true, subtree: true });
      enhanceFrappeGrids();
      var crumb = $(".ag-crumb-title");
      if (crumb) {
        var mo = new MutationObserver(function () {
          var k = tabForCrumb(crumb.textContent); if (k) setActive(k);
        });
        mo.observe(crumb, { childList: true, characterData: true, subtree: true });
      }
      clearInterval(boot);
    }
    if (++tries > 60) clearInterval(boot);   // give up after ~12s
  }, 200);
})();
