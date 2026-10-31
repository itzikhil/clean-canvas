#!/usr/bin/env python3
"""Clean Canvas hub: an always-on computer at home does the heavy lifting, the TV only shows the result.

Every few minutes it reads your Emby "Continue watching" list (log in once with emby_login.py), drops titles rated
16+ (and repeats of the same title), saves small landscape covers, and serves feed.json and the covers on the home
network. The launcher shows them as a row above the dock while the Emby tile is focused.

OK on a card opens Emby on the TV and asks the hub to POST /play?id=<item>: the hub waits for the TV's Emby app to
come online and tells it to play that title from where you stopped (Emby's own remote control, like its phone app).

    python3 hub/hub.py [--port 8787] [--every 300] [--max-age 16] [--player "Emby for LG"]

With ~/.clean-canvas/tv.json it also watches the TV: after the TV restarts fully, nothing of ours runs on it, so the
hub opens the launcher once LG's home has stayed up for 8 s after power-on (see watch_tv).

Towards Emby it only reads, except that one "play this" command. It serves only feed.json and covers/*.jpg, and
plays only titles that are in the current feed; nothing else on this computer.
"""
import argparse
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = os.path.expanduser('~/.clean-canvas')
LOGIN = os.path.join(HOME, 'emby.json')
OUT = os.path.join(HOME, 'hub')
COVERS = os.path.join(OUT, 'covers')
AUTH = 'MediaBrowser Client="Clean Canvas", Device="Home screen", DeviceId="clean-canvas-home", Version="1.0"'
MAX_ITEMS = 10


def log(*a):
    print(time.strftime('%Y-%m-%d %H:%M:%S'), *a, flush=True)


def get(s, path, raw=False, post=False):
    req = urllib.request.Request(s['base'] + path, data=b'' if post else None, headers={
        'X-Emby-Authorization': AUTH, 'X-Emby-Token': s['token'], 'Accept': '*/*' if raw else 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    return data if raw or post else json.loads(data)


def play(item_id, player):
    """Start item_id on the TV's Emby app at its resume point, once that app is online (it may still be starting)."""
    s = json.load(open(LOGIN))
    t0 = time.time()
    while time.time() - t0 < 30:
        live = [x for x in get(s, '/Sessions')
                if x.get('Client') == player and x.get('UserId') == s['user'] and x.get('SupportsRemoteControl')]
        if live:
            break
        time.sleep(1)
    else:
        return log('play: no %s online within 30 s' % player)
    session = max(live, key=lambda x: x.get('LastActivityDate') or '')
    ticks = (get(s, '/Users/%s/Items/%s' % (s['user'], item_id)).get('UserData') or {}).get('PlaybackPositionTicks') or 0
    get(s, '/Sessions/%s/Playing?ItemIds=%s&PlayCommand=PlayNow&StartPositionTicks=%d' % (session['Id'], item_id, ticks),
        post=True)
    log('play: %s at %d min after %.1f s' % (item_id, ticks // 600000000, time.time() - t0))


# Age ratings: the number in the rating ('FSK-16', 'DE-12', '15', '18+'), else the US/UK letter ratings.
# A title with no rating stays in: no rating is not a guessed rating.
LETTERS = {'G': 0, 'TV-Y': 0, 'TV-G': 0, 'U': 0, 'PG': 8, 'TV-Y7': 7, 'TV-Y7-FV': 7, 'TV-PG': 10,
           'PG-13': 13, 'TV-14': 14, 'R': 17, 'TV-MA': 17, 'NC-17': 18, 'X': 18, 'XXX': 18}


def age(rating):
    if not rating:
        return None
    r = rating.strip().upper()
    for prefix in ('US-', 'GB-', 'UK-'):
        if r.startswith(prefix):
            r = r[len(prefix):]
    if r in LETTERS:
        return LETTERS[r]
    m = re.search(r'(\d{1,2})', r)
    return int(m.group(1)) if m else None


def cover_path(item):
    """A landscape picture: an episode's own still, else the film's Thumb, else its backdrop, else the poster."""
    tags = item.get('ImageTags') or {}
    if item.get('Type') == 'Episode' and 'Primary' in tags:
        return '/Items/%s/Images/Primary' % item['Id']
    if 'Thumb' in tags:
        return '/Items/%s/Images/Thumb' % item['Id']
    if item.get('BackdropImageTags'):
        return '/Items/%s/Images/Backdrop/0' % item['Id']
    if item.get('ParentBackdropImageTags') and item.get('ParentBackdropItemId'):
        return '/Items/%s/Images/Backdrop/0' % item['ParentBackdropItemId']
    if 'Primary' in tags:
        return '/Items/%s/Images/Primary' % item['Id']
    return None


series_rating = {}   # series id -> OfficialRating (or '' when the series has none)


def refresh(s, max_age):
    fields = 'OfficialRating,ImageTags,BackdropImageTags,ParentBackdropImageTags,ParentBackdropItemId,ProductionYear'
    items = get(s, '/Users/%s/Items/Resume?Limit=30&MediaTypes=Video&Fields=%s' % (s['user'], fields)).get('Items', [])
    need = sorted({i['SeriesId'] for i in items if i.get('SeriesId') and i['SeriesId'] not in series_rating})
    if need:
        for x in get(s, '/Users/%s/Items?Ids=%s&Fields=OfficialRating' % (s['user'], ','.join(need))).get('Items', []):
            series_rating[x['Id']] = x.get('OfficialRating') or ''
    out, seen, hidden = [], set(), 0
    for i in items:
        is_ep = i.get('Type') == 'Episode'
        if is_ep and i.get('SeriesId') not in series_rating:
            continue   # the series' rating did not arrive: leave it out this round rather than guess
        rating = series_rating.get(i.get('SeriesId')) if is_ep else i.get('OfficialRating')
        a = age(rating)
        if max_age and a is not None and a >= max_age:
            hidden += 1
            continue
        key = i.get('SeriesId') or (i.get('Name'), i.get('ProductionYear'))
        if key in seen:
            continue
        seen.add(key)
        pic = cover_path(i)
        if not pic:
            continue
        name = 'c%s.jpg' % i['Id']
        dest = os.path.join(COVERS, name)
        if not os.path.exists(dest):
            data = get(s, pic + '?maxWidth=576&quality=82&format=jpg', raw=True)
            with open(dest + '.tmp', 'wb') as f:
                f.write(data)
            os.replace(dest + '.tmp', dest)
        if is_ep:
            sub = 'S%d E%d · %s' % (i.get('ParentIndexNumber') or 0, i.get('IndexNumber') or 0, i.get('Name', ''))
            title = i.get('SeriesName') or i.get('Name', '')
        else:
            sub = str(i.get('ProductionYear') or '')
            title = i.get('Name', '')
        pct = (i.get('UserData') or {}).get('PlayedPercentage')
        out.append({'id': i['Id'], 'title': title, 'sub': sub, 'pct': round(pct) if pct else 0, 'img': 'covers/' + name})
        if len(out) >= MAX_ITEMS:
            break
    keep = {o['img'][7:] for o in out}
    for f in os.listdir(COVERS):
        if f not in keep and f.endswith('.jpg'):
            os.remove(os.path.join(COVERS, f))
    feed = {'updated': int(time.time()), 'continueWatching': out}
    tmp = os.path.join(OUT, 'feed.json.tmp')
    with open(tmp, 'w') as f:
        json.dump(feed, f, ensure_ascii=False)
    os.replace(tmp, os.path.join(OUT, 'feed.json'))
    log('feed: %d shown, %d hidden by age rating' % (len(out), hidden))


def loop(every, max_age):
    while True:
        try:
            refresh(json.load(open(LOGIN)), max_age)
        except FileNotFoundError:
            log('not logged in: run python3 hub/emby_login.py')
        except Exception as e:   # the server is slow or away: keep the last feed, try again next round
            log('refresh failed, keeping the last feed:', repr(e))
        time.sleep(every)


TV = os.path.join(HOME, 'tv.json')   # {"ip": ..., "key": the helper's SSAP client key}: turns on watch_tv
TV_APP, LG_HOME = 'io.tvlauncher.home', 'com.webos.app.home'


def watch_tv(ip, key):
    """Now and then the TV restarts fully (Quick Start+ on or not), and after that nothing of ours runs: LG's home
    stays up. The TV can't autostart a Developer Mode app, so this does it: when the TV comes up showing LG's home and
    it is still there 8 s later (the helper takes over in ~3 s when it runs), it opens the launcher, whose helper then
    works as usual. Only right after connecting: once any other app is seen, Home is the helper's job.
    """
    import socket
    import tvlib   # copied next to this file by install.sh, with ssap_manifest.json
    manifest = json.load(open(os.path.join(HOME, 'ssap_manifest.json')))
    manifest.pop('_comment', None)
    state = None   # logged only when it changes: the TV is off for hours every day

    def report(now):
        nonlocal state
        if now != state:
            state = now
            log('tv:', now)
    while True:
        try:
            ws = tvlib.Socket(ip)
        except OSError as e:
            report('not reachable (%s)' % (e.strerror or e.__class__.__name__))   # off, or still starting
            time.sleep(5)
            continue
        try:
            ws.send({'type': 'register', 'id': 'register',
                     'payload': {'client-key': key, 'pairingType': 'PROMPT', 'forcePairing': False, 'manifest': manifest}})
            fresh, due, fg = True, None, None
            while True:
                try:
                    m = ws.receive(max(0.1, due - time.time()) if due else 120)
                except socket.timeout:
                    if not due:
                        raise OSError('TV quiet')
                    due = None
                    if fg == LG_HOME:
                        ws.send({'type': 'request', 'id': 'launch', 'uri': 'ssap://system.launcher/launch',
                                 'payload': {'id': TV_APP}})
                        log('tv: LG home after power-on, opened the launcher')
                        fresh = False
                    continue
                if m.get('id') == 'register' and m.get('type') == 'response' and 'pairingType' in (m.get('payload') or {}):
                    # The key was refused and the TV is showing a pairing prompt: never repeat that every few seconds.
                    return log('tv: key not accepted (the TV asks to pair); TV watch off until the hub restarts')
                if m.get('type') == 'registered':
                    report('connected')
                    ws.send({'type': 'subscribe', 'id': 'fg', 'uri': 'ssap://com.webos.applicationManager/getForegroundAppInfo',
                             'payload': {}})
                elif m.get('id') == 'fg':
                    fg = (m.get('payload') or {}).get('appId') or ''
                    if fg == LG_HOME and fresh and not due:
                        due = time.time() + 8
                    elif fg and fg != LG_HOME:
                        fresh = False
        except (OSError, ValueError):
            pass
        finally:
            ws.close()
        time.sleep(5)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/feed.json':
            file, ctype, cache = os.path.join(OUT, 'feed.json'), 'application/json', 'no-cache'
        elif re.fullmatch(r'/covers/c\w+\.jpg', path):
            file, ctype, cache = os.path.join(COVERS, path[8:]), 'image/jpeg', 'max-age=86400'
        else:
            return self.send_error(404)
        try:
            data = open(file, 'rb').read()
        except OSError:
            return self.send_error(404)
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', cache)
        self.send_header('Access-Control-Allow-Origin', '*')   # the launcher runs from file://
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        m = re.fullmatch(r'/play\?id=(\w+)', self.path)
        try:
            ids = {i['id'] for i in json.load(open(os.path.join(OUT, 'feed.json')))['continueWatching']}
        except (OSError, ValueError, KeyError):
            ids = set()
        if not m or m.group(1) not in ids:   # only titles the row shows: nothing else can be started from here
            return self.send_error(404)
        threading.Thread(target=self.server.play, args=(m.group(1),), daemon=True).start()
        self.send_response(202)   # the launcher doesn't wait: Emby may need a few seconds to start
        self.send_header('Content-Length', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

    def log_message(self, *a):
        pass


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--port', type=int, default=8787)
    p.add_argument('--every', type=int, default=300, help='seconds between refreshes')
    p.add_argument('--max-age', type=int, default=16, help='hide titles rated this age or older (0: hide none)')
    p.add_argument('--player', default='Emby for LG', help="the TV's Emby app, as Emby names its client")
    a = p.parse_args()
    os.makedirs(COVERS, exist_ok=True)
    threading.Thread(target=loop, args=(a.every, a.max_age), daemon=True).start()
    if os.path.exists(TV):
        tv = json.load(open(TV))
        threading.Thread(target=watch_tv, args=(tv['ip'], tv['key']), daemon=True).start()
        log('watching the TV at %s for power-on' % tv['ip'])
    log('serving on port %d' % a.port)
    server = ThreadingHTTPServer(('0.0.0.0', a.port), Handler)

    def play_logged(item_id):
        try:
            play(item_id, a.player)
        except Exception as e:
            log('play failed:', repr(e))
    server.play = play_logged
    server.serve_forever()


if __name__ == '__main__':
    sys.exit(main())
