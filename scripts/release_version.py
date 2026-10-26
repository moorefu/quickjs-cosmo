"""Version and filenames shared by packaging, CI transport and publishing."""
import os
import re


def validate_tag(tag):
    if not re.fullmatch(r"v[0-9][A-Za-z0-9]*(?:[._+-][A-Za-z0-9]+)*", tag):
        raise ValueError("Release tag must be a portable version such as v2026-06-04.1")
    return tag


def release_info(settings, tag=None, *, from_environment=True):
    if tag is None and from_environment and os.environ.get("GITHUB_REF_TYPE") == "tag":
        tag = os.environ.get("GITHUB_REF_NAME", "")
    version = validate_tag(tag)[1:] if tag is not None else settings.data["quickjs"]["version"]
    return dict(tag=tag, version=version, archive=f"quickjs-cosmo-{version}.zip")


def bundle_release(metadata, settings):
    info = metadata["release"]
    if info != release_info(settings, info["tag"], from_environment=False):
        raise ValueError("CI bundle has inconsistent release version or filenames")
    if "GITHUB_REF_TYPE" in os.environ and info != release_info(settings):
        raise ValueError("CI bundle release does not match the current GitHub ref")
    return info
