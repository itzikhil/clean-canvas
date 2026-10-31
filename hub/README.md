# Hub (optional)

An always-on computer at home (a Mac mini, a NAS, a Raspberry Pi with Python 3) does the work, and the TV only shows the result. For now that's Emby's **Continue watching**. The launcher shows it as a row above the dock while the Emby tile is focused, like tvOS's top shelf.

- **Every 5 minutes** the hub reads your Emby "Continue watching" list. It leaves out titles rated 16+ and repeats of the same title (`--max-age 0` keeps everything), and saves small landscape covers. Titles without a rating stay in: no rating is not a guessed rating.
- **It serves only `feed.json` and `covers/*.jpg`** on port 8787, on your home network. Don't forward that port in your router.
- **OK on a card plays it** from where you stopped: the launcher opens Emby and the hub tells the TV's Emby app to play that title (Emby's own remote control). Only titles in the row can be started this way.
- **Otherwise read-only towards Emby.** Only a login token is kept, in `~/.clean-canvas/emby.json` (readable by you only), never your password.

## Set up (on the always-on computer)

```sh
sh hub/install.sh                     # copies the hub to ~/.clean-canvas, starts it now and at every login
python3 ~/.clean-canvas/emby_login.py # log in to Emby once; prints what the row will show
```

Then, in `app/config.local.js` on the computer you install the TV from:

```js
hub: {url: 'http://<the hub computer's IP>:8787', app: 'com.emby.app'},
```

Reserve that IP in your router so it doesn't change. Then reinstall the launcher with `python3 tools/install.py`.

## Power-on watch (optional)

Now and then the TV restarts fully, even with Quick Start+ on, and after that nothing of ours runs: LG's home stays up until someone opens Clean Canvas. The TV can't start a Developer Mode app by itself, so the hub can: with `~/.clean-canvas/tv.json` it keeps a connection to the TV, and when the TV comes up on LG's home and is still there 8 s later (the helper takes over in ~3 s when it runs), it opens the launcher. It acts only right after the TV comes up; once any other app is seen, Home is the helper's job.

`tv.json` holds the TV's IP and the helper's own SSAP key (the one built into the app), so no new pairing:

```sh
printf '{"ip": "%s", "key": "%s"}' 192.168.1.50 "$(cat ~/.ssh/tvlauncher_ssap_home_192_168_1_50)" > ~/.clean-canvas/tv.json
chmod 600 ~/.clean-canvas/tv.json   # then run hub/install.sh again
```

If the TV ever refuses that key, the hub stops watching rather than make the TV ask to pair again and again.

## Remove

```sh
sh hub/install.sh --remove
python3 ~/.clean-canvas/emby_login.py --forget   # logs out and deletes the token
```

If the hub is off or unreachable, the launcher simply shows no row.
