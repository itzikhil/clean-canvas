/*
 * Local time for the configured zone without Intl: building the first Intl.DateTimeFormat costs ~100 ms of boot on
 * this TV (measured), which delays the Home takeover. Central European zones follow the EU rule (CET +1, CEST +2 from
 * the last Sunday of March to the last Sunday of October, 01:00 UTC); any other zone falls back to Intl.
 */
var Time = (function () {
  'use strict';

  var CET = /^Europe\/(Berlin|Amsterdam|Brussels|Copenhagen|Luxembourg|Madrid|Monaco|Oslo|Paris|Prague|Rome|Stockholm|Vienna|Warsaw|Zurich|Budapest|Bratislava|Ljubljana|Zagreb|Belgrade)$/;
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December'];
  var zone = window.CONFIG.timeZone;
  var intl = null;

  function lastSundayUtc(year, month) {   // 01:00 UTC on the last Sunday of month (0-based)
    var d = new Date(Date.UTC(year, month + 1, 0, 1));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.getTime();
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** {year, month, day, hour, minute, second, weekday} in the configured zone; month 1-12, weekday 0 = Sunday. */
  function parts(date) {
    date = date || new Date();
    if (CET.test(zone)) {
      var y = date.getUTCFullYear(), t = date.getTime();
      var summer = t >= lastSundayUtc(y, 2) && t < lastSundayUtc(y, 9);
      var l = new Date(t + (summer ? 2 : 1) * 3600000);
      return {year: l.getUTCFullYear(), month: l.getUTCMonth() + 1, day: l.getUTCDate(), hour: l.getUTCHours(),
        minute: l.getUTCMinutes(), second: l.getUTCSeconds(), weekday: l.getUTCDay()};
    }
    if (!intl) {
      intl = new Intl.DateTimeFormat('en-US', {timeZone: zone, hourCycle: 'h23', weekday: 'short', year: 'numeric',
        month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'});
    }
    var o = {};
    intl.formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    return {year: +o.year, month: +o.month, day: +o.day, hour: +o.hour % 24, minute: +o.minute, second: +o.second,
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday)};
  }

  return {
    parts: parts,
    /** '21:07' */
    clock: function (p) { return pad(p.hour) + ':' + pad(p.minute); },
    /** 'Wednesday 28 October' (uppercased by CSS) */
    date: function (p) { return DAYS[p.weekday] + ' ' + p.day + ' ' + MONTHS[p.month - 1]; },
    /** '2026-10-28' */
    day: function (p) { return p.year + '-' + pad(p.month) + '-' + pad(p.day); },
    /** '2026-10-28T21:07', comparable as a string with Open-Meteo's sunrise and sunset */
    iso: function (p) { return p.year + '-' + pad(p.month) + '-' + pad(p.day) + 'T' + pad(p.hour) + ':' + pad(p.minute); }
  };
})();
