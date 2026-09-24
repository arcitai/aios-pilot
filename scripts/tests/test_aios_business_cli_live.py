"""Selective knowledge proof against a fresh, disposable, typed loopback host.

Requires AIOS_TEST_DISPOSABLE_HOST=1, AIOS_TEST_RELAY_URL, AIOS_TEST_CLI,
AIOS_TEST_CONTEXT_OWNER_KEY, AIOS_TEST_CONTEXT_AGENT_KEY and
AIOS_TEST_CONTEXT_AGENT_PUBKEY. The fixture owner is a host administrator; the
agent is an admitted ordinary member. Keys stay in subprocess environments.
The test refuses a host that already has canonical company knowledge.
"""

import json
import os
from pathlib import Path
import subprocess
import unittest
from urllib.parse import urlsplit
import uuid


REQUIRED = (
    "AIOS_TEST_RELAY_URL", "AIOS_TEST_CLI", "AIOS_TEST_CONTEXT_OWNER_KEY",
    "AIOS_TEST_CONTEXT_AGENT_KEY", "AIOS_TEST_CONTEXT_AGENT_PUBKEY",
)


@unittest.skipUnless(
    os.environ.get("AIOS_TEST_DISPOSABLE_HOST") == "1"
    and all(os.environ.get(key) for key in REQUIRED),
    "Requires an explicitly selected fresh disposable host and fixture identities",
)
class BusinessCliLiveTests(unittest.TestCase):
    def test_discovery_adoption_selective_reads_cas_and_revocation(self):
        relay = os.environ["AIOS_TEST_RELAY_URL"]
        location = urlsplit(relay)
        self.assertIn(location.scheme, ("ws", "http"))
        self.assertEqual(location.hostname, "127.0.0.1")
        self.assertIsNotNone(location.port)
        binary = Path(os.environ["AIOS_TEST_CLI"])
        self.assertTrue(binary.is_absolute() and binary.is_file())
        owner = os.environ["AIOS_TEST_CONTEXT_OWNER_KEY"]
        agent = os.environ["AIOS_TEST_CONTEXT_AGENT_KEY"]
        agent_pubkey = os.environ["AIOS_TEST_CONTEXT_AGENT_PUBKEY"]
        self.assertRegex(agent_pubkey, r"^[0-9a-f]{64}$")
        self.assertNotEqual(owner, agent)

        def invoke(*args, as_agent=False, succeeds=True, document=None):
            result = subprocess.run(
                [str(binary), *args], capture_output=True, text=True, timeout=60,
                input=None if document is None else json.dumps(document),
                env={"BUZZ_RELAY_URL": relay,
                     "BUZZ_PRIVATE_KEY": agent if as_agent else owner},
            )
            diagnostic = result.stderr[-4000:].replace(owner, "[redacted]").replace(agent, "[redacted]")
            if succeeds:
                self.assertEqual(result.returncode, 0, diagnostic)
            else:
                self.assertNotEqual(result.returncode, 0, "unexpected accepted operation")
            return result

        def read(*args, **kwargs):
            return json.loads(invoke(*args, **kwargs).stdout)

        self.assertIsNone(read("business", "discover")["canonical_context_id"],
                          "Use a fresh disposable host, never an existing company")
        suffix = str(uuid.uuid4())
        initialized = read("business", "init", "--name", f"Knowledge proof {suffix}",
                           "--summary", "We help Danish teams.")
        context = initialized["channel_id"]
        scope = ("--channel", context)
        saved = read("business", "show", *scope)
        document = saved["document"]
        sentinel = f"PRIVATE_KNOWLEDGE_{suffix}"
        document["sources"] = [{
            "id": "brand", "title": "Brand guide", "kind": "note",
            "content": f"{sentinel}: Skriv klart på dansk. 🌿",
            "createdAt": "2026-09-24T12:00:00Z",
        }]
        read("business", "update", *scope, "--file", "-",
             "--expected-revision", saved["revision"], document=document)
        before = read("business", "show", *scope)
        members = read("channels", "members", *scope)
        adoption = read("business", "adopt", *scope)
        self.assertTrue(adoption["registered"])
        self.assertFalse(adoption["already_registered"])
        self.assertTrue(read("business", "adopt", *scope)["already_registered"])
        self.assertEqual(read("business", "show", *scope), before)
        self.assertEqual(read("channels", "members", *scope), members)
        discovered = read("business", "discover")
        self.assertEqual(discovered["canonical_context_id"], context)
        self.assertNotIn(sentinel, json.dumps(discovered))

        # Ordinary host membership alone never grants private company access.
        denied = invoke("business", "read", *scope, "--entry", "source:brand",
                        as_agent=True, succeeds=False)
        self.assertNotIn(sentinel, denied.stdout)
        self.assertIsNone(read("business", "discover", as_agent=True)["canonical_context_id"])
        read("channels", "add-member", *scope, "--pubkey", agent_pubkey, "--role", "bot")
        self.assertEqual(read("business", "discover", as_agent=True)["canonical_context_id"], context)
        index = read("business", "index", *scope, "--limit", "20", as_agent=True)
        self.assertNotIn(sentinel, json.dumps(index))
        self.assertEqual(index["result"]["total"], 7)
        selected = read("business", "read", *scope, "--entry", "source:brand", as_agent=True)
        self.assertEqual(selected["result"]["text"], document["sources"][0]["content"])
        search = read("business", "search", *scope, "--query", "DANSK", as_agent=True)
        self.assertEqual(search["result"]["hits"][0]["entry"]["id"], "source:brand")
        self.assertEqual(search["revision"], selected["revision"])

        page = read("business", "read", *scope, "--entry", "source:brand", "--limit", "10", as_agent=True)
        invoke("business", "read", *scope, "--entry", "source:brand", "--offset", "10",
               as_agent=True, succeeds=False)
        document["company"]["goals"] = "A fresh revision"
        read("business", "update", *scope, "--file", "-",
             "--expected-revision", before["revision"], document=document)
        stale = invoke("business", "read", *scope, "--entry", "source:brand",
                       "--offset", str(page["result"]["next_offset"]),
                       "--expected-revision", page["revision"], as_agent=True, succeeds=False)
        self.assertEqual(stale.returncode, 5)
        # Generic Canvas operations must not bypass typed-document validation.
        current = read("business", "show", *scope)
        invoke("canvas", "set", *scope, "--content", "plain text is not company JSON", succeeds=False)
        self.assertEqual(read("business", "show", *scope), current)
        read("channels", "remove-member", *scope, "--pubkey", agent_pubkey)
        for operation, arguments in (
            ("index", ()), ("search", ("--query", "DANSK")),
            ("read", ("--entry", "source:brand")),
        ):
            result = invoke("business", operation, *scope, *arguments,
                            as_agent=True, succeeds=False)
            self.assertNotIn(sentinel, result.stdout)
        self.assertIsNone(read("business", "discover", as_agent=True)["canonical_context_id"])
        self.assertEqual(read("business", "show", *scope), current)


if __name__ == "__main__":
    unittest.main()
