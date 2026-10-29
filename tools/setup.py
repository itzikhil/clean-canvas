#!/usr/bin/env python3
"""Clean Canvas setup: one command from a TV in Developer Mode to the installed home screen.

    python3 tools/setup.py

It finds the TV, pairs with it (the TV asks twice to allow), lets you pick the apps for the dock, looks up your city
for the weather and sunset, asks for your language and calendars, writes app/config.local.js, and installs.
Run it again any time to change those choices (the previous settings are kept as config.local.js.bak).
"""
import json
import os
import re
import socket
import struct
import subprocess
import sys
import urllib.parse
import urllib.request
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import list_apps  # noqa: E402
import tvlib  # noqa: E402

ROOT = tvlib.ROOT
APP = os.path.join(ROOT, 'app')
LANGUAGES = {'en': 'English', 'de': 'Deutsch', 'he': 'עברית', 'es': 'Español', 'fr': 'Français'}


def ask(prompt, default=''):
    answer = input('%s%s: ' % (prompt, ' [%s]' % default if default else '')).strip()
    return answer or default


def step(n, title):
    print('\n%d. %s' % (n, title))


# ---------- Finding the TV ----------

def discover(timeout=3):
    """LG webOS TVs on the network, via SSDP: [(ip, name)]."""
    msg = ('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\n'
           'ST: urn:lge-com:service:webos-second-screen:1\r\n\r\n').encode()
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    s.settimeout(timeout)
    s.sendto(msg, ('239.255.255.250', 1900))
    found = {}
    try:
        while True:
            data, addr = s.recvfrom(4096)
            text = data.decode('utf-8', 'replace')
            if 'webos' in text.lower() or 'lge' in text.lower():
                found[addr[0]] = re.search(r'(?im)^server:\s*(.*)$', text).group(1).strip() if 'server:' in text.lower() else ''
    except socket.timeout:
        pass
    finally:
        s.close()
    return sorted(found.items())


def port_open(ip, port):
    try:
        socket.create_connection((ip, port), timeout=3).close()
        return True
    except OSError:
        return False


# ---------- Tile colours: the icon's own background, so the icon reads as a full-bleed logo ----------

def corner_colour(path):
    """The colour of a PNG's top-left area as '#rrggbb', or '' (palette PNGs and odd files: no guess)."""
    try:
        data = open(path, 'rb').read()
        i, idat, w = 8, b'', 0
        while i < len(data):
            n, kind = struct.unpack('>I4s', data[i:i + 8])
            chunk = data[i + 8:i + 8 + n]
            if kind == b'IHDR':
                w, _, depth, ctype = struct.unpack('>IIBB', chunk[:10])
                if depth != 8 or ctype not in (2, 6):
                    return ''
            elif kind == b'IDAT':
                idat += chunk
            i += 12 + n
        raw = zlib.decompress(idat)
        bpp = 4 if ctype == 6 else 3
        stride = w * bpp
        prev = bytearray(stride)
        pos = 0
        for _ in range(4):   # unfilter the first four rows
            f, line = raw[pos], bytearray(raw[pos + 1:pos + 1 + stride])
            pos += 1 + stride
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b, c = prev[x], prev[x - bpp] if x >= bpp else 0
                if f == 1:
                    line[x] = (line[x] + a) & 255
                elif f == 2:
                    line[x] = (line[x] + b) & 255
                elif f == 3:
                    line[x] = (line[x] + (a + b) // 2) & 255
                elif f == 4:
                    pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                    line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
            prev = line
        px = prev[3 * bpp:3 * bpp + bpp]
        if bpp == 4 and px[3] < 128:
            return ''   # transparent corner: let the default tile colour show
        return '#%02x%02x%02x' % (px[0], px[1], px[2])
    except Exception:
        return ''


def place_lookup(name, language):
    url = 'https://geocoding-api.open-meteo.com/v1/search?count=5&language=%s&name=%s' % (language, urllib.parse.quote(name))
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.load(r).get('results') or []


def js(value):
    return json.dumps(value, ensure_ascii=False)


def main():
    print(__doc__.strip().splitlines()[0])

    step(1, 'Finding the TV')
    tvs = discover()
    for i, (ip, server) in enumerate(tvs, 1):
        print('   %d. %s  %s' % (i, ip, server))
    default = tvs[0][0] if tvs else ''
    choice = ask('TV address (number or IP)', '1' if tvs else '')
    ip = tvs[int(choice) - 1][0] if choice.isdigit() and 0 < int(choice) <= len(tvs) else choice or default
    if not re.match(r'^\d{1,3}(\.\d{1,3}){3}$', ip):
        sys.exit('An IP address like 192.168.1.50 is needed (TV: Settings > Network > the connection > IP address).')
    with open(os.path.join(ROOT, 'tools', 'tv.local.json'), 'w') as f:
        json.dump({'ip': ip}, f)
    os.environ['TV_IP'] = ip

    step(2, 'Checking Developer Mode')
    if not port_open(ip, 9922):
        sys.exit('Developer Mode is not on. On the TV: install "Developer Mode" from the LG Content Store, sign in with a '
                 'free account from webostv.developer.lge.com, turn on Dev Mode Status (the TV restarts) and Key Server.')
    if not port_open(ip, 9991) and not os.path.exists(tvlib.key_path(ip)):
        sys.exit('Turn on Key Server in the Developer Mode app, then run this again.')
    print('   Developer Mode is on.')

    step(3, 'Pairing (choose Allow on the TV, twice)')
    sys.argv = ['list_apps.py', ip]
    list_apps.main()
    tvlib.ssap(ip, 'com.webos.service.tvpower/power/getPowerState', home=True)
    print('   Paired.')

    step(4, 'Apps in the dock')
    # The numbers list_apps.py printed above index its full list (this app included, once installed).
    with open(os.path.join(ROOT, 'tools', 'apps.local.json'), encoding='utf-8') as f:
        listed = json.load(f)
    picks = ask('Numbers from the list above, in dock order (e.g. 2,3,5,4)', '')
    dock = []
    for n in re.findall(r'\d+', picks):
        i = int(n) - 1
        if 0 <= i < len(listed) and listed[i]['id'] != 'io.tvlauncher.home':
            a = listed[i]
            bg = corner_colour(os.path.join(APP, a['icon'])) if a['icon'] else ''
            dock.append({'id': a['id'], 'title': a['title'], 'icon': a['icon'], 'bg': bg or a.get('color') or '#2c2c2e'})
    print('   Dock: ' + (', '.join(d['title'] for d in dock) or '(the first five apps)'))

    step(5, 'Language')
    for code, name in LANGUAGES.items():
        print('   %s  %s' % (code, name))
    language = ask('Language', 'en')
    if language not in LANGUAGES:
        language = 'en'

    step(6, 'Your town (for the weather, the time zone and the sunset)')
    place, zone = None, 'Europe/Berlin'
    name = ask('Town or city (Enter to skip)', '')
    if name:
        results = place_lookup(name, language)
        for i, r in enumerate(results, 1):
            print('   %d. %s, %s, %s' % (i, r['name'], r.get('admin1', ''), r.get('country', '')))
        if results:
            r = results[int(ask('Which one', '1')) - 1]
            place = {'name': r['name'], 'latitude': round(r['latitude'], 4), 'longitude': round(r['longitude'], 4)}
            zone = r.get('timezone') or zone

    step(7, 'Calendars (optional): read-only .ics links, one line per person. README: "Calendars"')
    calendars = []
    while True:
        who = ask('Name (Enter when done)', '')
        if not who:
            break
        link = ask('  Link (.ics) for ' + who, '')
        if link:
            entry = {'name': who, 'ics': link}
            if ask('  Only timed meetings? (y/N)', 'n').lower().startswith('y'):
                entry['meetingsOnly'] = True
            calendars.append(entry)

    step(8, 'Writing app/config.local.js')
    path = os.path.join(APP, 'config.local.js')
    if os.path.exists(path):
        os.replace(path, path + '.bak')
        print('   (previous settings kept as config.local.js.bak)')
    lines = ['/* Written by tools/setup.py. Personal settings: not in git. Overrides app/config.js. */',
             'Object.assign(window.CONFIG, {',
             '  timeZone: %s,' % js(zone),
             '  language: %s,' % js(language),
             '  apps: [' + ','.join('\n    ' + js(d) for d in dock) + ('\n  ],' if dock else '],'),
             '  place: %s,' % js(place),
             '  calendars: [' + ','.join('\n    ' + js(c) for c in calendars) + ('\n  ]' if calendars else ']'),
             '});', '']
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print('   Done. Edit it any time (README: "Settings"), then: python3 tools/install.py')

    step(9, 'Installing (the first time it asks for the passphrase shown in the Developer Mode app)')
    subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'install.py'), '--ip', ip], check=False)
    print('\nOn the TV: with Clean Canvas open, hold 1 on the remote to pin it to that key. Enjoy.')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nStopped.')
