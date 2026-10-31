#!/bin/sh
# Installs the Clean Canvas hub on this Mac so it starts by itself and restarts if it stops.
# Run on the always-on Mac:  sh hub/install.sh      Remove:  sh hub/install.sh --remove
#
# Default: a login agent (no password). With the power-on watch (tv.json) use  sudo sh hub/install.sh --daemon
# instead: macOS's Local Network privacy blocks a login agent's Python from reaching the TV ("No route to host",
# without a prompt), while launchd daemons are exempt. The daemon still runs as you, not as root.
set -e
LABEL=io.cleancanvas.hub

if [ "$1" = "--daemon" ] || { [ "$1" = "--remove" ] && [ "$(id -u)" = 0 ]; }; then
  [ "$(id -u)" = 0 ] && [ -n "$SUDO_USER" ] || { echo "Run it with sudo: sudo sh $0 $1"; exit 1; }
  RUN_AS=$SUDO_USER
  USER_HOME=$(dscl . -read "/Users/$RUN_AS" NFSHomeDirectory | awk '{print $2}')
else
  RUN_AS=$(id -un)
  USER_HOME=$HOME
fi
AGENT="$USER_HOME/Library/LaunchAgents/$LABEL.plist"
DAEMON="/Library/LaunchDaemons/$LABEL.plist"
DIR="$USER_HOME/.clean-canvas"
USER_ID=$(id -u "$RUN_AS")

if [ "$1" = "--remove" ]; then
  launchctl bootout "gui/$USER_ID/$LABEL" 2>/dev/null || true
  rm -f "$AGENT"
  if [ -f "$DAEMON" ]; then
    if [ "$(id -u)" = 0 ]; then launchctl bootout "system/$LABEL" 2>/dev/null || true; rm -f "$DAEMON"
    else echo "The hub also runs as a daemon: sudo sh $0 --remove"; exit 1; fi
  fi
  echo "Hub removed. Your Emby login token stays in $DIR (python3 $DIR/emby_login.py --forget deletes it)."
  exit 0
fi

PY=/opt/homebrew/bin/python3
[ -x "$PY" ] || PY=$(command -v python3)
mkdir -p "$DIR" && chmod 700 "$DIR"
cp "$(dirname "$0")/hub.py" "$(dirname "$0")/emby_login.py" "$DIR/"
# For the power-on watch (only used when $DIR/tv.json exists): the SSAP client and the helper's permissions.
for f in tvlib.py ssap_manifest.json; do
  if [ -f "$(dirname "$0")/$f" ]; then cp "$(dirname "$0")/$f" "$DIR/"; else cp "$(dirname "$0")/../tools/$f" "$DIR/"; fi
done
chown -R "$RUN_AS" "$DIR"

plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$DIR/hub.py</string></array>
  $1
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$DIR/hub.log</string>
  <key>StandardErrorPath</key><string>$DIR/hub.log</string>
</dict></plist>
EOF
}

# Only one of the two may run (both would want port 8787).
launchctl bootout "gui/$USER_ID/$LABEL" 2>/dev/null || true
if [ "$1" = "--daemon" ]; then
  rm -f "$AGENT"
  plist "<key>UserName</key><string>$RUN_AS</string>
  <key>EnvironmentVariables</key><dict><key>HOME</key><string>$USER_HOME</string></dict>" > "$DAEMON"
  chown root:wheel "$DAEMON" && chmod 644 "$DAEMON"
  launchctl bootout "system/$LABEL" 2>/dev/null || true
  launchctl bootstrap system "$DAEMON"
  echo "Hub running as a daemon (as $RUN_AS) on port 8787. Log: $DIR/hub.log"
else
  [ ! -f "$DAEMON" ] || { echo "The hub runs as a daemon: update it with  sudo sh $0 --daemon"; exit 1; }
  mkdir -p "$(dirname "$AGENT")"
  plist "" > "$AGENT"
  launchctl bootstrap "gui/$USER_ID" "$AGENT"
  echo "Hub running on port 8787. Log: $DIR/hub.log"
fi
[ -f "$DIR/emby.json" ] || echo "Next: python3 $DIR/emby_login.py  (log in to Emby once)"
