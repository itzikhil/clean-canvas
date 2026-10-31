#!/bin/sh
# Installs the Clean Canvas hub on this Mac as a login agent that starts at login and restarts if it stops.
# Run on the always-on Mac:  sh hub/install.sh      Remove:  sh hub/install.sh --remove
#
# It runs on Apple's /usr/bin/python3 when there is one: macOS's Local Network privacy blocks other Pythons (such
# as Homebrew's) in a login agent from reaching the TV, without a prompt ("No route to host" in the log), while
# Apple's own binaries are allowed (measured on macOS 26.4).
# Run with sudo only to clear an earlier daemon install (/Library/LaunchDaemons); the agent still runs as you.
set -e
LABEL=io.cleancanvas.hub

if [ "$(id -u)" = 0 ]; then
  [ -n "$SUDO_USER" ] || { echo "Run it as yourself, or with sudo from your account"; exit 1; }
  RUN_AS=$SUDO_USER
  USER_HOME=$(dscl . -read "/Users/$RUN_AS" NFSHomeDirectory | awk '{print $2}')
else
  RUN_AS=$(id -un)
  USER_HOME=$HOME
fi
PLIST="$USER_HOME/Library/LaunchAgents/$LABEL.plist"
DAEMON="/Library/LaunchDaemons/$LABEL.plist"
DIR="$USER_HOME/.clean-canvas"
USER_ID=$(id -u "$RUN_AS")

if [ -f "$DAEMON" ]; then
  [ "$(id -u)" = 0 ] || { echo "An earlier install runs the hub as a daemon. Once: sudo sh $0 $1"; exit 1; }
  launchctl bootout "system/$LABEL" 2>/dev/null || true
  rm -f "$DAEMON"
fi

if [ "$1" = "--remove" ]; then
  launchctl bootout "gui/$USER_ID/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Hub removed. Your Emby login token stays in $DIR (python3 $DIR/emby_login.py --forget deletes it)."
  exit 0
fi

PY=/usr/bin/python3
/usr/bin/python3 -V >/dev/null 2>&1 || PY=$(command -v python3)   # without Apple's Python: no power-on watch
mkdir -p "$DIR" && chmod 700 "$DIR"
cp "$(dirname "$0")/hub.py" "$(dirname "$0")/emby_login.py" "$DIR/"
# For the power-on watch (only used when $DIR/tv.json exists): the SSAP client and the helper's permissions.
for f in tvlib.py ssap_manifest.json; do
  if [ -f "$(dirname "$0")/$f" ]; then cp "$(dirname "$0")/$f" "$DIR/"; else cp "$(dirname "$0")/../tools/$f" "$DIR/"; fi
done
chown -R "$RUN_AS" "$DIR"
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$DIR/hub.py</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$DIR/hub.log</string>
  <key>StandardErrorPath</key><string>$DIR/hub.log</string>
</dict></plist>
EOF
chown "$RUN_AS" "$PLIST"
launchctl bootout "gui/$USER_ID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$USER_ID" "$PLIST"
echo "Hub running on port 8787 with $PY. Log: $DIR/hub.log"
[ -f "$DIR/emby.json" ] || echo "Next: python3 $DIR/emby_login.py  (log in to Emby once)"
