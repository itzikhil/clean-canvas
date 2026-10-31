#!/bin/sh
# Installs the Clean Canvas hub on this Mac as a login agent that starts at login and restarts if it stops.
# Run on the always-on Mac:  sh hub/install.sh      Remove:  sh hub/install.sh --remove
set -e
LABEL=io.cleancanvas.hub
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$HOME/.clean-canvas"

if [ "$1" = "--remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Hub removed. Your Emby login token stays in $DIR (python3 $DIR/emby_login.py --forget deletes it)."
  exit 0
fi

PY=$(command -v python3)
mkdir -p "$DIR" && chmod 700 "$DIR"
cp "$(dirname "$0")/hub.py" "$(dirname "$0")/emby_login.py" "$DIR/"
# For the power-on watch (only used when $DIR/tv.json exists): the SSAP client and the helper's permissions.
for f in tvlib.py ssap_manifest.json; do
  if [ -f "$(dirname "$0")/$f" ]; then cp "$(dirname "$0")/$f" "$DIR/"; else cp "$(dirname "$0")/../tools/$f" "$DIR/"; fi
done
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
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Hub running on port 8787. Log: $DIR/hub.log"
[ -f "$DIR/emby.json" ] || echo "Next: python3 $DIR/emby_login.py  (log in to Emby once)"
