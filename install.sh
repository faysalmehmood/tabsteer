#!/bin/sh
# Sets up Tab Steer from a clone of this repository.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js 18 or newer is required: https://nodejs.org" >&2; exit 1; }
exec node bin/tabsteer.js install --link "$@"
