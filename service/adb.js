/*
 * A minimal ADB client over TCP (port 5555): enough to run one shell command on a Fire TV with ADB debugging on.
 * Used by the helper service on the TV and by tools/firetv.js on the Mac. Plain ES5, Node's net and crypto only.
 */
var net = require('net');
var crypto = require('crypto');

function buffer(x) { return Buffer.from ? Buffer.from(x) : new Buffer(x); }

var A = {CNXN: 0x4e584e43, AUTH: 0x48545541, OPEN: 0x4e45504f, OKAY: 0x59414b4f, CLSE: 0x45534c43, WRTE: 0x45545257};
var SHA1_PREFIX = buffer([0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14]);

function adbPacket(cmd, arg0, arg1, data) {
  data = data || buffer([]);
  var sum = 0;
  for (var i = 0; i < data.length; i++) sum = (sum + data[i]) >>> 0;
  var h = Buffer.alloc ? Buffer.alloc(24) : new Buffer(24);
  h.writeUInt32LE(cmd, 0);
  h.writeUInt32LE(arg0 >>> 0, 4);
  h.writeUInt32LE(arg1 >>> 0, 8);
  h.writeUInt32LE(data.length, 12);
  h.writeUInt32LE(sum, 16);
  h.writeUInt32LE((cmd ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([h, data]);
}

/**
 * Runs one shell command on the Fire TV: connect, answer its token with our key (the first time, the Fire TV asks to
 * allow this computer: "Always allow"), open shell:<command>, collect the output. done(error, output).
 */
function shell(host, command, keys, done) {
  var sock = net.connect(5555, host), buf = buffer([]), out = '', finished = false, sentKey = false;
  var timer = setTimeout(function () { finish('timeout (is ADB debugging on, and was this TV allowed?)'); }, 30000);
  function finish(err) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    sock.destroy();
    done(err, out);
  }
  sock.on('connect', function () {
    sock.write(adbPacket(A.CNXN, 0x01000000, 4096, buffer('host::\0')));
  });
  sock.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 24) {
      var cmd = buf.readUInt32LE(0), arg0 = buf.readUInt32LE(4), len = buf.readUInt32LE(12);
      if (buf.length < 24 + len) return;
      var data = buf.slice(24, 24 + len);
      buf = buf.slice(24 + len);
      if (cmd === A.AUTH && arg0 === 1) {
        if (!sentKey) {
          // Sign the token as a SHA-1 digest (PKCS#1 v1.5), the way adb does.
          sentKey = true;
          var sig = crypto.privateEncrypt({key: keys.key, padding: crypto.constants.RSA_PKCS1_PADDING},
            Buffer.concat([SHA1_PREFIX, data]));
          sock.write(adbPacket(A.AUTH, 2, 0, sig));
        } else {
          sock.write(adbPacket(A.AUTH, 3, 0, buffer(keys.pub + '\0')));   // unknown key: the Fire TV asks to allow
        }
      } else if (cmd === A.CNXN) {
        sock.write(adbPacket(A.OPEN, 1, 0, buffer('shell:' + command + '\0')));
      } else if (cmd === A.WRTE) {
        out += data.toString('utf8');
        sock.write(adbPacket(A.OKAY, 1, arg0));
      } else if (cmd === A.CLSE) {
        finish(null);
      }
    }
  });
  sock.on('error', function (e) { finish(e.message); });
  sock.on('close', function () { finish(out ? null : 'connection closed'); });
}

module.exports = {shell: shell};
