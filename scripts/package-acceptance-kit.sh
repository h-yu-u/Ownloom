#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo 'Usage: package-acceptance-kit.sh NEW_OUTPUT_DIRECTORY' >&2
  exit 2
fi

acceptance_repo="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
acceptance_output="$1"
if [ -e "$acceptance_output" ] || [ -e "$acceptance_output.zip" ]; then
  echo 'Refusing to overwrite existing acceptance kit.' >&2
  exit 2
fi
mkdir -m 700 "$acceptance_output"
for acceptance_file in run-bundle-acceptance.sh verify-bundle-stability.mjs \
  acceptance-system.mjs acceptance-runtime.mjs acceptance-media.mjs \
  acceptance-workloads.mjs acceptance.spec.mjs; do
  cp "$acceptance_repo/scripts/$acceptance_file" "$acceptance_output/"
done
cp "$acceptance_repo/docs/release-acceptance.md" "$acceptance_output/README.md"
(
  cd "$acceptance_output"
  /usr/bin/shasum -a 256 ./*.mjs ./*.sh README.md > SHA256SUMS
)
/usr/bin/ditto -c -k --keepParent "$acceptance_output" "$acceptance_output.zip"
/usr/bin/shasum -a 256 "$acceptance_output.zip"
