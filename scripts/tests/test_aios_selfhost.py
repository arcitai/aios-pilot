"""Security regression tests for the AIOS Buzz backup/restore validator."""

from __future__ import annotations

import datetime as dt
import importlib.machinery
import importlib.util
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "aios-selfhost"
LOADER = importlib.machinery.SourceFileLoader("aios_selfhost", str(SCRIPT))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
assert SPEC is not None
AIOS_SELFHOST = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(AIOS_SELFHOST)


class SafeArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="aios-selfhost-archive-")
        self.addCleanup(self.temp_dir.cleanup)
        self.archive_path = Path(self.temp_dir.name) / "archive.tar.gz"
        self.file_contents: dict[str, bytes] = {}

    def write_archive(self, members: list[tarfile.TarInfo]) -> Path:
        with tarfile.open(self.archive_path, mode="w:gz") as archive:
            for member in members:
                if member.isfile():
                    content = self.file_contents.get(member.name, b"x")
                    member.size = len(content)
                    archive.addfile(member, io.BytesIO(content))
                else:
                    archive.addfile(member)
        return self.archive_path

    @staticmethod
    def directory(name: str) -> tarfile.TarInfo:
        info = tarfile.TarInfo(name)
        info.type = tarfile.DIRTYPE
        return info

    def regular_file(self, name: str, content: bytes = b"data") -> tarfile.TarInfo:
        info = tarfile.TarInfo(name)
        self.file_contents[name] = content
        return info

    @staticmethod
    def link(name: str, target: str, kind: bytes) -> tarfile.TarInfo:
        info = tarfile.TarInfo(name)
        info.type = kind
        info.linkname = target
        return info

    def test_accepts_normal_volume_archive_paths(self) -> None:
        path = self.write_archive(
            [
                self.directory("./"),
                self.directory("./pgdata/"),
                self.regular_file("./pgdata/PG_VERSION", b"17\n"),
            ]
        )

        AIOS_SELFHOST.safe_archive(path)

    def test_rejects_parent_component_even_when_not_at_path_start(self) -> None:
        path = self.write_archive([self.regular_file("dir/../../outside")])

        with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "unsafe path"):
            AIOS_SELFHOST.safe_archive(path)

    def test_rejects_absolute_member_path(self) -> None:
        path = self.write_archive([self.regular_file("/outside")])

        with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "unsafe path"):
            AIOS_SELFHOST.safe_archive(path)

    def test_rejects_symlink_parent_target(self) -> None:
        path = self.write_archive([self.link("link", "../../outside", tarfile.SYMTYPE)])

        with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "symbolic or hard link"):
            AIOS_SELFHOST.safe_archive(path)

    def test_rejects_absolute_symlink_target(self) -> None:
        path = self.write_archive([self.link("link", "/outside", tarfile.SYMTYPE)])

        with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "symbolic or hard link"):
            AIOS_SELFHOST.safe_archive(path)

    def test_rejects_chained_symlink_escape(self) -> None:
        path = self.write_archive(
            [
                self.link("a", ".", tarfile.SYMTYPE),
                self.directory("d/"),
                self.link("d/b", "../a/..", tarfile.SYMTYPE),
            ]
        )

        with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "symbolic or hard link"):
            AIOS_SELFHOST.safe_archive(path)

    def test_rejects_hardlink_outside_archive(self) -> None:
        path = self.write_archive([self.link("hard", "../../outside", tarfile.LNKTYPE)])

        with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "symbolic or hard link"):
            AIOS_SELFHOST.safe_archive(path)


class BackupMetadataTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="aios-selfhost-manifest-")
        self.addCleanup(self.temp_dir.cleanup)
        self.backup_dir = Path(self.temp_dir.name)
        self.manifest = {
            "format": "aios-buzz-selfhost-backup",
            "version": 1,
            "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "sourceProject": "aios-buzz-local",
            "sourceCommit": "7f30e55",
            "volumes": {
                service: f"aios-buzz-local_{resource}"
                for service, resource in AIOS_SELFHOST.VOLUMES.items()
            },
            "sha256": {},
        }

    def assert_manifest_rejected(self, manifest: dict, message: str) -> None:
        path = self.backup_dir / "manifest.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        os.chmod(path, 0o600)
        with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, message):
            AIOS_SELFHOST.verify_backup(self.backup_dir)

    def test_rejects_invalid_source_project(self) -> None:
        manifest = {**self.manifest, "sourceProject": "../outside"}

        self.assert_manifest_rejected(manifest, "source project metadata")

    def test_rejects_overlong_source_project(self) -> None:
        manifest = {**self.manifest, "sourceProject": "a" * 64}

        self.assert_manifest_rejected(manifest, "source project metadata")

    def test_rejects_invalid_source_commit(self) -> None:
        manifest = {**self.manifest, "sourceCommit": "x" * 41}

        self.assert_manifest_rejected(manifest, "source commit metadata")

    def test_rejects_overlong_creation_timestamp(self) -> None:
        manifest = {**self.manifest, "createdAt": "x" * 65}

        self.assert_manifest_rejected(manifest, "64-character limit")

    def test_rejects_future_creation_timestamp(self) -> None:
        future = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=10)
        manifest = {**self.manifest, "createdAt": future.isoformat()}

        self.assert_manifest_rejected(manifest, "more than five minutes in the future")

    def test_rejects_source_volume_metadata_mismatch(self) -> None:
        manifest = {**self.manifest, "volumes": {"postgres": "primary-data"}}

        self.assert_manifest_rejected(manifest, "source volume metadata")

    def test_rejects_oversized_manifest(self) -> None:
        path = self.backup_dir / "manifest.json"
        path.write_bytes(b" " * (AIOS_SELFHOST.MAX_MANIFEST_BYTES + 1))
        os.chmod(path, 0o600)

        with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "manifest exceeds"):
            AIOS_SELFHOST.verify_backup(self.backup_dir)


if __name__ == "__main__":
    unittest.main()
