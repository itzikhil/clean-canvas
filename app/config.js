/* Clean Canvas defaults. Personal settings go in config.local.js (not in git); then: python3 tools/install.py */
window.CONFIG = {
  timeZone: 'Europe/Berlin',
  locale: 'en-GB',
  // Words on screen: 'en', 'de', 'he', 'es' or 'fr' (dates work in any language the TV knows).
  language: 'en',

  // The dock, left to right: set it in config.local.js. Empty: the first five apps the TV lists.
  // Entries: {id, title, icon, bg} for a TV app (python3 tools/list_apps.py lists ids and saves icons),
  // {url, title, label, bg, fg} for a web page in LG's browser, {firetv: '<package>', title, label, bg} for a Fire TV app.
  apps: [],

  browserApp: 'com.webos.app.browser',
  // A Fire TV Stick for `firetv` tiles: {host: '<ip>', input: 'com.webos.app.hdmiN'} (see README).
  fireTv: null,
  // A hub on an always-on computer at home (hub/README.md): {url: 'http://<ip>:8787', app: '<dock app id>'}. Its
  // "Continue watching" row shows above the dock while that app's tile is focused. null: no row.
  hub: null,

  inputs: [
    {id: 'com.webos.app.livetv', label: 'Live TV'},
    {id: 'com.webos.app.hdmi1', label: 'HDMI 1'},
    {id: 'com.webos.app.hdmi2', label: 'HDMI 2'},
    {id: 'com.webos.app.hdmi3', label: 'HDMI 3'},
    {id: 'com.webos.app.hdmi4', label: 'HDMI 4'}
  ],

  // Calendars, one line per person: [{name, ics, meetingsOnly, hide}] in config.local.js (README: "Calendars").
  calendars: [],

  // Test hooks (benchmark, launch/Luna tests, reports to a computer): off; set true in config.local.js to use them.
  debug: false,

  settingsApp: 'com.palm.app.settings',
  lgHomeApp: 'com.webos.app.home',

  // Weather (Open-Meteo, no key) and night mode, which follows this place's sunset and sunrise: set `place` in
  // config.local.js as {name, latitude, longitude}. Without it: no weather, night from 19:00 to 07:00.
  place: null,
  night: {artDim: 0.5, textOpacity: 0.75},
  // Today's chance of rain shows when it is at least this many percent (0 = always).
  rainFrom: 0,

  // When nobody uses the remote: the art screensaver after `saverAfter` minutes, the screen off after `screenOffAfter`
  // more minutes (the TV stays on; any key wakes it).
  saverAfter: 5,
  screenOffAfter: 60,

  // Remote's Home button opens this launcher instead of LG's home (needs the helper: tools/list_apps.py --pair-helper).
  // LG's own home is then reachable only from the launcher's LG Home button.
  homeTakeover: true,

  // Slow 1.0 → 1.05 zoom on the wallpaper. Off: on this TV the page renders at 4K and a scaled full-screen layer
  // costs 3-5 fps during focus moves even while paused (measured: 55-56 fps on, 58-59 off).
  kenBurns: false,

  // Daily wallpaper: public-domain paintings from The Met Open Access API, landscape orientation, safe for kids.
  // Strict: EVERY subject tag must be in `allow` (an unusual tag such as Couples, Rabbits or Angels excludes it), none
  // of the `block` words may appear in its tags or title (case-insensitive), and untagged paintings are skipped.
  art: {
    departments: [11],          // 11 = European Paintings
    queries: ['landscape', 'still life', 'flowers', 'seascape', 'river', 'village'],
    minRatio: 1.3,              // width / height of the painting itself
    maxRatio: 2.2,
    allow: ['landscapes', 'rivers', 'boats', 'ships', 'seascapes', 'sea', 'oceans', 'lakes', 'mountains', 'trees',
      'forests', 'gardens', 'flowers', 'still life', 'fruit', 'animals', 'horses', 'cows', 'cattle', 'sheep', 'dogs',
      'cats', 'birds', 'cityscapes', 'buildings', 'bridges', 'streets', 'villages', 'houses', 'snow', 'winter', 'clouds',
      'sunsets', 'beaches', 'harbors', 'farms', 'fields', 'haystacks', 'waterfalls', 'moon', 'architecture', 'skies',
      // neutral company for the subjects above
      'men', 'women', 'boys', 'girls', 'children', 'working', 'fishing', 'fishermen', 'peasants', 'shepherds', 'travelers',
      'carriages', 'sailboats', 'windmills', 'mills', 'canals', 'ponds', 'rocks', 'roads', 'hills', 'valleys', 'ruins',
      'castles', 'palaces', 'towers', 'churches', 'cathedrals', 'goats', 'ducks', 'swans', 'skating', 'apples', 'grapes',
      'pears', 'lemons', 'oranges', 'vases', 'baskets', 'london', 'venice', 'rome', 'cities', 'gondolas', 'cliffs'],
    block: ['nude', 'naked', 'bath', 'venus', 'paris', 'leda', 'susanna', 'cupid', 'satyr', 'nymph', 'bacchan',
      'crucif', 'christ', 'martyr', 'saint', 'massacre', 'battle', 'war', 'soldier', 'weapon', 'sword', 'gun', 'death',
      'dead', 'dying', 'corpse', 'skull', 'skeleton', 'blood', 'wound', 'execution', 'murder', 'kill', 'behead',
      'decapit', 'judith', 'holofernes', 'rape', 'abduct', 'hell', 'devil', 'demon', 'slaughter', 'hunt', 'game',
      'sacrifice', 'deluge', 'lament', 'entomb', 'pieta', 'fight', 'duel', 'combat', 'violence', 'fire', 'shipwreck',
      'storm', 'drown', 'temptation', 'mytholog']
  }
};
