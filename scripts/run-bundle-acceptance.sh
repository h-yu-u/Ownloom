#!/bin/sh
set -eu

if [ "$#" -lt 1 ]; then
  echo 'Usage: run-bundle-acceptance.sh /path/to/Ownloom.app --output NEW_DIRECTORY [options]' >&2
  exit 2
fi

acceptance_app="$1"
shift
acceptance_node="$acceptance_app/Contents/Resources/coding-agent/bin/node"
if [ ! -x "$acceptance_node" ]; then
  echo 'Packaged Node is missing. Select the complete release app.' >&2
  exit 2
fi

acceptance_scripts="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
exec "$acceptance_node" "$acceptance_scripts/verify-bundle-stability.mjs" --app "$acceptance_app" "$@"
