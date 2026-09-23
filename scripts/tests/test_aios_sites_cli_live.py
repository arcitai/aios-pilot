"""Real CLI/relay proof using generated identities and private test channels.

AIOS_TEST_RELAY_URL=ws://127.0.0.1:3341 AIOS_TEST_CLI=/absolute/path/to/buzz \
    python3 -m unittest scripts.tests.test_aios_sites_cli_live -v
"""

import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import unittest
from urllib.parse import urlsplit
import uuid


@unittest.skipUnless(
    os.environ.get("AIOS_TEST_RELAY_URL") and os.environ.get("AIOS_TEST_CLI"),
    "Requires an explicitly selected loopback relay and CLI binary",
)
class SitesCliLiveTests(unittest.TestCase):
    def test_private_site_roundtrip_conflict_export_and_denial(self):
        relay = os.environ["AIOS_TEST_RELAY_URL"]
        parsed = urlsplit(relay)
        self.assertEqual(parsed.scheme, "ws")
        self.assertEqual(parsed.hostname, "127.0.0.1")
        self.assertIsNotNone(parsed.port)
        binary = Path(os.environ["AIOS_TEST_CLI"])
        self.assertTrue(binary.is_absolute() and binary.is_file())
        # Generated fixture identities are never stored or printed.
        owner_key, outsider_key = secrets.token_hex(32), secrets.token_hex(32)

        def run(*arguments, document=None, outsider=False, succeeds=True):
            result = subprocess.run(
                [str(binary), *arguments],
                input=None if document is None else json.dumps(document),
                capture_output=True,
                text=True,
                timeout=60,
                env={"BUZZ_RELAY_URL": relay,
                     "BUZZ_PRIVATE_KEY": outsider_key if outsider else owner_key},
            )
            if succeeds:
                self.assertEqual(result.returncode, 0, result.stderr[-4000:])
            else:
                self.assertNotEqual(result.returncode, 0)
            return result

        def read(*arguments):
            return json.loads(run(*arguments).stdout)

        business = read("business", "init", "--name", f"Sites CLI proof {uuid.uuid4()}")["channel_id"]
        other_business = read("business", "init", "--name", f"Other Sites proof {uuid.uuid4()}")["channel_id"]

        def create_site(parent):
            marker = f"AIOS private site workspace for business channel {parent} [aios.site-channel:v1]"
            return read("channels", "create", "--name", f"CLI site {uuid.uuid4()}",
                        "--type", "stream", "--visibility", "private",
                        "--description", marker)["channel_id"]

        site = create_site(business)
        other_site = create_site(other_business)
        scope = ("--business-channel", business, "--site-channel", site)
        before = read("sites", "show", *scope)
        self.assertEqual(before["revision"], "none")
        self.assertIsNone(before["document"])
        document = {
            "schemaVersion": 1, "kind": "aios.site", "siteId": site,
            "parentBusinessChannelId": business, "title": "Velkommen til København",
            "files": {"indexHtml": "<h1>A useful customer page</h1>",
                      "styleCss": "h1 { color: teal; }", "appJs": "document.title = 'Ready';"},
        }
        run("sites", "update", *scope, "--expected-revision", "none", "--document", "-", document=document)
        saved = read("sites", "show", *scope)
        self.assertEqual(saved["document"], document)
        self.assertRegex(saved["revision"], r"^[0-9a-f]{64}$")
        listed = read("sites", "list", "--business-channel", business)
        self.assertEqual([item["site_channel_id"] for item in listed], [site])
        self.assertNotIn(other_site, json.dumps(listed))
        document["files"]["indexHtml"] = "<h1>A revised customer page</h1>"
        run("sites", "update", *scope, "--expected-revision", saved["revision"], "--document", "-", document=document)
        stale = run("sites", "update", *scope, "--expected-revision", saved["revision"], "--document", "-", document=document, succeeds=False)
        self.assertEqual(stale.returncode, 5)
        current = read("sites", "show", *scope)
        invalid = {**document, "unexpected": True}
        run("sites", "update", *scope, "--expected-revision", current["revision"], "--document", "-", document=invalid, succeeds=False)
        self.assertEqual(read("sites", "show", *scope), current)
        run("sites", "show", "--business-channel", other_business, "--site-channel", site, succeeds=False)
        denied = run("sites", "show", *scope, outsider=True, succeeds=False)
        self.assertNotIn("A revised customer page", denied.stdout)
        with tempfile.TemporaryDirectory(prefix="aios-sites-cli-") as folder:
            output = Path(folder) / "site.html"
            result = read("sites", "export", *scope, "--output", str(output))
            self.assertFalse(result["published"])
            html = output.read_text()
            self.assertIn("A revised customer page", html)
            self.assertIn("Content-Security-Policy", html)
            self.assertIn("connect-src 'none'", html)
        self.assertEqual(read("sites", "show", *scope), current)


if __name__ == "__main__":
    unittest.main()
