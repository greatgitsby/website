#!/bin/sh
# Renders the social preview cards in og/ with headless Chrome.
# Run from the site root with the site served on :4173:
#   python3 -m http.server 4173 & sh tools/og/render.sh
set -e
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
BASE="http://localhost:4173/tools/og/card.html"
mkdir -p og

card() { # name, query
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1200,630 --virtual-time-budget=3000 \
    --screenshot="og/$1.png" "$BASE?$2" >/dev/null 2>&1
  echo "og/$1.png"
}

# Each page gets its own variation, so links look distinct side by side.
card home     "hue=0"
card blog     "hue=0&mirror=1"
card vinetech "hue=1"
card articles "hue=2&mirror=1"
card projects "hue=3"
