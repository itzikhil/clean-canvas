"""Talking to the LG TV from the Mac: its remote control API (SSAP, port 3000) and Developer Mode SSH (port 9922).

SSAP client and SSH/luna flow adapted from Free My TV (github.com/simbasjungles/free-my-tv, webos/, MIT).
"""
import base64
import getpass
import json
import os
import shutil
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
import urllib.request

HOME = os.path.expanduser('~')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def default_ip():
    """The TV's address: $TV_IP, else tools/tv.local.json {"ip": ...} (not in git)."""
    if os.environ.get('TV_IP'):
        return os.environ['TV_IP']
    path = os.path.join(ROOT, 'tools', 'tv.local.json')
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)['ip']
    sys.exit('Set the TV address: TV_IP=192.168.1.50 or tools/tv.local.json with {"ip": "192.168.1.50"}.')
SSH_OPTS = ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=' + os.devnull, '-o', 'LogLevel=ERROR',
            '-o', 'HostKeyAlgorithms=+ssh-rsa', '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa', '-p', '9922']
MANIFEST = {'manifestVersion': 1, 'appVersion': '1.0', 'permissions': ['READ_INSTALLED_APPS', 'LAUNCH']}


class Socket:
    """Just enough of a WebSocket client (RFC 6455) for SSAP: text messages, no extensions."""

    def __init__(self, ip, port=3001):
        # webOS 24 resets plain ws:// on 3000; wss:// on 3001 uses a self-signed certificate.
        raw = socket.create_connection((ip, port), timeout=10)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        self.sock = ctx.wrap_socket(raw, server_hostname=ip) if port == 3001 else raw
        key = base64.b64encode(os.urandom(16)).decode('ascii')
        self.sock.sendall(('GET / HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                           'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n' % (ip, port, key)).encode())
        self.buf = b''
        while b'\r\n\r\n' not in self.buf:
            self.buf += self._recv()
        head, self.buf = self.buf.split(b'\r\n\r\n', 1)
        if b' 101 ' not in head.split(b'\r\n', 1)[0]:
            raise OSError('TV refused the connection: ' + head.split(b'\r\n', 1)[0].decode('latin-1'))

    def _recv(self):
        chunk = self.sock.recv(65536)
        if not chunk:
            raise OSError('TV closed the connection')
        return chunk

    def _exactly(self, n):
        while len(self.buf) < n:
            self.buf += self._recv()
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _frame(self, opcode, payload):
        mask = os.urandom(4)
        n = len(payload)
        head = struct.pack('!B', 0x80 | opcode)
        head += (struct.pack('!B', 0x80 | n) if n < 126 else
                 struct.pack('!BH', 0x80 | 126, n) if n < 65536 else struct.pack('!BQ', 0x80 | 127, n))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def send(self, message):
        self._frame(0x1, json.dumps(message).encode())

    def receive(self, timeout):
        self.sock.settimeout(timeout)
        parts = []
        while True:
            b0, b1 = self._exactly(2)
            n = b1 & 0x7f
            if n == 126:
                n = struct.unpack('!H', self._exactly(2))[0]
            elif n == 127:
                n = struct.unpack('!Q', self._exactly(8))[0]
            mask = self._exactly(4) if b1 & 0x80 else None
            payload = self._exactly(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            op = b0 & 0x0f
            if op == 0x8:
                raise OSError('TV closed the connection')
            if op == 0x9:
                self._frame(0xA, payload)
            elif op in (0x0, 0x1):
                parts.append(payload)
                if b0 & 0x80:
                    return json.loads(b''.join(parts).decode())

    def close(self):
        try:
            self._frame(0x8, b'')
            self.sock.close()
        except OSError:
            pass


def home_key_path(ip):
    """The helper's SSAP client key (signed manifest), built into the app by tools/build.py."""
    return os.path.join(HOME, '.ssh', 'tvlauncher_ssap_home_' + ip.replace('.', '_'))


SETTINGS_MANIFEST = {'manifestVersion': 1, 'appVersion': '1.0',
                     'permissions': ['READ_SETTINGS', 'WRITE_SETTINGS', 'READ_INSTALLED_APPS']}


def ssap(ip, uri, payload=None, home=False, settings=False):
    """One SSAP request; pairs first (the TV asks once, the key is kept in ~/.ssh).

    home=True pairs with tools/ssap_manifest.json, the permissions the helper needs (the running app,
    power state, screen control); that key goes into the app for its on-TV helper.
    """
    if settings:   # tools/tv_settings.py only; this key never goes into the app
        path = os.path.join(HOME, '.ssh', 'tvlauncher_ssap_settings_' + ip.replace('.', '_'))
    else:
        path = home_key_path(ip) if home else os.path.join(HOME, '.ssh', 'tvlauncher_ssap_' + ip.replace('.', '_'))
    key = open(path).read().strip() if os.path.exists(path) else None
    manifest = SETTINGS_MANIFEST if settings else MANIFEST
    if home:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ssap_manifest.json'), encoding='utf-8') as f:
            manifest = json.load(f)
        manifest.pop('_comment', None)
    ws = Socket(ip)
    try:
        reg = {'forcePairing': False, 'pairingType': 'PROMPT', 'manifest': manifest}
        if key:
            reg['client-key'] = key
        ws.send({'type': 'register', 'id': 'register', 'payload': reg})
        if not key:
            print('On the TV, choose Allow ...')
        while True:
            m = ws.receive(timeout=90)
            if m.get('type') == 'error':
                sys.exit('TV said: %s' % (m.get('error') or json.dumps(m)))
            if m.get('type') == 'registered':
                os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
                with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f:
                    f.write(m['payload']['client-key'])
                req = {'type': 'request', 'id': 'call', 'uri': 'ssap://' + uri}
                if payload is not None:
                    req['payload'] = payload
                ws.send(req)
            elif m.get('id') == 'call':
                return m.get('payload') or {}
    finally:
        ws.close()


def key_path(ip):
    return os.path.join(HOME, '.ssh', 'tvlauncher_webos_' + ip.replace('.', '_'))


def fetch_key(ip):
    """The TV's dev-mode SSH key from its Key Server, unlocked once with the passphrase the TV shows."""
    path = key_path(ip)
    if os.path.exists(path):
        return path
    with urllib.request.urlopen('http://%s:9991/webos_rsa' % ip, timeout=6) as r:
        data = r.read()
    passphrase = getpass.getpass('Passphrase shown in the Developer Mode app on the TV: ').strip()
    tmp = tempfile.NamedTemporaryFile(delete=False)
    tmp.write(data)
    tmp.close()
    os.chmod(tmp.name, 0o600)
    res = subprocess.run(['ssh-keygen', '-p', '-P', passphrase, '-N', '', '-f', tmp.name], capture_output=True, text=True)
    if res.returncode != 0:
        os.unlink(tmp.name)
        sys.exit('Passphrase did not unlock the key: ' + (res.stderr.strip().splitlines() or [''])[-1])
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    shutil.move(tmp.name, path)
    os.chmod(path, 0o600)
    return path


def ssh(ip, key, command, stdin=None, tty=False):
    args = ['ssh'] + (['-tt'] if tty else []) + SSH_OPTS + ['-i', key, 'prisoner@' + ip, command]
    return subprocess.run(args, stdin=stdin, capture_output=True, text=stdin is None)


def luna(ip, key, uri, payload, replies=1, wait=20):
    """luna-send-pub over dev-mode SSH. It prints nothing without a terminal (-tt); -i is the fallback."""
    t = "if timeout -t 1 true 2>/dev/null; then T='timeout -t %d'; else T='timeout %d'; fi; " % (wait, wait)
    msg = "%s '%s'" % (uri, json.dumps(payload, separators=(',', ':')))
    out = ssh(ip, key, t + '$T luna-send-pub -n %d %s' % (replies, msg), tty=True).stdout or ''
    if not out.strip():
        out = ssh(ip, key, t + '$T luna-send-pub -i %s </dev/null' % msg).stdout or ''
    return out
