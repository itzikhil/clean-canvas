#!/usr/bin/env python3
"""Read-only check: can this machine read your Emby "Continue watching" and "Recently added" lists?

Run it on the hub computer (README.md here) and type your Emby server address, username and password. It logs in once, keeps only
the login token (in ~/.clean-canvas/emby.json, readable by you only), and prints what the home screen would show.
It changes nothing on the server. Run with --forget to log out and delete the token.
"""
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.request

STORE = os.path.expanduser('~/.clean-canvas/emby.json')
AUTH = 'MediaBrowser Client="Clean Canvas", Device="Home screen", DeviceId="clean-canvas-home", Version="1.0"'


def call(base, path, token=None, body=None):
    headers = {'X-Emby-Authorization': AUTH, 'Accept': 'application/json'}
    if token:
        headers['X-Emby-Token'] = token
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        return json.loads(raw) if raw and 'json' in r.headers.get('Content-Type', '') else raw


def login():
    base = input('Emby server address (as in the Emby app, e.g. https://example.com): ').strip().rstrip('/')
    if not base.startswith('http'):
        base = 'https://' + base
    user = input('Emby username: ').strip()
    pw = getpass.getpass('Emby password (not shown): ')
    for root in (base, base + '/emby'):   # some servers serve the API under /emby
        try:
            res = call(root, '/Users/AuthenticateByName', body={'Username': user, 'Pw': pw})
            break
        except urllib.error.HTTPError as e:
            if e.code == 401:
                sys.exit('Login refused: wrong username or password (or the provider blocks other apps).')
            last = e
        except urllib.error.URLError as e:
            last = e
    else:
        sys.exit('Could not reach the server: %s' % last)
    saved = {'base': root, 'token': res['AccessToken'], 'user': res['User']['Id']}
    os.makedirs(os.path.dirname(STORE), exist_ok=True)
    fd = os.open(STORE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(saved, f)
    print('Logged in. Token saved to %s (password not stored).' % STORE)
    return saved


def label(item):
    if item.get('Type') == 'Episode':
        return '%s  S%02dE%02d  %s' % (item.get('SeriesName', '?'), item.get('ParentIndexNumber') or 0,
                                       item.get('IndexNumber') or 0, item.get('Name', ''))
    return '%s (%s)' % (item.get('Name', '?'), item.get('ProductionYear', '-'))


def main():
    if '--forget' in sys.argv:
        if os.path.exists(STORE):
            s = json.load(open(STORE))
            try:
                call(s['base'], '/Sessions/Logout', s['token'], body={})
            except Exception:
                pass
            os.remove(STORE)
        print('Token deleted.')
        return
    s = json.load(open(STORE)) if os.path.exists(STORE) else login()
    t0 = time.time()
    resume = call(s['base'], '/Users/%s/Items/Resume?Limit=12&MediaTypes=Video&Fields=PrimaryImageAspectRatio' % s['user'], s['token'])
    latest = call(s['base'], '/Users/%s/Items/Latest?Limit=12&Fields=PrimaryImageAspectRatio' % s['user'], s['token'])
    ms = int((time.time() - t0) * 1000)
    items = resume.get('Items', [])
    print('\nContinue watching (%d):' % len(items))
    for it in items:
        pct = (it.get('UserData') or {}).get('PlayedPercentage')
        print('  - %s%s' % (label(it), '  [%d%%]' % pct if pct else ''))
    print('\nRecently added (%d):' % len(latest))
    for it in latest:
        print('  - %s' % label(it))
    first = (items or latest or [None])[0]
    if first:
        img = call(s['base'], '/Items/%s/Images/Primary?maxHeight=360&quality=85' % (first.get('SeriesId') or first['Id']), s['token'])
        print('\nCover image: %d KB.' % (len(img) // 1024))
    print('Both lists fetched in %d ms.' % ms)


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as e:
        sys.exit('Server answered %d %s. Run again with --forget, then log in again.' % (e.code, e.reason))
