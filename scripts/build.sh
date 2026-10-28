#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
QUICKJS_COSMO_PROFILE=${QUICKJS_COSMO_PROFILE:-nightly}
OFFLINE=
for argument in "$@"; do
    case "$argument" in
        --nightly) QUICKJS_COSMO_PROFILE=nightly ;;
        --offline) OFFLINE=--offline ;;
        *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
    esac
done
export QUICKJS_COSMO_PROFILE
python3 scripts/bootstrap.py $OFFLINE
MAKE=${MAKE:-$(command -v make)}
python3 scripts/prepare-host.py
TOOLCHAIN=$(python3 scripts/build_config.py toolchain)
BUILD=$(python3 scripts/build_config.py build)
DIST=$(python3 scripts/build_config.py dist)
LOCK=$(python3 scripts/build_config.py lock_file)
export PATH="$TOOLCHAIN/bin:$PATH"
export LC_ALL=C
export TZ=UTC
SOURCE_DATE_EPOCH=$(python3 scripts/build_config.py source_epoch)
export SOURCE_DATE_EPOCH
JOBS=${JOBS:-4}

# Keep upstream sources pristine; generated C and object files stay in build/.
python3 - <<'PY'
from pathlib import Path
import shutil
import sys
sys.path.insert(0, str(Path.cwd() / "scripts"))
from build_config import load_config
root = Path.cwd()
shutil.copytree(root / "upstream/quickjs", load_config().build,
                dirs_exist_ok=True, ignore=shutil.ignore_patterns(".git", ".bootstrap.json"))
PY
for patch_file in "$ROOT"/patches/*.patch; do
    patch --batch -d "$BUILD" -p1 -i "$patch_file"
done
python3 scripts/prepare_compat.py $OFFLINE
python3 scripts/build_native.py $OFFLINE --jobs "$JOBS"
python3 scripts/build_crypto.py
python3 scripts/build_compression.py
cp native/module_registry.h "$BUILD/qjs-cosmo.h"
cp native/tasks.h "$BUILD/qjs-tasks.h"
python3 scripts/generate_runtime_config.py --output "$BUILD/qjs-cosmo-config.h"
python3 scripts/embed_js.py --output "$BUILD/qjs-builtins.h"
QJSC=./qjsc.exe
if [ "$(uname -s)" = Linux ]; then
    case "$(uname -m)" in
        aarch64|arm64) LOADER="$TOOLCHAIN/bin/ape-aarch64.elf" ;;
        *) LOADER="$TOOLCHAIN/bin/ape-x86_64.elf" ;;
    esac
    QJSC="$LOADER ./qjsc.exe"
fi
"$MAKE" -C "$BUILD" -f Makefile -f "$ROOT/compat/build.mk" -j "$JOBS" \
    QJS_COSMO_ROOT="$ROOT" QJS_COSMO_COMPAT="$BUILD/compat-source" \
    CONFIG_COSMO=y CONFIG_WIN32= MSYSTEM= CONFIG_DARWIN= CONFIG_FREEBSD= CONFIG_CLANG= \
    CC=cosmocc AR=cosmoar QJSC_CC=cosmocc QJSC="$QJSC" EXE=.exe PREFIX="$DIST" \
    qjs.exe qjsc.exe run-test262.exe libquickjs.a
mkdir -p "$DIST"
cp "$BUILD/qjs.exe" "$BUILD/qjsc.exe" "$BUILD/run-test262.exe" "$DIST/"
cp "$TOOLCHAIN/bin/ape-x86_64.elf" "$TOOLCHAIN/bin/ape-aarch64.elf" "$DIST/"
for program in qjs qjsc run-test262; do
    cp scripts/launch.sh "$DIST/$program"
    chmod +x "$DIST/$program"
done
cp "$BUILD/quickjs.h" "$BUILD/quickjs-libc.h" "$BUILD/qjs-cosmo.h" "$BUILD/qjs-tasks.h" "$DIST/"
cp types/*.d.ts "$DIST/"
cp src/js/vendor/node/LICENSE "$DIST/NODE-MODULES-LICENSE"
cp build/native/backends/LICENSES.txt "$DIST/NATIVE-MODULES-LICENSES"
cat build/native/crypto-extra/LICENSES.txt >> "$DIST/NATIVE-MODULES-LICENSES"
cp "$BUILD/libquickjs.a" "$DIST/"
mkdir -p "$DIST/.aarch64"
cp "$BUILD/.aarch64/libquickjs.a" "$DIST/.aarch64/"
cp upstream/quickjs/LICENSE "$DIST/QUICKJS-LICENSE"
cp "$LOCK" "$DIST/versions.json"
python3 scripts/artifact_manifest.py
printf '\nBuilt portable binaries in %s\n' "$DIST"
