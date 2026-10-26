#!/usr/bin/env python3
"""Publish the CI-verified payload for an existing version tag."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import quote

from build_config import load_config
from ci_artifact import sha256, verify
from release_version import validate_tag


class GitHubCLI:
    def run(self, *arguments):
        return subprocess.run(["gh", *arguments], check=True, text=True, encoding="utf-8",
                              stdout=subprocess.PIPE).stdout.strip()

    def get(self, endpoint, missing_ok=False):
        result = subprocess.run(["gh", "api", endpoint], capture_output=True, text=True, encoding="utf-8")
        if result.returncode:
            if missing_ok and "HTTP 404" in result.stderr:
                return None
            raise RuntimeError("GitHub API request failed: " + result.stderr.strip())
        return json.loads(result.stdout)


def verify_assets(release, files):
    assets = {asset["name"]: asset for asset in release["assets"]}
    if set(assets) != {path.name for path in files}:
        raise ValueError("Existing release assets do not match the expected file inventory")
    for path in files:
        asset = assets[path.name]
        if (asset.get("state") != "uploaded" or asset["size"] != path.stat().st_size
                or asset.get("digest") != "sha256:" + sha256(path)):
            raise ValueError("Release asset hash mismatch: " + path.name)


def find_release(client, api, tag):
    # The tag endpoint only returns published releases. Authenticated release
    # listings also include drafts, which must be resumed and read by numeric ID.
    release = client.get(api + "/releases/tags/" + quote(tag, safe=""), missing_ok=True)
    if release:
        return release
    page = 1
    while True:
        releases = client.get(api + f"/releases?per_page=100&page={page}")
        matches = [item for item in releases if item["tag_name"] == tag]
        if len(matches) > 1:
            raise ValueError("Multiple release drafts use the requested tag")
        if matches:
            return matches[0]
        if len(releases) < 100:
            return None
        page += 1


def publish(tag, repository, commit, files, notes, client=None):
    validate_tag(tag)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Invalid GitHub repository")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Release commit must be the full tested Git SHA")
    client = client or GitHubCLI()
    api = "repos/" + repository
    tag_path = quote(tag, safe="")
    def require_tested_tag():
        if client.get(api + "/commits/" + tag_path)["sha"] != commit:
            raise ValueError("Release tag moved away from the commit tested by CI")
    require_tested_tag()
    marker = f"<!-- quickjs-cosmo-release: {tag} {commit} -->"
    release = find_release(client, api, tag)
    if release and not release["draft"]:
        verify_assets(release, files)
        print("Release already published with matching assets:", release["html_url"], flush=True)
        return release
    if release and marker not in (release.get("body") or ""):
        raise ValueError("An unrelated draft already uses this tag; refusing to overwrite it")
    if not release:
        client.run("release", "create", tag, "--repo", repository, "--verify-tag",
                   "--target", commit, "--title", tag, "--notes-file", str(notes), "--draft")
        release = find_release(client, api, tag)
    if not release or not release["draft"] or marker not in (release.get("body") or ""):
        raise ValueError("The workflow's release draft could not be found")
    endpoint = api + "/releases/" + str(release["id"])
    # Only this workflow's draft can be resumed or have incomplete assets replaced.
    client.run("release", "upload", tag, *map(str, files), "--repo", repository, "--clobber")
    release = client.get(endpoint)
    verify_assets(release, files)
    require_tested_tag()
    client.run("release", "edit", tag, "--repo", repository, "--title", tag, "--draft=false", "--latest")
    release = client.get(endpoint)
    if release["draft"] or release["tag_name"] != tag or release["name"] != tag:
        raise ValueError("Release was not published with the requested tag and name")
    verify_assets(release, files)
    print("Published release:", release["html_url"], flush=True)
    return release


def prepare(settings, tag, commit, run_url):
    validate_tag(tag)
    metadata = verify(settings)
    if metadata["release"]["tag"] != tag:
        raise ValueError("CI bundle belongs to a different release tag")
    archive = settings.releases / metadata["release"]["archive"]
    files = [archive, archive.with_suffix(".zip.sha256"), settings.dist / "manifest.json"]
    output = settings.root / "build/release"
    output.mkdir(parents=True, exist_ok=True)
    notes = output / "notes.md"
    notes.write_text(
        f"<!-- quickjs-cosmo-release: {tag} {commit} -->\n"
        f"QuickJS Cosmopolitan **{tag}**，包含 x86_64 / ARM64 双架构 APE，保留 Temporal/Intl。\n\n"
        f"- QuickJS：`{settings.data['quickjs']['commit']}`\n"
        f"- cosmocc：Nightly #{settings.data['cosmopolitan']['run_number']}，"
        f"`{settings.data['cosmopolitan']['commit']}`\n"
        f"- 验证：Linux x86_64/ARM64、macOS Intel/ARM64、Windows x64，以及 Windows ARM 的 x64 兼容运行。\n"
        f"- CI：[构建与完整矩阵]({run_url})\n\n"
        f"下载 `{archive.name}`，按同目录的 `.sha256` 校验。ZIP 保持官方三文件布局："
        "`readme.txt`、`run-test262`、`qjs`。Windows 可将后二者重命名为 `.exe` 后运行。\n\n"
        "发布版本号来自 tag，ZIP 文件名使用去掉前导 v 的版本号。QuickJS 引擎的固定 VERSION 不变。"
        "`manifest.json` 记录完整构建输入、补丁和文件哈希。\n", encoding="utf-8")
    return files, notes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", default=os.environ.get("GITHUB_REF_NAME", ""))
    parser.add_argument("--dry-run", action="store_true", help="Validate the payload and write release notes only")
    args = parser.parse_args()
    if not args.dry_run and (os.environ.get("GITHUB_REF_TYPE") != "tag"
                            or args.tag != os.environ.get("GITHUB_REF_NAME")):
        parser.error("Publishing requires a tag workflow run")
    settings = load_config()
    repository = os.environ.get("GITHUB_REPOSITORY", "moorefu/quickjs-cosmo")
    commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=settings.root, text=True).strip()
    run_url = (f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{repository}/actions/runs/"
               f"{os.environ.get('GITHUB_RUN_ID', '')}")
    files, notes = prepare(settings, args.tag, commit, run_url)
    print("Release:", args.tag, "Assets:", ", ".join(path.name for path in files), flush=True)
    if not args.dry_run:
        release = publish(args.tag, repository, commit, files, notes)
        (settings.root / "build/release/published.json").write_text(
            json.dumps(release, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
