#!/bin/sh
# Installed as dist/qjs, dist/qjsc and dist/run-test262.
set -eu
DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROGRAM=${0##*/}
if [ "$(uname -s)" = Linux ]; then
    case "$(uname -m)" in
        aarch64|arm64) ARCH=aarch64 ;;
        *) ARCH=x86_64 ;;
    esac
    # Explicit loader also avoids WSL's MZ -> Windows interop handler.
    exec "$DIRECTORY/ape-$ARCH.elf" "$DIRECTORY/$PROGRAM.exe" "$@"
fi
exec /bin/sh "$DIRECTORY/$PROGRAM.exe" "$@"
