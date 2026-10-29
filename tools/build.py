#!/usr/bin/env python3
"""Packs app/ into dist/<id>_<version>_all.ipk the way LG's ares-package does (no LG tools needed).

    python3 tools/build.py

An .ipk is an ar archive: debian-binary, control.tar.gz, data.tar.gz (the app under usr/palm/applications/<id>).
Packaging approach from Free My TV (github.com/simbasjungles/free-my-tv, webos/build.py, MIT).
"""
import io
import json
import os
import tarfile
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'app')
SERVICE = os.path.join(ROOT, 'service')
SKIP = {'.DS_Store', 'config.local.example.js'}


def app_info():
    with open(os.path.join(APP, 'appinfo.json'), encoding='utf-8') as f:
        return json.load(f)


def ipk_path():
    info = app_info()
    return os.path.join(ROOT, 'dist', '%s_%s_all.ipk' % (info['id'], info['version']))


def adb_keys():
    """The helper's ADB key for the Fire TV: (private key PEM, public key in Android's adbkey.pub format).

    Created once in ~/.ssh/tvlauncher_adbkey (openssl). Android's format is a little-endian struct (word count, n0inv,
    modulus, R^2 mod n, exponent), base64; Python's big ints compute it here so the TV's Node needs only RSA signing.
    """
    import base64
    import re
    import struct
    import subprocess
    path = os.path.join(os.path.expanduser('~'), '.ssh', 'tvlauncher_adbkey')
    if not os.path.exists(path):
        subprocess.run(['openssl', 'genrsa', '-traditional', '-out', path, '2048'], check=True, capture_output=True)
        os.chmod(path, 0o600)
    pem = open(path).read()
    text = subprocess.run(['openssl', 'rsa', '-in', path, '-noout', '-text'], capture_output=True, text=True).stdout
    n = int(re.sub(r'[^0-9a-f]', '', re.search(r'modulus:\s*([0-9a-f:\s]+)publicExponent', text).group(1)), 16)
    words = 64
    n0inv = (-pow(n % 2 ** 32, -1, 2 ** 32)) % 2 ** 32
    rr = pow(2 ** (32 * words), 2, n)
    blob = struct.pack('<II', words, n0inv) + n.to_bytes(words * 4, 'little') + rr.to_bytes(words * 4, 'little') + \
        struct.pack('<I', 65537)
    return pem, base64.b64encode(blob).decode() + ' tvlauncher@lgtv'


def tar_gz(entries):
    """A .tar.gz from [(name, bytes or None for a directory)], owned by root."""
    buf = io.BytesIO()
    now = int(time.time())
    with tarfile.open(fileobj=buf, mode='w:gz', format=tarfile.PAX_FORMAT) as tar:
        for name, data in entries:
            info = tarfile.TarInfo(name)
            info.mtime = now
            info.uid = info.gid = 0
            if data is None:
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
                tar.addfile(info)
            else:
                info.size = len(data)
                info.mode = 0o644
                tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def ar(members):
    out = io.BytesIO()
    out.write(b'!<arch>\n')
    now = int(time.time())
    for name, data in members:
        out.write(('%-16s%-12d%-6d%-6d%-8s%-10d`\n' % (name, now, 0, 0, '100644', len(data))).encode('ascii'))
        out.write(data)
        if len(data) % 2:
            out.write(b'\n')
    return out.getvalue()


def build():
    info = app_info()
    app_id, version = info['id'], info['version']
    base = 'usr/palm/applications/' + app_id
    entries = [('usr', None), ('usr/palm', None), ('usr/palm/applications', None), (base, None)]
    size = 0
    for dirpath, dirnames, filenames in os.walk(APP):
        dirnames.sort()
        rel = os.path.relpath(dirpath, APP)
        if rel != '.':
            entries.append((base + '/' + rel.replace(os.sep, '/'), None))
        for name in sorted(filenames):
            if name in SKIP:
                continue
            with open(os.path.join(dirpath, name), 'rb') as f:
                data = f.read()
            size += len(data)
            path = name if rel == '.' else rel.replace(os.sep, '/') + '/' + name
            entries.append((base + '/' + path, data))

    # The helper service (service/service.js) with the SSAP client key from tools/list_apps.py --pair-helper.
    # The key stays out of git: it is read from ~/.ssh at build time.
    service_id = app_id + '.service'
    sbase = 'usr/palm/services/' + service_id
    from tvlib import home_key_path, default_ip
    key_file = home_key_path(default_ip())
    key = open(key_file).read().strip() if os.path.exists(key_file) else ''
    if not key:
        print('Warning: no helper key at %s; Home takeover and screen-off will not work.' % key_file)
    adb_key, adb_pub = adb_keys()
    with open(os.path.join(SERVICE, 'service.js'), 'rb') as f:
        sfiles = {
            'service.js': f.read(),
            'adb.js': open(os.path.join(SERVICE, 'adb.js'), 'rb').read(),
            'package.json': json.dumps({'name': service_id, 'version': version, 'main': 'service.js'}, indent=2).encode(),
            'services.json': json.dumps({'id': service_id, 'description': 'Home helper',
                                         'services': [{'name': service_id, 'description': 'Home helper'}]}, indent=2).encode(),
            'key.json': json.dumps({'clientKey': key, 'adbKey': adb_key, 'adbPub': adb_pub}).encode(),
        }
    entries += [('usr/palm/services', None), (sbase, None)]
    entries += [(sbase + '/' + n, sfiles[n]) for n in sorted(sfiles)]
    size += sum(len(d) for d in sfiles.values())

    # Files each TV makes for itself (not in git): empty stand-ins when they don't exist yet.
    for name, stub in (('config.local.js', b'/* no personal settings yet: see config.local.example.js */\n'),
                       ('apps.js', b'window.ALL_APPS = [];   /* python3 tools/list_apps.py fills this */\n')):
        if not os.path.exists(os.path.join(APP, name)):
            entries.append((base + '/' + name, stub))

    package = json.dumps({'id': app_id, 'version': version, 'app': app_id, 'services': [service_id]}, indent=2).encode()
    entries += [('usr/palm/packages', None), ('usr/palm/packages/' + app_id, None),
                ('usr/palm/packages/' + app_id + '/packageinfo.json', package)]
    control = ('Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: %d\n'
               'Maintainer: tv-launcher\nDescription: Minimal home screen.\n'
               'webOS-Package-Format-Version: 2\nwebOS-Packager-Version: 1.0.0\n' % (app_id, version, size + len(package)))
    data = ar([('debian-binary', b'2.0\n'), ('control.tar.gz', tar_gz([('control', control.encode())])),
               ('data.tar.gz', tar_gz(entries))])
    out = ipk_path()
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'wb') as f:
        f.write(data)
    print('Built %s (%d KB)' % (os.path.relpath(out, ROOT), len(data) // 1024))
    return out


if __name__ == '__main__':
    build()
