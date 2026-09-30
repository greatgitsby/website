#!/bin/sh
# Renders the social preview cards in og/ with headless Chrome.
# Run from the site root with the site served on :4173:
#   python3 -m http.server 4173 & sh tools/og/render.sh
set -e
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
BASE="http://localhost:4173/tools/og/card.html"
mkdir -p og

card() { # name, title, kicker (URL-encoded)
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1200,630 --virtual-time-budget=8000 \
    --screenshot="og/$1.png" "$BASE?title=$2&kicker=$3" >/dev/null 2>&1
  echo "og/$1.png"
}

card home     "Trey%20Moen"               "Professional%20Maker"
card blog     "Blog"                      "Trey%20Moen"
card vinetech "Senior%20Capstone%20Project" "Blog%20%C2%B7%20Trey%20Moen"
card articles "Articles"                  "Blog%20%C2%B7%20Trey%20Moen"
card projects "Projects"                  "Blog%20%C2%B7%20Trey%20Moen"
