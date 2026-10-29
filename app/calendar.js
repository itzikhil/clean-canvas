/*
 * The next event per person, from published read-only .ics links (Outlook / Microsoft 365, Google, iCloud).
 * CONFIG.calendars: [{name, ics | file, meetingsOnly, hide, days, allDay, strip, combine}]:
 *   ics      a published link (webcal:// works too); file: an .ics bundled in app/ (e.g. a downloaded bin schedule)
 *   meetingsOnly  skip all-day, Free and Away items        hide   skip titles containing any of these words
 *   days     how far ahead to look (default 7; 2 = today and tomorrow, for bins)
 *   allDay   treat timed events as whole-day ones (a collection 08:00-20:00 stays "Today" all day)
 *   strip    text removed from titles (' - Abholtermin')  combine  join several events on the same day with ' + '
 * The page can't read those links itself (no CORS), so the helper service fetches the file; every 15 minutes, cached
 * in localStorage for offline. Times without a Z are taken as the configured time zone (Outlook writes its own zone
 * names, e.g. "W. Europe Standard Time"). Repeats: DAILY, WEEKLY (BYDAY), MONTHLY, YEARLY with INTERVAL, COUNT,
 * UNTIL, EXDATE and moved instances (RECURRENCE-ID).
 */
var Calendar = (function () {
  'use strict';

  var C = window.CONFIG;
  var DAY = 86400000;
  var WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  var SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var listeners = [];
  var sources = [];   // [{cfg, events}]

  // Outlook writes Windows zone names; these are the common ones. IANA names (Google, iCloud) pass through.
  var WINDOWS_ZONES = {
    'W. Europe Standard Time': 'Europe/Berlin', 'Romance Standard Time': 'Europe/Paris',
    'Central Europe Standard Time': 'Europe/Budapest', 'Central European Standard Time': 'Europe/Warsaw',
    'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik', 'UTC': 'UTC',
    'FLE Standard Time': 'Europe/Kiev', 'GTB Standard Time': 'Europe/Bucharest', 'E. Europe Standard Time': 'Europe/Chisinau',
    'Israel Standard Time': 'Asia/Jerusalem', 'Turkey Standard Time': 'Europe/Istanbul', 'Russian Standard Time': 'Europe/Moscow',
    'Arabian Standard Time': 'Asia/Dubai', 'India Standard Time': 'Asia/Kolkata', 'China Standard Time': 'Asia/Shanghai',
    'Singapore Standard Time': 'Asia/Singapore', 'Tokyo Standard Time': 'Asia/Tokyo', 'AUS Eastern Standard Time': 'Australia/Sydney',
    'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago',
    'Mountain Standard Time': 'America/Denver', 'Pacific Standard Time': 'America/Los_Angeles',
    'Atlantic Standard Time': 'America/Halifax', 'SA Pacific Standard Time': 'America/Bogota',
    'E. South America Standard Time': 'America/Sao_Paulo'
  };
  var zoneFmt = {};

  function zoneOf(tzid) {
    if (!tzid) return C.timeZone;
    var z = WINDOWS_ZONES[tzid] || tzid;
    if (z === C.timeZone) return z;
    try { zoneFmt[z] = zoneFmt[z] || new Intl.DateTimeFormat('en-US', {timeZone: z, hourCycle: 'h23', year: 'numeric',
      month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short'}); } catch (e) { return C.timeZone; }
    return z;
  }

  /** Wall-clock parts of an instant in a zone (the configured one without Intl, others via Intl). */
  function partsIn(zone, t) {
    if (zone === C.timeZone) return Time.parts(new Date(t));
    var o = {};
    zoneFmt[zone].formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
    return {year: +o.year, month: +o.month, day: +o.day, hour: +o.hour % 24, minute: +o.minute,
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday)};
  }

  /** Wall-clock time in a zone -> epoch ms. Date.UTC normalises overflowing days and months. */
  function localToEpoch(y, mo, d, h, mi, zone) {
    zone = zone || C.timeZone;
    var want = Date.UTC(y, mo - 1, d, h || 0, mi || 0), guess = want;
    for (var i = 0; i < 2; i++) {
      var p = partsIn(zone, guess);
      guess -= Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - want;
    }
    return guess;
  }

  /** '20261029', '20261029T183000' (+ TZID), '20261029T173000Z' -> {t, allDay, zone} */
  function parseDate(v, tzid) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(v || '');
    if (!m) return null;
    var zone = zoneOf(tzid);
    if (!m[4]) return {t: localToEpoch(+m[1], +m[2], +m[3], 0, 0, C.timeZone), allDay: true, zone: C.timeZone};
    if (m[7]) return {t: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)), allDay: false, zone: zone};
    return {t: localToEpoch(+m[1], +m[2], +m[3], +m[4], +m[5], zone), allDay: false, zone: zone};
  }

  function parse(text) {
    var lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/), out = [], ev = null;
    lines.forEach(function (line) {
      if (line === 'BEGIN:VEVENT') { ev = {exdates: []}; return; }
      if (line === 'END:VEVENT') { if (ev) out.push(ev); ev = null; return; }
      if (!ev) return;
      var i = line.indexOf(':');
      if (i < 0) return;
      var head = line.slice(0, i).split(';'), name = head[0], value = line.slice(i + 1);
      var tz = (head.filter(function (h) { return h.indexOf('TZID=') === 0; })[0] || '').slice(5).replace(/^"|"$/g, '');
      if (name === 'SUMMARY') ev.title = value.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ');
      else if (name === 'DTSTART') ev.start = parseDate(value, tz);
      else if (name === 'DTEND') ev.end = parseDate(value, tz);
      else if (name === 'RRULE') ev.rrule = value;
      else if (name === 'UID') ev.uid = value;
      else if (name === 'STATUS') ev.cancelled = value === 'CANCELLED';
      else if (name === 'X-MICROSOFT-CDO-BUSYSTATUS') ev.busy = value;   // FREE, TENTATIVE, BUSY, OOF
      else if (name === 'EXDATE') value.split(',').forEach(function (v) { var d = parseDate(v, tz); if (d) ev.exdates.push(d.t); });
      else if (name === 'RECURRENCE-ID') ev.recurrenceId = parseDate(value, tz);
    });
    return out.filter(function (e) { return e.start && !e.cancelled; });
  }

  /**
   * A calendar published as availability only ("Can view when I'm busy") has titles like Busy or Tentative: show
   * 'Meeting' then, and say so when it's tentative.
   */
  function displayTitle(e) {
    var t = (e.title || '').trim();
    if (/^(busy|tentative|free|away|working elsewhere)$/i.test(t) || !t) {
      return e.busy === 'TENTATIVE' || /^tentative$/i.test(t) ? I18N.t('tentative') : I18N.t('meeting');
    }
    return t;
  }

  /** Occurrence start times of one event inside [from, to). */
  function occurrences(ev, from, to, moved) {
    var start = ev.start.t, len = ev.end ? ev.end.t - start : (ev.start.allDay ? DAY : 0);
    if (!ev.rrule) return start + len > from && start < to ? [start] : [];
    var r = {};
    ev.rrule.split(';').forEach(function (kv) { var p = kv.split('='); r[p[0]] = p[1]; });
    var interval = +(r.INTERVAL || 1), count = r.COUNT ? +r.COUNT : Infinity;
    var until = r.UNTIL ? parseDate(r.UNTIL).t : Infinity;
    var zone = ev.start.zone || C.timeZone;
    var p0 = partsIn(zone, start), out = [], n = 0;
    var days = r.BYDAY ? r.BYDAY.split(',').map(function (d) { return WD.indexOf(d.slice(-2)); }) : null;
    var nth = r.BYDAY && /^-?\d/.test(r.BYDAY) ? parseInt(r.BYDAY, 10) : 0;   // MONTHLY 2WE = second Wednesday
    function at(y, mo, d) { return localToEpoch(y, mo, d, p0.hour, p0.minute, zone); }
    /** Day of month of the nth (or last, n < 0) weekday wd in month mo (may be > 12: Date.UTC rolls over). */
    function nthDay(y, mo, wd, n) {
      var first = new Date(Date.UTC(y, mo - 1, 1)), dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      var fy = first.getUTCFullYear(), fm = first.getUTCMonth() + 1;
      if (n > 0) return {y: fy, mo: fm, d: 1 + (wd - first.getUTCDay() + 7) % 7 + (n - 1) * 7};
      var last = new Date(Date.UTC(fy, fm - 1, dim));
      return {y: fy, mo: fm, d: dim - (last.getUTCDay() - wd + 7) % 7};
    }
    for (var k = 0; k < 3000 && n < count; k++) {
      var batch = [];
      if (r.FREQ === 'DAILY') batch = [at(p0.year, p0.month, p0.day + k * interval)];
      else if (r.FREQ === 'WEEKLY') {
        var weekStart = at(p0.year, p0.month, p0.day - p0.weekday + k * 7 * interval);
        var ws = partsIn(zone, weekStart);
        (days || [p0.weekday]).slice().sort().forEach(function (wd) { batch.push(at(ws.year, ws.month, ws.day + wd)); });
      } else if (r.FREQ === 'MONTHLY' && nth) {
        var nd = nthDay(p0.year, p0.month + k * interval, days[0], nth);
        batch = [at(nd.y, nd.mo, nd.d)];
      } else if (r.FREQ === 'MONTHLY') batch = [at(p0.year, p0.month + k * interval, p0.day)];
      else if (r.FREQ === 'YEARLY') batch = [at(p0.year + k * interval, p0.month, p0.day)];
      else break;
      for (var b = 0; b < batch.length && n < count; b++) {
        var t = batch[b];
        if (t < start) continue;
        if (t > until || t >= to) return out;
        n++;
        if (ev.exdates.indexOf(t) >= 0 || moved.indexOf(t) >= 0) continue;
        if (t + len > from) out.push(t);
      }
    }
    return out;
  }

  /** The next (or ongoing) event within opts.days: {t, allDay, title} or null. */
  function next(now, events, opts) {
    opts = opts || {};
    var e = nextRaw(now, events, opts);
    if (!e || !opts.combine) return e;
    // Everything else on the same day, e.g. two bins collected together.
    var day = Time.day(Time.parts(new Date(e.t))), titles = [e.title];
    nextAll(now, events, opts).forEach(function (o) {
      if (o !== e && Time.day(Time.parts(new Date(o.t))) === day && titles.indexOf(o.title) < 0) titles.push(o.title);
    });
    return {t: e.t, allDay: e.allDay, title: titles.join(' + ')};
  }

  function nextRaw(now, events, opts) {
    var list = nextAll(now, events, opts);
    // A timed event that already started is still "next" for 15 minutes; all-day events count for their whole day.
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.allDay ? e.t + DAY > now : e.t > now - 15 * 60000) return e;
    }
    return null;
  }

  /** Every occurrence within the window, sorted. */
  function nextAll(now, events, opts) {
    opts = opts || {};
    var hide = (opts.hide || []).map(function (w) { return w.toLowerCase(); });
    var from = now - DAY, to = now + (opts.days || 7) * DAY, list = [];
    var moved = {};
    events.forEach(function (e) { if (e.recurrenceId) (moved[e.uid] = moved[e.uid] || []).push(e.recurrenceId.t); });
    events.forEach(function (e) {
      // A meeting: timed, and not marked Free or Away in Outlook.
      if (opts.meetingsOnly && (e.start.allDay || e.busy === 'FREE' || e.busy === 'OOF')) return;
      var title = (e.title || '').toLowerCase();
      if (hide.some(function (w) { return title.indexOf(w) >= 0; })) return;
      var title = displayTitle(e);
      if (opts.strip) title = title.split(opts.strip).join('').trim();
      occurrences(e, from, to, e.recurrenceId ? [] : (moved[e.uid] || [])).forEach(function (t) {
        if (opts.allDay) {   // whole day: from local midnight
          var p = Time.parts(new Date(t));
          list.push({t: localToEpoch(p.year, p.month, p.day, 0, 0), allDay: true, title: title});
        } else list.push({t: t, allDay: e.start.allDay, title: title});
      });
    });
    list.sort(function (a, b) { return a.t - b.t || (a.allDay ? -1 : 1); });
    return list;
  }

  /** '18:30 Dinner', 'Tomorrow 09:00 Dentist', 'Sat 10:00 Swimming', 'Today: Birthday' */
  function format(e, now) {
    if (!e) return '';
    var p = Time.parts(new Date(e.t)), today = Time.day(Time.parts(new Date(now)));
    var tomorrow = Time.day(Time.parts(new Date(now + DAY))), day = Time.day(p);
    var when = day === today ? '' : day === tomorrow ? I18N.t('tomorrow') + ' ' :
      (I18N.shortDay(new Date(e.t)) || SHORT[p.weekday]) + ' ';
    if (e.allDay) return (when ? when.trim() : I18N.t('today')) + ': ' + e.title;
    return when + Time.clock(p) + ' ' + e.title;
  }

  function key(i) { return 'cal.v2.' + i; }

  function refresh(src, i) {
    if (src.cfg.file) {   // bundled with the app: a local read (XHR works for file:// pages, fetch may not)
      var xhr = new XMLHttpRequest();
      xhr.onload = function () {
        if (xhr.responseText.indexOf('BEGIN:VCALENDAR') < 0) return;
        src.events = parse(xhr.responseText);
        listeners.forEach(function (fn) { fn(); });
      };
      xhr.open('GET', src.cfg.file);
      xhr.send();
      return;
    }
    var url = String(src.cfg.ics || '').replace(/^webcal:/i, 'https:');
    function done(text) {
      if (!text || text.indexOf('BEGIN:VCALENDAR') < 0) return;
      try { localStorage.setItem(key(i), text); } catch (e) {}
      src.events = parse(text);
      listeners.forEach(function (fn) { fn(); });
    }
    if (TV.webos) TV.luna(window.HELPER + 'fetchText', {url: url}, function (res) { done(res && res.text); });
    else fetch(url).then(function (r) { return r.text(); }).then(done).catch(function () {});
  }

  return {
    start: function (onUpdate) {
      var list = C.calendars || [];
      if (!list.length) return;
      listeners.push(onUpdate);
      sources = list.filter(function (c) { return c && (c.ics || c.file); }).map(function (c, i) {
        var src = {cfg: c, events: []}, cached = null;
        try { cached = localStorage.getItem(key(i)); } catch (e) {}
        if (cached) src.events = parse(cached);
        return src;
      });
      onUpdate();
      sources.forEach(refresh);
      setInterval(function () { sources.forEach(refresh); }, 15 * 60000);
    },
    /** [{name, text}] per calendar with an upcoming event, e.g. {name: 'Alex', text: '18:30 Standup'}. */
    lines: function () {
      var now = Date.now(), out = [];
      sources.forEach(function (src) {
        var text = format(next(now, src.events, src.cfg), now);
        if (text) out.push({name: src.cfg.name || '', text: text});
      });
      return out;
    },
    // for tests
    _parse: parse, _next: next, _format: format, _sources: function () { return sources; }
  };
})();
