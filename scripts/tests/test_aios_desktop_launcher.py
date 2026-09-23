"""Exercise the packaged-app launcher without opening a native window or Docker."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "aios-desktop"


class DesktopLauncherTests(unittest.TestCase):
    def run_launcher(self, *, healthy=False, start_fails=False, becomes_healthy=True):
        with tempfile.TemporaryDirectory(prefix="aios-launcher-test-") as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            (root / "bin").mkdir()
            app = root / "desktop/src-tauri/target/debug/bundle/macos/AIOS Pilot.app"
            app.mkdir(parents=True)
            shutil.copyfile(SOURCE, root / "scripts/aios-desktop")
            commands = {
                "bin/uname": "#!/bin/sh\nprintf 'Darwin\\n'\n",
                "bin/curl": '#!/bin/sh\ntest -f "$AIOS_LAUNCHER_TEST_ROOT/healthy"\n',
                "bin/open": '#!/bin/sh\nprintf "%s\\n" "$1" > "$AIOS_LAUNCHER_TEST_ROOT/opened"\n',
                "scripts/aios-selfhost": (
                    '#!/bin/sh\nprintf "%s\\n" "$*" > "$AIOS_LAUNCHER_TEST_ROOT/start-args"\n'
                    + ("exit 1\n" if start_fails else
                       'touch "$AIOS_LAUNCHER_TEST_ROOT/healthy"\n' if becomes_healthy else "exit 0\n")
                ),
            }
            for name, content in commands.items():
                path = root / name
                path.write_text(content)
                path.chmod(0o700)
            if healthy:
                (root / "healthy").touch()
            result = subprocess.run(
                ["/bin/bash", str(root / "scripts/aios-desktop"), "open"],
                env={**os.environ, "PATH": f"{root / 'bin'}:/usr/bin:/bin", "AIOS_LAUNCHER_TEST_ROOT": str(root)},
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            started = (root / "start-args").read_text() if (root / "start-args").exists() else None
            opened = (root / "opened").read_text() if (root / "opened").exists() else None
            return result, started, opened, str(app)

    def test_healthy_server_opens_without_starting_again(self):
        result, started, opened, app = self.run_launcher(healthy=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(started)
        self.assertEqual(opened, app + "\n")

    def test_stopped_server_starts_and_is_checked_before_opening(self):
        result, started, opened, app = self.run_launcher()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(started, "start\n")
        self.assertEqual(opened, app + "\n")

    def test_start_failure_does_not_open_app(self):
        result, _, opened, _ = self.run_launcher(start_fails=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(opened)

    def test_unhealthy_server_does_not_open_app(self):
        result, _, opened, _ = self.run_launcher(becomes_healthy=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(opened)
        self.assertIn("not ready at the pilot address", result.stderr)


if __name__ == "__main__":
    unittest.main()
