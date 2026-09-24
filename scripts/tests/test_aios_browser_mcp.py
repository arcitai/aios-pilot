"""Opt-in real Browser MCP proof against a disposable loopback page.

Set AIOS_TEST_ACP and AIOS_TEST_BROWSER_NODE to the built ACP and managed Node.
The fixture owns its process group and never attaches to a user browser.
"""

import http.server
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import tempfile
import threading
import time
import unittest


class FixturePage(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        page = (
            b"<title>AIOS browser proof</title>"
            b"<main><h1>Private browser fixture</h1>"
            b"<button onclick='this.textContent=\"Done\"'>Prepare brief</button></main>"
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.end_headers()
        self.wfile.write(page)

    def log_message(self, *_args):
        pass


@unittest.skipUnless(
    os.name == "posix"
    and os.environ.get("AIOS_TEST_ACP")
    and os.environ.get("AIOS_TEST_BROWSER_NODE"),
    "Requires the built ACP, managed Node, and POSIX process groups",
)
class BrowserMcpLiveTests(unittest.TestCase):
    def test_real_stdio_browser_and_owned_process_cleanup(self):
        acp = Path(os.environ["AIOS_TEST_ACP"]).resolve(strict=True)
        node = Path(os.environ["AIOS_TEST_BROWSER_NODE"]).resolve(strict=True)
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FixturePage)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory(prefix="buzz-browser-proof-") as root:
                stderr_path = Path(root) / "stderr.log"
                child_env = os.environ.copy()
                child_env.update(
                    {
                        "BUZZ_PRIVATE_KEY": "fixture-sentinel-not-a-key",
                        "BUZZ_AUTH_TAG": "fixture-sentinel-auth",
                        "OPENAI_API_KEY": "fixture-sentinel-openai",
                        "ANTHROPIC_API_KEY": "fixture-sentinel-anthropic",
                        "NODE_OPTIONS": "--require=fixture-sentinel.js",
                    }
                )
                with stderr_path.open("wb") as errors:
                    process = subprocess.Popen(
                        [
                            str(acp),
                            "browser-mcp",
                            "--node-path",
                            str(node),
                            "--data-dir",
                            root,
                            "--headless",
                        ],
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        stderr=errors,
                        start_new_session=True,
                        env=child_env,
                    )
                    try:
                        with selectors.DefaultSelector() as ready:
                            ready.register(process.stdout, selectors.EVENT_READ)
                            pending = bytearray()

                            def send(message):
                                process.stdin.write((json.dumps(message) + "\n").encode())
                                process.stdin.flush()

                            def request(identity, method, params):
                                send(
                                    {
                                        "jsonrpc": "2.0",
                                        "id": identity,
                                        "method": method,
                                        "params": params,
                                    }
                                )
                                timeout = 240 if identity == 1 else 60
                                deadline = time.monotonic() + timeout
                                while time.monotonic() < deadline:
                                    if b"\n" not in pending:
                                        if not ready.select(
                                            min(1, max(0, deadline - time.monotonic()))
                                        ):
                                            continue
                                        chunk = os.read(process.stdout.fileno(), 65536)
                                        self.assertTrue(
                                            chunk,
                                            "Browser adapter exited before its RPC response",
                                        )
                                        pending.extend(chunk)
                                        self.assertLess(len(pending), 1024 * 1024)
                                        continue
                                    line, _, tail = pending.partition(b"\n")
                                    pending[:] = tail
                                    # Any installer banner on stdout fails JSON parsing.
                                    response = json.loads(line)
                                    if response.get("id") == identity:
                                        self.assertNotIn("error", response)
                                        return response["result"]
                                self.fail(f"MCP request timed out: {method}")

                            initialized = request(
                                1,
                                "initialize",
                                {
                                    "protocolVersion": "2024-11-05",
                                    "capabilities": {},
                                    "clientInfo": {
                                        "name": "aios-fixture",
                                        "version": "1",
                                    },
                                },
                            )
                            self.assertIn("serverInfo", initialized)
                            send(
                                {
                                    "jsonrpc": "2.0",
                                    "method": "notifications/initialized",
                                }
                            )
                            tools = request(2, "tools/list", {})
                            self.assertIn(
                                "browser_navigate",
                                {tool["name"] for tool in tools["tools"]},
                            )
                            result = request(
                                3,
                                "tools/call",
                                {
                                    "name": "browser_navigate",
                                    "arguments": {
                                        "url": f"http://127.0.0.1:{server.server_port}/"
                                    },
                                },
                            )
                            self.assertFalse(result.get("isError"), json.dumps(result)[:1000])
                            result_text = json.dumps(result)
                            self.assertIn(
                                f"Page URL: http://127.0.0.1:{server.server_port}/",
                                result_text,
                            )
                            self.assertIn("Page Title: AIOS browser proof", result_text)
                            for secret in child_env.values():
                                if str(secret).startswith("fixture-sentinel"):
                                    self.assertNotIn(str(secret), result_text)
                    finally:
                        # Mirror ACP's inherited group boundary without touching
                        # any browser or process owned by the user's desktop.
                        try:
                            os.killpg(process.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            try:
                                os.killpg(process.pid, signal.SIGKILL)
                            except ProcessLookupError:
                                pass
                            process.wait(timeout=5)
                        process.stdin.close()
                        process.stdout.close()
                        deadline = time.monotonic() + 5
                        while time.monotonic() < deadline:
                            try:
                                os.killpg(process.pid, 0)
                            except ProcessLookupError:
                                break
                            time.sleep(0.05)
                        else:
                            os.killpg(process.pid, signal.SIGKILL)
                            self.fail("Browser processes survived the owned process-group stop")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
