import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

test("host supports Tauri's immutable globals and forwards only foreign channel completion", async () => {
  const calls = [];
  const received = [];
  const callbacks = new Map([[10, (value) => received.push(value)]]);
  const native = {};
  Object.defineProperties(native, {
    callbacks: { value: callbacks },
    runCallback: { value: (id, value) => callbacks.get(id)?.(value) },
    invoke: {
      value: async (command, args) => {
        calls.push({ command, args });
      },
    },
  });
  const globals = {
    window: { __TAURI_INTERNALS__: native },
    console,
    setTimeout,
  };
  Object.defineProperty(globals, "ipc", { value: {}, configurable: false });
  vm.runInNewContext(
    readFileSync(new URL("../public/browser-host.js", import.meta.url), "utf8"),
    globals,
  );
  await Promise.resolve();
  assert.equal(calls[0].command, "browser_dev_host_ready");
  native.runCallback(10, { end: true, index: 0 });
  assert.equal(received.length, 1);
  assert.equal(calls.length, 1);
  native.runCallback(42, {
    index: 0,
    message: "ordinary data uses the native interceptor",
  });
  assert.equal(calls.length, 1);
  native.runCallback(42, { end: true, index: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), {
    command: "browser_dev_channel_end",
    args: { callback: 42, index: 1 },
  });
});
