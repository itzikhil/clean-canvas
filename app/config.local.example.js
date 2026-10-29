/* Copy to config.local.js and fill in; it overrides app/config.js and stays out of git. */
Object.assign(window.CONFIG, {
  timeZone: 'Europe/Berlin',
  apps: [
    // python3 tools/list_apps.py prints your TV's app ids and saves their icons to app/icons/
    {id: 'youtube.leanback.v4', title: 'YouTube', icon: 'icons/youtube.leanback.v4.png', bg: '#ffffff'},
    {id: 'netflix', title: 'Netflix', icon: 'icons/netflix.png', bg: '#ffffff'},
    // a web page: {id: 'kids', title: 'Kids', url: 'https://example.org/', label: 'Kids', bg: '#ff4f6d', fg: '#ffffff'},
    // a Fire TV app: {id: 'firetv.f1', title: 'F1 TV', firetv: 'com.formulaone.production', label: 'F1 TV', bg: '#e10600'}
  ],
  // fireTv: {host: '192.168.1.23', input: 'com.webos.app.hdmi4'},
  place: {name: 'Berlin', latitude: 52.52, longitude: 13.405}
  // calendars: [   // read-only published links (README: "Calendars"); one line per person
  //   {name: 'Alex', ics: 'https://outlook.office365.com/owa/calendar/.../calendar.ics', meetingsOnly: true},
  //   {name: 'Sam', ics: 'https://calendar.google.com/calendar/ical/.../basic.ics', hide: ['Birthday']},
  //   {name: 'Bins', file: 'bins.local.ics', days: 2, allDay: true, strip: ' - Abholtermin', combine: true}
  // ]
});
