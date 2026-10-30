/*
 * The home screen: clock, weather, dock, top buttons, inputs picker, All apps drawer, D-pad focus, caption,
 * night mode, idle screensaver, the on-TV helper (Home takeover, screen off), and an on-TV benchmark.
 */
(function () {
  'use strict';

  var C = window.CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  var KEY = {LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461};
  var HELPER = window.HELPER = 'luna://' + (window.PalmSystem && window.PalmSystem.identifier ?
    window.PalmSystem.identifier.split(' ')[0] : 'io.tvlauncher.home') + '.service/';

  if (!C.kenBurns) root.classList.add('no-kb');
  root.lang = I18N.lang;
  if (I18N.rtl) root.classList.add('rtl');   // Hebrew: text runs right to left inside each line (style.css)
  $('d-title').textContent = I18N.t('allApps');
  root.style.setProperty('--night-dim', C.night.artDim);
  root.style.setProperty('--night-text', C.night.textOpacity);

  // ---------- Clock, night mode ----------

  var timeEl = $('time'), dateEl = $('date'), clockTimer = null;

  function tick() {
    var now = new Date(), p = Time.parts(now);
    var t = Time.clock(p), d = I18N.longDate(now) || Time.date(p);
    if (timeEl.textContent !== t) timeEl.textContent = t;
    if (dateEl.textContent !== d) dateEl.textContent = d;
    root.classList.toggle('night', Weather.isNight(Time.iso(p)));
    renderCalendar();
    renderLabel(t, d);
    if (saver) driftLabel();
    clearTimeout(clockTimer);
    clockTimer = setTimeout(tick, 60000 - (now.getTime() % 60000) + 30);   // just after the next minute
  }

  // ---------- Weather ----------

  function showRain(w) { return w.rain !== null && w.rain !== undefined && w.rain >= (C.rainFrom || 0); }

  function renderWeather(w) {
    $('wx').firstChild.innerHTML = Weather.icons[w.icon] || '';
    $('wx-temp').textContent = w.temp + '°';
    // Rain chance when it is at least C.rainFrom % (0 = always).
    $('wx-range').textContent = I18N.t('high') + ' ' + w.max + '°  ' + I18N.t('low') + ' ' + w.min + '°' +
      (showRain(w) ? '  ·  ' + w.rain + I18N.t('rain') : '');
    $('wx').classList.add('on');
    tick();   // sunrise and sunset may have changed night mode
  }

  // ---------- Calendar and the screensaver's gallery label ----------

  var CAL_ICON = '<svg viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="14" rx="2.5"/>' +
    '<path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>';
  var calHtml = '';

  /** One line per person under the weather: icon, name, next event. */
  function renderCalendar() {
    var lines = Calendar.lines();
    var html = lines.map(function (l) {
      return '<div class="ev">' + CAL_ICON + (l.name ? '<b></b>' : '') + '<span></span></div>';
    }).join('');
    if (JSON.stringify(lines) === calHtml) return;   // unchanged: no DOM work
    calHtml = JSON.stringify(lines);
    var box = $('cal');
    box.innerHTML = html;
    Array.prototype.forEach.call(box.children, function (row, i) {
      if (lines[i].name) row.querySelector('b').textContent = lines[i].name;
      row.querySelector('span').textContent = lines[i].text;
    });
  }

  /** 'Thursday 29 October · Cloudy, 12° and 6° · 18:30 Dinner', with the time first: one line, like a wall card. */
  function renderLabel(t, d) {
    var w = Weather.current(), parts = [t || timeEl.textContent, d || dateEl.textContent];
    if (w && C.place) {
      parts.push(Weather.word(w.desc) + ', ' + w.max + '° ' + I18N.t('and') + ' ' + w.min + '°' +
        (showRain(w) ? ', ' + w.rain + I18N.t('rainChance') : ''));
    }
    // First line: time · date · weather; then one line per calendar, like the details on a wall card.
    var lines = [parts.join('  ·  ')].concat(Calendar.lines().map(function (l) {
      return (l.name ? l.name + ': ' : '') + l.text;
    }));
    var key = lines.join('\n'), box = $('g-line');
    if (box.getAttribute('data-k') === key) return;
    box.setAttribute('data-k', key);
    box.innerHTML = lines.map(function () { return '<div></div>'; }).join('');
    lines.forEach(function (text, i) { box.children[i].textContent = text; });
  }

  // ---------- Dock ----------

  function makeTile(app, cls) {
    var tile = document.createElement('div');
    tile.className = 'tile' + (cls ? ' ' + cls : '');
    tile.innerHTML = '<div class="face">' + (app.icon ? '<img alt="">' : '<div class="label"></div>') + '</div><div class="name"></div>';
    tile.firstChild.style.background = app.bg || '#2c2c2e';
    if (app.fg) tile.firstChild.style.color = app.fg;
    if (app.icon) tile.querySelector('img').src = app.icon;
    else tile.querySelector('.label').textContent = app.label || app.title;
    tile.lastChild.textContent = app.title;
    return tile;
  }

  /** Opens a dock or drawer entry: a TV app, a web page in LG's browser, or an app on the Fire TV. */
  function open(app) {
    if (app.url) TV.launch(C.browserApp, null, {target: app.url});
    else if (app.firetv) {
      TV.launch(C.fireTv.input);   // switch to the Fire TV's HDMI input while it opens the app
      TV.luna(HELPER + 'firetv', {host: C.fireTv.host, package: app.firetv}, function (res) {
        if (!res) console.warn('Fire TV: could not open', app.firetv);
      });
    } else TV.launch(app.id);
  }

  // No dock configured yet: the first five apps the TV lists (tools/list_apps.py).
  if (!C.apps || !C.apps.length) C.apps = (window.ALL_APPS || []).slice(0, 5);

  var row = $('row'), tiles = [];
  C.apps.forEach(function (app) {
    var tile = makeTile(app);
    row.appendChild(tile);
    tiles.push(tile);
  });

  // Size and centre the dock from the app count (no layout reads): full-size tiles up to 5 apps, then smaller ones
  // so the row stays inside the 90 px safe area. Then line up its blurred wallpaper copy.
  var n = C.apps.length;
  var gap = n > 5 ? 28 : 40;
  var tileW = Math.min(272, Math.floor((1920 - 2 * 90 - 68 - (n - 1) * gap) / n));
  var tileH = Math.round(tileW * 0.625);
  var dockW = n * tileW + (n - 1) * gap + 68;
  var dockH = tileH + 96;
  var dockX = Math.round((1920 - dockW) / 2), dockY = 910 - dockH;
  root.style.setProperty('--tile-w', tileW + 'px');
  root.style.setProperty('--tile-h', tileH + 'px');
  root.style.setProperty('--gap', gap + 'px');
  var dock = $('dock');
  dock.style.left = dockX + 'px';
  dock.style.top = dockY + 'px';
  dock.style.width = dockW + 'px';
  dock.style.height = dockH + 'px';
  Array.prototype.forEach.call(document.querySelectorAll('.blur'), function (b) {
    b.style.left = -dockX + 'px';
    b.style.top = -dockY + 'px';
  });

  // ---------- All apps drawer ----------

  var COLS = 7;
  var dockIds = C.apps.map(function (a) { return a.id; });
  var drawerApps = (window.ALL_APPS || []).filter(function (a) { return dockIds.indexOf(a.id) < 0; });
  var grid = $('grid'), cells = [];
  function buildDrawer() {   // after the first frame: not needed to show the home screen
    drawerApps.forEach(function (app) {
      var tile = makeTile(app, 'small');
      grid.appendChild(tile);
      cells.push(tile);
    });
  }

  // ---------- Continue watching: the hub's row (hub/hub.py on an always-on computer) ----------

  var CARD = 256 + 24, CARDS_SHOWN = 6;   // card width + gap (style.css); cards that fit inside the safe area
  var hubDock = C.hub ? dockIds.indexOf(C.hub.app) : -1;   // the dock tile whose row this is
  var shelfRow = $('sh-row'), shelfTiles = [], shelfKey = '', shelfIdx = 0;
  $('sh-title').textContent = I18N.t('continueWatching');

  function renderShelf(list) {
    var key = JSON.stringify(list);
    if (key === shelfKey) return;   // unchanged: no DOM work
    shelfKey = key;
    if (zone === 'shelf') focus('dock', hubDock);
    shelfRow.innerHTML = '';
    shelfTiles = [];
    shelfIdx = 0;
    list.forEach(function (it) {
      var card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = '<img alt=""><div class="info"><b></b><span></span></div>' + (it.pct ? '<i><u></u></i>' : '');
      card.firstChild.src = C.hub.url + '/' + it.img;
      card.querySelector('b').textContent = it.title;
      card.querySelector('span').textContent = it.sub;
      if (it.pct) card.querySelector('u').style.width = it.pct + '%';
      shelfRow.appendChild(card);
      shelfTiles.push(card);
    });
    showShelf();
  }

  /** The row shows while the hub's dock tile, or the row itself, has focus. */
  function showShelf() {
    root.classList.toggle('shelf', shelfTiles.length > 0 && (zone === 'shelf' || (zone === 'dock' && idx === hubDock)));
  }

  function loadShelf() {
    if (hubDock < 0 || document.hidden) return;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', C.hub.url + '/feed.json');
    xhr.timeout = 5000;
    xhr.onload = function () {
      try { renderShelf(JSON.parse(xhr.responseText).continueWatching || []); } catch (e) { renderShelf([]); }
    };
    xhr.onerror = xhr.ontimeout = function () { renderShelf([]); };   // hub away: no row (its covers would not load)
    xhr.send();
  }

  // ---------- Inputs picker ----------

  var picker = $('picker'), items = [];
  C.inputs.forEach(function (input) {
    var el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = '<span></span><span class="note"></span>';
    el.firstChild.textContent = input.label;
    el.lastChild.textContent = input.note || '';
    picker.appendChild(el);
    items.push(el);
  });

  // ---------- Focus ----------

  var buttons = [$('b-inputs'), $('b-lghome'), $('b-settings')];
  var zone = 'dock', idx = 0, topIdx = 0, dockIdx = 0, focused = null;

  // Ken Burns, when on, pauses while the remote is in use (see style.css); it resumes 3 s after the last move.
  var stillTimer = null;
  function still(ms) {
    root.classList.add('still');
    clearTimeout(stillTimer);
    stillTimer = setTimeout(function () { if (zone !== 'picker') root.classList.remove('still'); }, ms || 3000);
  }

  var lastInput = Date.now();

  function focus(z, i) {
    still();
    lastInput = Date.now();
    var list = z === 'dock' ? tiles : z === 'top' ? buttons : z === 'picker' ? items : z === 'shelf' ? shelfTiles : cells;
    i = Math.max(0, Math.min(list.length - 1, i));
    zone = z;
    idx = i;
    if (z === 'top') topIdx = i;
    if (z === 'dock') dockIdx = i;
    if (z === 'shelf') {
      shelfIdx = i;
      shelfRow.style.transform = 'translateX(' + -Math.max(0, i - CARDS_SHOWN + 1) * CARD + 'px)';
    }
    if (hubDock >= 0) showShelf();
    var el = list[i];
    if (el === focused) return;
    if (focused) focused.classList.remove('f');
    el.classList.add('f');
    focused = el;
  }

  function openPicker() {
    picker.classList.add('open');
    buttons[0].classList.add('f');   // the Inputs button stays lit under its menu
    focused = null;
    focus('picker', 0);
  }
  function closePicker() {
    picker.classList.remove('open');
    if (focused) focused.classList.remove('f');
    focused = buttons[0];
    focus('top', 0);
  }

  function openDrawer() {
    if (!cells.length) return;   // also before buildDrawer() has run
    root.classList.add('drawer');
    focus('drawer', 0);
  }
  function closeDrawer() {
    root.classList.remove('drawer');
    focus('dock', dockIdx);
  }

  function lgHome() {
    TV.luna(HELPER + 'lgHome', {}, function (res) { if (!res) TV.launch(C.lgHomeApp); });
  }

  function activate() {
    if (zone === 'dock') open(C.apps[idx]);
    else if (zone === 'drawer') open(drawerApps[idx]);
    else if (zone === 'shelf') TV.launch(C.hub.app);
    else if (zone === 'top') {
      if (idx === 0) openPicker();
      else if (idx === 1) lgHome();
      else TV.launch(C.settingsApp);
    } else {
      var id = C.inputs[idx].id;
      closePicker();
      TV.launch(id);
    }
  }

  function topToDock(i) { return Math.max(0, tiles.length - buttons.length + i); }

  function move(key) {
    if (zone === 'dock') {
      if (key === KEY.LEFT) focus('dock', idx - 1);
      else if (key === KEY.RIGHT) focus('dock', idx + 1);
      else if (key === KEY.UP && idx === hubDock && shelfTiles.length) focus('shelf', shelfIdx);
      else if (key === KEY.UP) focus('top', topIdx);
      else if (key === KEY.DOWN) openDrawer();
    } else if (zone === 'shelf') {
      if (key === KEY.LEFT) focus('shelf', idx - 1);
      else if (key === KEY.RIGHT) focus('shelf', idx + 1);
      else if (key === KEY.UP) focus('top', topIdx);
      else if (key === KEY.DOWN) focus('dock', hubDock);
    } else if (zone === 'top') {
      if (key === KEY.LEFT) focus('top', idx - 1);
      else if (key === KEY.RIGHT) focus('top', idx + 1);
      else if (key === KEY.DOWN) focus('dock', topToDock(idx));
    } else if (zone === 'picker') {
      if (key === KEY.UP) focus('picker', idx - 1);
      else if (key === KEY.DOWN) focus('picker', idx + 1);
    } else {
      var col = idx % COLS;
      if (key === KEY.LEFT && col > 0) focus('drawer', idx - 1);
      else if (key === KEY.RIGHT && col < COLS - 1) focus('drawer', idx + 1);
      else if (key === KEY.UP) { if (idx < COLS) closeDrawer(); else focus('drawer', idx - COLS); }
      else if (key === KEY.DOWN && idx + COLS < cells.length) focus('drawer', idx + COLS);
      else if (key === KEY.DOWN && Math.floor(idx / COLS) < Math.floor((cells.length - 1) / COLS)) focus('drawer', cells.length - 1);
    }
  }

  function back() {
    if (zone === 'picker') closePicker();
    else if (zone === 'drawer') closeDrawer();
    else if (zone === 'shelf') focus('dock', hubDock);
    else if (zone === 'top') focus('dock', topToDock(idx));
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    noteInput();
    if (saver) {   // the first key only wakes the screen
      exitSaver();
      e.preventDefault();
      return;
    }
    showCaption();
    if (k >= 37 && k <= 40) move(k);
    else if (k === KEY.OK) activate();
    else if (k === KEY.BACK || k === 27 || k === 8) back();
    else return;
    e.preventDefault();
  }, true);

  // The Magic Remote pointer: invisible (CSS), inert, and never moves focus.
  ['mousemove', 'mouseover', 'mouseout', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel',
    'pointerdown', 'pointermove', 'pointerup', 'pointerover'].forEach(function (type) {
    document.addEventListener(type, function (e) { e.stopPropagation(); e.preventDefault(); }, {capture: true, passive: false});
  });
  // webOS fires this when the pointer appears or hides; re-assert the D-pad focus either way.
  document.addEventListener('cursorStateChange', function () {
    if (focused && !focused.classList.contains('f')) focused.classList.add('f');
  });

  // Test only (launch param eventLog: report URL): every remote event, posted to the Mac every 2 s.
  function eventLog(report) {
    var log = [], t0 = Date.now();
    ['keydown', 'keyup', 'mousedown', 'mouseup', 'click', 'pointerdown', 'cursorStateChange'].forEach(function (type) {
      window.addEventListener(type, function (e) {
        log.push({t: Date.now() - t0, type: type, key: e.keyCode, x: e.clientX, y: e.clientY,
          vis: e.detail && e.detail.visibility, zone: zone, idx: idx});
      }, true);
    });
    setInterval(function () {
      if (log.length) { post(report, {events: log}); log = []; }
    }, 2000);
  }

  // ---------- Caption ----------

  var caption = $('caption'), capTimer = null;
  function showCaption() {
    if (caption.classList.contains('hide')) caption.classList.remove('hide');
    clearTimeout(capTimer);
    capTimer = setTimeout(function () { caption.classList.add('hide'); }, 10000);
  }
  function setMeta(meta) {
    $('c-title').textContent = meta.title || '';
    $('c-meta').textContent = [meta.artist, meta.year].filter(Boolean).join(', ');
    $('g-title').textContent = meta.title || '';
    $('g-artist').textContent = $('c-meta').textContent;
    showCaption();
  }

  // ---------- Idle: art screensaver, then screen off ----------

  var saver = false, screenOff = false, idleTimer = null, offTimer = null, extendingAt = 0;

  function noteInput() {
    clearTimeout(idleTimer);
    if (!document.hidden) idleTimer = setTimeout(enterSaver, C.saverAfter * 60000);
  }

  function driftLabel() {
    // A slightly different spot each minute so nothing burns in.
    var x = Math.round(Math.random() * 60), y = Math.round(-Math.random() * 60);
    $('label').style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }

  function enterSaver() {
    if (saver || document.hidden) return;
    if (zone === 'picker') closePicker();
    if (zone === 'drawer') closeDrawer();
    saver = true;
    extendDevModeIfDue();
    driftLabel();
    renderLabel();
    root.classList.add('saver');
    clearTimeout(offTimer);
    offTimer = setTimeout(function () {
      TV.luna(HELPER + 'screenOff', {}, function (res) { screenOff = !!res; });
    }, C.screenOffAfter * 60000);
  }

  /** Once a week, while nobody is watching, renew Developer Mode so webOS never removes the launcher. */
  function extendDevModeIfDue() {
    var last = 0;
    try { last = +localStorage.getItem('devmode.extended') || 0; } catch (e) {}
    if (!TV.webos || Date.now() - last < 7 * 86400000) return;
    extendingAt = Date.now();
    TV.luna(HELPER + 'extendDevMode', {}, function (res) {
      if (res) { try { localStorage.setItem('devmode.extended', String(Date.now())); } catch (e) {} }
    });
  }

  function exitSaver() {
    saver = false;
    clearTimeout(offTimer);
    if (screenOff) {
      screenOff = false;
      TV.luna(HELPER + 'screenOn', {});
    }
    root.classList.remove('saver');
    showCaption();
  }

  // ---------- The TV: LG's screensaver, the helper ----------

  if (TV.webos) {
    // LG's screensaver asks running apps first; while this one is in front it says no and runs its own.
    TV.subscribe('luna://com.webos.service.tvpower/power/registerScreenSaverRequest',
      {subscribe: true, clientName: 'io.tvlauncher.home'}, function (m) {
        if (m && m.timestamp !== undefined) {
          TV.luna('luna://com.webos.service.tvpower/power/responseScreenSaverRequest',
            {clientName: 'io.tvlauncher.home', ack: !!document.hidden, timestamp: m.timestamp});
        }
      });
    // The helper service (Home takeover, screen off); the open subscription keeps it running.
    TV.subscribe(HELPER + 'start', {subscribe: true, takeover: !!C.homeTakeover}, function () {});
  }

  // ---------- Start ----------

  tick();
  focus('dock', 0);
  noteInput();
  window.Home = {still: still, idleMs: function () { return Date.now() - lastInput; }};
  Art.start(setMeta);
  // Everything not needed for the first frame waits for it: a faster first frame is a faster Home takeover.
  requestAnimationFrame(function () {
    setTimeout(function () {
      buildDrawer();
      Weather.onUpdate(renderWeather);
      Weather.start();
      Calendar.start(function () { renderCalendar(); renderLabel(); });
      loadShelf();
      setInterval(loadShelf, 5 * 60000);   // the hub refreshes every 5 min too
    }, 0);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimeout(idleTimer); return; }
    if (saver) exitSaver();
    tick();
    Art.refresh();
    loadShelf();   // back from watching: the list has probably moved on
    showCaption();
    noteInput();
  });
  document.addEventListener('webOSRelaunch', function (e) {
    // Back from the Developer Mode extension (started from gallery mode): stay in gallery mode.
    if (Date.now() - extendingAt < 20000) {
      extendingAt = 0;
      var sys0 = window.webOSSystem || window.PalmSystem;
      if (sys0 && sys0.activate) sys0.activate();
      saver = false;
      enterSaver();
      return;
    }
    // An app that handles its own relaunch must ask to come to the front; without this a relaunch over LG's home
    // stays hidden (and the helper had to restart the launcher from scratch, ~2.5 s).
    var sys = window.webOSSystem || window.PalmSystem;
    if (sys && sys.activate) sys.activate();
    if (zone === 'picker') closePicker();
    if (zone === 'drawer') closeDrawer();
    if (saver) exitSaver();
    noteInput();
    // Test hooks (benchmark, reports to a computer) only with debug: true in config.local.js: any app on the TV can
    // launch this one with parameters, and the reports could otherwise send calendar text to any address.
    var p = C.debug ? (e.detail || {}) : {};
    if (p.bench) { flags(p.flags); bench(p.report); }
    if (p.launchTest) launchTest(p.launchTest, p.report);
    if (p.lunaTest) lunaTest(p.lunaTest, p.report);
    if (p.saverTest) enterSaver();
    if (p.eventLog) eventLog(p.eventLog);
    if (p.timingReport) {
      var paints = {};
      (performance.getEntriesByType('paint') || []).forEach(function (e) { paints[e.name] = Math.round(e.startTime); });
      post(p.timingReport, {boot: boot, paints: paints, artShownAt: window.__artShown,
        fonts: document.fonts && document.fonts.status});
    }
    if (p.artReport) post(p.artReport, {art: $('c-title').textContent, by: $('c-meta').textContent, calendar: $('cal').textContent, weather: $('wx').textContent, label: $('g-line').textContent,
      calendarEvents: Calendar._sources().map(function (x) { return (x.cfg.name || '') + ':' + x.events.length; })});
  });

  // ---------- Tests: benchmark, launches, raw Luna calls (launch params from tools/install.py --params) ----------

  function post(report, obj) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', report);
    xhr.send(JSON.stringify(obj));
  }

  function lunaTest(calls, report) {
    var out = [];
    (function next(i) {
      if (i >= calls.length) { post(report, {lunaTest: out}); return; }
      var c = calls[i];
      setTimeout(function () {
        var t = setTimeout(function () { out.push({uri: c.uri, reply: 'no reply in 5 s'}); next(i + 1); }, 5000);
        TV.raw(c.uri, c.params, function (res) { clearTimeout(t); out.push({uri: c.uri, reply: res}); next(i + 1); });
      }, c.wait || 0);
    })(0);
  }

  function launchTest(id, report) {
    TV.launch(id, function (ok) { post(report, {launchTest: id, ok: ok}); });
  }

  function launchParams() {
    try {
      if (window.PalmSystem && window.PalmSystem.launchParams) return JSON.parse(window.PalmSystem.launchParams) || {};
    } catch (e) {}
    var q = /[?&]bench=([^&]*)/.exec(location.search);
    return q ? {bench: true, report: decodeURIComponent(q[1])} : {};
  }

  /** Bench only: switch effects off by name (html classes, see style.css) to find what costs frames. */
  function flags(list) {
    root.className = root.className.replace(/\bno-\S+/g, '').trim();
    if (!C.kenBurns) root.classList.add('no-kb');
    (list || []).forEach(function (f) { root.classList.add('no-' + f); });
  }

  function measure(ms, during) {
    return new Promise(function (resolve) {
      var frames = [], last = 0, end = performance.now() + ms, stop = during ? during() : null;
      function f(t) {
        if (last) frames.push(t - last);
        last = t;
        if (t < end) requestAnimationFrame(f);
        else {
          if (stop) stop();
          frames.sort(function (a, b) { return a - b; });
          var total = frames.reduce(function (a, b) { return a + b; }, 0);
          resolve({
            fps: +(frames.length / (total / 1000)).toFixed(1),
            p50: +frames[Math.floor(frames.length * 0.5)].toFixed(1),
            p95: +frames[Math.floor(frames.length * 0.95)].toFixed(1),
            worst: +frames[frames.length - 1].toFixed(1),
            dropped: frames.filter(function (d) { return d > 25; }).length,
            frames: frames.length
          });
        }
      }
      requestAnimationFrame(f);
    });
  }

  function bench(report) {
    var out = {flags: root.className, ua: navigator.userAgent, dpr: window.devicePixelRatio, screen: screen.width + 'x' + screen.height};
    var dir = KEY.RIGHT;
    function stepper(ms) {
      return function () {
        var t = setInterval(function () {
          if (zone !== 'dock') focus('dock', 0);
          if (idx === tiles.length - 1) dir = KEY.LEFT;
          if (idx === 0) dir = KEY.RIGHT;
          move(dir);
        }, ms);
        return function () { clearInterval(t); };
      };
    }
    function toggler(open, close, isOpen) {
      return function () {
        var t = setInterval(function () { if (isOpen()) close(); else open(); }, 400);
        return function () { clearInterval(t); if (isOpen()) close(); };
      };
    }
    return new Promise(function (r) { setTimeout(r, 3500); })   // past the post-move pause, so idle is truly idle
      .then(function () { return measure(4000); }).then(function (x) { out.idle = x; })
      .then(function () { return measure(6000, stepper(250)); }).then(function (x) { out.focusSlow = x; })
      .then(function () { return measure(6000, stepper(90)); }).then(function (x) { out.focusFast = x; })
      .then(function () { return measure(3000, function () { Art.crossfade(); }); }).then(function (x) { out.crossfade = x; })
      .then(function () {
        return measure(3000, toggler(function () { focus('top', 0); openPicker(); }, closePicker,
          function () { return zone === 'picker'; }));
      }).then(function (x) { out.picker = x; })
      .then(function () {
        focus('dock', 0);
        return measure(4000, toggler(openDrawer, closeDrawer, function () { return zone === 'drawer'; }));
      }).then(function (x) { out.drawer = x; })
      .then(function () {
        openDrawer();
        return measure(4000, function () {
          var t = setInterval(function () { move(idx % COLS === COLS - 1 ? KEY.DOWN : KEY.RIGHT); if (idx === cells.length - 1) focus('drawer', 0); }, 120);
          return function () { clearInterval(t); closeDrawer(); };
        });
      }).then(function (x) { out.drawerMoves = x; })
      .then(function () {
        focus('dock', 0);
        console.log('bench', JSON.stringify(out));
        if (report) post(report, out);
      });
  }

  var lp = C.debug ? launchParams() : {};
  if (lp.bench) { flags(lp.flags); bench(lp.report); }
  if (lp.launchTest) launchTest(lp.launchTest, lp.report);
  if (lp.lunaTest) lunaTest(lp.lunaTest, lp.report);
  if (lp.eventLog) eventLog(lp.eventLog);

  // Screenshots (desktop browser only): ?demo=home|drawer|picker|gallery|night
  var demo = !TV.webos && /[?&]demo=(\w+)/.exec(location.search);
  if (demo) {
    setTimeout(function () {
      var m = demo[1];
      root.classList.toggle('night', m === 'night');
      if (m === 'home' || m === 'night') focus('dock', 2);
      else if (m === 'drawer') { openDrawer(); focus('drawer', 8); }
      else if (m === 'shelf') { focus('dock', hubDock); focus('shelf', 1); }
      else if (m === 'picker') { focus('top', 0); openPicker(); focus('picker', 2); }
      else if (m === 'gallery') enterSaver();
      clearTimeout(clockTimer);   // hold the night/day state for the shot
    }, 3000);
  }
  // Page boot timings (ms since navigation start), kept for the timingReport test param.
  var boot = null;
  window.addEventListener('load', function () {
    requestAnimationFrame(function () {
      var t = performance.timing, n0 = t.navigationStart;
      boot = {responseEnd: t.responseEnd - n0, domInteractive: t.domInteractive - n0,
        domContentLoaded: t.domContentLoadedEventEnd - n0, load: t.loadEventEnd - n0, firstFrameAfterLoad: Math.round(performance.now())};
    });
  });
})();
