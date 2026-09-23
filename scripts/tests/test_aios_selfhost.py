"""Security regression tests for the AIOS Buzz backup/restore validator."""

from __future__ import annotations

import datetime as dt
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import stat
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "aios-selfhost"
LOADER = importlib.machinery.SourceFileLoader("aios_selfhost", str(SCRIPT))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
assert SPEC is not None
AIOS_SELFHOST = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(AIOS_SELFHOST)


def core_values() -> dict[str, str]:
    return {
        "BUZZ_HTTP_PORT": "3341",
        "BUZZ_DOMAIN": "127.0.0.1",
        "RELAY_URL": "ws://127.0.0.1:3341",
        "BUZZ_MEDIA_BASE_URL": "http://127.0.0.1:3341/media",
        "BUZZ_CORS_ORIGINS": "http://127.0.0.1:3341,http://localhost:3341",
        "BUZZ_RELAY_PRIVATE_KEY": "12" * 32,
        "BUZZ_GIT_HOOK_HMAC_SECRET": "ab" * 32,
        "POSTGRES_PASSWORD": "pg-test-secret-0123456789",
        "REDIS_PASSWORD": "redis-test-secret-0123456789",
        "BUZZ_S3_ACCESS_KEY": "fake-access-key",
        "BUZZ_S3_SECRET_KEY": "fake-s3-secret-0123456789",
    }


def sites_values(**overrides: str) -> dict[str, str]:
    values = {
        "AIOS_SITES_ENABLED": "1",
        "AIOS_SITES_ADMIN_TOKEN": "p" * 64,
        "AIOS_SITES_PUBLIC_PORT": "3351",
        "AIOS_SITES_ADMIN_PORT": "3352",
        "AIOS_SITES_PUBLIC_ORIGIN": "http://127.0.0.1:3351",
        "AIOS_SITES_ENABLE_DEV_PREVIEW": "0",
    }
    values.update(overrides)
    return values


def rendered_config(project: str, values: dict[str, str]) -> dict:
    config = {
        "name": project,
        "services": {
            "relay": {"ports": [{"host_ip": "127.0.0.1", "target": 3000, "published": values["BUZZ_HTTP_PORT"]}]},
            "postgres": {"ports": []},
            "redis": {"ports": []},
            "minio": {"ports": []},
        },
        "volumes": {
            resource: {"name": f"{project}_{resource}"}
            for resource in (*AIOS_SELFHOST.VOLUMES.values(), AIOS_SELFHOST.SITES_VOLUME)
        },
    }
    if AIOS_SELFHOST.sites_enabled(values):
        settings = AIOS_SELFHOST.sites_settings(values)
        config["services"]["sites-publisher"] = {
            "profiles": ["publisher"],
            "build": {
                "context": str((AIOS_SELFHOST.ROOT / "services/aios-sites").resolve()),
                "dockerfile": "Dockerfile",
            },
            "ports": [
                {"host_ip": "127.0.0.1", "target": 3351, "published": str(settings["public_port"])},
                {"host_ip": "127.0.0.1", "target": 3352, "published": str(settings["admin_port"])},
            ],
            "environment": {
                "AIOS_SITES_ADMIN_TOKEN": str(settings["token"]),
                "AIOS_SITES_DATA_DIR": "/data",
                "AIOS_SITES_CONTAINER_MODE": "1",
                "AIOS_SITES_PUBLIC_ORIGIN": str(settings["public_origin"]),
                "AIOS_SITES_ENABLE_DEV_PREVIEW": str(settings["dev_preview"]),
            },
            "volumes": [{"type": "volume", "source": AIOS_SELFHOST.SITES_VOLUME, "target": "/data"}],
        }
    return config


def make_backup(directory: Path, version: int = 1, env_overrides: dict[str, str] | None = None) -> Path:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    data_dir = directory / "data"
    data_dir.mkdir(mode=0o700, exist_ok=True)
    os.chmod(data_dir, 0o700)
    values = core_values()
    if version == 2 and env_overrides is None:
        env_overrides = {"AIOS_SITES_ENABLED": "0"}
    values.update(env_overrides or {})
    env_path = directory / "environment.env"
    env_path.write_text("".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8")
    os.chmod(env_path, 0o600)

    services = tuple(AIOS_SELFHOST.VOLUMES) + (("sites",) if version == 2 else ())
    checksums = {"environment.env": AIOS_SELFHOST.sha256(env_path)}
    for service in services:
        archive_path = data_dir / f"{service}.tar.gz"
        with tarfile.open(archive_path, "w:gz") as archive:
            info = tarfile.TarInfo("marker")
            payload = service.encode("ascii")
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
        os.chmod(archive_path, 0o600)
        checksums[f"data/{service}.tar.gz"] = AIOS_SELFHOST.sha256(archive_path)

    volumes = {
        service: f"aios-buzz-local_{resource}"
        for service, resource in AIOS_SELFHOST.VOLUMES.items()
    }
    if version == 2:
        volumes["sites"] = f"aios-buzz-local_{AIOS_SELFHOST.SITES_VOLUME}"
    manifest = {
        "format": "aios-buzz-selfhost-backup",
        "version": version,
        "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "sourceProject": "aios-buzz-local",
        "sourceCommit": "7f30e55",
        "volumes": volumes,
        "sha256": checksums,
    }
    manifest_path = directory / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    os.chmod(manifest_path, 0o600)
    return directory


class PublisherEnvironmentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="aios-selfhost-env-")
        self.addCleanup(self.temp_dir.cleanup)
        self.env_file = Path(self.temp_dir.name) / "private.env"

    def write_env(self, additions: dict[str, str] | None = None) -> dict[str, str]:
        values = core_values()
        values.update(additions or {})
        self.env_file.write_text("".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8")
        os.chmod(self.env_file, 0o600)
        return values

    def test_accepts_core_only_environment_and_defaults_publisher_off(self) -> None:
        values = self.write_env()

        self.assertEqual(AIOS_SELFHOST.private_env_file(self.env_file), values)
        self.assertFalse(AIOS_SELFHOST.sites_enabled(values))

    def test_enabled_environment_validates_token_ports_origin_and_preview_flag(self) -> None:
        values = {**core_values(), **sites_values()}
        self.env_file.write_text("".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8")
        os.chmod(self.env_file, 0o600)

        self.assertEqual(AIOS_SELFHOST.private_env_file(self.env_file), values)
        invalid = (
            ("AIOS_SITES_ADMIN_TOKEN", "short"),
            ("AIOS_SITES_ADMIN_TOKEN", "x" * 31 + " "),
            ("AIOS_SITES_ADMIN_TOKEN", "CHANGE_ME" * 8),
            ("AIOS_SITES_PUBLIC_PORT", "bad"),
            ("AIOS_SITES_ADMIN_PORT", "3351"),
            ("AIOS_SITES_PUBLIC_ORIGIN", "http://example.com:3351"),
            ("AIOS_SITES_PUBLIC_ORIGIN", "https://bad host"),
            ("AIOS_SITES_ENABLE_DEV_PREVIEW", "yes"),
        )
        for key, value in invalid:
            with self.subTest(key=key, value=value):
                self.env_file.write_text(
                    "".join(f"{name}={value if name == key else current}\n" for name, current in values.items()),
                    encoding="utf-8",
                )
                with self.assertRaises(AIOS_SELFHOST.OperationError):
                    AIOS_SELFHOST.private_env_file(self.env_file)

    def test_compose_profile_is_forced_from_private_environment(self) -> None:
        off = self.write_env()
        with mock.patch.dict(os.environ, {"COMPOSE_PROFILES": "publisher", "BUZZ_HTTP_PORT": "9999"}):
            environment = AIOS_SELFHOST.compose_env(self.env_file, off)
        self.assertEqual(environment["COMPOSE_PROFILES"], "")
        self.assertNotIn("BUZZ_HTTP_PORT", environment)

        on = {**off, **sites_values()}
        with mock.patch.dict(os.environ, {"COMPOSE_PROFILES": "", "BUZZ_HTTP_PORT": "9999"}):
            environment = AIOS_SELFHOST.compose_env(self.env_file, on)
        self.assertEqual(environment["COMPOSE_PROFILES"], "publisher")

    def test_sites_admin_token_is_redacted(self) -> None:
        token = "private-publisher-token-0123456789"

        self.assertEqual(AIOS_SELFHOST.redact(f"token={token}", {"AIOS_SITES_ADMIN_TOKEN": token}), "token=[redacted]")

    def test_enable_publisher_adds_settings_without_replacing_core_secrets(self) -> None:
        original = self.write_env()
        generated = "z" * 64
        output = io.StringIO()
        with mock.patch.object(AIOS_SELFHOST, "openssl_random_hex", return_value=generated), mock.patch.object(
            AIOS_SELFHOST, "config_json", return_value={}
        ), contextlib.redirect_stdout(output):
            AIOS_SELFHOST.enable_publisher(self.env_file, "aios-buzz-local")

        updated = AIOS_SELFHOST.parse_env(self.env_file)
        for key, value in original.items():
            self.assertEqual(updated[key], value)
        self.assertEqual(updated["AIOS_SITES_ENABLED"], "1")
        self.assertEqual(updated["AIOS_SITES_PUBLIC_PORT"], "3351")
        self.assertEqual(updated["AIOS_SITES_ADMIN_PORT"], "3352")
        self.assertEqual(updated["AIOS_SITES_PUBLIC_ORIGIN"], "http://127.0.0.1:3351")
        self.assertEqual(updated["AIOS_SITES_ADMIN_TOKEN"], generated)
        self.assertEqual(stat.S_IMODE(self.env_file.stat().st_mode), 0o600)
        self.assertNotIn(generated, output.getvalue())

    def test_enable_publisher_preserves_existing_token_and_repairs_missing_one(self) -> None:
        existing = "keep-this-existing-admin-token-0123456789"
        self.write_env({"AIOS_SITES_ADMIN_TOKEN": existing})
        with mock.patch.object(AIOS_SELFHOST, "config_json", return_value={}):
            AIOS_SELFHOST.enable_publisher(self.env_file, "aios-buzz-local")
        self.assertEqual(AIOS_SELFHOST.parse_env(self.env_file)["AIOS_SITES_ADMIN_TOKEN"], existing)

        self.write_env({"AIOS_SITES_ENABLED": "1"})
        with mock.patch.object(AIOS_SELFHOST, "openssl_random_hex", return_value="r" * 64), mock.patch.object(
            AIOS_SELFHOST, "config_json", return_value={}
        ):
            AIOS_SELFHOST.enable_publisher(self.env_file, "aios-buzz-local")
        self.assertEqual(AIOS_SELFHOST.parse_env(self.env_file)["AIOS_SITES_ADMIN_TOKEN"], "r" * 64)

    def test_enable_publisher_chooses_distinct_defaults_for_custom_relay_port(self) -> None:
        self.write_env({"BUZZ_HTTP_PORT": "3351"})
        with mock.patch.object(AIOS_SELFHOST, "config_json", return_value={}):
            AIOS_SELFHOST.enable_publisher(self.env_file, "aios-buzz-local")
        values = AIOS_SELFHOST.private_env_file(self.env_file)

        self.assertEqual(values["AIOS_SITES_PUBLIC_PORT"], "3352")
        self.assertEqual(values["AIOS_SITES_ADMIN_PORT"], "3353")
        self.assertEqual(values["AIOS_SITES_PUBLIC_ORIGIN"], "http://127.0.0.1:3352")

    def test_enable_publisher_rolls_back_if_compose_preflight_fails(self) -> None:
        self.write_env()
        original = self.env_file.read_bytes()
        with mock.patch.object(AIOS_SELFHOST, "openssl_random_hex", return_value="q" * 64), mock.patch.object(
            AIOS_SELFHOST, "config_json", side_effect=AIOS_SELFHOST.OperationError("synthetic preflight failure")
        ):
            with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "synthetic preflight failure"):
                AIOS_SELFHOST.enable_publisher(self.env_file, "aios-buzz-local")

        self.assertEqual(self.env_file.read_bytes(), original)
        self.assertEqual(stat.S_IMODE(self.env_file.stat().st_mode), 0o600)

class PublisherComposeValidationTests(unittest.TestCase):
    def test_preflight_accepts_enabled_publisher_and_rejects_wildcard_binding(self) -> None:
        project = "aios-compose-test"
        values = {**core_values(), **sites_values()}
        config = rendered_config(project, values)
        with mock.patch.object(AIOS_SELFHOST, "run_capture", return_value=(0, json.dumps(config))):
            validated = AIOS_SELFHOST.config_json(project, AIOS_SELFHOST.DEFAULT_ENV, values)
        self.assertIn("sites-publisher", validated["services"])

        config["services"]["sites-publisher"]["ports"][0]["host_ip"] = "0.0.0.0"
        with mock.patch.object(AIOS_SELFHOST, "run_capture", return_value=(0, json.dumps(config))):
            with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "loopback"):
                AIOS_SELFHOST.config_json(project, AIOS_SELFHOST.DEFAULT_ENV, values)

        config["services"]["sites-publisher"]["ports"][0]["host_ip"] = "127.0.0.1"
        config["services"]["sites-publisher"]["build"]["context"] = str(AIOS_SELFHOST.ROOT)
        with mock.patch.object(AIOS_SELFHOST, "run_capture", return_value=(0, json.dumps(config))):
            with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "build from services/aios-sites"):
                AIOS_SELFHOST.config_json(project, AIOS_SELFHOST.DEFAULT_ENV, values)

    def test_preflight_requires_profile_to_stay_disabled_by_default(self) -> None:
        project = "aios-compose-test"
        values = core_values()
        config = rendered_config(project, values)
        config["volumes"].pop(AIOS_SELFHOST.SITES_VOLUME)
        with mock.patch.object(AIOS_SELFHOST, "run_capture", return_value=(0, json.dumps(config))):
            validated = AIOS_SELFHOST.config_json(project, AIOS_SELFHOST.DEFAULT_ENV, values)
        self.assertEqual(
            AIOS_SELFHOST.sites_volume_name(validated, project),
            f"{project}_{AIOS_SELFHOST.SITES_VOLUME}",
        )

        config["services"]["sites-publisher"] = rendered_config(project, {**values, **sites_values()})["services"]["sites-publisher"]
        with mock.patch.object(AIOS_SELFHOST, "run_capture", return_value=(0, json.dumps(config))):
            with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "disabled"):
                AIOS_SELFHOST.config_json(project, AIOS_SELFHOST.DEFAULT_ENV, values)


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

    def test_accepts_unchanged_version_one_backup(self) -> None:
        make_backup(self.backup_dir)

        manifest, _, values = AIOS_SELFHOST.verify_backup(self.backup_dir)

        self.assertEqual(manifest["version"], 1)
        self.assertFalse(AIOS_SELFHOST.sites_enabled(values))

    def test_accepts_version_two_with_sites_volume_and_archive(self) -> None:
        make_backup(self.backup_dir, version=2, env_overrides=sites_values())

        manifest, _, values = AIOS_SELFHOST.verify_backup(self.backup_dir)

        self.assertEqual(manifest["version"], 2)
        self.assertEqual(manifest["volumes"]["sites"], f"aios-buzz-local_{AIOS_SELFHOST.SITES_VOLUME}")
        self.assertTrue(AIOS_SELFHOST.sites_enabled(values))

    def test_rejects_version_one_environment_that_enables_sites(self) -> None:
        make_backup(self.backup_dir, env_overrides=sites_values())

        with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "Version 1 backups cannot enable"):
            AIOS_SELFHOST.verify_backup(self.backup_dir)

    def test_rejects_version_two_sites_volume_mismatch(self) -> None:
        make_backup(self.backup_dir, version=2, env_overrides=sites_values())
        path = self.backup_dir / "manifest.json"
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifest["volumes"]["sites"] = "shared-sites-data"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        os.chmod(path, 0o600)

        with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "source volume metadata"):
            AIOS_SELFHOST.verify_backup(self.backup_dir)

    def test_rejects_unlisted_or_extraneous_archive(self) -> None:
        make_backup(self.backup_dir)
        (self.backup_dir / "data" / "sites.tar.gz").write_bytes(b"unexpected")
        os.chmod(self.backup_dir / "data" / "sites.tar.gz", 0o600)

        with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "unexpected or missing archives"):
            AIOS_SELFHOST.verify_backup(self.backup_dir)

    def test_rejects_unlisted_root_file(self) -> None:
        make_backup(self.backup_dir)
        (self.backup_dir / "extra.txt").write_text("unexpected", encoding="utf-8")

        with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "unexpected files"):
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


class BackupOperationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="aios-selfhost-backup-op-")
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.backup_root = self.root / "backups"
        self.env_file = self.root / "private.env"

    def run_backup(self, *, enabled: bool, sites_volume_exists: bool, running: list[str]) -> tuple[Path, mock.Mock, mock.Mock, mock.Mock]:
        values = core_values()
        if enabled:
            values.update(sites_values())
        self.env_file.write_text("".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8")
        os.chmod(self.env_file, 0o600)
        config = rendered_config("aios-backup-test", values)
        helper = mock.Mock(
            side_effect=lambda volume, archive_dir, archive_name, *, restore: self.write_volume_archive(
                archive_dir / archive_name
            )
        )
        running_mock = mock.Mock(return_value=running)
        run_capture_mock = mock.Mock(return_value=(0, ""))
        site_name = f"aios-backup-test_{AIOS_SELFHOST.SITES_VOLUME}"
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "BACKUP_ROOT", self.backup_root))
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "validate_stack", return_value=values))
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "config_json", return_value=config))
            stack.enter_context(
                mock.patch.object(
                    AIOS_SELFHOST,
                    "volume_exists",
                    side_effect=lambda name: sites_volume_exists if name == site_name else True,
                )
            )
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "service_running", running_mock))
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "run_stream"))
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "helper_container", helper))
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "run_capture", run_capture_mock))
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "source_revision", return_value="7f30e55"))
            with contextlib.redirect_stdout(io.StringIO()):
                AIOS_SELFHOST.backup("aios-backup-test", self.env_file)
        return next(self.backup_root.iterdir()), running_mock, run_capture_mock, helper

    @staticmethod
    def write_volume_archive(path: Path) -> None:
        with tarfile.open(path, "w:gz") as archive:
            info = tarfile.TarInfo("marker")
            payload = b"data"
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
        os.chmod(path, 0o600)

    def test_disabled_without_sites_volume_writes_version_one(self) -> None:
        destination, running_mock, run_capture_mock, helper = self.run_backup(
            enabled=False,
            sites_volume_exists=False,
            running=["relay", "postgres"],
        )

        manifest = json.loads((destination / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(set(manifest["volumes"]), set(AIOS_SELFHOST.VOLUMES))
        self.assertEqual(len(list((destination / "data").iterdir())), 4)
        self.assertFalse(running_mock.call_args.kwargs["include_publisher"])
        self.assertEqual(run_capture_mock.call_args.kwargs["env"]["COMPOSE_PROFILES"], "")
        self.assertEqual(helper.call_count, 4)

    def test_enabled_or_existing_sites_volume_writes_version_two_and_preserves_profile(self) -> None:
        destination, running_mock, run_capture_mock, helper = self.run_backup(
            enabled=False,
            sites_volume_exists=True,
            running=["relay", "sites-publisher"],
        )

        manifest = json.loads((destination / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], 2)
        self.assertEqual(set(manifest["volumes"]), {*AIOS_SELFHOST.VOLUMES, "sites"})
        self.assertTrue(running_mock.call_args.kwargs["include_publisher"])
        self.assertEqual(run_capture_mock.call_args.kwargs["env"]["COMPOSE_PROFILES"], "publisher")
        self.assertEqual(helper.call_count, 5)

    def test_enabled_sites_without_its_volume_fails_before_stopping_stack(self) -> None:
        values = {**core_values(), **sites_values()}
        self.env_file.write_text("".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8")
        os.chmod(self.env_file, 0o600)
        with mock.patch.object(AIOS_SELFHOST, "validate_stack", return_value=values), mock.patch.object(
            AIOS_SELFHOST, "config_json", return_value=rendered_config("aios-backup-test", values)
        ), mock.patch.object(AIOS_SELFHOST, "volume_exists", return_value=False), mock.patch.object(
            AIOS_SELFHOST, "run_stream"
        ) as run_stream:
            with self.assertRaisesRegex(AIOS_SELFHOST.OperationError, "Sites Publisher data volume is missing"):
                AIOS_SELFHOST.backup("aios-backup-test", self.env_file)
        run_stream.assert_not_called()


class RestoreOperationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="aios-selfhost-restore-op-")
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.restore_root = self.root / "restores"

    def run_restore(self, *, version: int, overrides: dict[str, str], project: str) -> tuple[dict[str, str], list, list, mock.Mock, mock.Mock]:
        backup_dir = make_backup(self.root / f"backup-{project}", version=version, env_overrides=overrides)
        next_ports = iter((44001, 44002, 44003))
        allocated: list[tuple[int, set[int]]] = []

        def allocate(start: int, excluded: set[int]) -> int:
            allocated.append((start, set(excluded)))
            return next(next_ports)

        created_volumes: list[list[str]] = []
        restored_archives: list[tuple[str, str, bool]] = []
        run_capture_mock = mock.Mock(side_effect=lambda args, **kwargs: (created_volumes.append(args) or 0, "volume"))
        helper_mock = mock.Mock(
            side_effect=lambda volume, archive_dir, archive_name, *, restore: restored_archives.append(
                (volume, archive_name, restore)
            )
        )
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "RESTORE_ROOT", self.restore_root))
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "compose_version", return_value=((2, 24, 4), "2.24.4")))
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "engine_version", return_value="test-engine"))
            stack.enter_context(
                mock.patch.object(
                    AIOS_SELFHOST,
                    "config_json",
                    side_effect=lambda project, env_file, values: rendered_config(project, values),
                )
            )
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "free_local_port", side_effect=allocate))
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "volume_exists", return_value=False))
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "run_capture", run_capture_mock))
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "helper_container", helper_mock))
            stack.enter_context(mock.patch.object(AIOS_SELFHOST, "rebind_local_community"))
            run_stream_mock = stack.enter_context(mock.patch.object(AIOS_SELFHOST, "run_stream"))
            with contextlib.redirect_stdout(io.StringIO()):
                AIOS_SELFHOST.restore(backup_dir, project, should_start=False)

        restored_env = self.restore_root / project / ".env"
        restored_values = AIOS_SELFHOST.private_env_file(restored_env)
        return restored_values, created_volumes, restored_archives, run_stream_mock, run_capture_mock

    def test_version_two_restore_rebases_local_sites_origin_and_uses_fresh_labeled_volume(self) -> None:
        token = "restore-admin-token-0123456789abcdefghijkl"
        overrides = sites_values(AIOS_SITES_ADMIN_TOKEN=token)
        values, created, archives, down, _ = self.run_restore(version=2, overrides=overrides, project="restore-local")

        self.assertEqual(values["BUZZ_HTTP_PORT"], "44001")
        self.assertEqual(values["AIOS_SITES_PUBLIC_PORT"], "44002")
        self.assertEqual(values["AIOS_SITES_ADMIN_PORT"], "44003")
        self.assertEqual(values["AIOS_SITES_PUBLIC_ORIGIN"], "http://127.0.0.1:44002")
        self.assertEqual(values["AIOS_SITES_ADMIN_TOKEN"], token)
        sites_volume = "restore-local_aios-sites-data"
        self.assertTrue(any(args[-1] == sites_volume and "com.buzz.aios.restore=" in " ".join(args) for args in created))
        self.assertIn((sites_volume, "sites.tar.gz", True), archives)
        self.assertEqual(down.call_args.kwargs["env"]["COMPOSE_PROFILES"], "publisher")

    def test_version_two_restore_preserves_custom_https_origin(self) -> None:
        overrides = sites_values(AIOS_SITES_PUBLIC_ORIGIN="https://sites.example.test")
        values, _, _, _, _ = self.run_restore(version=2, overrides=overrides, project="restore-https")

        self.assertEqual(values["AIOS_SITES_PUBLIC_ORIGIN"], "https://sites.example.test")
        self.assertEqual(values["AIOS_SITES_ADMIN_TOKEN"], overrides["AIOS_SITES_ADMIN_TOKEN"])
        self.assertEqual(values["AIOS_SITES_PUBLIC_PORT"], "44002")

    def test_disabled_version_two_restores_sites_data_without_enabling_profile(self) -> None:
        values, created, archives, down, _ = self.run_restore(
            version=2,
            overrides={"AIOS_SITES_ENABLED": "0"},
            project="restore-disabled",
        )

        self.assertEqual(values["AIOS_SITES_ENABLED"], "0")
        self.assertTrue(any(args[-1] == "restore-disabled_aios-sites-data" for args in created))
        self.assertIn(("restore-disabled_aios-sites-data", "sites.tar.gz", True), archives)
        self.assertEqual(down.call_args.kwargs["env"]["COMPOSE_PROFILES"], "")

    def test_version_one_restore_does_not_create_sites_volume(self) -> None:
        _, created, archives, _, _ = self.run_restore(version=1, overrides={}, project="restore-v1")

        self.assertEqual(len(created), 4)
        self.assertFalse(any(archive_name == "sites.tar.gz" for _, archive_name, _ in archives))


if __name__ == "__main__":
    unittest.main()
