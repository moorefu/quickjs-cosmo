#!/usr/bin/env python3
"""Generate deterministic APE ZIP objects and their compiled manifest anchor."""
import json

from build_config import load_config
from build_native import run
from runtime_resources import resource_files, LIMITS, digest


def main():
    settings = load_config()
    output = settings.build / 'runtime-resources'
    output.mkdir(parents=True, exist_ok=True)
    files = resource_files(settings.root, settings.runtime_profile)
    rows = []
    for name, data in files.items():
        source = output / name.split('/')[-1]
        source.write_bytes(data)
        rows.append('    {' + json.dumps(name) + ', ' + str(len(data)) + ', ' + str(LIMITS[name]) + ', ' + json.dumps(digest(data)) + '},')
        for arch in ('x86_64', 'aarch64'):
            target = settings.build / ('.obj/.aarch64' if arch == 'aarch64' else '.obj') / ('qjs-' + source.name + '.zip.o')
            target.parent.mkdir(parents=True, exist_ok=True)
            run([settings.toolchain / 'bin/zipobj', '-a', arch, '-N', name, '-o', target,
                 source.relative_to(settings.root)], settings.root)
    header = '/* Generated resource metadata; resource bytes live only in ZIP. */\nstatic const ResourceSpec specs[] = {\n' + '\n'.join(rows) + '\n};\n'
    path = settings.build / 'qjs-resource-config.h'
    if not path.exists() or path.read_text() != header:
        path.write_text(header, encoding='ascii', newline='\n')
    print('PASS runtime resources: canonical manifest, anchored SHA-256, dual architecture ZIP objects')


if __name__ == '__main__':
    main()
