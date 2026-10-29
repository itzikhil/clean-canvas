# Security

## Reporting a problem

Please report security issues privately through GitHub's **Report a vulnerability** (the Security tab of this repository), not in a public issue.

## What Clean Canvas can do, and what protects it

- **On the TV**, the app and its helper service run as a Developer Mode app (user `prisoner`), with no root access.
- **The helper** holds two keys that are built into the installed package and never committed:
  - an SSAP client key for the TV's remote-control API: launching apps, reading which app is in front, turning the screen off and on;
  - an ADB key for the Fire TV, if you use Fire TV tiles.
  Anyone with access to the TV's Developer Mode can read the installed package, so treat Developer Mode access like the TV's own remote.
- **Any app on the TV can call the helper.** It therefore offers only narrow methods: no shell commands, Fire TV launches by package name to a local-network address only, and calendar fetches over `https` only (at most 2 MB).
- **Test hooks** (benchmark, launch and Luna tests, reports to a computer) are off unless `debug: true` is set in `app/config.local.js`. With debug on, the reports can carry what's on screen, including calendar text, to any address given in the launch parameters. Turn it off again after testing.

## Keys and personal data on your computer

| What | Where | In git |
|---|---|---|
| TV SSH key (Developer Mode) | `~/.ssh/tvlauncher_webos_<ip>` | never |
| SSAP keys (app list, helper, settings reader) | `~/.ssh/tvlauncher_ssap_*` | never |
| ADB key for the Fire TV | `~/.ssh/tvlauncher_adbkey` | never |
| Personal settings, calendar links, bin schedule, TV address | `app/config.local.js`, `app/*.local.ics`, `tools/tv.local.json` | git-ignored |
| The TV's app list and icons | `app/apps.js`, `app/icons/`, `tools/apps.local.json` | git-ignored |

A published calendar link (.ics) lets anyone who has it read that calendar. Keep it in `config.local.js` only, and unpublish it in Outlook or Google to revoke it.

## What leaves your home

- **Weather:** Open-Meteo, which receives your place's latitude and longitude.
- **Paintings:** The Met's API, through `images.weserv.nl`, which receives the painting's image address.
- **Calendars:** your calendar provider, for the links you configured.
- **Developer Mode:** LG, when the session is renewed.

There are no accounts, analytics or trackers.
