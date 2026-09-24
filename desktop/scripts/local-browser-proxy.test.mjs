import assert from "node:assert/strict";
import test from "node:test";
import { acceptsBrowserRequest } from "./local-browser-proxy.mjs";

test("local native proxy rejects cross-site and rebinding requests", () => {
  const origin = "http://127.0.0.1:1437";
  const request = {
    method: "POST",
    headers: {
      host: "127.0.0.1:1437",
      origin,
      "content-type": "application/json",
    },
  };
  assert.equal(acceptsBrowserRequest(request, origin), true);
  for (const headers of [
    { origin: "http://attacker.example" },
    { origin: "null" },
    { host: "rebind.example:1437" },
    { "content-type": "text/plain" },
    { origin: undefined },
  ]) {
    assert.equal(
      acceptsBrowserRequest(
        { ...request, headers: { ...request.headers, ...headers } },
        origin,
      ),
      false,
    );
  }
  assert.equal(
    acceptsBrowserRequest({ ...request, method: "GET" }, origin),
    false,
  );
});
