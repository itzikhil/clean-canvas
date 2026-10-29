#!/usr/bin/env python3
"""Builds the launcher, installs it on the TV over Developer Mode SSH, and opens it.

    python3 tools/install.py                      # build, install or update, launch
    python3 tools/install.py --uninstall          # remove it from the TV
    python3 tools/install.py --launch-only        # just open it
    python3 tools/install.py --ip 192.168.1.50    # another TV

The first run downloads the TV's SSH key from its Key Server (port 9991) and asks for the passphrase shown in the
Developer Mode app; the unlocked key is kept in ~/.ssh/tvlauncher_webos_<IP>. The .ipk is copied over SSH (port 9922)
and installed with the TV's own installer (com.webos.appInstallService), as Free My TV's webos/install.py does.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build  # noqa: E402
from tvlib import default_ip, fetch_key, luna, ssh  # noqa: E402

TEMP = '/media/developer/temp/tvlauncher.ipk'


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def launch(ip, key, app_id, params=None):
    payload = {'id': app_id}
    if params:
        payload['params'] = params
    return luna(ip, key, 'luna://com.webos.applicationManager/launch', payload)


def main():
    ip = arg('--ip') or default_ip()
    app_id = build.app_info()['id']
    key = fetch_key(ip)

    if '--uninstall' in sys.argv:
        out = luna(ip, key, 'luna://com.webos.appInstallService/dev/remove', {'id': app_id}, replies=3, wait=30)
        print('Removed.' if '"returnValue":true' in out.replace(' ', '') else 'The TV said: ' + out.strip())
        return

    params = json.loads(arg('--params', 'null'))
    if '--launch-only' not in sys.argv:
        ipk = build.build()
        print('Copying to the TV ...')
        with open(ipk, 'rb') as f:
            copy = ssh(ip, key, 'mkdir -p /media/developer/temp && cat > ' + TEMP, stdin=f)
        if copy.returncode != 0:
            sys.exit('Copy failed: %s\nIs Developer Mode still on?' % copy.stderr.decode('utf-8', 'replace').strip())
        print('Installing ...')
        out = luna(ip, key, 'luna://com.webos.appInstallService/dev/install',
                   {'id': app_id, 'ipkUrl': TEMP, 'subscribe': True}, replies=30, wait=60)
        if '"state":"installed"' not in out.replace(' ', ''):
            sys.exit('The TV did not finish installing. It said:\n' + out.strip())
        ssh(ip, key, 'rm -f ' + TEMP)
    out = launch(ip, key, app_id, params)
    print('Open on the TV.' if '"returnValue":true' in out.replace(' ', '') else 'Launch said: ' + out.strip())


if __name__ == '__main__':
    main()
