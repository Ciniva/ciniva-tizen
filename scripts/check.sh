#!/bin/sh
# Checks that the app runs on Tizen 5.5 (Chromium 69): ES2017 syntax, no newer DOM APIs or CSS, versions in sync.
set -u
cd "$(dirname "$0")/.."
status=0

for f in src/boot.js src/verify.js src/js/*.js; do
  npx --yes acorn@8.14.0 --ecma2017 --silent "$f" || { echo "^ $f is not ES2017"; status=1; }
done

# Matches outside comment lines.
banned() {
  pattern=$1
  shift
  grep -HnE "$pattern" "$@" | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|/\*|\*)'
}

if banned '\.replaceChildren\(|Object\.fromEntries|\.flat\(|\.flatMap\(|Intl\.DisplayNames|\.at\(|structuredClone|\.replaceAll\(|\.matchAll\(|globalThis|queueMicrotask|loading: .lazy' src/boot.js src/verify.js src/js/*.js; then
  echo "^ API newer than Chromium 69"
  status=1
fi

if banned '(^|[^-])gap:|aspect-ratio|(^|[^-])inset:|backdrop-filter|:focus-visible|:has\(|:is\(|:where\(' src/css/*.css; then
  echo "^ CSS newer than Chromium 69 (flex gap, aspect-ratio, inset, :has…)"
  status=1
fi

v=$(tr -d ' \r\n' < VERSION)
grep -q "version=\"$v\"" src/config.xml || { echo "src/config.xml version is not $v (VERSION)"; status=1; }
grep -q "C.VERSION = '$v'" src/js/app.js || { echo "src/js/app.js C.VERSION is not $v (VERSION)"; status=1; }
[ -f src/icon.png ] || { echo "src/icon.png is missing"; status=1; }

node scripts/check-ui.js || status=1
node scripts/test-verify.js || status=1

[ $status -eq 0 ] && echo "OK: ES2017, Chromium 69 APIs, version $v"
exit $status
