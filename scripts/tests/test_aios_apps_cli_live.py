"""Exercise the compiled Apps CLI against an explicitly selected local relay."""

import json
import os
from pathlib import Path
import secrets
import subprocess
import unittest
from urllib.parse import urlsplit
import uuid


@unittest.skipUnless(
    os.environ.get("AIOS_TEST_RELAY_URL") and os.environ.get("AIOS_TEST_CLI"),
    "Requires an explicitly selected loopback relay and CLI binary",
)
class AppsCliLiveTests(unittest.TestCase):
    def test_all_editors_share_the_cli_document_contract_and_private_access(self):
        relay = os.environ["AIOS_TEST_RELAY_URL"]
        parsed = urlsplit(relay)
        self.assertEqual((parsed.scheme, parsed.hostname), ("ws", "127.0.0.1"))
        self.assertIsNotNone(parsed.port)
        binary = Path(os.environ["AIOS_TEST_CLI"])
        self.assertTrue(binary.is_absolute() and binary.is_file())
        owner, outsider = secrets.token_hex(32), secrets.token_hex(32)

        def run(*args, document=None, denied=False, use_outsider=False):
            result = subprocess.run(
                [str(binary), *args], capture_output=True, text=True, timeout=60,
                input=json.dumps(document) if document is not None else None,
                env={"BUZZ_RELAY_URL": relay, "BUZZ_PRIVATE_KEY": outsider if use_outsider else owner},
            )
            if denied:
                self.assertNotEqual(result.returncode, 0)
            else:
                self.assertEqual(result.returncode, 0, result.stderr[-4000:])
            return result

        def read(*args):
            return json.loads(run(*args).stdout)

        channel = read("business", "init", "--name", f"Apps CLI proof {uuid.uuid4()}")["channel_id"]
        original_context = read("business", "show", "--channel", channel)
        stamp = "2026-09-24T00:00:00.000Z"
        documents = {
            "slides": {"title": "København", "slides": [{"id": "slide-one", "title": "Velkommen", "body": "An agent-created introduction."}]},
            "calendar": {"googleCalendarStatus": "not_connected", "events": [{"id": "event-one", "title": "Customer call", "description": "Prepare the first brief.", "startsAt": "2026-09-25T09:00:00.000Z", "endsAt": "2026-09-25T10:00:00.000Z"}]},
            "design": {"title": "Customer welcome", "html": "<main><h1>Welcome</h1><p>A useful prototype.</p></main>"},
        }
        saved_documents = []
        for app, body in documents.items():
            with self.subTest(app=app):
                document = {"kind": app, "schemaVersion": 1, "id": f"{app}-one", "updatedAt": stamp, **body}
                scope = ("--channel", channel, "--app", app)
                created = json.loads(run("apps", "create", *scope, "--document", "-", document=document).stdout)
                self.assertTrue(created["private"] and created["readback_verified"])
                self.assertNotEqual(created["channel_id"], channel)
                shown = read("apps", "show", *scope)
                self.assertEqual(shown["document"], document)
                self.assertEqual(len(shown["members"]), 1, "company members must not be copied to app access")
                run("apps", "create", *scope, "--document", "-", document=document, denied=True)
                document["updatedAt"] = "2026-09-24T00:01:00.000Z"
                if app == "calendar":
                    document["events"][0]["description"] = "Prepare the revised brief."
                else:
                    document["title"] += " — revised"
                updated = json.loads(run("apps", "update", *scope, "--expected-revision", shown["revision"], "--document", "-", document=document).stdout)
                self.assertTrue(updated["readback_verified"] and updated["is_current_head"])
                run("apps", "update", *scope, "--expected-revision", shown["revision"], "--document", "-", document=document, denied=True)
                final = read("apps", "show", *scope)
                self.assertEqual(final["document"], document)
                denied = run("apps", "show", *scope, use_outsider=True, denied=True)
                self.assertNotIn(document["id"], denied.stdout)
                saved_documents.append(final["document"])
        listed = read("apps", "list", "--channel", channel)
        self.assertEqual({item["app_id"] for item in listed["apps"]}, set(documents))
        self.assertEqual(read("business", "show", "--channel", channel), original_context)
        ordinary = read("channels", "create", "--name", f"Ordinary private room {uuid.uuid4()}", "--type", "stream", "--visibility", "private")["channel_id"]
        run("apps", "create", "--channel", ordinary, "--app", "slides", "--document", "-", document=saved_documents[0], denied=True)
        # Use the production Desktop parser on the exact documents read back
        # from the relay, so duplicated Rust/TypeScript schemas cannot silently drift.
        root = Path(__file__).resolve().parents[2]
        script = """
import assert from 'node:assert/strict';
import { parseAppDocument } from './desktop/src/features/aios-apps/types.ts';
let input = ''; for await (const chunk of process.stdin) input += chunk;
for (const document of JSON.parse(input)) {
  const parsed = parseAppDocument(document.kind, document);
  assert.deepEqual(parsed, document, 'Desktop rejected or changed the CLI document');
}
console.log('All three Desktop app parsers accepted persisted CLI documents');
"""
        result = subprocess.run(["node", "--import", "./desktop/test-loader.mjs", "--experimental-strip-types", "--input-type=module", "-e", script],
                                cwd=root, input=json.dumps(saved_documents), capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr[-4000:])


if __name__ == "__main__":
    unittest.main()
