#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
python3 scripts/bootstrap.py "$@"
MAKE=${MAKE:-$(command -v make)}
python3 scripts/prepare-host.py
TOOLCHAIN="$ROOT/toolchains/cosmocc-4.0.2"
export PATH="$TOOLCHAIN/bin:$PATH"
export LC_ALL=C
export TZ=UTC
export SOURCE_DATE_EPOCH=1793026814
JOBS=${JOBS:-4}

# Keep upstream sources pristine; generated C and object files stay in build/.
python3 - <<'PY'
from pathlib import Path
import shutil
root = Path.cwd()
shutil.copytree(root / "upstream/quickjs", root / "build/quickjs",
                dirs_exist_ok=True, ignore=shutil.ignore_patterns(".git", ".bootstrap.json"))
PY
for patch_file in "$ROOT"/patches/*.patch; do
    patch --batch -d build/quickjs -p1 -i "$patch_file"
done
QJSC=./qjsc.exe
if [ "$(uname -s)" = Linux ]; then
    case "$(uname -m)" in
        aarch64|arm64) LOADER="$TOOLCHAIN/bin/ape-aarch64.elf" ;;
        *) LOADER="$TOOLCHAIN/bin/ape-x86_64.elf" ;;
    esac
    QJSC="$LOADER ./qjsc.exe"
fi
"$MAKE" -C build/quickjs -j "$JOBS" \
    CONFIG_COSMO=y CONFIG_WIN32= MSYSTEM= CONFIG_DARWIN= CONFIG_FREEBSD= CONFIG_CLANG= \
    CC=cosmocc AR=cosmoar QJSC_CC=cosmocc QJSC="$QJSC" EXE=.exe PREFIX="$ROOT/dist" \
    qjs.exe qjsc.exe run-test262.exe libquickjs.a
mkdir -p dist
cp build/quickjs/qjs.exe build/quickjs/qjsc.exe build/quickjs/run-test262.exe dist/
cp "$TOOLCHAIN/bin/ape-x86_64.elf" "$TOOLCHAIN/bin/ape-aarch64.elf" dist/
for program in qjs qjsc run-test262; do
    cp scripts/launch.sh "dist/$program"
    chmod +x "dist/$program"
done
cp build/quickjs/quickjs.h build/quickjs/quickjs-libc.h dist/
cp build/quickjs/libquickjs.a dist/
mkdir -p dist/.aarch64
cp build/quickjs/.aarch64/libquickjs.a dist/.aarch64/
cp upstream/quickjs/LICENSE dist/QUICKJS-LICENSE
cp versions.json dist/versions.json
python3 scripts/artifact_manifest.py
printf '\nBuilt portable binaries in %s/dist\n' "$ROOT"
