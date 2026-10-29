#!/usr/bin/env python3
"""Package the active profile; aggregation combines the SDK and tests."""
import argparse
from build_config import load_config
from release_assets import package_profile
from release_version import release_info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nightly', action='store_true')
    parser.add_argument('--tag')
    parser.add_argument('--validate',action='store_true',help='Execute independently extracted SDK/tests packages')
    args = parser.parse_args()
    settings = load_config('nightly' if args.nightly else None)
    release=release_info(settings,args.tag)
    result = package_profile(settings,release)
    if args.validate:
        from test_release_packages import validate
        validate(settings,release['version'])
    for value in result['runtimes']:
        print(f"PASS {value['profile']}/{value['architecture']}: qjs {value['qjsBytes']} B, ZIP {value['bytes']} B")


if __name__ == '__main__':
    main()
