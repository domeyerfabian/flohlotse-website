// Kleine Helfer: Menü, Filter nach Art und Umkreis, Karte, Ratgeber-Suche, Live-Status, Veranstalter-Badge, Schildgenerator. Die Seite funktioniert auch ohne dieses Skript.
(function () {
  var menu = document.querySelector(".menu-wrap");
  if (menu) {
    var label = menu.querySelector(".menu-btn span");
    menu.addEventListener("toggle", function () { if (label) label.textContent = menu.open ? "Schließen" : "Menü"; });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary").focus(); } });
    document.addEventListener("click", function (e) { if (menu.open && (!menu.contains(e.target) || e.target.closest(".menu a"))) menu.open = false; });
  }
  // Am Computer öffnen Links zu fremden Seiten (Veranstalter, Google Maps, Instagram) einen neuen Tab; Flohlotse bleibt offen. Am Handy bleibt alles wie gehabt, damit Karten-Apps direkt aufgehen.
  if (window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches) {
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[href]");
      if (!a || a.target || !/^https?:$/.test(a.protocol) || a.hostname === location.hostname) return;
      a.target = "_blank"; if (!/noopener/.test(a.rel)) a.rel = (a.rel + " noopener").trim();
    }, true);
  }
  // Wer einen längeren Text kopiert, bekommt die Quelle mitgeliefert (nicht in Eingabefeldern und nicht beim Code-Baukasten)
  document.addEventListener("copy", function (e) {
    try {
      var sel = window.getSelection ? String(window.getSelection()) : "", el = document.activeElement;
      if (sel.replace(/\s+/g, " ").trim().length < 80 || !e.clipboardData || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      var can = document.querySelector('link[rel="canonical"]'), sn = document.querySelector('meta[property="og:site_name"]');
      var url = can ? can.href : location.origin + location.pathname;
      e.clipboardData.setData("text/plain", sel + "\n\nQuelle: " + (sn ? sn.content : "Flohlotse") + " – " + url);
      e.preventDefault();
    } catch (err) {}
  });
  // Heute in Hamburg (unabhängig von der Uhr-Einstellung des Geräts)
  var berlin = function () { try { var o = {}; new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).forEach(function (x) { o[x.type] = x.value; }); return { day: o.year + "-" + o.month + "-" + o.day, hm: o.hour + ":" + o.minute }; } catch (e) { return null; } };
  var NOW = berlin();
  // Nach Filtern oder Ausblenden: leere Teilbereiche („Hamburg“/„Umland“) verstecken, Anzahl in Tagesüberschrift und Tagesleiste nachziehen
  var refreshDays = function () {
    document.querySelectorAll("main .sub").forEach(function (s) { s.hidden = !s.querySelector(".ev:not([hidden])"); });
    document.querySelectorAll("main .group").forEach(function (g) {
      var n = g.querySelectorAll(".ev:not([hidden]):not(.off)").length, gn = g.querySelector(".gn");
      if (gn) gn.textContent = n ? "· " + n + (n === 1 ? " Markt" : " Märkte") : "";
      var a = document.querySelector('.daystrip a[data-day="' + g.getAttribute("data-day") + '"]');
      if (a) { a.hidden = !n || g.hidden; var c = a.querySelector(".ds-n"); if (c) { c.textContent = n; c.setAttribute("aria-label", n + (n === 1 ? " Markt" : " Märkte")); } }
    });
  };
  // Die Seite wird jede Nacht neu gebaut. Zwischen Mitternacht und dem Neubau (oder wenn ein Neubau ausfällt) ist sie von gestern:
  // Dann verschwinden die vergangenen Tage, und ein Hinweis sagt, von wann der Stand ist.
  var stand = document.documentElement.getAttribute("data-stand"), me0 = document.querySelector('script[src*="/assets/site."]'), ROOT0 = me0 ? me0.getAttribute("src").replace(/\/assets\/site\..*$/, "") : "";
  if (NOW && stand && stand < NOW.day) {
    var dated = document.querySelectorAll("main [data-day]"), old = 0;
    dated.forEach(function (el) { if (el.getAttribute("data-day") < NOW.day) { el.remove(); old++; } });
    document.querySelectorAll("main ul.dates").forEach(function (l) { if (!l.children.length) { var p = document.createElement("p"); p.className = "meta"; p.textContent = "Die nächsten Termine werden gerade aktualisiert."; l.parentNode.replaceChild(p, l); } });
    if (dated.length || document.documentElement.hasAttribute("data-rel")) {
      var main = document.querySelector("main"), d = stand.split("-"), note = document.createElement("p");
      note.className = "stale"; note.setAttribute("role", "status"); note.setAttribute("data-nosnippet", "");
      note.textContent = "Stand dieser Seite: " + (+d[2]) + "." + (+d[1]) + "." + d[0] + ". Sie wird gerade aktualisiert" + (old ? ", vergangene Termine sind ausgeblendet" : "") + ". Angaben wie „heute“ und „morgen“ beziehen sich auf den Stand. ";
      if (location.pathname.slice(-9) !== "/termine/") { var more = document.createElement("a"); more.href = ROOT0 + "/termine/"; more.textContent = "Zu den kommenden Terminen"; note.appendChild(more); }
      if (main) main.insertBefore(note, main.firstChild);
    }
  }
  // Pfad der Website (falls sie in einem Unterordner liegt), abgeleitet aus dem Pfad dieses Skripts
  var me = document.querySelector('script[src*="/assets/site."]'), ROOT = me ? me.getAttribute("src").replace(/\/assets\/site\..*$/, "") : "";
  // Filter: Art des Markts (Termine-Seite) und Umkreis nach Postleitzahl oder Standort. Alles passiert im Browser.
  var filter = document.getElementById("filter"), near = document.getElementById("near");
  var F = { tag: "", origin: null, km: 10, label: "" };
  var kmOf = function (el) { var ll = el.getAttribute("data-ll"); if (!ll || !F.origin) return null; ll = ll.split(","); var R = 6371, toR = Math.PI / 180, a = +ll[0] * toR, b = F.origin[0] * toR, dl = (+ll[1] - F.origin[1]) * toR; return R * 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((a - b) / 2), 2) + Math.cos(a) * Math.cos(b) * Math.pow(Math.sin(dl / 2), 2))); };
  var kmText = function (d) { return d < 1 ? "unter 1 km" : "ca. " + Math.round(d) + " km"; };
  var badge = function (host, d) { if (!host) return; var o = host.querySelector(".dist"); if (o) o.remove(); if (d === null) return; var b = document.createElement("span"); b.className = "dist"; b.textContent = kmText(d); host.appendChild(b); };
  var apply = function () {
    var shown = 0;
    document.querySelectorAll("main .ev").forEach(function (ev) {
      var ok = !F.tag || (ev.getAttribute("data-tags") || "").split("|").indexOf(F.tag) > -1, d = kmOf(ev);
      if (F.origin && (d === null || d > F.km)) ok = false;
      badge(ev.querySelector(".meta.ln > span"), F.origin ? d : null);
      ev.hidden = !ok; if (ok) shown++;
    });
    document.querySelectorAll("main .group").forEach(function (g) { g.hidden = !g.querySelector(".ev:not([hidden])"); });
    refreshDays();
    var qs = document.querySelectorAll("main .qlist a[data-ll]");
    qs.forEach(function (a) { var d = kmOf(a), ok = !F.origin || (d !== null && d <= F.km); badge(a.querySelector(".meta"), F.origin ? d : null); a.hidden = !ok; if (ok) shown++; });
    if (qs.length) document.querySelectorAll("main .cluster").forEach(function (c) { if (c.querySelector(".qlist")) c.hidden = !c.querySelector(".qlist a:not([hidden])"); });
    var leer = document.getElementById("leer"); if (leer) leer.hidden = shown > 0;
    var msg = document.getElementById("nearMsg");
    if (msg && F.origin) msg.classList.add("on"); if (msg && F.origin) msg.textContent = shown ? shown + (shown === 1 ? " Treffer" : " Treffer") + " im Umkreis von " + F.km + " km um " + F.label + ". Entfernungen sind ungefähr." : "Im Umkreis von " + F.km + " km um " + F.label + " ist gerade nichts im Kalender. Wähl einen größeren Umkreis.";
    if (window.flMapNear) window.flMapNear(F);
  };
  if (filter) {
    filter.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      F.tag = b.getAttribute("data-t");
      filter.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      apply();
    });
  }
  if (near) {
    near.hidden = false;
    var nTog = document.getElementById("nearTog"), nIn = document.getElementById("nearIn");
    var nOpen = function (on) { if (!nTog) return; nIn.hidden = !on; nTog.setAttribute("aria-expanded", String(on)); near.classList.toggle("open", on); };
    if (nTog) nTog.addEventListener("click", function () { var on = nIn.hidden; nOpen(on); if (on) setTimeout(function () { var p = document.getElementById("nearPlz"); if (p && window.matchMedia && matchMedia("(hover: hover)").matches) p.focus(); }, 30); });
    var plzIn = document.getElementById("nearPlz"), kmSel = document.getElementById("nearKm"), geo = document.getElementById("nearGeo"), clr = document.getElementById("nearClear"), msg0 = document.getElementById("nearMsg").textContent, plzData = null;
    // Postleitzahl steht hinter dem # in der Adresse: dieser Teil wird nie an den Server gesendet
    var sync = function () { try { var h = F.origin && F.label.indexOf("PLZ") === 0 ? "#plz=" + plzIn.value + "&km=" + F.km : " "; history.replaceState(null, "", h === " " ? location.pathname + location.search : h); } catch (e) {} };
    var loadPlz = function (cb) { if (plzData) return cb(plzData); fetch(ROOT + "/assets/plz.json").then(function (r) { return r.json(); }).then(function (j) { plzData = j; cb(j); }).catch(function () { document.getElementById("nearMsg").textContent = "Die Postleitzahlen konnten gerade nicht geladen werden."; }); };
    var say = function (t, on) { var m = document.getElementById("nearMsg"); m.textContent = t; m.classList.toggle("on", !!on); };
    var byPlz = function () {
      var v = plzIn.value.replace(/\D/g, "").slice(0, 5); plzIn.value = v;
      if (v.length < 5) { say("Bitte gib eine Postleitzahl mit fünf Ziffern ein.", true); plzIn.focus(); return; }
      loadPlz(function (j) {
        if (!j[v]) { say("Die Postleitzahl " + v + " liegt außerhalb unseres Gebiets (Hamburg und 30 km Umland).", true); return; }
        F.origin = j[v]; F.label = "PLZ " + v; clr.hidden = false; apply(); sync(); plzIn.blur();
      });
    };
    var reset = function () { F.origin = null; F.label = ""; plzIn.value = ""; clr.hidden = true; say(msg0, false); apply(); sync(); };
    plzIn.addEventListener("input", function () { var v = plzIn.value.replace(/\D/g, "").slice(0, 5); if (plzIn.value !== v) plzIn.value = v; });
    document.getElementById("nearForm").addEventListener("submit", function (e) { e.preventDefault(); byPlz(); });
    kmSel.addEventListener("change", function () { F.km = +kmSel.value; if (F.origin) { apply(); sync(); } });
    clr.addEventListener("click", reset);
    geo.addEventListener("click", function () {
      if (!navigator.geolocation) { document.getElementById("nearMsg").textContent = "Dein Browser kann den Standort nicht bestimmen."; return; }
      document.getElementById("nearMsg").textContent = "Standort wird bestimmt …";
      navigator.geolocation.getCurrentPosition(function (p) { F.origin = [p.coords.latitude, p.coords.longitude]; F.label = "deinen Standort"; plzIn.value = ""; clr.hidden = false; apply(); sync(); },
        function () { document.getElementById("nearMsg").textContent = "Standort nicht verfügbar. Gib stattdessen deine Postleitzahl ein."; }, { timeout: 10000, maximumAge: 600000 });
    });
    // Startseite „In meiner Nähe“ (/termine/#near): Umkreis zeigen und gleich den Standort abfragen
    if (location.hash === "#near") { nOpen(true); setTimeout(function () { near.scrollIntoView({ block: "start" }); geo.click(); }, 60); }
    try { var hp = new URLSearchParams(location.hash.slice(1)), qp = new URLSearchParams(location.search), p0 = hp.get("plz") || qp.get("plz"), k0 = hp.get("km") || qp.get("km"); if (k0 && kmSel.querySelector('option[value="' + k0 + '"]')) { kmSel.value = k0; F.km = +k0; } if (p0) { nOpen(true); plzIn.value = p0; byPlz(); } } catch (e) {}
  }
  // Karte (erst nach Klick: Kartenbilder von OpenStreetMap, Leaflet liegt auf unserem Server)
  var mapLoad = document.getElementById("mapLoad");
  if (mapLoad) {
    mapLoad.addEventListener("click", function () {
      var box = document.getElementById("mapBox"); box.innerHTML = '<p class="map-wait">Karte wird geladen …</p>';
      var css = document.createElement("link"); css.rel = "stylesheet"; css.href = ROOT + "/assets/leaflet.css?v=1.9.4"; document.head.appendChild(css);
      var js = document.createElement("script"); js.src = ROOT + "/assets/leaflet.js?v=1.9.4";
      js.onload = function () {
        box.innerHTML = ""; var L = window.L, data = JSON.parse(document.getElementById("mapData").textContent);
        var map = L.map(box, { scrollWheelZoom: false, tap: true }).setView([53.55, 10.0], 10);
        map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende' }).addTo(map);
        var groups = {}; data.forEach(function (d) { var k = d[3].toFixed(4) + "," + d[4].toFixed(4); (groups[k] = groups[k] || []).push(d); });
        var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
        var pts = [];
        Object.keys(groups).forEach(function (k) {
          var g = groups[k], ll = [g[0][3], g[0][4]]; pts.push(ll);
          var icon = L.divIcon({ className: "pin", html: "<span>" + (g.length > 1 ? g.length : "") + "</span>", iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] });
          L.marker(ll, { icon: icon, title: g.map(function (d) { return d[0]; }).join(", ") }).addTo(map).bindPopup(g.map(function (d) {
            return '<p class="pop"><a href="' + ROOT + "/flohmarkt/" + d[1] + '/">' + esc(d[0]) + "</a><br><small>" + esc(d[2]) + " · " + (d[5] ? "nächster Termin " + esc(d[5]) : esc(d[6])) + "</small></p>";
          }).join(""));
        });
        if (pts.length) map.fitBounds(pts, { padding: [24, 24] });
        var circle = null;
        window.flMapNear = function (f) { if (circle) { map.removeLayer(circle); circle = null; } if (f.origin) { circle = L.circle(f.origin, { radius: f.km * 1000, color: "#15211B", weight: 1, fillOpacity: .06 }).addTo(map); map.fitBounds(circle.getBounds(), { padding: [12, 12] }); } };
        window.flMapNear(F);
      };
      js.onerror = function () { box.innerHTML = '<p class="map-wait">Die Karte konnte nicht geladen werden.</p>'; };
      document.head.appendChild(js);
    });
    if (location.hash === "#karte") setTimeout(function () { var k = document.getElementById("karte"); if (k) k.scrollIntoView(); }, 50);
  }
  // Kalender-Abo: Android-Handys kennen „webcal://“ oft nicht, dort geht das Abo über Google Kalender
  if (/Android/i.test(navigator.userAgent || "")) document.querySelectorAll("a[data-gcal]").forEach(function (a) { a.href = a.getAttribute("data-gcal"); a.rel = "noopener"; });
  // Terminliste: Umschalter Liste | Karte (die Karte lädt erst nach Klick auf „Karte laden“)
  var vTog = document.getElementById("viewTog");
  if (vTog) {
    var vSet = function (v) {
      vTog.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === v)); });
      var k = document.getElementById("karte"), l = document.getElementById("liste"), s = document.querySelector(".daystrip");
      if (k) k.hidden = v !== "karte"; if (l) l.hidden = v === "karte"; if (s) s.hidden = v === "karte";
      var leer = document.getElementById("leer"); if (leer && v === "karte") leer.hidden = true;
    };
    vTog.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) vSet(b.getAttribute("data-v")); });
    if (location.hash === "#karte") vSet("karte");
  }
  // Lange Listen: Knopf „Nach oben“, erscheint erst nach dem Scrollen
  if (document.querySelectorAll("main .ev").length > 12) {
    var up = document.createElement("button"); up.type = "button"; up.className = "to-top"; up.hidden = true; up.setAttribute("aria-label", "Nach oben");
    up.innerHTML = '<svg class="i" aria-hidden="true" focusable="false"><use href="' + ROOT0 + '/assets/icons.svg#i-chev"/></svg>';
    var useEl = document.querySelector("svg use[href*='icons.svg']"); if (useEl) up.querySelector("use").setAttribute("href", useEl.getAttribute("href").replace(/#.*$/, "#i-chev"));
    document.body.appendChild(up);
    var upT; window.addEventListener("scroll", function () { if (upT) return; upT = setTimeout(function () { upT = 0; up.hidden = window.scrollY < 1400; }, 120); }, { passive: true });
    up.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); });
  }
  // Standgebühren im Vergleich: Filter „Spontan möglich“, „Nur Privatverkäufer“, „Bis 10 € pro Meter“
  var feeF = document.getElementById("feeF");
  if (feeF) {
    feeF.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var f = b.getAttribute("data-f"), any = false;
      feeF.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      document.querySelectorAll(".fee-reg").forEach(function (c) {
        var n = 0;
        c.querySelectorAll(".fee").forEach(function (r) { var ok = !f || (" " + r.getAttribute("data-f") + " ").indexOf(" " + f + " ") > -1; r.hidden = !ok; if (ok) n++; });
        c.hidden = n === 0; if (n) any = true;
      });
      document.getElementById("feeLeer").hidden = any;
    });
  }
  var q = document.getElementById("kbSearch");
  if (q) {
    q.addEventListener("input", function () {
      var v = q.value.trim().toLowerCase(), any = false;
      document.querySelectorAll(".cluster").forEach(function (c) {
        var n = 0;
        c.querySelectorAll(".qlist a").forEach(function (a) { var ok = !v || a.getAttribute("data-q").indexOf(v) > -1; a.hidden = !ok; if (ok) n++; });
        c.hidden = n === 0; if (n) any = true;
      });
      document.getElementById("kbLeer").hidden = any;
    });
  }
  // Live-Status für heutige Termine: „Jetzt geöffnet“, „Öffnet heute um …“, „Heute schon vorbei“ (Hamburger Uhrzeit)
  var liveEvs = document.querySelectorAll(".group .ev[data-s]");
  if (liveEvs.length && NOW) {
    var today = NOW.day, hm = NOW.hm;
    var uhr = function (t) { var h = parseInt(t.slice(0, 2), 10), m = t.slice(3, 5); return h + (m === "00" ? "" : ":" + m) + " Uhr"; };
    liveEvs.forEach(function (ev) {
      var g = ev.closest(".group"); if (!g || g.getAttribute("data-day") !== today) return;
      var s = ev.getAttribute("data-s"), e = ev.getAttribute("data-e");
      if (hm < s || !e) return;
      if (hm < e) { var t = ev.querySelector(".time"); if (t) { var d = document.createElement("span"); d.className = "live-dot"; d.title = "Jetzt geöffnet"; d.innerHTML = '<span class="vh">Jetzt geöffnet</span>'; t.appendChild(d); } return; }
      ev.classList.add("is-past");
      // Startseite: Heute schon beendete Märkte fallen weg (und der Tag, wenn nichts mehr übrig ist)
      if (ev.closest(".home-next")) { ev.hidden = true; if (!g.querySelector(".ev:not([hidden])")) g.hidden = true; refreshDays(); return; }
      var b = document.createElement("span"); b.className = "live past"; b.textContent = "Heute schon vorbei";
      var body = ev.querySelector(".ev-body"); if (body) body.insertBefore(b, body.firstChild);
    });
  }
  // Sticker auf der Startseite: Sonntagabend, wenn alle heutigen Märkte vorbei sind, zeigt er den nächsten Markttag
  var bigSt = document.getElementById("bigSt");
  if (bigSt && NOW && bigSt.getAttribute("data-day") === NOW.day && NOW.hm >= bigSt.getAttribute("data-end")) {
    bigSt.querySelector("b").textContent = bigSt.getAttribute("data-n"); bigSt.querySelector("span").textContent = bigSt.getAttribute("data-l"); bigSt.href = bigSt.getAttribute("data-h");
  }
  // Slider auf der Startseite: Punkte zeigen die Position und springen zum Bild
  var hlT = document.getElementById("hlTrack"), hlD = document.getElementById("hlDots");
  if (hlT && hlD) {
    var hlB = hlD.querySelectorAll("button"), hlS = hlT.children, hlW;
    var hlAt = function () { var x = hlT.scrollLeft, best = 0, d = 1e9; for (var i = 0; i < hlS.length; i++) { var q = Math.abs(hlS[i].offsetLeft - hlS[0].offsetLeft - x); if (q < d) { d = q; best = i; } } return best; };
    hlT.addEventListener("scroll", function () { clearTimeout(hlW); hlW = setTimeout(function () { var n = hlAt(); for (var i = 0; i < hlB.length; i++) { if (i === n) hlB[i].setAttribute("aria-current", "true"); else hlB[i].removeAttribute("aria-current"); } }, 60); }, { passive: true });
    hlD.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; var i = Array.prototype.indexOf.call(hlB, b); hlT.scrollTo({ left: hlS[i].offsetLeft - hlS[0].offsetLeft, behavior: "smooth" }); });
  }
  // Teilen: vorformulierte Nachricht über die Teilen-Funktion des Geräts, sonst in die Zwischenablage
  document.querySelectorAll("button[data-share]").forEach(function (b) {
    b.hidden = false;
    b.addEventListener("click", function () {
      var text = b.getAttribute("data-share");
      if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
      var done = function () { if (b.classList.contains("copied")) return; var o = b.innerHTML, al = b.getAttribute("aria-label"); b.classList.add("copied"); b.setAttribute("aria-label", "Nachricht kopiert"); if (b.classList.contains("share-big")) b.lastChild.textContent = "Nachricht kopiert"; setTimeout(function () { b.innerHTML = o; b.classList.remove("copied"); if (al) b.setAttribute("aria-label", al); }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {}); else { var t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); done(); } catch (e) {} t.remove(); }
    });
  });
  // Veranstalter-Badge: Link-Code für die eigene Website
  var bdg = document.getElementById("bdgSel");
  if (bdg) {
    var code = document.getElementById("bdgCode"), prev = document.getElementById("bdgPrev"), cp = document.getElementById("bdgCopy");
    var make = function () {
      var url = bdg.getAttribute("data-site") + "/flohmarkt/" + bdg.value + "/";
      var html = '<a href="' + url + '" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#F6E03A;color:#15211B;font:700 15px/1.2 system-ui,sans-serif;text-decoration:none">Alle Termine auf Flohlotse</a>';
      code.value = html; prev.innerHTML = html;
    };
    bdg.addEventListener("change", make); make();
    cp.addEventListener("click", function () {
      code.select();
      var ok = function () { cp.textContent = "Kopiert!"; setTimeout(function () { cp.textContent = "Code kopieren"; }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(code.value).then(ok, function () { document.execCommand("copy"); ok(); }); else { document.execCommand("copy"); ok(); }
    });
  }
  // Schildgenerator: Vorschau live aktualisieren, Text einpassen, nur das Schild drucken. Nichts wird gespeichert oder verschickt.
  var gen = document.getElementById("gen");
  if (gen) {
    var wrap = document.getElementById("sheetWrap"), $ = function (id) { return document.getElementById(id); };
    var st = { kind: gen.getAttribute("data-kind"), fmt: gen.getAttribute("data-fmt"), top: $("fTop").value, main: $("fMain").value, bot: $("fBot").value, price: $("fPrice").value, vb: true, save: false };
    var lastSignFmt = st.kind === "tags" ? "quer" : st.fmt;
    var over = function (b) { return b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1; };
    // passt, wenn weder der Kasten noch der Text selbst überläuft (lange Wörter werden so kleiner statt abgeschnitten)
    var bad = function (box, el) { return over(box) || (el !== box && el.scrollWidth > el.clientWidth + 1); };
    var fit = function (box, el, max, min) { var lo = min || 4, hi = max; el.style.fontSize = hi + "px"; if (!bad(box, el)) return hi; while (hi - lo > 0.5) { var mid = (lo + hi) / 2; el.style.fontSize = mid + "px"; if (bad(box, el)) hi = mid; else lo = mid; } el.style.fontSize = lo + "px"; return lo; };
    var sheet;
    // Vorschau einpassen: echte Blattgröße messen, Rahmen-Höhe exakt setzen (Rahmen darf nicht bei jedem Tastendruck schrumpfen)
    var scale = function () {
      if (!sheet) return;
      sheet.style.transform = "none"; wrap.style.aspectRatio = "auto";
      var r = sheet.getBoundingClientRect(), s = wrap.clientWidth / r.width;
      sheet.style.transform = "scale(" + s + ")";
      wrap.style.height = (r.height * s + (wrap.offsetHeight - wrap.clientHeight)) + "px";
    };
    var render = function () {
      var tags = st.kind === "tags", fmt = tags ? "tags" : st.fmt, n = tags ? 24 : fmt === "acht" ? 8 : 1;
      gen.setAttribute("data-kind", st.kind); gen.setAttribute("data-fmt", fmt);
      sheet = document.createElement("div"); sheet.id = "sheet";
      sheet.className = "sheet f-" + fmt + (st.save ? " save" : "") + (tags && !st.vb ? " novb" : "");
      var tpl = $(tags ? "tplTag" : "tplSign").content.firstElementChild;
      for (var i = 0; i < n; i++) sheet.appendChild(tpl.cloneNode(true));
      wrap.innerHTML = ""; wrap.appendChild(sheet);
      var units = sheet.children, u = units[0];
      if (tags) {
        var box = u.querySelector(".tg-price"), sp = box.firstElementChild;
        box.classList.toggle("blank", !st.price); sp.textContent = st.price || "€";
        var fs = st.price ? fit(box, sp, box.clientHeight * 0.8, 6) : null;
        for (i = 1; i < n; i++) { var b2 = units[i].querySelector(".tg-price"); b2.className = box.className; b2.firstElementChild.textContent = sp.textContent; if (fs) b2.firstElementChild.style.fontSize = fs + "px"; }
      } else {
        var top = u.querySelector(".sg-top"), main = u.querySelector(".sg-main"), ms = main.firstElementChild, bot = u.querySelector(".sg-bot");
        top.textContent = st.top.trim(); ms.textContent = st.main.trim() || " "; bot.textContent = st.bot.trim();
        var base = top.parentNode.clientWidth, sizes = [];
        [top, bot].forEach(function (el) { if (el.textContent) { el.style.fontSize = ""; var mx = parseFloat(getComputedStyle(el).fontSize); sizes.push(fit(el, el, mx, 4)); } else sizes.push(null); });
        var mfs = fit(main, ms, main.clientHeight * 0.9, 6);
        for (i = 1; i < n; i++) {
          var c = units[i];
          c.querySelector(".sg-top").textContent = top.textContent; if (sizes[0]) c.querySelector(".sg-top").style.fontSize = sizes[0] + "px";
          c.querySelector(".sg-bot").textContent = bot.textContent; if (sizes[1]) c.querySelector(".sg-bot").style.fontSize = sizes[1] + "px";
          var m2 = c.querySelector(".sg-main span"); m2.textContent = ms.textContent; m2.style.fontSize = mfs + "px";
        }
      }
      scale();
    };
    var setPressed = function (sel, el) { gen.querySelectorAll(sel).forEach(function (x) { x.setAttribute("aria-pressed", String(x === el)); }); };
    ["fTop", "fMain", "fBot", "fPrice"].forEach(function (id) { $(id).addEventListener("input", function () { st[{ fTop: "top", fMain: "main", fBot: "bot", fPrice: "price" }[id]] = this.value; render(); }); });
    $("fVb").addEventListener("change", function () { st.vb = this.checked; render(); });
    $("fSave").addEventListener("change", function () { st.save = this.checked; render(); });
    gen.addEventListener("click", function (e) {
      var f = e.target.closest("[data-fmt]"), p = e.target.closest("[data-set]");
      if (f && f.tagName === "BUTTON") { st.fmt = lastSignFmt = f.getAttribute("data-fmt"); setPressed("button[data-fmt]", f); render(); }
      if (p) {
        var d = JSON.parse(p.getAttribute("data-set"));
        st.kind = d.kind; st.top = d.top || ""; st.main = d.main || ""; st.bot = d.bot || ""; st.price = d.price || "";
        st.fmt = d.kind === "tags" ? "tags" : lastSignFmt;
        $("fTop").value = st.top; $("fMain").value = st.main; $("fBot").value = st.bot; $("fPrice").value = st.price;
        setPressed("button[data-set]", p); setPressed("button[data-fmt]", gen.querySelector('button[data-fmt="' + st.fmt + '"]')); render();
      }
    });
    // Drucken: nur das Schild, in Originalgröße, Seitenformat passend (auch bei Strg+P)
    var pageCss = document.createElement("style"), root = null;
    var prep = function () {
      if (root) root.remove();
      root = document.createElement("div"); root.id = "print-root";
      var c = sheet.cloneNode(true); c.removeAttribute("id"); c.style.transform = "none"; root.appendChild(c);
      document.body.appendChild(root);
      pageCss.textContent = "@page{size:A4 " + (st.kind !== "tags" && st.fmt === "quer" ? "landscape" : "portrait") + ";margin:0}";
      document.head.appendChild(pageCss); document.documentElement.classList.add("print-sign");
    };
    var done = function () { document.documentElement.classList.remove("print-sign"); if (root) { root.remove(); root = null; } pageCss.remove(); };
    window.addEventListener("beforeprint", prep); window.addEventListener("afterprint", done);
    $("doPrint").addEventListener("click", function () { prep(); window.print(); });
    window.addEventListener("resize", scale);
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(render);
    render();
  }
  /* Merkliste: gemerkte Märkte liegen nur im Browser (Local Storage, Schlüssel „flohlotse-merkliste“, nur die Kennungen der Märkte).
     Angelegt wird sie erst, wenn jemand auf ein Herz tippt. Nichts davon wird an den Server geschickt. */
  var FK = "flohlotse-merkliste", SLUG_OK = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var favOk = (function () { try { return !!window.localStorage && typeof localStorage.getItem === "function"; } catch (e) { return false; } })();
  var favGet = function () { try { var v = JSON.parse(localStorage.getItem(FK) || "[]"); return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string" && SLUG_OK.test(x); }) : []; } catch (e) { return []; } };
  var favSet = function (a) { try { if (a.length) localStorage.setItem(FK, JSON.stringify(a)); else localStorage.removeItem(FK); return true; } catch (e) { return false; } };
  var favHas = function (s) { return favGet().indexOf(s) > -1; };
  // kurze Meldung unten am Bildschirm (schwarz = Hinweis), auf Wunsch mit Link oder Knopf
  var toastEl = null, toastT = 0;
  var toast = function (msg, act, fn) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; toastEl.setAttribute("role", "status"); toastEl.setAttribute("aria-live", "polite"); document.body.appendChild(toastEl); }
    toastEl.innerHTML = ""; var t = document.createElement("span"); t.textContent = msg; toastEl.appendChild(t);
    if (act) { var a; if (typeof fn === "string") { a = document.createElement("a"); a.href = fn; } else { a = document.createElement("button"); a.type = "button"; a.addEventListener("click", function () { fn(); toastEl.classList.remove("on"); }); } a.textContent = act; toastEl.appendChild(a); }
    toastEl.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove("on"); }, 4000);
  };
  var favSync = function () {
    var a = favGet();
    document.querySelectorAll("button[data-fav]").forEach(function (b) {
      var on = a.indexOf(b.getAttribute("data-fav")) > -1, n = b.getAttribute("data-name") || "Markt";
      b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", on ? n + " von der Merkliste nehmen" : n + " merken");
      var l = b.querySelector(".fav-l"); if (l) l.textContent = on ? "Gemerkt" : "Merken";
    });
    document.querySelectorAll(".fav-n").forEach(function (x) { x.textContent = a.length > 99 ? "99+" : String(a.length); x.hidden = !a.length; });
    document.querySelectorAll(".fav-top").forEach(function (x) { x.setAttribute("aria-label", a.length ? "Merkliste, " + a.length + (a.length === 1 ? " Markt" : " Märkte") : "Merkliste"); x.classList.toggle("has", a.length > 0); });
  };
  // on: true = merken, false = entfernen, nichts = umschalten. Ergebnis: neuer Zustand oder null, wenn der Browser nichts speichern lässt.
  var favToggle = function (s, on) {
    var a = favGet(), i = a.indexOf(s); if (on === undefined) on = i < 0;
    if (on && i < 0) a.push(s); if (!on && i > -1) a.splice(i, 1);
    if (!favSet(a)) { toast("Merken klappt in diesem Browser gerade nicht, zum Beispiel im privaten Fenster."); return null; }
    favSync(); try { document.dispatchEvent(new CustomEvent("flfav")); } catch (e) {}
    return on;
  };
  if (favOk) {
    document.querySelectorAll("button[data-fav]").forEach(function (b) { b.hidden = false; });
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button[data-fav]"); if (!b) return;
      var s = b.getAttribute("data-fav"), n = b.getAttribute("data-name") || "Markt", on = favToggle(s);
      if (on === null) return;
      if (b.classList.contains("fav")) { b.classList.remove("pop"); void b.offsetWidth; if (on) b.classList.add("pop"); }
      if (document.getElementById("merk")) return;
      var grp = on && b.closest(".group"), same = grp ? grp.querySelectorAll('button[data-fav][aria-pressed="true"]').length : 0;
      if (same > 1) { var gk = grp.getAttribute("data-day"); toast(same + " Märkte am " + ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"][new Date(gk + "T12:00:00Z").getUTCDay()] + " gemerkt", "Als Tour planen", ROOT + "/merkliste/#tour-" + gk); return; }
      var calA = on && document.querySelector(".cal-dd .cal-pop a"), calSeen = false; try { calSeen = !!localStorage.getItem("flohlotse-kal-tipp"); } catch (x) {}
      if (calA && !calSeen) { try { localStorage.setItem("flohlotse-kal-tipp", "1"); } catch (x) {} toast("Gemerkt. Neue Termine automatisch in deinen Kalender?", "Abonnieren", calA.getAttribute("href")); return; }
      toast(on ? "„" + n + "“ ist auf deiner Merkliste." : "„" + n + "“ ist nicht mehr auf der Merkliste.", on ? "Ansehen" : "Rückgängig", on ? ROOT + "/merkliste/" : function () { favToggle(s, true); });
    });
    window.addEventListener("storage", function (e) { if (e.key === FK || e.key === null) { favSync(); try { document.dispatchEvent(new CustomEvent("flfav")); } catch (x) {} } });
    favSync();
  }
  var esc2 = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var dayAdd = function (k, n) { var p = k.split("-"), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)); return d.toISOString().slice(0, 10); };
  var TODAY = NOW ? NOW.day : new Date().toISOString().slice(0, 10), TOMORROW = dayAdd(TODAY, 1);
  var dayLab = function (k) { if (k === TODAY) return "Heute"; if (k === TOMORROW) return "Morgen"; var p = k.split("-"), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); return ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getUTCDay()] + " " + p[2] + "." + p[1] + "." + (p[0] !== TODAY.slice(0, 4) ? p[0] : ""); };

  // Seite Merkliste: Daten der Märkte laden und die gemerkten mit ihren nächsten Terminen zeigen
  var merk = document.getElementById("merk");
  if (merk) {
    var DATA = null, msg = document.getElementById("merkMsg"), tools = document.getElementById("merkTools"), imp = null;
    try { var hm0 = new URLSearchParams(location.hash.slice(1)).get("m"); if (hm0) imp = hm0.split(",").filter(function (x) { return SLUG_OK.test(x); }).slice(0, 200); } catch (e) {}
    var say = function (html) { msg.innerHTML = html || ""; };
    var spr = (function () { var u = document.querySelector(".fav-top use"); return u ? u.getAttribute("href").replace(/#.*$/, "") : ROOT + "/assets/icons.svg"; })();
    var svg = function (id, cls) { return '<svg class="i ' + cls + '" aria-hidden="true" focusable="false"><use href="' + spr + "#i-" + id + '"/></svg>'; };
    var card = function (s) {
      var d = DATA[s], dates = d[3].filter(function (x) { return x[0] >= TODAY; });
      var dl = dates.length ? '<ul class="mk-dates">' + dates.map(function (x) { return '<li' + (x[1] === "fällt aus" ? ' class="off"' : "") + '><b>' + dayLab(x[0]) + "</b>" + (x[1] ? " · " + esc2(x[1]) : "") + "</li>"; }).join("") + "</ul>" : '<p class="meta">Zurzeit ist kein Termin bekannt.</p>';
      return '<article class="mk"><div class="mk-top"><h2><a href="' + ROOT + "/flohmarkt/" + s + '/">' + esc2(d[0]) + '</a></h2><button type="button" class="fav" data-fav="' + s + '" data-name="' + esc2(d[0]) + '" aria-pressed="true" aria-label="' + esc2(d[0]) + ' von der Merkliste nehmen">' + svg("heart", "ho") + svg("heartfill", "hf") + "</button></div>" +
        '<p class="meta">' + esc2(d[1]) + "</p>" + dl + '<p class="ln rh">' + svg("repeat", "") + "<span>" + esc2(d[2]) + "</span></p></article>";
    };
    var render = function () {
      if (!DATA) return;
      if (!favOk) { merk.innerHTML = '<div class="empty">Dein Browser lässt hier nichts speichern, zum Beispiel im privaten Fenster. Dann funktioniert die Merkliste leider nicht.</div>'; return; }
      var a = favGet(), known = a.filter(function (s) { return DATA[s]; }), gone = a.length - known.length, out = "";
      if (gone) { favSet(known); favSync(); say(gone === 1 ? "Ein gemerkter Markt steht nicht mehr im Kalender und wurde entfernt." : gone + " gemerkte Märkte stehen nicht mehr im Kalender und wurden entfernt."); }
      if (imp) {
        var neu = imp.filter(function (s) { return DATA[s] && known.indexOf(s) < 0; });
        out += neu.length ? '<div class="mk-imp"><p><b>Dieser Link enthält ' + (neu.length === 1 ? "einen Markt" : neu.length + " Märkte") + ", die noch nicht auf deiner Merkliste " + (neu.length === 1 ? "steht" : "stehen") + ':</b> ' + neu.map(function (s) { return esc2(DATA[s][0]); }).join(", ") + '</p><div class="share-row"><button type="button" class="btn" id="mkImpYes">Übernehmen</button><button type="button" class="btn" id="mkImpNo">Nein danke</button></div></div>' : "";
        if (!neu.length) { imp = null; try { history.replaceState(null, "", location.pathname); } catch (e) {} }
      }
      var nx = function (s) { var x = DATA[s][3].filter(function (y) { return y[0] >= TODAY && y[1] !== "fällt aus"; })[0]; return x ? x[0] : "9999"; };
      known.sort(function (p, q) { return nx(p) < nx(q) ? -1 : nx(p) > nx(q) ? 1 : DATA[p][0].localeCompare(DATA[q][0], "de"); });
      out += known.length ? tourCards(known) + '<p class="mk-n">' + (known.length === 1 ? "1 Markt" : known.length + " Märkte") + ", sortiert nach dem nächsten Termin.</p>" + '<div class="mk-list">' + known.map(card).join("") + "</div>"
        : '<div class="empty mk-empty"><p><b>Noch nichts gemerkt.</b></p><p>Tipp bei einem Termin auf das Herz oder wisch dich durch die Märkte der nächsten Wochen.</p><div class="share-row"><a class="btn" href="' + ROOT + '/entdecken/">Wischen &amp; merken</a><a class="route" href="' + ROOT + '/termine/">Alle Termine</a></div></div>';
      merk.innerHTML = out; tools.hidden = !known.length;
      var y = document.getElementById("mkImpYes");
      if (y) { y.addEventListener("click", function () { var a2 = favGet(); imp.forEach(function (s) { if (DATA[s] && a2.indexOf(s) < 0) a2.push(s); }); if (favSet(a2)) { favSync(); say("Übernommen."); } imp = null; try { history.replaceState(null, "", location.pathname); } catch (e) {} render(); });
        document.getElementById("mkImpNo").addEventListener("click", function () { imp = null; try { history.replaceState(null, "", location.pathname); } catch (e) {} render(); }); }
    };

    /* Flohmarkt-Tour: Ab zwei gemerkten Märkten am selben Tag plant die Merkliste eine Route.
       Alles wird im Browser berechnet. Fahrzeiten sind Schätzungen für Hamburg (Stadt/Umland, Elbquerung, Parkplatzsuche, Umsteigen);
       die genaue Route zeigt Google Maps per Link. Gespeichert werden nur die Einstellungen (ohne Standort) im Browser. */
    var tourEl = document.getElementById("tour"), TK = "flohlotse-tour";
    var tSet = (function () { try { return JSON.parse(localStorage.getItem(TK) || "{}") || {}; } catch (e) { return {}; } })();
    var tSave = function () { try { localStorage.setItem(TK, JSON.stringify({ mode: tSet.mode, stay: tSet.stay, plz: tSet.plz })); } catch (e) {} };
    var WDN = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
    var kDate = function (k) { var p = k.split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); };
    var kLab = function (k) { var p = k.split("-"); return WDN[kDate(k).getUTCDay()] + ", " + p[2] + "." + p[1] + "."; };
    var toMin = function (t) { var p = String(t).split(":"); return +p[0] * 60 + (+p[1] || 0); };
    var fmtT = function (m) { m = Math.round(m); return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0"); };
    var km = function (a, b) { var R = 6371, r = Math.PI / 180, x = (b[0] - a[0]) * r, y = (b[1] - a[1]) * r; var h = Math.pow(Math.sin(x / 2), 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.pow(Math.sin(y / 2), 2); return 2 * R * Math.asin(Math.sqrt(h)); };
    // grobe Fahrzeit in Minuten
    var travel = function (a, b, mode, flagB) {
      var d = km(a, b), road = d * 1.3, inHH = function (p) { return p[0] > 53.39 && p[0] < 53.74 && p[1] > 9.73 && p[1] < 10.33; };
      var elbe = (a[0] - 53.535) * (b[0] - 53.535) < 0 && a[1] > 9.75 && a[1] < 10.15 && b[1] > 9.75 && b[1] < 10.15;
      var t;
      if (mode === "rad") t = road / 15 * 60 + 2 + (elbe ? 4 : 0);
      else if (mode === "bahn") t = 10 + road / 25 * 60 + (d > 5 ? 8 : 0) + (elbe ? 4 : 0);
      else t = road / (!(inHH(a) && inHH(b)) && d > 8 ? 45 : road > 6 ? 30 : 22) * 60 + (elbe ? 8 : 0) + ((flagB & 1) ? 8 : 3);
      return Math.max(5, Math.round(t / 5) * 5);
    };
    var dayTours = function (known) {
      var by = {}, lim = dayAdd(TODAY, 28);
      known.forEach(function (s) { var d = DATA[s], tz = d && d[12]; if (!tz || !d[11]) return; Object.keys(tz).forEach(function (k) { if (k >= TODAY && k <= lim) (by[k] = by[k] || []).push(s); }); });
      return Object.keys(by).filter(function (k) { return by[k].length > 1; }).sort().slice(0, 3).map(function (k) { return { k: k, ms: by[k] }; });
    };
    var tourCards = function (known) {
      var ts = dayTours(known); if (!ts.length) return "";
      var t = ts[0], first = Math.min.apply(null, t.ms.map(function (s) { return toMin(DATA[s][12][t.k][0]); }));
      return '<a class="tour-card" href="#tour-' + t.k + '"><span class="k">' + svg("route", "") + "Deine Tour</span><h2>" + kLab(t.k) + ": " + t.ms.length + " Märkte</h2><p>Ab " + fmtT(first).replace(/:00$/, "") + " Uhr · " + t.ms.map(function (s) { return esc2(DATA[s][7] || DATA[s][0]); }).join(", ") + '</p><span class="go">Tour planen' + svg("chev", "") + "</span></a>" +
        (ts.length > 1 ? '<p class="tour-more">Auch planbar: ' + ts.slice(1).map(function (x) { return '<a href="#tour-' + x.k + '">' + kLab(x.k) + "</a>"; }).join(" · ") + "</p>" : "");
    };
    // beste Reihenfolge: alle Reihenfolgen durchprobieren (höchstens 7 Märkte), Märkte, die nicht ins Zeitfenster passen, fallen raus
    var plan = function (k, ms, o) {
      var mk = ms.map(function (s) { var d = DATA[s], tz = d[12][k]; return { s: s, d: d, ll: d[11], open: toMin(tz[0]), close: tz[1] ? toMin(tz[1]) : toMin(tz[0]) + 240, flag: d[13] || 0 }; }).slice(0, 7);
      var best = null, perm = function (arr, used, res) {
        if (res.length === arr.length) { test(res.slice()); return; }
        for (var i = 0; i < arr.length; i++) if (!used[i]) { used[i] = true; res.push(arr[i]); perm(arr, used, res); res.pop(); used[i] = false; }
      };
      var test = function (order) {
        var t = o.from, pos = o.origin, stops = [], miss = [], dist = 0, wait = 0;
        order.forEach(function (m) {
          var tt = pos ? travel(pos, m.ll, o.mode, m.flag) : 0, arr = t + tt, start = Math.max(arr, m.open), leave = start + o.stay;
          if (leave > m.close || leave > o.to) { miss.push({ m: m, arr: arr }); return; }
          stops.push({ m: m, tt: tt, km: pos ? km(pos, m.ll) * 1.3 : 0, arr: arr, start: start, leave: leave, from: pos });
          dist += tt; if (pos) wait += start - arr; t = leave; pos = m.ll;
        });
        var sc = [stops.length, -(dist + wait * 0.3), -t];
        if (!best || sc[0] > best.sc[0] || (sc[0] === best.sc[0] && (sc[1] > best.sc[1] || (sc[1] === best.sc[1] && sc[2] > best.sc[2])))) best = { sc: sc, stops: stops, miss: miss, end: t };
      };
      perm(mk, [], []);
      return best;
    };
    var gmaps = function (a, b, mode) { return "https://www.google.com/maps/dir/?api=1" + (a ? "&origin=" + a[0] + "," + a[1] : "") + "&destination=" + b[0] + "," + b[1] + "&travelmode=" + ({ rad: "bicycling", bahn: "transit" }[mode] || "driving"); };
    var tourOpen = function (k) {
      var known = favGet().filter(function (s) { return DATA[s]; }), t = dayTours(known).filter(function (x) { return x.k === k; })[0];
      if (!t) { tourEl.hidden = true; merk.hidden = false; return; }
      var ms = t.ms, opens = ms.map(function (s) { return toMin(DATA[s][12][k][0]); }), closes = ms.map(function (s) { var z = DATA[s][12][k]; return z[1] ? toMin(z[1]) : toMin(z[0]) + 240; });
      var o = { from: Math.min.apply(null, opens), to: Math.max.apply(null, closes), stay: tSet.stay || 45, mode: tSet.mode || "auto", origin: null, label: "" };
      var opt = function (v, sel) { var h = ""; for (var m = 300; m <= 1320; m += 30) h += '<option value="' + m + '"' + (m === sel ? " selected" : "") + ">" + fmtT(m) + " Uhr</option>"; return h; };
      tourEl.innerHTML = '<p class="tour-back"><a href="#" id="tourBack">' + svg("chev", "flip") + 'Zur Merkliste</a></p><h2 class="tour-h">Deine Tour am ' + kLab(k).replace(",", "") + '</h2><p class="meta">' + ms.length + " gemerkte Märkte</p>" +
        '<div class="tplan"><div><p class="lab">Wo startest du?</p><div class="tstart"><button type="button" class="chip" id="tGeo">' + svg("route", "") + 'Mein Standort</button><span class="meta">oder</span><input id="tPlz" inputmode="numeric" maxlength="5" placeholder="PLZ" aria-label="Postleitzahl" value="' + esc2(tSet.plz || "") + '"></div></div>' +
        '<div class="row2"><label>Los geht\'s um<select id="tFrom">' + opt(0, Math.floor(o.from / 30) * 30) + '</select></label><label>Zeit bis<select id="tTo">' + opt(0, Math.ceil(o.to / 30) * 30) + "</select></label></div>" +
        '<div class="row2"><label>Pro Markt stöbern<select id="tStay">' + [30, 45, 60, 90].map(function (v) { return '<option value="' + v + '"' + (v === o.stay ? " selected" : "") + ">" + v + " Minuten</option>"; }).join("") + '</select></label><div><p class="lab">Unterwegs mit</p><div class="seg" id="tMode">' + [["auto", "Auto"], ["rad", "Rad"], ["bahn", "Bahn"]].map(function (x) { return '<button type="button" class="chip" data-m="' + x[0] + '" aria-pressed="' + (x[0] === o.mode) + '">' + x[1] + "</button>"; }).join("") + "</div></div></div></div>" +
        '<div id="tOut" aria-live="polite"></div>';
      tourEl.hidden = false; merk.hidden = true; tools.hidden = true;
      var out = document.getElementById("tOut");
      var draw = function () {
        o.from = +document.getElementById("tFrom").value; o.to = +document.getElementById("tTo").value; o.stay = +document.getElementById("tStay").value;
        var r = o.to <= o.from ? null : plan(k, ms, o), h = "";
        if (!r || !r.stops.length) { out.innerHTML = '<p class="tsum"><b>Das passt so nicht.</b> Im gewählten Zeitfenster schaffst du keinen der Märkte. Wähl eine andere Uhrzeit.</p>'; return; }
        var free = o.to - r.end, dep = o.from;
        // Mit Startpunkt: nicht zu früh losschicken, sondern so, dass man pünktlich zur Öffnung des ersten Markts da ist
        if (o.origin && r.stops[0].start > r.stops[0].arr) { dep = r.stops[0].start - r.stops[0].tt; r.stops[0].arr = r.stops[0].start; }
        h += '<p class="tsum"><b>' + (r.miss.length ? r.stops.length + " von " + ms.length + " Märkten passen." : (ms.length === 2 ? "Beide Märkte passen." : "Alle " + ms.length + " Märkte passen.")) + "</b> Fertig gegen " + fmtT(r.end) + " Uhr" + (free >= 30 && free <= 180 ? ", danach bleiben dir " + (free >= 90 ? Math.round(free / 60) + " Stunden" : free + " Minuten") + " Puffer." : ".") + "</p><ol class=\"tour\">";
        if (o.origin) h += '<li><span class="n home">' + svg("pin", "") + '</span><div class="c home"><h3>Start: ' + esc2(o.label) + " · losfahren um " + fmtT(dep) + " Uhr</h3></div></li>";
        r.stops.forEach(function (st, i) {
          var d = st.m.d;
          if (st.from) h += '<li class="legrow"><span class="leg">↓ ca. ' + Math.max(1, Math.round(st.km)) + " km · rund " + st.tt + ' Min. <a href="' + gmaps(st.from, st.m.ll, o.mode) + '" rel="noopener">Genau prüfen</a></span></li>';
          h += '<li><span class="n">' + (i + 1) + '</span><div class="c"><h3><a href="' + ROOT + "/flohmarkt/" + st.m.s + '/">' + esc2(d[0]) + "</a></h3><p><b>" + esc2(d[1]) + "</b> · geöffnet " + fmtT(st.m.open).replace(/:00$/, "") + " bis " + fmtT(st.m.close).replace(/:00$/, "") + ' Uhr</p><p class="arr"><span class="time">' + svg("clock", "") + '<span class="t-main">' + fmtT(st.start) + "–" + fmtT(st.leave) + '</span><span class="t-u">Uhr</span></span>' + (st.start > st.arr + 4 ? '<span class="meta">Ankunft ' + fmtT(st.arr) + (st.start - st.arr > 15 ? ", öffnet um " + fmtT(st.start) + " Uhr" : ", kurz warten") + "</span>" : "") + "</p></div></li>";
        });
        h += "</ol>";
        if (r.miss.length) h += '<div class="tour-miss">' + r.miss.map(function (x) { return "<b>" + esc2(x.m.d[0]) + "</b> passt zeitlich nicht mehr (geöffnet bis " + fmtT(x.m.close) + " Uhr)."; }).join("<br>") + "</div>";
        var pts = r.stops.map(function (st) { return st.m.ll; }), whole = o.mode === "bahn" ? "" : "https://www.google.com/maps/dir/?api=1" + (o.origin ? "&origin=" + o.origin[0] + "," + o.origin[1] : "&origin=" + pts[0][0] + "," + pts[0][1]) + "&destination=" + pts[pts.length - 1][0] + "," + pts[pts.length - 1][1] + (pts.length > (o.origin ? 1 : 2) ? "&waypoints=" + pts.slice(o.origin ? 0 : 1, -1).map(function (p) { return p[0] + "," + p[1]; }).join("|") : "") + "&travelmode=" + (o.mode === "rad" ? "bicycling" : "driving");
        h += '<div class="tour-actions">' + (whole ? '<a class="btn" href="' + whole + '" rel="noopener">' + svg("route", "") + "Ganze Tour in Google Maps öffnen</a>" : "") + '<button type="button" class="route" id="tShare">' + svg("share", "") + "Tour teilen</button></div>";
        h += '<p class="tour-note">' + (o.mode === "bahn" ? "Mit der Bahn bitte jeden Abschnitt über „Genau prüfen“ ansehen, dort steht die genaue Verbindung. " : "") + "Fahrzeiten sind grob geschätzt" + (o.mode === "auto" ? ", inklusive Parkplatzsuche" : "") + ". Die genaue Route zeigt Google Maps. " + (o.origin ? "Dein Standort bleibt auf deinem Gerät." : "Ohne Startpunkt beginnt die Tour am ersten Markt.") + "</p>";
        out.innerHTML = h;
        document.getElementById("tShare").addEventListener("click", function () {
          var txt = "Meine Flohmarkt-Tour am " + kLab(k).replace(",", "") + ":\n" + r.stops.map(function (st, i) { return (i + 1) + ". " + fmtT(st.start) + " Uhr " + st.m.d[0] + " (" + st.m.d[1] + ")"; }).join("\n") + "\n" + location.origin + ROOT + "/termine/";
          if (navigator.share) { navigator.share({ title: "Meine Flohmarkt-Tour", text: txt }).catch(function () {}); return; }
          if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast("Tour kopiert. Jetzt einfügen und verschicken."); }, function () {}); });
      };
      ["tFrom", "tTo", "tStay"].forEach(function (id) { document.getElementById(id).addEventListener("change", function () { if (id === "tStay") { tSet.stay = +this.value; tSave(); } draw(); }); });
      document.getElementById("tMode").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; o.mode = tSet.mode = b.getAttribute("data-m"); tSave(); this.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); draw(); });
      var geoB = document.getElementById("tGeo"), plzI = document.getElementById("tPlz");
      var setO = function (ll, lab, isGeo) { o.origin = ll; o.label = lab; geoB.setAttribute("aria-pressed", String(!!isGeo)); draw(); };
      geoB.addEventListener("click", function () {
        if (geoB.getAttribute("aria-pressed") === "true") { setO(null, "", false); return; }
        if (!navigator.geolocation) { toast("Dein Browser kann den Standort nicht bestimmen. Gib stattdessen deine Postleitzahl ein."); return; }
        navigator.geolocation.getCurrentPosition(function (p) { plzI.value = ""; setO([p.coords.latitude, p.coords.longitude], "dein Standort", true); }, function () { toast("Standort nicht verfügbar. Gib stattdessen deine Postleitzahl ein."); }, { timeout: 10000, maximumAge: 600000 });
      });
      var byPlz = function () {
        var v = plzI.value.replace(/\D/g, "").slice(0, 5); plzI.value = v; if (v.length < 5) { if (!v && geoB.getAttribute("aria-pressed") !== "true") setO(null, "", false); return; }
        fetch(ROOT + "/assets/plz.json").then(function (r) { return r.json(); }).then(function (j) { if (!j[v]) { toast("Die Postleitzahl " + v + " liegt außerhalb unseres Gebiets."); return; } tSet.plz = v; tSave(); setO(j[v], "PLZ " + v, false); }).catch(function () {});
      };
      plzI.addEventListener("input", function () { if (plzI.value.replace(/\D/g, "").length === 5 || !plzI.value) byPlz(); });
      document.getElementById("tourBack").addEventListener("click", function (e) { e.preventDefault(); try { history.pushState(null, "", location.pathname); } catch (x) {} tourEl.hidden = true; merk.hidden = false; render(); window.scrollTo(0, 0); });
      if (tSet.plz && tSet.plz.length === 5) byPlz(); else draw();
      tourEl.scrollIntoView ? window.scrollTo(0, 0) : 0;
    };
    var tourHash = function () { var m = /^#tour-(\d{4}-\d{2}-\d{2})$/.exec(location.hash); if (m && DATA) tourOpen(m[1]); else if (tourEl && !tourEl.hidden) { tourEl.hidden = true; merk.hidden = false; render(); } };
    window.addEventListener("hashchange", tourHash);
    // Herz auf der Merkliste: Markt entfernen, mit „Rückgängig“
    merk.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-fav]"); if (!b) return;
      var s = b.getAttribute("data-fav"), n = b.getAttribute("data-name");
      setTimeout(function () { if (!favHas(s)) { render(); say("„" + esc2(n) + "“ entfernt. "); var u = document.createElement("button"); u.type = "button"; u.className = "linkish"; u.textContent = "Rückgängig"; u.addEventListener("click", function () { favToggle(s, true); say(""); render(); }); msg.appendChild(u); } }, 0);
    });
    document.addEventListener("flfav", function () { if (!merk.contains(document.activeElement)) render(); });
    document.getElementById("merkLink").addEventListener("click", function () {
      var a = favGet().filter(function (s) { return DATA && DATA[s]; }); if (!a.length) return;
      var url = location.origin + ROOT + "/merkliste/#m=" + a.join(",");
      if (navigator.share) { navigator.share({ title: "Meine Flohmarkt-Merkliste", url: url }).catch(function () {}); return; }
      var ok = function () { say("Link kopiert. Schick ihn dir selbst, dann hast du deine Merkliste überall."); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(ok, function () { prompt("Link zur Merkliste:", url); }); else prompt("Link zur Merkliste:", url);
    });
    document.getElementById("merkClear").addEventListener("click", function () {
      if (!confirm("Merkliste wirklich leeren? Das lässt sich nicht rückgängig machen.")) return;
      favSet([]); favSync(); say("Die Merkliste ist leer."); render();
    });
    fetch(merk.getAttribute("data-src")).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (j) { DATA = j.m || {}; render(); tourHash(); })
      .catch(function () { merk.innerHTML = '<div class="empty">Die Merkliste konnte gerade nicht geladen werden. Versuch es gleich noch einmal.</div>'; });
  }

  // Wischen & merken: Karten der nächsten vier Wochen. Rechts = merken, links = weiter (wird nicht gespeichert).
  var deck = document.getElementById("deck"), stack = document.getElementById("dkStack");
  if (deck && stack && !deck.hidden && !favOk) {
    document.getElementById("dkBtns").hidden = true;
    var nt = document.createElement("p"); nt.className = "empty"; nt.textContent = "Dein Browser lässt hier nichts speichern, zum Beispiel im privaten Fenster. Deshalb gibt es die Märkte hier als Liste."; deck.insertBefore(nt, stack);
  }
  if (deck && stack && favOk && !deck.hidden) {
    var all = Array.prototype.slice.call(stack.querySelectorAll(".dk-card")), RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    all = all.filter(function (c) {
      var k = c.getAttribute("data-day"), e = c.getAttribute("data-e");
      var ok = NOW ? (k === TODAY && !(e && NOW.hm >= e)) || k > TODAY : true;
      if (!ok) c.remove(); else { var dd = c.querySelector(".dk-day"); if (dd && (k === TODAY || k === TOMORROW)) dd.textContent = (k === TODAY ? "Heute · " : "Morgen · ") + dd.textContent; }
      return ok;
    });
    if (!all.length) { deck.hidden = true; document.getElementById("dkEmpty").hidden = false; var dkSec = document.getElementById("dkSec"); if (dkSec) dkSec.hidden = true; }
    else {
      deck.classList.add("on");
      var cnt = document.getElementById("dkCount"), btnY = document.getElementById("dkYes"), btnN = document.getElementById("dkNo"), btnU = document.getElementById("dkUndo"), done = document.getElementById("dkDone"), hist = [], idx = 0, busy = false;
      all.forEach(function (c) { if (favHas(c.getAttribute("data-fav"))) { var h = document.createElement("span"); h.className = "dk-had"; h.textContent = "Schon auf deiner Merkliste"; c.insertBefore(h, c.firstChild); } });
      var fit = function () { var h = 0; stack.style.height = ""; deck.classList.add("measure"); all.forEach(function (c) { h = Math.max(h, c.offsetHeight); }); deck.classList.remove("measure"); if (h) stack.style.height = (h + 18) + "px"; };
      var lay = function () {
        all.forEach(function (c, i) { var r = i - idx; c.className = "dk-card " + (r < 0 ? "gone" : r === 0 ? "c0" : r === 1 ? "c1" : r === 2 ? "c2" : "cx"); if (r !== 0) { c.style.transform = ""; c.style.opacity = ""; } c.setAttribute("aria-hidden", String(r !== 0)); c.querySelectorAll("a").forEach(function (a) { a.tabIndex = r === 0 ? 0 : -1; }); });
        var end = idx >= all.length; done.hidden = !end; stack.hidden = end; document.getElementById("dkBtns").hidden = end; btnU.disabled = !hist.length;
        if (!end) cnt.textContent = (idx + 1) + " von " + all.length;
        else { var n = hist.filter(function (x) { return x.dir > 0; }).length; cnt.textContent = ""; document.getElementById("dkDoneP").textContent = n ? "Du hast " + (n === 1 ? "einen Markt" : n + " Märkte") + " gemerkt. Alle stehen auf deiner Merkliste." : "Diesmal war nichts für dich dabei. Alle Termine der nächsten Wochen findest du im Kalender."; }
      };
      var stamp = function (c, dx) { var y = c.querySelector(".dk-stamp.yes"), n = c.querySelector(".dk-stamp.no"), v = Math.max(-1, Math.min(1, dx / 90)); y.style.opacity = v > 0 ? v : 0; n.style.opacity = v < 0 ? -v : 0; c.classList.toggle("to-yes", v > 0.35); c.classList.toggle("to-no", v < -0.35); };
      var decide = function (dir) {
        if (busy || idx >= all.length) return; var c = all[idx], s = c.getAttribute("data-fav"), was = favHas(s);
        if (dir > 0 && favToggle(s, true) === null) return;
        hist.push({ dir: dir, was: was }); busy = true; stamp(c, dir * 120);
        var fin = function () { busy = false; idx++; lay(); };
        if (RM) return fin();
        c.style.transition = "transform .32s ease-in, opacity .32s ease-in"; c.style.transform = "translate(" + (dir * 1.4 * stack.offsetWidth) + "px, 30px) rotate(" + (dir * 24) + "deg)"; c.style.opacity = "0";
        setTimeout(fin, 330);
      };
      var undo = function () {
        if (busy || !hist.length) return; var h = hist.pop(); idx--; var c = all[idx];
        if (h.dir > 0 && !h.was) favToggle(c.getAttribute("data-fav"), false);
        c.style.transition = "none"; c.style.transform = ""; c.style.opacity = ""; stamp(c, 0); lay();
      };
      btnY.addEventListener("click", function () { decide(1); });
      btnN.addEventListener("click", function () { decide(-1); });
      btnU.addEventListener("click", undo);
      document.getElementById("dkAgain").addEventListener("click", function () { hist = []; idx = 0; all.forEach(function (c) { c.style.transition = "none"; c.style.transform = ""; c.style.opacity = ""; stamp(c, 0); }); lay(); fit(); });
      if (deck.hasAttribute("data-keys")) document.addEventListener("keydown", function (e) { if (deck.hidden || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || "") || e.altKey || e.ctrlKey || e.metaKey) return; if (e.key === "ArrowRight") { e.preventDefault(); decide(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); decide(-1); } });
      // Ziehen mit Finger oder Maus (senkrecht scrollt die Seite weiter)
      var drag = null, noClick = 0;
      stack.addEventListener("click", function (e) { if (Date.now() - noClick < 450) { e.preventDefault(); e.stopPropagation(); } }, true);
      stack.addEventListener("pointerdown", function (e) {
        var c = e.target.closest(".dk-card.c0"); if (!c || busy || (e.pointerType === "mouse" && e.button !== 0)) return;
        drag = { c: c, x: e.clientX, y: e.clientY, t: Date.now(), dx: 0, dy: 0, id: e.pointerId, moved: false };
      });
      stack.addEventListener("pointermove", function (e) {
        if (!drag || e.pointerId !== drag.id) return; drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y;
        if (!drag.moved) { if (Math.abs(drag.dx) < 8) return; if (Math.abs(drag.dy) > Math.abs(drag.dx)) { drag = null; return; } drag.moved = true; try { drag.c.setPointerCapture(e.pointerId); } catch (x) {} drag.c.style.transition = "none"; }
        drag.c.style.transform = "translate(" + drag.dx + "px," + (drag.dy * 0.2) + "px) rotate(" + (drag.dx / 18) + "deg)"; stamp(drag.c, drag.dx);
      });
      var end = function (e) {
        if (!drag || e.pointerId !== drag.id) return; var d = drag; drag = null; if (!d.moved) return;
        var v = Math.abs(d.dx) / Math.max(1, Date.now() - d.t), thr = Math.min(100, stack.offsetWidth * 0.25);
        if (Math.abs(d.dx) > thr || (v > 0.6 && Math.abs(d.dx) > 40)) decide(d.dx > 0 ? 1 : -1);
        else { d.c.style.transition = RM ? "none" : "transform .2s ease-out"; d.c.style.transform = ""; stamp(d.c, 0); }
        noClick = Date.now();
      };
      stack.addEventListener("pointerup", end); stack.addEventListener("pointercancel", function (e) { if (drag && e.pointerId === drag.id) { var c = drag.c; drag = null; c.style.transition = "transform .2s ease-out"; c.style.transform = ""; stamp(c, 0); } });
      lay(); fit(); window.addEventListener("resize", fit);
      // Beim ersten Laden stupst die oberste Karte einmal nach rechts und links: So sieht man, dass sie sich wischen lässt
      // Auf der Startseite erst, wenn der Stapel ins Bild kommt
      var nudge = function () { var c = all[idx]; if (!c || drag || busy || hist.length) return; c.classList.add("nudge"); setTimeout(function () { c.classList.remove("nudge"); }, 1700); };
      if (!RM) { if ("IntersectionObserver" in window) { var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { io.disconnect(); setTimeout(nudge, 500); } }, { threshold: 0.6 }); io.observe(stack); } else setTimeout(nudge, 700); }
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    }
  }

  // Kasten „Aktuell“ auf der Startseite: Reiter zum Anklicken, blättert alle 7 Sekunden weiter.
  // Pause bei Maus darüber, Fokus darin, verstecktem Tab oder wenn der Kasten nicht zu sehen ist. Nach einem Klick auf einen Reiter bleibt er stehen.
  var news = document.getElementById("news");
  if (news) {
    var tabs = Array.prototype.slice.call(news.querySelectorAll(".akt-tab")), pans = Array.prototype.slice.call(news.querySelectorAll(".akt-p")), bar = document.getElementById("newsBar"), pBtn = document.getElementById("newsPause");
    var cur = 0, auto = tabs.length > 1 && !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches), hover = false, focus = false, seen = true, timer = 0, left = 7000, t0 = 0, DUR = 7000;
    news.classList.add("on");
    var show = function (i, byUser) {
      cur = (i + tabs.length) % tabs.length;
      tabs.forEach(function (t, k) { t.setAttribute("aria-selected", String(k === cur)); t.tabIndex = k === cur ? 0 : -1; });
      pans.forEach(function (p, k) { p.classList.toggle("act", k === cur); p.setAttribute("aria-hidden", String(k !== cur)); });
      if (byUser) { auto = false; syncBtn(); }
      left = DUR; run();
    };
    var running = function () { return auto && !hover && !focus && seen && !document.hidden; };
    var run = function () {
      clearTimeout(timer);
      if (bar) { bar.style.transition = "none"; bar.style.width = (100 * (1 - left / DUR)) + "%"; void bar.offsetWidth; }
      if (!running()) { news.classList.toggle("paused", auto); return; }
      news.classList.remove("paused"); t0 = Date.now();
      if (bar) { bar.style.transition = "width " + left + "ms linear"; bar.style.width = "100%"; }
      timer = setTimeout(function () { show(cur + 1); }, left);
    };
    var hold = function () { if (timer && t0) { left = Math.max(300, left - (Date.now() - t0)); } clearTimeout(timer); timer = 0; t0 = 0; run(); };
    var syncBtn = function () { if (!pBtn) return; pBtn.setAttribute("aria-pressed", String(!auto)); pBtn.setAttribute("aria-label", auto ? "Automatisches Weiterblättern anhalten" : "Automatisch weiterblättern"); news.classList.toggle("stopped", !auto); };
    tabs.forEach(function (t, k) { t.addEventListener("click", function () { show(k, true); }); });
    news.querySelector(".akt-tabs").addEventListener("keydown", function (e) { var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (!d) return; e.preventDefault(); show(cur + d, true); tabs[cur].focus(); });
    if (pBtn) pBtn.addEventListener("click", function () { auto = !auto; syncBtn(); if (auto) { left = DUR; show(cur + 1); } else hold(); });
    news.addEventListener("mouseenter", function () { hover = true; hold(); });
    news.addEventListener("mouseleave", function () { hover = false; run(); });
    news.addEventListener("focusin", function () { focus = true; hold(); });
    news.addEventListener("focusout", function (e) { if (!news.contains(e.relatedTarget)) { focus = false; run(); } });
    document.addEventListener("visibilitychange", function () { if (document.hidden) hold(); else run(); });
    if ("IntersectionObserver" in window) new IntersectionObserver(function (en) { seen = en[0].isIntersecting; if (seen) run(); else hold(); }, { threshold: 0.5 }).observe(news);
    // Wischen über den Kasten blättert vor oder zurück
    var sx = null, sy = 0, panEl = document.getElementById("newsPanels");
    panEl.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    panEl.addEventListener("touchend", function (e) { if (sx === null) return; var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(cur + (dx < 0 ? 1 : -1), true); }, { passive: true });
    syncBtn(); show(0);
  }
  // Suchfeld auf der Startseite: öffnet die Suche, der Begriff steht hinter dem # (wird nicht an den Server geschickt)
  document.querySelectorAll(".sx-home").forEach(function (f) {
    f.addEventListener("submit", function (e) { e.preventDefault(); var v = (f.querySelector("input").value || "").trim().slice(0, 80); location.href = ROOT + "/suche/" + (v ? "#q=" + encodeURIComponent(v) : ""); });
  });
  /* Suche (Seite /suche/): nach Name, Stadtteil, Veranstalter oder Datum. Läuft komplett im Browser mit /assets/maerkte.json,
     es wird nichts an den Server geschickt. Das Suchfeld ist die einzige Quelle: Auch die Tag-Knöpfe schreiben nur hinein. */
  (function () {
    var out = document.getElementById("sxOut"); if (!out) return;
    var q = document.getElementById("sxQ"), form = document.getElementById("sxForm"), msg = document.getElementById("sxMsg"), clr = document.getElementById("sxClear"),
      pick = document.getElementById("sxDate"), days = document.getElementById("sxDays"), az = document.getElementById("sxAz"), tip = document.getElementById("sxTip");
    var D = null, MO = {}, BIS = "", IDX = [], LIMIT = 12, showAll = false;
    var WDN = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
    var MONN = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
    var MSL = ["januar", "februar", "maerz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
    var spr = (function () { var u = document.querySelector(".fav-top use, .srch-top use"); return u ? u.getAttribute("href").replace(/#.*$/, "") : ROOT + "/assets/icons.svg"; })();
    var svg = function (id, cls) { return '<svg class="i' + (cls ? " " + cls : "") + '" aria-hidden="true" focusable="false"><use href="' + spr + "#i-" + id + '"/></svg>'; };
    var norm = function (t) { return String(t || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); };
    var STOP = {}; ("flohmarkt flohmaerkte flohmarkte flohmarkts flomarkt floh markt maerkte troedelmarkt der die das dem den des ein eine am an im in auf bei und von vom zum zur fuer mit findet statt wann wo ist gibt es hamburg hh naechster naechste termin termine offen geoeffnet").split(" ").forEach(function (w) { STOP[w] = 1; });
    var ymd = function (y, m, d) { var x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x.toISOString().slice(0, 10) : null; };
    var wdOf = function (k) { var p = k.split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); };
    var longDay = function (k) { var p = k.split("-"); return WDN[wdOf(k)] + ", " + (+p[2]) + ". " + MONN[+p[1] - 1] + (p[0] !== TODAY.slice(0, 4) ? " " + p[0] : ""); };
    var nextWd = function (wd) { var k = TODAY; for (var i = 0; i < 7; i++) { if (wdOf(k) === wd) return k; k = dayAdd(k, 1); } return k; };
    var weekend = function () { var w = wdOf(TODAY); if (w === 0) return [TODAY]; var sa = nextWd(6); return [sa, dayAdd(sa, 1)]; };
    // Jahr ergänzen: ein Tag ohne Jahr meint den nächsten; liegt er höchstens zwei Wochen zurück, ist dieses Jahr gemeint („schon vorbei“).
    var withYear = function (d, m, y) {
      if (y) { y = +y; if (y < 100) y += 2000; return ymd(y, m, d); }
      var cy = +TODAY.slice(0, 4), k = ymd(cy, m, d); if (!k) return null;
      return k < dayAdd(TODAY, -14) ? ymd(cy + 1, m, d) : k;
    };
    var MONRE = "(jan(?:uar)?|feb(?:ruar)?|m(?:ae|a)?rz|mär(?:z)?|apr(?:il)?|mai|juni?|juli?|aug(?:ust)?|sept?(?:ember)?|okt(?:ober)?|nov(?:ember)?|dez(?:ember)?)";
    var monIdx = function (s) { s = s.replace("ä", "ae"); var keys = ["jan", "feb", "m", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"]; if (/^m(ae|a)?r|^mrz/.test(s)) return 2; for (var i = 0; i < 12; i++) if (i !== 2 && s.indexOf(keys[i]) === 0) return i; return -1; };
    // Datum aus der Eingabe lesen. Ergebnis: { days: [...], bad, month } und der Rest als Namenssuche
    var parse = function (raw) {
      var s = " " + raw.toLowerCase().replace(/\s+/g, " ") + " ", r = { days: null, bad: false, month: null }, m;
      var cut = function (x) { s = s.replace(x, " "); };
      if ((m = /(\d{4})-(\d{2})-(\d{2})/.exec(s))) { r.days = [ymd(+m[1], +m[2], +m[3])]; cut(m[0]); }
      else if ((m = /(^|[^\d.])(\d{1,2})\.\s?(\d{1,2})\.?(?:\s?(\d{4}|\d{2})(?![\d.]))?(?!\d)/.exec(s))) { r.days = [withYear(+m[2], +m[3], m[4])]; s = s.replace(m[0], m[1] + " "); }
      else if ((m = new RegExp("(^|\\s)(\\d{1,2})\\.?\\s?" + MONRE + "\\.?(?:\\s(\\d{4}))?(?=\\s|$)").exec(s)) && monIdx(m[3]) > -1) { r.days = [withYear(+m[2], monIdx(m[3]) + 1, m[4])]; cut(m[0]); }
      else if ((m = /\s(ue|ü)bermorgen\s/.exec(s))) { r.days = [dayAdd(TODAY, 2)]; cut(m[0]); }
      else if ((m = /\sheute\s/.exec(s))) { r.days = [TODAY]; cut(m[0]); }
      else if ((m = /\smorgen\s/.exec(s))) { r.days = [TOMORROW]; cut(m[0]); }
      else if ((m = /\s(diese[sn]?\s|am\s|naechste[sn]?\s|nächste[sn]?\s)?wochenende\s/.exec(s))) { r.days = weekend(); r.we = true; cut(m[0]); }
      else if ((m = /\s(sonntag|so|montag|mo|dienstag|di|mittwoch|mi|donnerstag|do|freitag|fr|samstag|sonnabend|sa)\.?\s/.exec(s))) {
        var w = { so: 0, sonntag: 0, mo: 1, montag: 1, di: 2, dienstag: 2, mi: 3, mittwoch: 3, "do": 4, donnerstag: 4, fr: 5, freitag: 5, sa: 6, samstag: 6, sonnabend: 6 }[m[1]];
        // „so“, „mo“, „di“ … nur als Tag lesen, wenn sonst nichts Längeres dasteht (sonst könnten es Wortteile sein)
        if (m[1].length > 2 || !norm(s.replace(m[0], " ")).split(" ").filter(function (t) { return t && !STOP[t]; }).length) { r.days = [nextWd(w)]; cut(m[0]); }
      }
      if (!r.days && (m = new RegExp("(^|\\s)" + MONRE + "\\.?(?:\\s(\\d{4}))?(?=\\s|$)").exec(s)) && monIdx(m[2]) > -1 && m[2].length >= 3) {
        var mi = monIdx(m[2]), y = m[3] ? +m[3] : +TODAY.slice(0, 4); if (!m[3] && mi + 1 < +TODAY.slice(5, 7)) y++;
        r.month = y + "-" + ("0" + (mi + 1)).slice(-2); cut(m[0]);
      }
      if (r.days && !r.days[0]) { r.bad = true; r.days = null; }
      r.toks = norm(s).split(" ").filter(function (t) { return t && !STOP[t]; });
      return r;
    };
    // Tippfehler zulassen: Abstand nach Damerau-Levenshtein (Vertauschen zählt als ein Fehler)
    var lev = function (a, b) {
      if (Math.abs(a.length - b.length) > 2) return 9;
      var d = [], i, j; for (i = 0; i <= a.length; i++) { d[i] = [i]; } for (j = 0; j <= b.length; j++) d[0][j] = j;
      for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) {
        var c = a[i - 1] === b[j - 1] ? 0 : 1; d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
      return d[a.length][b.length];
    };
    var build = function () {
      IDX = Object.keys(D).map(function (s) {
        var x = D[s], f = [[x[0], 10, "n"], [x[7], 10, "n"], [x[1], 6, "a"], [x[8], 5, "a"], [x[6], 4, "b"], [x[5], 4, "o"], [x[9], 2, "a"], [(x[10] || []).join(" "), 3, "t"], [s.replace(/-/g, " "), 2, "n"]];
        return { s: s, x: x, f: f.filter(function (y) { return y[0]; }).map(function (y) { var t = norm(y[0]); return { t: t, ws: t.split(" "), w: y[1], k: y[2] }; }) };
      });
    };
    var tokHit = function (tok, it) {
      var best = 0, kind = "";
      it.f.forEach(function (fl) {
        var sc = 0;
        if (fl.ws.indexOf(tok) > -1) sc = fl.w * 1.25;
        else if ((" " + fl.t).indexOf(" " + tok) > -1) sc = fl.w;
        else if (tok.length >= 3 && fl.t.indexOf(tok) > -1) sc = fl.w * 0.8;
        else if (tok.length >= 4) {
          var lim = tok.length >= 8 ? 2 : 1;
          fl.ws.forEach(function (w) {
            if (w.length < 3) return;
            var dm = Math.min(lev(tok, w), lev(tok, w.slice(0, tok.length)), lev(tok, w.slice(0, tok.length + 1)), tok.length > 4 ? lev(tok, w.slice(0, tok.length - 1)) : 9);
            if (dm <= lim) sc = Math.max(sc, fl.w * (dm === 1 ? 0.6 : 0.4));
          });
        }
        if (sc > best) { best = sc; kind = fl.k; }
      });
      return [best, kind];
    };
    var future = function (x) { return (x[4] || x[3] || []).filter(function (e) { return e[0] >= TODAY; }); };
    var short = function (t) { return String(t || "").replace(/ bis /, "–").replace(/ Uhr$/, " Uhr"); };
    var favB = function (s, n) { return favOk ? '<button type="button" class="fav" data-fav="' + s + '" data-name="' + esc2(n) + '" aria-pressed="false" aria-label="' + esc2(n) + ' merken">' + svg("heart", "ho") + svg("heartfill", "hf") + "</button>" : ""; };
    var dayLink = function (k) {
      if (k === TODAY) return [ROOT + "/heute/", "Alle Märkte von heute"]; if (k === TOMORROW) return [ROOT + "/morgen/", "Alle Märkte von morgen"];
      var p = k.split("-"), mp = MO[p[0] + "-" + p[1]]; return mp ? [ROOT + mp + "#" + (+p[2]) + "-" + MSL[+p[1] - 1], "Diesen Tag im Monatskalender ansehen"] : null;
    };
    var tval = function (t) { var m = /(\d{1,2})(?::(\d{2}))?/.exec(t || ""); return m ? +m[1] + (+m[2] || 0) / 60 : 99; };
    // Märkte an einem Tag
    var onDay = function (k) {
      var rows = [];
      IDX.forEach(function (it) { (it.x[4] || []).forEach(function (e) { if (e[0] === k) rows.push({ it: it, e: e }); }); });
      return rows.sort(function (a, b) { var oa = a.e[1] === "fällt aus" ? 1 : 0, ob = b.e[1] === "fällt aus" ? 1 : 0; return oa - ob || tval(a.e[1]) - tval(b.e[1]) || a.it.x[0].localeCompare(b.it.x[0], "de"); });
    };
    var nextDaysWith = function (from, n) { var seen = {}, list = []; IDX.forEach(function (it) { (it.x[4] || []).forEach(function (e) { if (e[0] > from && e[1] !== "fällt aus" && !seen[e[0]]) { seen[e[0]] = 1; list.push(e[0]); } }); }); return list.sort().slice(0, n); };
    var dayChips = function (ks) { return '<div class="chips">' + ks.map(function (k) { return '<button type="button" class="chip" data-q="' + qOf(k) + '">' + svg("cal") + esc2(dayLab(k)) + "</button>"; }).join("") + "</div>"; };
    var qOf = function (k) { var p = k.split("-"); return (+p[2]) + "." + (+p[1]) + "." + (p[0] !== TODAY.slice(0, 4) ? p[0] : ""); };
    var renderDay = function (k) {
      var rows = onDay(k), open = rows.filter(function (r) { return r.e[1] !== "fällt aus"; }).length, lk = dayLink(k), h = '<section class="sx-day"><div class="sx-dh"><h2>' + esc2(longDay(k)) + "</h2>";
      if (k < TODAY) return h + '</div><div class="empty sx-empty"><p><b>Dieser Tag ist schon vorbei.</b></p><p>Die nächsten Flohmärkte:</p>' + dayChips(nextDaysWith(dayAdd(TODAY, -1), 4)) + "</div></section>";
      if (!rows.length) {
        var far = BIS && k > BIS;
        return h + '</div><div class="empty sx-empty"><p><b>An diesem Tag steht noch kein Flohmarkt im Kalender.</b></p><p>' + (far ? "So weit im Voraus sind meist noch keine Termine bekannt. Schau später noch einmal rein." : "Neue Termine kommen laufend dazu.") + "</p>" + (nextDaysWith(k, 1).length ? "<p>Die nächsten Tage mit Flohmarkt:</p>" + dayChips(nextDaysWith(k, 4)) : "") + "</div></section>";
      }
      return h + '<span class="meta">' + (open === 1 ? "1 Flohmarkt" : open + " Flohmärkte") + "</span></div><div class=\"sx-rows\">" + rows.map(function (r) {
        var x = r.it.x, off = r.e[1] === "fällt aus";
        return '<article class="sx-row' + (off ? " off" : "") + '"><span class="sx-t' + (off ? " off" : r.e[1] ? "" : " na") + '">' + esc2(off ? "fällt aus" : r.e[1] ? short(r.e[1]) : "Uhrzeit folgt") + '</span><div class="sx-rb"><a href="' + ROOT + "/flohmarkt/" + r.it.s + '/">' + esc2(x[0]) + '</a><span class="meta">' + esc2(x[1]) + (r.e[2] ? " · " + esc2(r.e[2]) : "") + "</span></div>" + favB(r.it.s, x[7] || x[0]) + "</article>";
      }).join("") + "</div>" + (lk ? '<a class="more-link" href="' + lk[0] + '">' + lk[1] + svg("chev") + "</a>" : "") + "</section>";
    };
    // Antwort auf „Findet … statt?“: nächster Termin oder der gefragte Tag
    var card = function (it, p, kinds) {
      var x = it.x, fu = future(x), ans = "", rest = fu, note = "";
      var k0 = p.days ? p.days[0] : null;
      if (k0) {
        var lab = p.days.length > 1 ? "Am Wochenende" : k0 === TODAY ? "Heute" : k0 === TOMORROW ? "Morgen" : "Am " + dayLab(k0);
        var hits = fu.filter(function (e) { return p.days.indexOf(e[0]) > -1; });
        if (hits.length) {
          var e0 = hits[0], off = e0[1] === "fällt aus";
          ans = '<p class="sx-ans' + (off ? " off" : "") + '"><span class="kicker">' + esc2(lab) + "</span><b>" + (off ? "Fällt aus" : "Ja" + (p.days.length > 1 ? ", " + esc2(dayLab(e0[0])) : "")) + "</b>" + (off ? "" : esc2(e0[1] || "Uhrzeit folgt")) + "</p>";
          note = e0[2] || ""; rest = fu.filter(function (e) { return e[0] !== e0[0]; });
        } else {
          var nx = fu.filter(function (e) { return e[0] > k0 && e[1] !== "fällt aus"; })[0];
          ans = '<p class="sx-ans none"><span class="kicker">' + esc2(lab) + "</span>Kein Termin." + (nx ? " Nächster: <strong>" + esc2(dayLab(nx[0])) + "</strong>" + (nx[1] ? ", " + esc2(nx[1]) : "") : "") + "</p>";
        }
      } else if (p.month) {
        var inM = fu.filter(function (e) { return e[0].slice(0, 7) === p.month; }), mn = MONN[+p.month.slice(5) - 1];
        ans = inM.length ? '<p class="sx-ans"><span class="kicker">Im ' + mn + "</span><b>" + inM.filter(function (e) { return e[1] !== "fällt aus"; }).length + (inM.length === 1 ? " Termin" : " Termine") + "</b>" + esc2(inM.slice(0, 3).map(function (e) { return dayLab(e[0]); }).join(", ")) + (inM.length > 3 ? " …" : "") + "</p>"
          : '<p class="sx-ans none"><span class="kicker">Im ' + mn + "</span>Kein Termin bekannt.</p>";
      } else {
        var cx = [], first = null; fu.forEach(function (e) { if (first) return; if (e[1] === "fällt aus") cx.push(e); else first = e; });
        if (first) {
          ans = '<p class="sx-ans"><span class="kicker">Nächster Termin</span><b>' + esc2(dayLab(first[0])) + "</b>" + esc2(first[1] || "Uhrzeit folgt") + "</p>";
          if (cx.length) ans += '<p class="sx-note">' + esc2(cx.map(function (e) { return dayLab(e[0]); }).join(", ")) + " fällt aus.</p>";
          note = first[2] || ""; rest = fu.filter(function (e) { return e !== first && e[1] !== "fällt aus"; });
        } else ans = '<p class="sx-ans none">Zurzeit ist kein Termin bekannt, zum Beispiel wegen Saisonpause. Neue Termine tragen wir ein, sobald der Veranstalter sie veröffentlicht.</p>';
      }
      var more = rest.slice(0, 8);
      return '<article class="mk"><div class="mk-top"><h2><a href="' + ROOT + "/flohmarkt/" + it.s + '/">' + esc2(x[0]) + "</a></h2>" + favB(it.s, x[7] || x[0]) + "</div>" +
        '<p class="meta">' + esc2(x[1]) + (x[6] && x[6] !== x[1] ? " · " + esc2(x[6]) : "") + "</p>" + (kinds.o && x[5] ? '<p class="meta">Veranstalter: ' + esc2(x[5]) + "</p>" : "") + ans + (note ? '<p class="sx-note">' + esc2(note) + "</p>" : "") +
        (more.length ? '<details class="sx-more"><summary>Weitere Termine' + svg("chev") + '</summary><ul class="mk-dates">' + more.map(function (e) { return "<li" + (e[1] === "fällt aus" ? ' class="off"' : "") + "><b>" + esc2(dayLab(e[0])) + "</b>" + (e[1] ? " · " + esc2(e[1]) : "") + "</li>"; }).join("") + (rest.length > 8 ? '<li><a href="' + ROOT + "/flohmarkt/" + it.s + '/">Alle Termine auf der Seite des Markts</a></li>' : "") + "</ul></details>" : "") +
        '<p class="ln rh">' + svg("repeat") + "<span>" + esc2(x[2]) + "</span></p></article>";
    };
    var nextK = function (it) { var e = future(it.x).filter(function (y) { return y[1] !== "fällt aus"; })[0]; return e ? e[0] : "9999"; };
    var setChips = function (p) {
      if (!days) return;
      var one = p.days && p.days.length === 1 && !p.toks.length ? p.days[0] : null, map = { "0": TODAY, "1": TOMORROW, sa: nextWd(6), so: nextWd(0) }, hit = false;
      days.querySelectorAll("button[data-d]").forEach(function (b) { var on = !!one && map[b.getAttribute("data-d")] === one && !hit; if (on) hit = true; b.setAttribute("aria-pressed", String(on)); });
      var lab = days.querySelector(".sx-pick span"), pk = days.querySelector(".sx-pick");
      if (lab) lab.textContent = one && !hit ? dayLab(one) : "Datum wählen";
      if (pk) pk.classList.toggle("on", !!one && !hit);
      if (pick && one) pick.value = one;
    };
    // Der Suchbegriff steht nur hinter dem # in der Adresse: Dieser Teil wird nie an den Server geschickt.
    var syncUrl = function (v) { try { history.replaceState(null, "", location.pathname + (v ? "#q=" + encodeURIComponent(v) : "")); } catch (e) {} };
    var run = function () {
      var v = q.value.trim(); clr.hidden = !v; syncUrl(v);
      var empty = !v; az.classList.toggle("sx-hide", !empty); tip.classList.toggle("sx-hide", !empty);
      if (empty) { out.innerHTML = ""; msg.textContent = ""; setChips({ days: null, toks: [] }); return; }
      if (!D) { msg.textContent = "Suche wird geladen …"; return; }
      var p = parse(v); setChips(p);
      if (p.bad) { out.innerHTML = '<div class="empty sx-empty"><p><b>Dieses Datum gibt es nicht.</b></p><p>Tipp das Datum so ein: 24.10. oder 24. Oktober.</p></div>'; msg.textContent = ""; return; }
      if (!p.toks.length && p.days) {
        out.innerHTML = p.days.map(renderDay).join("");
        var n = 0; p.days.forEach(function (k) { n += onDay(k).filter(function (r) { return r.e[1] !== "fällt aus"; }).length; });
        msg.textContent = p.days.length > 1 ? (n === 1 ? "1 Termin am Wochenende." : n + " Termine am Wochenende.") : "";
        favSync(); return;
      }
      if (!p.toks.length && p.month) {
        var mp = MO[p.month], seen = {}, ks = [], mn = MONN[+p.month.slice(5) - 1] + " " + p.month.slice(0, 4);
        IDX.forEach(function (it) { (it.x[4] || []).forEach(function (e) { if (e[0].slice(0, 7) === p.month && e[0] >= TODAY && e[1] !== "fällt aus") { if (!seen[e[0]]) ks.push(e[0]); seen[e[0]] = (seen[e[0]] || 0) + 1; } }); });
        ks.sort();
        out.innerHTML = '<section class="sx-day"><div class="sx-dh"><h2>Flohmärkte im ' + esc2(mn) + "</h2></div>" + (ks.length ? "<p class=\"meta\">Tipp auf einen Tag:</p>" + dayChips(ks) + (mp ? '<a class="more-link" href="' + ROOT + mp + '">Alle Termine im ' + esc2(mn) + svg("chev") + "</a>" : "") : '<div class="empty sx-empty"><p><b>Für diesen Monat stehen noch keine Termine im Kalender.</b></p></div>') + "</section>";
        msg.textContent = ""; return;
      }
      if (!p.toks.length) { out.innerHTML = '<div class="empty sx-empty"><p><b>Wonach suchst du?</b></p><p>Tipp einen Namen, einen Stadtteil oder ein Datum ein, zum Beispiel „Goldbek“, „Altona“ oder „24.10.“</p></div>'; msg.textContent = ""; return; }
      var scored = IDX.map(function (it) {
        var sum = 0, all = true, kinds = {}, any = 0;
        p.toks.forEach(function (t) { var h = tokHit(t, it); if (h[0] > 0) { sum += h[0]; kinds[h[1]] = 1; any++; } else all = false; });
        if (sum && norm(it.x[0]).indexOf(p.toks.join(" ")) > -1) sum += 6;
        if (sum && nextK(it) !== "9999") sum += 1.5; // bei sonst gleichem Treffer: Märkte mit bekanntem Termin zuerst
        return { it: it, sc: sum, all: all, any: any, kinds: kinds };
      });
      var hits = scored.filter(function (r) { return r.all && r.sc > 0; }), loose = false;
      if (!hits.length && p.toks.length > 1) { hits = scored.filter(function (r) { return r.any > 0; }); loose = hits.length > 0; }
      hits.sort(function (a, b) { return (b.any - a.any) || (b.sc - a.sc) || (nextK(a.it) < nextK(b.it) ? -1 : nextK(a.it) > nextK(b.it) ? 1 : 0); });
      if (!hits.length) {
        out.innerHTML = '<div class="empty sx-empty"><p><b>Nichts gefunden für „' + esc2(v) + "“.</b></p><p>Prüf die Schreibweise oder such nach dem Stadtteil. Fehlt ein Markt im Kalender? Sag uns Bescheid, dann tragen wir ihn ein.</p>" +
          '<div class="chips"><a class="chip" href="' + ROOT + '/veranstalter/">' + svg("mail") + 'Markt melden</a><a class="chip" href="' + ROOT + '/flohmaerkte/">' + svg("map") + "Alle Märkte</a></div></div>";
        msg.textContent = "Keine Treffer."; return;
      }
      var shown = showAll ? hits : hits.slice(0, LIMIT);
      out.innerHTML = (loose ? '<p class="sx-sub">Keine genaue Übereinstimmung. Ähnliche Märkte:</p>' : "") + '<div class="sx-hits">' + shown.map(function (r) { return card(r.it, p, r.kinds); }).join("") + "</div>" +
        (hits.length > shown.length ? '<button type="button" class="more" id="sxMore">Alle ' + hits.length + " Treffer anzeigen</button>" : "") +
        '<p class="sx-x meta">Nicht dabei? <a href="' + ROOT + '/veranstalter/">Markt melden</a> · <a href="' + ROOT + '/flohmaerkte/">Alle Märkte</a></p>';
      msg.textContent = loose ? "" : hits.length === 1 ? "1 Markt gefunden." : hits.length + " Märkte gefunden.";
      favSync();
    };
    var t = 0;
    q.addEventListener("input", function () { showAll = false; clearTimeout(t); t = setTimeout(run, 120); });
    form.addEventListener("submit", function (e) { e.preventDefault(); clearTimeout(t); run(); q.blur(); });
    clr.addEventListener("click", function () { q.value = ""; showAll = false; run(); q.focus(); });
    var setQ = function (v) { q.value = v; showAll = false; run(); };
    out.addEventListener("click", function (e) {
      var c = e.target.closest("[data-q]"); if (c) { setQ(c.getAttribute("data-q")); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
      if (e.target.closest("#sxMore")) { showAll = true; run(); }
    });
    if (days) days.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-d]"); if (!b) return;
      var d = b.getAttribute("data-d"); setQ(b.getAttribute("aria-pressed") === "true" ? "" : { "0": "heute", "1": "morgen", sa: "samstag", so: "sonntag" }[d]);
    });
    if (pick) {
      pick.min = TODAY;
      pick.addEventListener("click", function () { try { if (pick.showPicker) pick.showPicker(); } catch (e) {} });
      pick.addEventListener("change", function () { if (/^\d{4}-\d{2}-\d{2}$/.test(pick.value)) setQ(qOf(pick.value)); });
    }
    var fromUrl = function () { try { return new URLSearchParams(location.hash.slice(1)).get("q") || new URLSearchParams(location.search).get("q") || ""; } catch (e) { return ""; } };
    var q0 = fromUrl(); if (q0) q.value = q0.slice(0, 80);
    window.addEventListener("hashchange", function () { var v = fromUrl().slice(0, 80); if (v !== q.value.trim()) { q.value = v; showAll = false; run(); } });
    if (q.value) run(); else if (window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches) q.focus();
    fetch(out.getAttribute("data-src")).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (j) { D = j.m || {}; MO = j.mo || {}; BIS = j.bis || ""; build(); if (q.value.trim()) run(); })
      .catch(function () { msg.textContent = ""; out.innerHTML = '<div class="empty">Die Suche konnte gerade nicht geladen werden. Versuch es gleich noch einmal oder schau in die <a href="' + ROOT + '/flohmaerkte/">Liste aller Märkte</a>.</div>'; });
  })();
})();
