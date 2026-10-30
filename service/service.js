/*
 * The launcher's on-TV helper (a webOS JS service). Developer Mode apps are denied the power and foreground-app
 * Luna methods on webOS 24, but the TV's own remote control API (SSAP, wss://127.0.0.1:3001) allows them to a paired
 * client. This service holds one SSAP connection with the client key built in at packaging time (key.json) and:
 *  - Home takeover: when LG's home (com.webos.app.home) comes to the front, it restarts the launcher on top.
 *    Only the launcher's own LG Home button leaves LG's home up (until another app, or the launcher, is opened).
 *    No double-press escape: in a household used to pressing Home, a second press must not change the outcome.
 *  - screenOff / screenOn for the idle screensaver.
 * Plain ES5 and Node's tls only, like Free My TV's webos/service (MIT), whose WebSocket framing this follows.
 */
var tls = require('tls');
var https = require('https');
var Service = require('webos-service');

var APP = 'io.tvlauncher.home';
var LG_HOME = 'com.webos.app.home';
var service = new Service(require('./package.json').name);
var clientKey = '', adbKey = '', adbPub = '';
try {
  var keys = require('./key.json');
  clientKey = keys.clientKey;
  adbKey = keys.adbKey;
  adbPub = keys.adbPub;
} catch (e) {}

var socket = null, ready = false, buf = null, text = '', nextId = 1, waiting = {}, queue = [];
var foreground = '', takeover = true, lgMode = false, restarting = false;
var history = [], connects = 0;   // the last foreground changes and what the helper did, for status()

function note(id, action) {
  history.push({t: new Date().toISOString().slice(11, 23), app: id, action: action});
  if (history.length > 30) history.shift();
}

function buffer(x) { return Buffer.from ? Buffer.from(x) : new Buffer(x); }

function frame(textOut, opcode) {
  var data = buffer(textOut), n = data.length, head, op = 0x80 | (opcode || 1);
  var mask = buffer([Math.random() * 256 | 0, Math.random() * 256 | 0, Math.random() * 256 | 0, Math.random() * 256 | 0]);
  for (var i = 0; i < n; i++) data[i] ^= mask[i % 4];
  if (n < 126) head = buffer([op, 0x80 | n]);
  else head = buffer([op, 0xfe, n >> 8, n & 0xff]);
  return Buffer.concat([head, mask, data]);
}

function send(obj) { socket.write(frame(JSON.stringify(obj))); }

/** One SSAP request; done(payload or null). Queued until the connection is registered. */
function request(uri, payload, done) {
  if (!ready) { queue.push([uri, payload, done]); connect(); return; }
  var id = 'r' + nextId++;
  if (done) waiting[id] = done;
  send({type: 'request', id: id, uri: 'ssap://' + uri, payload: payload || {}});
}

function onMessage(m) {
  if (m.type === 'registered') {
    ready = true;
    connects++;
    send({type: 'subscribe', id: 'fg', uri: 'ssap://com.webos.applicationManager/getForegroundAppInfo', payload: {}});
    var q = queue;
    queue = [];
    q.forEach(function (r) { request(r[0], r[1], r[2]); });
  } else if (m.id === 'fg' && m.payload) {
    onForeground(m.payload.appId || '');
  } else if (m.id && waiting[m.id]) {
    var done = waiting[m.id];
    delete waiting[m.id];
    done(m.type === 'error' ? null : m.payload);
  }
}

function connect() {
  if (socket) return;
  buf = buffer([]);
  var open = false;
  socket = tls.connect({host: '127.0.0.1', port: 3001, rejectUnauthorized: false}, function () {
    socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:3001\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dHZsYXVuY2hlci1ob21lLXg=\r\n\r\n');
  });
  socket.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!open) {
      var end = buf.toString('binary').indexOf('\r\n\r\n');
      if (end < 0) return;
      if (!/^HTTP\/1\.1 101/.test(buf.toString('utf8', 0, 12))) { socket.destroy(); return; }
      open = true;
      buf = buf.slice(end + 4);
      send({type: 'register', id: 'register', payload: {'client-key': clientKey, pairingType: 'PROMPT', forcePairing: false}});
    }
    while (buf.length >= 2) {
      var fin = buf[0] & 0x80, op = buf[0] & 0x0f, n = buf[1] & 0x7f, off = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); off = 4; }
      else if (n === 127) { if (buf.length < 10) return; n = buf.readUInt32BE(6); off = 10; }
      if (buf.length < off + n) return;
      var data = buf.slice(off, off + n);
      buf = buf.slice(off + n);
      if (op === 8) { socket.destroy(); return; }
      // Answer keep-alive pings: unanswered, the TV dropped the connection every ~40 s and the helper re-registered.
      if (op === 9) { socket.write(frame(data, 0xA)); continue; }
      if (op !== 1 && op !== 0) continue;
      text += data.toString('utf8');
      if (!fin) continue;
      var m = null;
      try { m = JSON.parse(text); } catch (e) {}
      text = '';
      if (m) onMessage(m);
    }
  });
  socket.on('error', function () {});
  socket.on('close', function () {
    socket = null;
    ready = false;
    for (var id in waiting) waiting[id](null);
    waiting = {};
    setTimeout(connect, 3000);
  });
}

/**
 * Launch the launcher. The direct Luna call is allowed to this service and skips the SSAP hop; SSAP is the fallback.
 * `via` (status history) says which answered.
 */
function launchApp(done) {
  service.call('luna://com.webos.applicationManager/launch', {id: APP}, function (m) {
    if (m.payload && m.payload.returnValue) { if (done) done('luna'); return; }
    request('system.launcher/launch', {id: APP}, function () { if (done) done('ssap'); });
  });
}

/**
 * Bring the launcher back over LG's home. Normally a relaunch of the running launcher: it calls activate() and is in
 * front in 0.2-0.5 s from an app, ~1-1.5 s from an HDMI input (measured); only if it still isn't in front after 3 s is
 * it closed and started fresh. Right after the TV turns on (`cold`), the relaunch never brought it to the front (two
 * power-ons measured: still behind at 3 s, then a fresh start took 2.0-2.4 s), so it is started fresh at once.
 */
// At power-on: 'relaunchClose' (relaunch, close LG's home, fresh start if not in front by 2.5 s), 'fresh' (fresh
// start at once: ~5.6 s from start to front on a waking TV, measured), or 'relaunch' (the normal Home path).
var powerOnMode = 'relaunchClose';

function restartLauncher(cold) {
  if (restarting) return;
  restarting = true;
  if (cold && powerOnMode === 'relaunchClose') {
    // Relaunch, then close LG's home so nothing sits above the launcher.
    launchApp(function () {
      note(APP, 'relaunched (power-on)');
      request('system.launcher/close', {id: LG_HOME}, function () { note(LG_HOME, 'closed LG home'); });
      setTimeout(function () {
        if (foreground === APP) { restarting = false; return; }
        restarting = false;
        note(foreground, 'power-on relaunch not in front: fresh start');
        restarting = true;
        request('system.launcher/close', {id: APP}, function () {
          launchApp(function () { note(APP, 'restarted'); setTimeout(function () { restarting = false; }, 1500); });
        });
      }, 2500);
    });
    return;
  }
  if (cold && powerOnMode === 'relaunch') cold = false;
  function fresh(why) {
    note(foreground, why);
    request('system.launcher/close', {id: APP}, function () {
      launchApp(function () {
        note(APP, 'restarted');
        setTimeout(function () { restarting = false; }, 1500);
      });
    });
  }
  if (cold) { fresh('TV just turned on: fresh start'); return; }
  launchApp(function (via) {
    note(APP, 'relaunched via ' + via);
    setTimeout(function () {
      if (foreground === APP || foreground !== LG_HOME) { restarting = false; return; }
      fresh('relaunch not in front: restarting');
    }, 3000);
  });
}

function onForeground(id) {
  var prev = foreground;
  foreground = id;
  // Any other app, the launcher, or the TV turning off ('') ends LG-home mode, so the next power-on is ours again.
  if (id !== LG_HOME) lgMode = false;
  if (id !== LG_HOME) { note(id, ''); return; }
  if (prev === LG_HOME) { note(id, 'still LG home'); return; }
  if (!takeover) { note(id, 'takeover off'); return; }
  if (lgMode) { note(id, 'LG Home button'); return; }
  if (restarting) { note(id, 'already restarting'); return; }
  // LG's home straight after a blank screen ('' = TV off or in standby) is the TV turning on.
  note(id, prev === '' ? 'takeover (power-on)' : 'takeover');
  restartLauncher(prev === '');
}

// ---------- Fire TV: ADB over the network, to open its apps from the launcher ----------

var adb = require('./adb.js');

// ---------- Methods the launcher calls ----------

// The launcher subscribes on start; the open subscription keeps this service alive.
service.register('start', function (message) {
  connect();
  if (typeof message.payload.takeover === 'boolean') takeover = message.payload.takeover;
  message.respond({returnValue: true, connected: ready, paired: !!clientKey});
});

service.register('lgHome', function (message) {
  lgMode = true;
  request('system.launcher/launch', {id: LG_HOME}, function (res) {
    message.respond({returnValue: !!res});
  });
});

service.register('screenOff', function (message) {
  request('com.webos.service.tvpower/power/turnOffScreen', {standbyMode: 'active'}, function (res) {
    message.respond({returnValue: !!(res && res.returnValue)});
  });
});

service.register('screenOn', function (message) {
  request('com.webos.service.tvpower/power/turnOnScreen', {standbyMode: 'active'}, function (res) {
    message.respond({returnValue: !!(res && res.returnValue)});
  });
});

// {host, package}: wake the Fire TV and open the app's TV launcher activity. Only that: any app on the TV can call
// this service, so it takes no shell command, only a package name, and only a host on the local network.
service.register('firetv', function (message) {
  var p = message.payload;
  // Fire OS refuses `monkey` here ("SYS_KEYS has no physical keys"), so resolve the app's TV launch activity
  // (LEANBACK_LAUNCHER, else LAUNCHER) and start it with am.
  var resolve = function (cat) {
    return 'cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.' + cat +
      ' ' + p.package + ' | tail -1';
  };
  var local = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}(\.\d{1,3})?$/.test(String(p.host || ''));
  if (!/^[A-Za-z][\w]*(\.[\w]+)+$/.test(String(p.package || '')) || !local) {
    message.respond({returnValue: false, errorText: 'bad request'});
    return;
  }
  var cmd = 'input keyevent KEYCODE_WAKEUP; c=$(' + resolve('LEANBACK_LAUNCHER') + '); ' +
    'case "$c" in */*) ;; *) c=$(' + resolve('LAUNCHER') + ');; esac; am start -n "$c"';
  adb.shell(p.host, cmd, {key: adbKey, pub: adbPub}, function (err, out) {
    message.respond(err ? {returnValue: false, errorText: err} : {returnValue: true, output: out.slice(-2000)});
  });
});

// {url}: an https text file the page can't read itself for lack of CORS (a published .ics calendar). Follows up to
// three redirects; at most 2 MB.
service.register('fetchText', function (message) {
  var url = String(message.payload.url || '');
  if (!/^https:\/\//.test(url)) { message.respond({returnValue: false, errorText: 'https only'}); return; }
  (function get(u, hops) {
    https.get(u, {headers: {'User-Agent': 'CleanCanvas/1.0'}}, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 3) {
        res.resume();
        get(require('url').resolve(u, res.headers.location), hops + 1);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); message.respond({returnValue: false, errorText: 'HTTP ' + res.statusCode}); return; }
      var chunks = [], size = 0;
      res.on('data', function (c) {
        size += c.length;
        if (size > 2 * 1024 * 1024) { res.destroy(); return; }
        chunks.push(c);
      });
      res.on('end', function () { message.respond({returnValue: true, text: Buffer.concat(chunks).toString('utf8')}); });
    }).on('error', function (e) { message.respond({returnValue: false, errorText: e.message}); });
  })(url, 0);
});

// Developer Mode expires after ~1000 hours and then removes this app. Opening LG's Developer Mode app with
// {extend: true} does what its Extend button does (measured: 982 h left -> 999:59 h); then the launcher comes back.
service.register('extendDevMode', function (message) {
  service.call('luna://com.webos.applicationManager/launch', {id: 'com.palmdts.devmode', params: {extend: true}}, function (m) {
    var ok = !!(m.payload && m.payload.returnValue);
    note('com.palmdts.devmode', ok ? 'extend requested' : 'extend failed');
    setTimeout(function () { launchApp(function () { note(APP, 'back after extend'); }); }, 6000);
    message.respond({returnValue: ok});
  });
});

service.register('status', function (message) {
  message.respond({returnValue: true, connected: ready, foreground: foreground, takeover: takeover,
    lgMode: lgMode, paired: !!clientKey, connects: connects, history: history});
});

connect();
