#!/usr/bin/env bash
# macOS/Linux equivalent of make_xpi.ps1 — same include list, same output name.
# content/translator.css is deliberately excluded: nothing references it.
# _docs/ is excluded too; shipping it bloats the XPI and was rejected in ATN
# review of 1.8.3.
set -euo pipefail

src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$src"

version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -1)"
xpi="thunderbird-translator-v${version}.xpi"
rm -f "$xpi"

files=(
  manifest.json
  background.js
  content/translator.js
  content/composer.js
  options/options.html
  options/options.js
  icons/translate-dark.svg
  icons/translate-light.svg
)
while IFS= read -r f; do files+=("$f"); done < <(find _locales -type f -name 'messages.json' | sort)

for f in "${files[@]}"; do
  [ -f "$f" ] || { echo "MISSING: $f" >&2; exit 1; }
done

# -X drops macOS resource forks / extra attributes from the archive.
zip -q -X "$xpi" "${files[@]}"
printf 'XPI created: %s (%s bytes)\n' "$xpi" "$(wc -c < "$xpi" | tr -d ' ')"
