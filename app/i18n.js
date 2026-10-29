/*
 * Words on screen in CONFIG.language: 'en' (default), 'de', 'he', 'es', 'fr'. Weekday and month names come from the
 * TV's Intl in any language; English ones are built in, because creating an Intl formatter costs ~100 ms at boot.
 */
var I18N = (function () {
  'use strict';

  var STRINGS = {
    en: {today: 'Today', tomorrow: 'Tomorrow', meeting: 'Meeting', tentative: 'Meeting (tentative)', rain: '% rain',
      rainChance: '% chance of rain', high: 'H', low: 'L', and: 'and', allApps: 'All apps',
      clear: 'Clear', partly: 'Partly cloudy', cloud: 'Cloudy', fog: 'Fog', drizzle: 'Rain', snow: 'Snow', storm: 'Thunderstorms'},
    de: {today: 'Heute', tomorrow: 'Morgen', meeting: 'Termin', tentative: 'Termin (vorläufig)', rain: '% Regen',
      rainChance: '% Regenwahrscheinlichkeit', high: 'H', low: 'T', and: 'und', allApps: 'Alle Apps',
      clear: 'Klar', partly: 'Teils bewölkt', cloud: 'Bewölkt', fog: 'Nebel', drizzle: 'Regen', snow: 'Schnee', storm: 'Gewitter'},
    he: {today: 'היום', tomorrow: 'מחר', meeting: 'פגישה', tentative: 'פגישה (טנטטיבית)', rain: '% גשם',
      rainChance: '% סיכוי לגשם', high: 'מקס׳', low: 'מינ׳', and: 'עד', allApps: 'כל האפליקציות',
      clear: 'בהיר', partly: 'מעונן חלקית', cloud: 'מעונן', fog: 'ערפל', drizzle: 'גשם', snow: 'שלג', storm: 'סופות רעמים'},
    es: {today: 'Hoy', tomorrow: 'Mañana', meeting: 'Reunión', tentative: 'Reunión (provisional)', rain: '% lluvia',
      rainChance: '% de probabilidad de lluvia', high: 'Máx', low: 'Mín', and: 'y', allApps: 'Todas las apps',
      clear: 'Despejado', partly: 'Parcialmente nublado', cloud: 'Nublado', fog: 'Niebla', drizzle: 'Lluvia', snow: 'Nieve',
      storm: 'Tormentas'},
    fr: {today: 'Aujourd’hui', tomorrow: 'Demain', meeting: 'Réunion', tentative: 'Réunion (provisoire)', rain: '% pluie',
      rainChance: '% de risque de pluie', high: 'Max', low: 'Min', and: 'et', allApps: 'Toutes les apps',
      clear: 'Dégagé', partly: 'Partiellement nuageux', cloud: 'Nuageux', fog: 'Brouillard', drizzle: 'Pluie', snow: 'Neige',
      storm: 'Orages'}
  };

  var lang = String(window.CONFIG.language || 'en').slice(0, 2).toLowerCase();
  var S = STRINGS[lang] || STRINGS.en;
  var english = lang === 'en';
  var dateFmt = null, shortFmt = null;

  return {
    lang: lang,
    english: english,
    rtl: lang === 'he' || lang === 'ar',
    t: function (key) { return S[key] || STRINGS.en[key] || key; },

    /** The long date in this language, e.g. 'Donnerstag, 29. Oktober'; null for English (time.js builds that one). */
    longDate: function (date) {
      if (english) return null;
      dateFmt = dateFmt || new Intl.DateTimeFormat(lang, {timeZone: window.CONFIG.timeZone, weekday: 'long', day: 'numeric', month: 'long'});
      return dateFmt.format(date);
    },

    /** Short weekday in this language ('Sa', 'שבת'); null for English. */
    shortDay: function (date) {
      if (english) return null;
      shortFmt = shortFmt || new Intl.DateTimeFormat(lang, {timeZone: window.CONFIG.timeZone, weekday: 'short'});
      return shortFmt.format(date);
    }
  };
})();
