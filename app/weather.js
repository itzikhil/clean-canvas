/*
 * Weather from Open-Meteo (no key, CORS), every 30 minutes, cached in localStorage so the last reading shows at once
 * and offline. Its sunrise and sunset drive night mode. Weather data by Open-Meteo.com (CC BY 4.0).
 */
var Weather = (function () {
  'use strict';

  var C = window.CONFIG;
  var KEY = 'wx.v2';
  var data = null;
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  var listeners = [];

  // Line icons, 24x24, stroked like the top buttons.
  var SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7L5.3 5.3"/>';
  var MOON = '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>';
  var CLOUD = '<path d="M7 18.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18.5z"/>';
  var ICONS = {
    clear: SUN,
    night: MOON,
    partly: '<path d="M8.5 4v1.5M3.5 9H5M4.9 5.4l1 1M12.1 5.4l-1 1"/><path d="M5.6 11.5A3.5 3.5 0 0 1 11.6 7.6"/>' +
      '<path d="M8.5 19.5h9a3.5 3.5 0 0 0 .3-7 4.8 4.8 0 0 0-9.2 1.3 2.9 2.9 0 0 0-.1 5.7z"/>',
    cloud: CLOUD,
    fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
    rain: '<path d="M7 15h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.4A3.1 3.1 0 0 0 7 15z"/><path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
    snow: '<path d="M7 15h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.4A3.1 3.1 0 0 0 7 15z"/><path d="M8.5 19h.01M12 20.5h.01M15.5 19h.01"/>',
    storm: '<path d="M7 15h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.4A3.1 3.1 0 0 0 7 15z"/><path d="M12.5 15.5l-2 3h3l-2 3"/>'
  };

  // Icon name -> the word in CONFIG.language (i18n.js); 'rain' is 'drizzle' there, as 'rain' is the "% rain" suffix.
  var WORDS = {clear: 'clear', night: 'clear', partly: 'partly', cloud: 'cloud', fog: 'fog', rain: 'drizzle',
    snow: 'snow', storm: 'storm'};

  /** WMO weather code → icon name. */
  function kind(code, isDay) {
    if (code === 0 || code === 1) return isDay ? 'clear' : 'night';
    if (code === 2) return isDay ? 'partly' : 'cloud';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'rain';
  }

  function fetchNow() {
    var p = C.place;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + p.latitude + '&longitude=' + p.longitude +
      '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,' +
      'precipitation_probability_max' +
      '&timezone=' + encodeURIComponent(C.timeZone) + '&forecast_days=2';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('weather ' + r.status);
      return r.json();
    }).then(function (j) {
      var icon = kind(j.current.weather_code, j.current.is_day === 1);
      data = {
        t: Date.now(),
        temp: Math.round(j.current.temperature_2m),
        icon: icon,
        desc: icon,   // translated when shown (I18N.t(Weather.word(icon)))
        max: Math.round(j.daily.temperature_2m_max[0]),
        min: Math.round(j.daily.temperature_2m_min[0]),
        rain: j.daily.precipitation_probability_max ? j.daily.precipitation_probability_max[0] : null,   // % today
        sunrise: j.daily.sunrise,   // local ISO minutes, today and tomorrow
        sunset: j.daily.sunset
      };
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
      listeners.forEach(function (fn) { fn(data); });
    });
  }

  function loop() {
    fetchNow().catch(function (e) { console.warn('weather:', e && e.message); }).then(function () {
      setTimeout(loop, 30 * 60000);
    });
  }

  return {
    icons: ICONS,
    /** The weather word for an icon name, in CONFIG.language. */
    word: function (icon) { return I18N.t(WORDS[icon] || 'cloud'); },
    current: function () { return data; },
    onUpdate: function (fn) {
      listeners.push(fn);
      if (data) fn(data);
    },
    start: function () { if (C.place) setTimeout(loop, 1500); },   // no place set: no weather

    /**
     * Night between sunset and sunrise. `now` is local time as 'YYYY-MM-DDTHH:MM', which compares as a string
     * with Open-Meteo's times. Without data yet: 19:00-07:00.
     */
    isNight: function (now) {
      var day = now.slice(0, 10), i = data && data.sunrise ? data.sunrise.map(function (s) { return s.slice(0, 10); }).indexOf(day) : -1;
      if (i < 0) {
        var h = +now.slice(11, 13);
        return h >= 19 || h < 7;
      }
      return now < data.sunrise[i] || now >= data.sunset[i];
    }
  };
})();
