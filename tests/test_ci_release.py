"""A tagged release must only publish tested assets and must be safe to retry."""
import copy
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from ci_artifact import sha256
from publish_release import find_release, publish, validate_tag, verify_assets
from release_version import bundle_release, release_info
from retry_release import require_verified_run

TAG = "v2026-06-04.1"
COMMIT = "a" * 40
REPOSITORY = "moorefu/quickjs-cosmo"
MARKER = f"<!-- quickjs-cosmo-release: {TAG} {COMMIT} -->"


class FakeGitHub:
    def __init__(self, files, release=None, commit=COMMIT, corrupt_upload=False):
        self.files, self.release, self.commit = files, release, commit
        self.commands = []
        self.corrupt_upload = corrupt_upload

    def get(self, endpoint, missing_ok=False):
        if "/commits/" in endpoint:
            return {"sha": self.commit}
        if "/releases/tags/" in endpoint:
            return copy.deepcopy(self.release) if self.release and not self.release["draft"] else None
        if "/releases?" in endpoint:
            return [copy.deepcopy(self.release)] if self.release else []
        return copy.deepcopy(self.release)

    def run(self, *arguments):
        self.commands.append(arguments)
        operation = arguments[1]
        if operation == "create":
            self.release = dict(id=42, tag_name=TAG, name=TAG, draft=True, body=MARKER,
                                html_url="https://example.invalid/release", assets=[])
        elif operation == "upload":
            if not self.release["draft"]:
                raise AssertionError("published release must never be overwritten")
            self.release["assets"] = assets(self.files)
            if self.corrupt_upload:
                self.release["assets"][0]["digest"] = "sha256:incorrect"
        elif operation == "edit":
            self.release["draft"] = False


def assets(files):
    return [dict(name=p.name, size=p.stat().st_size, state="uploaded", digest="sha256:" + sha256(p))
            for p in files]


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.files = [root / "quickjs-cosmo-2026-06-04.1.zip",
                      root / "quickjs-cosmo-2026-06-04.1.zip.sha256", root / "manifest.json"]
        for index, path in enumerate(self.files):
            path.write_bytes(f"asset {index}".encode())
        self.notes = root / "notes.md"
        self.notes.write_text(MARKER)

    def test_accept_requested_version(self):
        self.assertEqual(validate_tag(TAG), TAG)

    def test_reject_branch_and_unsafe_tags(self):
        for tag in ("main", "v../main", "v1\nother", "v1;command", "v1/other", "v1 ", "v"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                validate_tag(tag)

    def test_new_release_is_verified_as_draft_before_publishing(self):
        client = FakeGitHub(self.files)
        result = publish(TAG, REPOSITORY, COMMIT, self.files, self.notes, client)
        self.assertFalse(result["draft"])
        self.assertEqual([c[1] for c in client.commands], ["create", "upload", "edit"])
        self.assertIn("--draft", client.commands[0])
        self.assertIn("--verify-tag", client.commands[0])
        self.assertIn("--draft=false", client.commands[-1])

    def test_moved_tag_cannot_publish(self):
        client = FakeGitHub(self.files, commit="b" * 40)
        with self.assertRaisesRegex(ValueError, "tag moved"):
            publish(TAG, REPOSITORY, COMMIT, self.files, self.notes, client)
        self.assertEqual(client.commands, [])

    def test_bad_upload_stays_draft(self):
        client = FakeGitHub(self.files, corrupt_upload=True)
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            publish(TAG, REPOSITORY, COMMIT, self.files, self.notes, client)
        self.assertTrue(client.release["draft"])
        self.assertFalse(any(c[1] == "edit" for c in client.commands))

    def test_retry_published_release_is_read_only(self):
        release = dict(draft=False, html_url="https://example.invalid/release", assets=assets(self.files))
        client = FakeGitHub(self.files, release)
        publish(TAG, REPOSITORY, COMMIT, self.files, self.notes, client)
        self.assertEqual(client.commands, [])

    def test_different_published_assets_are_not_overwritten(self):
        release = dict(draft=False, html_url="https://example.invalid/release", assets=assets(self.files))
        release["assets"][0]["digest"] = "sha256:different"
        client = FakeGitHub(self.files, release)
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            publish(TAG, REPOSITORY, COMMIT, self.files, self.notes, client)
        self.assertEqual(client.commands, [])

    def test_foreign_draft_is_not_modified(self):
        client = FakeGitHub(self.files, dict(id=42, tag_name=TAG, draft=True,
                                             body="someone else's draft", assets=[]))
        with self.assertRaisesRegex(ValueError, "unrelated draft"):
            publish(TAG, REPOSITORY, COMMIT, self.files, self.notes, client)
        self.assertEqual(client.commands, [])

    def test_own_partial_draft_can_resume(self):
        client = FakeGitHub(self.files, dict(id=42, draft=True, body=MARKER, assets=[], tag_name=TAG,
                                             name=TAG, html_url="https://example.invalid/release"))
        result = publish(TAG, REPOSITORY, COMMIT, self.files, self.notes, client)
        self.assertFalse(result["draft"])
        self.assertEqual([c[1] for c in client.commands], ["upload", "edit"])

    def test_missing_asset_is_not_complete(self):
        with self.assertRaisesRegex(ValueError, "inventory"):
            verify_assets(dict(assets=assets(self.files)[:-1]), self.files)

    def test_draft_lookup_handles_tag_endpoint_404(self):
        release = dict(id=42, tag_name=TAG, draft=True, body=MARKER, assets=[])
        client = FakeGitHub(self.files, release)
        self.assertIsNone(client.get(f"repos/{REPOSITORY}/releases/tags/{TAG}", missing_ok=True))
        self.assertEqual(find_release(client, f"repos/{REPOSITORY}", TAG), release)

    def test_draft_lookup_paginates_past_other_releases(self):
        client = mock.Mock()
        unrelated = [dict(tag_name=f"v1.{index}") for index in range(100)]
        draft = dict(id=42, tag_name=TAG, draft=True)
        client.get.side_effect = [None, unrelated, [draft]]
        self.assertEqual(find_release(client, f"repos/{REPOSITORY}", TAG), draft)
        self.assertTrue(client.get.call_args.args[0].endswith("page=2"))

    def test_duplicate_drafts_are_rejected(self):
        client = mock.Mock()
        client.get.side_effect = [None, [dict(tag_name=TAG), dict(tag_name=TAG)]]
        with self.assertRaisesRegex(ValueError, "Multiple release drafts"):
            find_release(client, f"repos/{REPOSITORY}", TAG)


class ReleaseVersionTests(unittest.TestCase):
    def setUp(self):
        self.settings = SimpleNamespace(data=dict(quickjs=dict(version="2026-06-04")))

    def test_zip_uses_tag_version_without_v(self):
        info = release_info(self.settings, TAG)
        self.assertEqual(info, dict(tag=TAG, version="2026-06-04.1", archive="quickjs-cosmo-2026-06-04.1.zip"))

    def test_actions_tag_selects_the_same_version_automatically(self):
        with mock.patch.dict(os.environ, {"GITHUB_REF_TYPE": "tag", "GITHUB_REF_NAME": TAG}):
            self.assertEqual(release_info(self.settings)["version"], "2026-06-04.1")

    def test_branch_build_keeps_upstream_version(self):
        with mock.patch.dict(os.environ, {"GITHUB_REF_TYPE": "branch", "GITHUB_REF_NAME": "main"}):
            self.assertEqual(release_info(self.settings), dict(
                tag=None, version="2026-06-04", archive="quickjs-cosmo-2026-06-04.zip"))

    def test_bundle_filename_cannot_disagree_with_tag(self):
        info = release_info(self.settings, TAG)
        info["archive"] = "quickjs-cosmo-wrong.zip"
        with self.assertRaisesRegex(ValueError, "inconsistent"):
            bundle_release(dict(release=info), self.settings)

    def test_bundle_from_another_tag_is_rejected(self):
        info = release_info(self.settings, TAG)
        with mock.patch.dict(os.environ, {"GITHUB_REF_TYPE": "tag", "GITHUB_REF_NAME": "v2026-06-04.2"}):
            with self.assertRaisesRegex(ValueError, "current GitHub ref"):
                bundle_release(dict(release=info), self.settings)


class RetryReleaseTests(unittest.TestCase):
    def setUp(self):
        self.run = dict(repository=dict(full_name=REPOSITORY), head_sha=COMMIT, head_branch=TAG,
                        event="push", path=".github/workflows/build-ape.yml", status="completed")
        self.jobs = [dict(name="CI gate", status="completed", conclusion="success"),
                     dict(name="Publish tagged release", status="completed", conclusion="failure")]

    def test_retry_accepts_failed_publication_after_successful_gate(self):
        require_verified_run(self.run, self.jobs, REPOSITORY, TAG, COMMIT)

    def test_retry_rejects_different_source_or_incomplete_run(self):
        for key, value in (("head_sha", "b" * 40), ("head_branch", "main"), ("event", "pull_request"),
                           ("path", "other.yml"), ("status", "in_progress")):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "release tag"):
                require_verified_run(dict(self.run, **{key: value}), self.jobs, REPOSITORY, TAG, COMMIT)

    def test_retry_rejects_failed_or_missing_gate(self):
        for jobs in ([], [dict(name="CI gate", status="completed", conclusion="failure")]):
            with self.subTest(jobs=jobs), self.assertRaisesRegex(ValueError, "successful complete CI gate"):
                require_verified_run(self.run, jobs, REPOSITORY, TAG, COMMIT)

    def test_retry_rejects_failed_validation(self):
        self.jobs.append(dict(name="Verify windows-2025", status="completed", conclusion="failure"))
        with self.assertRaisesRegex(ValueError, "unsuccessful validation"):
            require_verified_run(self.run, self.jobs, REPOSITORY, TAG, COMMIT)

    def test_retry_rejects_another_repository(self):
        self.run["repository"]["full_name"] = "other/quickjs-cosmo"
        with self.assertRaisesRegex(ValueError, "release tag"):
            require_verified_run(self.run, self.jobs, REPOSITORY, TAG, COMMIT)


if __name__ == "__main__":
    unittest.main()
