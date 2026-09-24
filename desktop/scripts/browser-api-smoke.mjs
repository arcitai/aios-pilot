// Exercise the actual running native development companion. Never logs identities or credentials.
import assert from "node:assert/strict";
const origin = "http://127.0.0.1:1437";
async function post(route, body, headers = {}) {
  const response = await fetch(`${origin}/__aios/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json() };
}
async function rpc(clientId, command, args = {}) {
  return post("rpc", { clientId, command, args });
}
const clients = [];
try {
  assert.equal((await post("health", {})).body.mode, "real-native");
  assert.equal(
    (await post("health", {}, { Origin: "http://untrusted.example" })).status,
    403,
  );
  assert.equal(
    (
      await post("rpc", {
        clientId: "00000000-0000-4000-8000-000000000000",
        command: "get_identity",
      })
    ).status,
    401,
  );
  for (let i = 0; i < 2; i++) {
    const connection = await post("connect", {});
    assert.equal(connection.status, 200);
    clients.push(connection.body.clientId);
  }
  const [owner, other] = clients;
  const identity = await rpc(owner, "get_identity");
  assert.equal(identity.body.ok, true);
  assert.match(identity.body.value.pubkey, /^[a-f0-9]{64}$/);
  assert.equal(
    (await rpc(owner, "browser_dev_channel_end", { callback: 1, index: 0 }))
      .status,
    403,
  );
  const callback = 2199023251;
  const listened = await rpc(owner, "plugin:event|listen", {
    event: "aios-browser-smoke",
    handler: callback,
  });
  assert.equal(listened.body.ok, true);
  const emitted = await rpc(owner, "plugin:event|emit", {
    event: "aios-browser-smoke",
    payload: { check: "actual-native-event" },
  });
  assert.equal(emitted.body.ok, true);
  const events = await post("events", { clientId: owner });
  assert(
    events.body.events.some(
      (event) =>
        event.callback === callback &&
        event.payload.payload.check === "actual-native-event",
    ),
  );
  await rpc(owner, "plugin:event|unlisten", {
    event: "aios-browser-smoke",
    eventId: listened.body.value,
  });
  const socket = await rpc(owner, "plugin:websocket|connect", {
    url: "ws://127.0.0.1:3341",
    onMessage: "__CHANNEL__:2199023252",
    config: {},
  });
  assert.equal(socket.body.ok, true);
  assert.equal(
    (await rpc(other, "plugin:websocket|disconnect", { id: socket.body.value }))
      .status,
    403,
  );
  assert.equal(
    (await rpc(owner, "plugin:websocket|disconnect", { id: socket.body.value }))
      .body.ok,
    true,
  );
  let ended = false;
  for (let i = 0; i < 3 && !ended; i++) {
    const result = await post("events", { clientId: owner });
    ended = result.body.events.some(
      (event) => event.callback === 2199023252 && event.payload.end === true,
    );
  }
  assert(
    ended,
    "Native channel completion must reach the browser and release its callback",
  );
  console.log(
    "PASS: real backend, origin/session denial, event roundtrip, socket ownership and channel cleanup",
  );
} finally {
  for (const clientId of clients) await post("disconnect", { clientId });
}
