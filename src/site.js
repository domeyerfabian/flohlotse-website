// Kleine Helfer: Menü, Filter nach Art und Umkreis, Karte, Ratgeber-Suche, Live-Status, Veranstalter-Badge, Schildgenerator. Die Seite funktioniert auch ohne dieses Skript.
(function () {
  var menu = document.querySelector(".menu-wrap");
  if (menu) {
    var label = menu.querySelector(".menu-btn span");
    menu.addEventListener("toggle", function () { if (label) label.textContent = menu.open ? "Schließen" : "Menü"; });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary").focus(); } });
    document.addEventListener("click", function (e) { if (menu.open && (!menu.contains(e.target) || e.target.closest(".menu a"))) menu.open = false; });
  }
  // Heute in Hamburg (unabhängig von der Uhr-Einstellung des Geräts)
  var berlin = function () { try { var o = {}; new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).forEach(function (x) { o[x.type] = x.value; }); return { day: o.year + "-" + o.month + "-" + o.day, hm: o.hour + ":" + o.minute }; } catch (e) { return null; } };
  var NOW = berlin();
  // Die Seite wird jede Nacht neu gebaut. Zwischen Mitternacht und dem Neubau (oder wenn ein Neubau ausfällt) ist sie von gestern:
  // Dann verschwinden die vergangenen Tage, und ein Hinweis sagt, von wann der Stand ist.
  var stand = document.documentElement.getAttribute("data-stand"), me0 = document.querySelector('script[src*="/assets/site.js"]'), ROOT0 = me0 ? me0.getAttribute("src").replace(/\/assets\/site\.js.*$/, "") : "";
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
  var me = document.querySelector('script[src*="/assets/site.js"]'), ROOT = me ? me.getAttribute("src").replace(/\/assets\/site\.js.*$/, "") : "";
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
    try { var hp = new URLSearchParams(location.hash.slice(1)), qp = new URLSearchParams(location.search), p0 = hp.get("plz") || qp.get("plz"), k0 = hp.get("km") || qp.get("km"); if (k0 && kmSel.querySelector('option[value="' + k0 + '"]')) { kmSel.value = k0; F.km = +k0; } if (p0) { plzIn.value = p0; byPlz(); } } catch (e) {}
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
      var s = ev.getAttribute("data-s"), e = ev.getAttribute("data-e"), cls, txt;
      if (hm < s) { cls = "soon"; txt = "Öffnet heute um " + uhr(s); }
      else if (!e) { cls = "soon"; txt = "Heute ab " + uhr(s); }
      else if (hm < e) { cls = "on"; txt = "Jetzt geöffnet · bis " + uhr(e); }
      else { cls = "past"; txt = "Heute schon vorbei"; }
      var b = document.createElement("span"); b.className = "live " + cls; b.textContent = txt;
      var body = ev.querySelector(".ev-body"); if (body) body.insertBefore(b, body.firstChild);
    });
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
})();
