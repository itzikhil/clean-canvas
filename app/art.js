/*
 * The daily wallpaper: a public-domain, landscape-orientation painting from The Met Open Access API.
 * The current painting (and tomorrow's, fetched ahead) live in IndexedDB as 1920x1080 JPEGs, so boot shows the
 * current one at once, even offline. A change crossfades over 1.5 s; each new image also gets a small pre-blurred
 * copy (canvas) that the dock shows instead of a live backdrop-filter.
 */
var Art = (function () {
  'use strict';

  var MET = 'https://collectionapi.metmuseum.org/public/collection';
  var DEFAULT = {src: 'default.jpg', meta: {title: 'A River Landscape', artist: 'Théodore Rousseau', year: 'ca. 1845–50', safe: 2}};
  var slides = [document.getElementById('s0'), document.getElementById('s1')];
  var blurs = [document.getElementById('g0'), document.getElementById('g1')];
  var active = -1;
  var urls = [null, null];
  var onMeta = function () {};
  var cfg = window.CONFIG.art;

  // ---------- IndexedDB: {date, meta, blob} under 'current' and 'next' ----------

  var dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise(function (resolve, reject) {
        var req = indexedDB.open('home', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('art'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }
    return dbp;
  }
  function op(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction('art', mode);
        var req = fn(tx.objectStore('art'));
        tx.oncomplete = function () { resolve(req.result); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  var get = function (k) { return op('readonly', function (s) { return s.get(k); }); };
  var put = function (k, v) { return op('readwrite', function (s) { return s.put(v, k); }); };
  var del = function (k) { return op('readwrite', function (s) { return s.delete(k); }); };

  // ---------- Time in the configured zone ----------

  function today() { return Time.day(Time.parts()); }
  function msToMidnight() {
    var p = Time.parts();
    return ((23 - p.hour) * 3600 + (59 - p.minute) * 60 + (60 - p.second)) * 1000;
  }

  // ---------- Showing an image ----------

  function show(src, meta, instant) {
    var t = active === 0 ? 1 : 0;
    var img = slides[t].firstElementChild;
    img.src = src;
    return img.decode().catch(function () {}).then(function () {
      paintBlur(img, blurs[t].firstElementChild);
      if (!instant && window.Home) window.Home.still(1800);   // no zoom during the crossfade
      var old = active;
      [slides[t], blurs[t]].forEach(function (el) {
        el.classList.remove('gone');
        if (instant) el.style.transition = 'none';
        el.classList.add('on');
        if (instant) { el.offsetWidth; el.style.transition = ''; }   // one forced style flush, boot only
      });
      if (old >= 0) {
        slides[old].classList.remove('on');
        blurs[old].classList.remove('on');
        var oldSrc = slides[old].firstElementChild.src;
        setTimeout(function () {
          // Only if that slot still holds the old image: a newer show() may have reused it meanwhile.
          var oldImg = slides[old].firstElementChild;
          if (old === active || oldImg.src !== oldSrc) return;
          slides[old].classList.add('gone');
          if (urls[old]) URL.revokeObjectURL(urls[old]);
          urls[old] = null;
          oldImg.removeAttribute('src');
        }, instant ? 0 : 1600);
      }
      urls[t] = src.indexOf('blob:') === 0 ? src : null;
      active = t;
      onMeta(meta);
    });
  }

  /** A 240x135 blurred copy, drawn once; CSS scales it to full screen behind the dock (upscaling blurs it more). */
  function paintBlur(img, canvas) {
    var ctx = canvas.getContext('2d');
    ctx.filter = 'blur(4px)';
    ctx.drawImage(img, -12, -12, 264, 159);   // overdraw so the blur doesn't pull in transparent edges
    ctx.filter = 'none';
  }

  // ---------- Choosing and fetching a painting ----------

  function json(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' → ' + r.status);
      return r.json();
    });
  }

  function candidateIds() {
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem('art.ids.v2')); } catch (e) {}
    if (cached && Date.now() - cached.t < 30 * 86400000 && cached.ids.length) return Promise.resolve(cached.ids);
    var searches = [];
    cfg.departments.forEach(function (d) {
      cfg.queries.forEach(function (q) {
        searches.push(json(MET + '/v1.1/search?isPublicDomain=true&hasImages=true&departmentId=' + d + '&q=' + encodeURIComponent(q)));
      });
    });
    return Promise.all(searches).then(function (results) {
      var ids = [], have = {};
      results.forEach(function (r) {
        (r.objectIDs || []).forEach(function (id) { if (!have[id]) { have[id] = 1; ids.push(id); } });
      });
      try { localStorage.setItem('art.ids.v2', JSON.stringify({t: Date.now(), ids: ids})); } catch (e) {}
      return ids;
    });
  }

  function ratio(obj) {
    var m = (obj.measurements || []).filter(function (x) { return x.elementName === 'Overall'; })[0] || (obj.measurements || [])[0];
    var e = m && m.elementMeasurements;
    return e && e.Width && e.Height ? e.Width / e.Height : 0;
  }

  // Paintings picked before the kid-safe filter existed are replaced (stored meta without this version).
  var SAFE = 2;

  /** Kid-safe: every subject tag on the allow list, no blocked word in tags or title. Untagged: unknown, so no. */
  function kidSafe(o) {
    var tags = (o.tags || []).map(function (t) { return String(t.term || '').toLowerCase(); });
    if (!tags.length) return false;
    var text = tags.join(' | ') + ' | ' + String(o.title || '').toLowerCase();
    if (cfg.block.some(function (w) { return text.indexOf(w) >= 0; })) return false;
    return tags.every(function (t) { return cfg.allow.indexOf(t) >= 0; });
  }

  /** A painting that fits: public domain, has an image, landscape, kid-safe. Resolves {meta, blob}. */
  function pick() {
    var seen = [];
    try { seen = JSON.parse(localStorage.getItem('art.seen')) || []; } catch (e) {}
    return candidateIds().then(function (ids) {
      var tries = 0;
      function next() {
        if (++tries > 60) {
          var err = new Error('no suitable painting after 60 tries');
          err.final = true;
          return Promise.reject(err);
        }
        var id = ids[Math.floor(Math.random() * ids.length)];
        if (seen.indexOf(id) >= 0) return next();
        return json(MET + '/v1/objects/' + id).then(function (o) {
          var r = ratio(o);
          if (!o.isPublicDomain || !o.primaryImage || o.classification !== 'Paintings' || r < cfg.minRatio || r > cfg.maxRatio ||
              !kidSafe(o)) {
            return next();
          }
          return imageBlob(o.primaryImage).then(normalize).then(function (blob) {
            seen.push(id);
            try { localStorage.setItem('art.seen', JSON.stringify(seen.slice(-300))); } catch (e) {}
            return {meta: {id: id, title: o.title, artist: o.artistDisplayName, year: o.objectDate, safe: SAFE}, blob: blob};
          });
        }).catch(function (e) {
          if (e && e.final) throw e;
          console.warn('art:', e && e.message);
          return next();
        });
      }
      return next();
    });
  }

  /**
   * The Met's image CDN sends no CORS headers, so a page can't read its bytes. images.weserv.nl relays them with CORS
   * and shrinks multi-megabyte originals server-side; a direct fetch is the fallback (webOS may allow it from file://).
   */
  function imageBlob(url) {
    function get(u) {
      return fetch(u).then(function (r) {
        if (!r.ok) throw new Error('image ' + r.status);
        return r.blob();
      });
    }
    var proxied = 'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, '')) +
      '&w=2200&h=2200&fit=inside&output=jpg&q=90';
    return get(proxied).catch(function () { return get(url); });
  }

  /** Any size → a 1920x1080 cover-cropped JPEG (3% trimmed off each edge, where photographed frames show). */
  function normalize(blob) {
    return createImageBitmap(blob).then(function (bmp) {
      var c = document.createElement('canvas');
      c.width = 1920;
      c.height = 1080;
      var sx = bmp.width * 0.03, sy = bmp.height * 0.03, sw = bmp.width - 2 * sx, sh = bmp.height - 2 * sy;
      var s = Math.max(1920 / sw, 1080 / sh);
      var w = sw * s, h = sh * s;
      c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, (1920 - w) / 2, (1080 - h) / 2, w, h);
      bmp.close();
      return new Promise(function (resolve) { c.toBlob(resolve, 'image/jpeg', 0.9); });
    });
  }

  // ---------- Daily schedule ----------

  var timer = null;
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(refresh, ms);
  }

  /** Today's painting if the current one is from another day; then fetch tomorrow's ahead. */
  function refresh() {
    var day = today();
    return get('current').then(function (cur) {
      if (cur && cur.date === day && cur.meta && cur.meta.safe === SAFE) return;
      return get('next').then(function (nxt) {
        if (nxt && (!nxt.meta || nxt.meta.safe !== SAFE)) nxt = null;   // fetched before the kid-safe filter
        return nxt ? del('next').then(function () { return nxt; }) : pick();
      }).then(function (art) {
        art.date = day;
        return put('current', art).then(function () { return show(URL.createObjectURL(art.blob), art.meta); });
      });
    }).then(function () {
      return get('next');
    }).then(function (nxt) {
      if (nxt && (!nxt.meta || nxt.meta.safe !== SAFE)) { nxt = null; del('next'); }
      if (!nxt) {
        // Prefetch tomorrow's painting in the background. Its decode and JPEG encode run on the main thread and cost
        // frames, so it waits for 10 s without remote input.
        var prefetch = function () {
          if (window.Home && window.Home.idleMs() < 10000) { setTimeout(prefetch, 5000); return; }
          pick().then(function (art) { return put('next', art); }).catch(function (e) { console.warn('prefetch:', e && e.message); });
        };
        setTimeout(prefetch, 20000);
      }
      schedule(msToMidnight() + 5000);
    }).catch(function (e) {
      console.warn('refresh:', e && e.message);
      schedule(30 * 60000);   // offline or API trouble: keep showing the cached one, try again later
    });
  }

  return {
    /** Shows the cached painting at once (or the bundled one), then keeps it current. */
    start: function (metaCallback) {
      onMeta = metaCallback;
      return get('current').catch(function () { return null; }).then(function (cur) {
        var ok = cur && cur.meta && cur.meta.safe === SAFE;   // never show a painting from before the kid-safe filter
        return ok ? show(URL.createObjectURL(cur.blob), cur.meta, true) : show(DEFAULT.src, DEFAULT.meta, true);
      }).then(function () {
        setTimeout(refresh, 3000);
      });
    },
    refresh: refresh,
    /** Bench only: crossfade to the bundled image or back to the cached one. */
    crossfade: function () {
      return get('current').then(function (cur) {
        var showingDefault = !urls[active];
        return cur && showingDefault ? show(URL.createObjectURL(cur.blob), cur.meta) : show(DEFAULT.src, DEFAULT.meta);
      });
    },
    today: today
  };
})();
