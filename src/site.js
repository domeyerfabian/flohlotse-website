// Kleine Helfer: Menü schließen, Termine filtern, Ratgeber durchsuchen, Live-Status, Schildgenerator. Die Seite funktioniert auch ohne dieses Skript.
(function () {
  var menu = document.querySelector(".menu-wrap");
  if (menu) {
    var label = menu.querySelector(".menu-btn span");
    menu.addEventListener("toggle", function () { if (label) label.textContent = menu.open ? "Schließen" : "Menü"; });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary").focus(); } });
    document.addEventListener("click", function (e) { if (menu.open && (!menu.contains(e.target) || e.target.closest(".menu a"))) menu.open = false; });
  }
  var filter = document.getElementById("filter");
  if (filter) {
    filter.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var t = b.getAttribute("data-t");
      filter.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      var shown = 0;
      document.querySelectorAll("#liste .group").forEach(function (g) {
        var n = 0;
        g.querySelectorAll(".ev").forEach(function (ev) {
          var ok = !t || ev.getAttribute("data-tags").split("|").indexOf(t) > -1;
          ev.hidden = !ok; if (ok) n++;
        });
        g.hidden = n === 0; shown += n;
      });
      document.getElementById("leer").hidden = shown > 0;
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
  if (liveEvs.length && window.Intl && Intl.DateTimeFormat.prototype.formatToParts) {
    var pt = {};
    new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).forEach(function (x) { pt[x.type] = x.value; });
    var today = pt.year + "-" + pt.month + "-" + pt.day, hm = pt.hour + ":" + pt.minute;
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
    var scale = function () { if (!sheet) return; var s = wrap.clientWidth / sheet.offsetWidth; sheet.style.transform = "scale(" + s + ")"; wrap.style.height = sheet.offsetHeight * s + "px"; };
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
