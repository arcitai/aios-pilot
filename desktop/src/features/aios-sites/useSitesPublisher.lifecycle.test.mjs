import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { JSDOM } from "jsdom";

const RELAY_A = "wss://relay-a.example";
const RELAY_B = "wss://relay-b.example";
const SIGNER = "1".repeat(64);
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

let act;
let cleanup;
let renderHook;
let waitFor;
let useSitesPublisher;
let handlers = new Map();
let calls = [];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeDocument(siteId, title = siteId) {
  return {
    schemaVersion: 1,
    kind: "aios.site",
    siteId,
    parentBusinessChannelId: "business_main",
    title,
    files: {
      indexHtml: "<button id='go'>Run</button><output id='result'></output>",
      styleCss: "",
      appJs: "document.querySelector('#go').onclick=()=>{}",
    },
  };
}

function status(siteId, published = false, contentHash = null) {
  return {
    siteId,
    published,
    contentHash,
    publicUrl: `https://public.example/sites/${siteId}`,
  };
}

function resetNative({
  connected = true,
  siteStatus = (args) => status(args.siteId),
} = {}) {
  calls = [];
  handlers = new Map([
    [
      "sites_publisher_status",
      () => ({ connected, version: connected ? "0.1.0" : null }),
    ],
    ["sites_publisher_site_status", (args) => siteStatus(args)],
    ["connect_sites_publisher", () => ({ connected: true, version: "0.1.0" })],
    ["disconnect_sites_publisher", () => undefined],
    [
      "sites_publisher_preview",
      () => ({
        previewUrl:
          "http://127.0.0.1:3351/previews/0123456789abcdef0123456789abcdef",
        expiresInSeconds: 1800,
      }),
    ],
    [
      "publish_sites_site",
      () => ({
        siteId: "site_a",
        contentHash: "a".repeat(64),
        publicUrl: "https://public.example/sites/site_a",
        alreadyPublished: false,
      }),
    ],
    ["revoke_sites_site", () => true],
  ]);
}

function baseProps(siteId = "site_a") {
  return {
    expectedRelayUrl: RELAY_A,
    expectedSignerPubkey: SIGNER,
    siteId,
    document: makeDocument(siteId),
    canPublish: true,
  };
}

async function mountPublisher(props = baseProps()) {
  const rendered = renderHook((value) => useSitesPublisher(value), {
    initialProps: props,
  });
  await waitFor(() => assert.equal(rendered.result.current.isChecking, false));
  if (rendered.result.current.connected) {
    await waitFor(() =>
      assert.equal(rendered.result.current.siteStatus?.siteId, props.siteId),
    );
  }
  return { ...rendered, props };
}

before(async () => {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.__TAURI_INTERNALS__ = {
    invoke(command, args) {
      calls.push({ command, args });
      const handler = handlers.get(command);
      if (!handler)
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      return Promise.resolve(handler(args));
    },
    transformCallback: () => 1,
  };
  globalThis.__TAURI_INTERNALS__ = dom.window.__TAURI_INTERNALS__;
  ({ act, cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  ));
  ({ useSitesPublisher } = await import("./useSitesPublisher.ts"));
});

afterEach(() => {
  cleanup();
  resetNative();
  localStorage.clear();
});

after(() => dom.window.close());

test("a connection completion from an edited publisher address cannot update the new scope", async () => {
  resetNative({ connected: false });
  const { result } = await mountPublisher();
  const pendingConnect = deferred();
  handlers.set("connect_sites_publisher", () => pendingConnect.promise);
  await act(async () =>
    result.current.setTokenDraft("test-token-value-long-enough"),
  );

  let connectPromise;
  act(() => {
    connectPromise = result.current.connect();
  });
  await waitFor(() => assert.equal(result.current.isConnecting, true));
  const request = calls.find(
    (call) => call.command === "connect_sites_publisher",
  );
  assert.equal(request.args.managerUrl, "http://127.0.0.1:3352");

  await act(async () =>
    result.current.setManagerUrl("https://publisher-b.example"),
  );
  await waitFor(() => assert.equal(result.current.isChecking, false));
  await act(async () => {
    pendingConnect.resolve({ connected: true, version: "old-scope" });
    await connectPromise;
  });

  assert.equal(result.current.connected, false);
  assert.equal(result.current.publisherVersion, null);
  assert.notEqual(result.current.message?.includes("Connected."), true);
  assert.equal(result.current.isConnecting, false);
});

test("a disconnect completion from another relay cannot clear the current connection", async () => {
  resetNative({ connected: true });
  const { result, props, rerender } = await mountPublisher();
  const pendingDisconnect = deferred();
  handlers.set("disconnect_sites_publisher", () => pendingDisconnect.promise);

  let disconnectPromise;
  act(() => {
    disconnectPromise = result.current.disconnect();
  });
  await waitFor(() => assert.equal(result.current.isDisconnecting, true));
  const request = calls.find(
    (call) => call.command === "disconnect_sites_publisher",
  );
  assert.equal(request.args.expectedRelayUrl, RELAY_A);

  await act(async () => rerender({ ...props, expectedRelayUrl: RELAY_B }));
  await waitFor(() =>
    assert.equal(result.current.siteStatus?.siteId, "site_a"),
  );
  await act(async () => {
    pendingDisconnect.resolve(undefined);
    await disconnectPromise;
  });

  assert.equal(result.current.connected, true);
  assert.equal(result.current.publisherVersion, "0.1.0");
  assert.notEqual(
    result.current.message,
    "Removed this publisher token from the OS keyring.",
  );
  assert.equal(result.current.isDisconnecting, false);
});

test("a delayed preview for site A is discarded after selecting site B", async () => {
  resetNative({ connected: true });
  const { result, props, rerender } = await mountPublisher();
  const pendingPreview = deferred();
  handlers.set("sites_publisher_preview", () => pendingPreview.promise);

  let previewPromise;
  act(() => {
    previewPromise = result.current.runPreview();
  });
  await waitFor(() => assert.equal(result.current.isPreviewing, true));
  const request = calls.find(
    (call) => call.command === "sites_publisher_preview",
  );
  assert.equal(request.args.siteId, "site_a");

  await act(async () =>
    rerender({ ...props, siteId: "site_b", document: makeDocument("site_b") }),
  );
  await waitFor(() =>
    assert.equal(result.current.siteStatus?.siteId, "site_b"),
  );
  await act(async () => {
    pendingPreview.resolve({
      previewUrl:
        "http://127.0.0.1:3351/previews/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expiresInSeconds: 1800,
    });
    await previewPromise;
  });

  assert.equal(result.current.previewUrl, null);
  assert.equal(result.current.isPreviewing, false);
  assert.notEqual(
    result.current.message?.startsWith("Preview is temporary"),
    true,
  );
});

test("a delayed preview from another identity cannot update the current scope", async () => {
  resetNative({ connected: true });
  const { result, props, rerender } = await mountPublisher();
  const pendingPreview = deferred();
  handlers.set("sites_publisher_preview", () => pendingPreview.promise);

  let previewPromise;
  act(() => {
    previewPromise = result.current.runPreview();
  });
  await waitFor(() => assert.equal(result.current.isPreviewing, true));
  const request = calls.find(
    (call) => call.command === "sites_publisher_preview",
  );
  assert.equal(request.args.expectedSignerPubkey, SIGNER);

  await act(async () =>
    rerender({ ...props, expectedSignerPubkey: "2".repeat(64) }),
  );
  await waitFor(() => {
    assert.equal(result.current.connected, true);
    assert.equal(result.current.siteStatus?.siteId, "site_a");
  });
  const newIdentityStatusRead = calls
    .filter((call) => call.command === "sites_publisher_site_status")
    .at(-1);
  assert.equal(newIdentityStatusRead.args.expectedSignerPubkey, "2".repeat(64));
  await act(async () => {
    pendingPreview.resolve({
      previewUrl:
        "http://127.0.0.1:3351/previews/cccccccccccccccccccccccccccccccc",
      expiresInSeconds: 1800,
    });
    await previewPromise;
  });

  assert.equal(result.current.previewUrl, null);
  assert.equal(result.current.isPreviewing, false);
  assert.equal(result.current.error, null);
});

test("a delayed publish for site A cannot replace site B status", async () => {
  resetNative({ connected: true });
  const { result, props, rerender } = await mountPublisher();
  const pendingPublish = deferred();
  handlers.set("publish_sites_site", () => pendingPublish.promise);
  const expectedHash = await (
    await import("./publisherApi.ts")
  ).siteContentHash("site_a", props.document.title, props.document.files);

  let publishPromise;
  act(() => {
    publishPromise = result.current.publish();
  });
  await waitFor(() =>
    assert.ok(calls.some((call) => call.command === "publish_sites_site")),
  );

  await act(async () =>
    rerender({ ...props, siteId: "site_b", document: makeDocument("site_b") }),
  );
  await waitFor(() =>
    assert.equal(result.current.siteStatus?.siteId, "site_b"),
  );
  const statusReadsBeforeCompletion = calls.filter(
    (call) => call.command === "sites_publisher_site_status",
  ).length;
  await act(async () => {
    pendingPublish.resolve({
      siteId: "site_a",
      contentHash: expectedHash,
      publicUrl: "https://public.example/sites/site_a",
      alreadyPublished: false,
    });
    await publishPromise;
  });

  assert.equal(result.current.siteStatus?.siteId, "site_b");
  assert.equal(result.current.siteStatus?.published, false);
  assert.equal(result.current.isPublishedCurrent, false);
  assert.equal(
    calls.filter((call) => call.command === "sites_publisher_site_status")
      .length,
    statusReadsBeforeCompletion,
    "stale publish must not issue readback into the new selection",
  );
});

test("publish completion does not mark a changed draft as the current published version", async () => {
  let statusReads = 0;
  let publishedHash = null;
  resetNative({
    connected: true,
    siteStatus: (args) => {
      statusReads += 1;
      return status(
        args.siteId,
        statusReads > 1,
        statusReads > 1 ? publishedHash : null,
      );
    },
  });
  const { result, props, rerender } = await mountPublisher();
  const pendingPublish = deferred();
  handlers.set("publish_sites_site", () => pendingPublish.promise);
  const expectedHash = await (
    await import("./publisherApi.ts")
  ).siteContentHash("site_a", props.document.title, props.document.files);
  publishedHash = expectedHash;

  let publishPromise;
  act(() => {
    publishPromise = result.current.publish();
  });
  await waitFor(() =>
    assert.ok(calls.some((call) => call.command === "publish_sites_site")),
  );

  const changedDocument = makeDocument("site_a", "Newer draft");
  await act(async () => rerender({ ...props, document: changedDocument }));
  await act(async () => {
    pendingPublish.resolve({
      siteId: "site_a",
      contentHash: expectedHash,
      publicUrl: "https://public.example/sites/site_a",
      alreadyPublished: false,
    });
    await publishPromise;
  });

  assert.equal(result.current.siteStatus?.published, true);
  assert.equal(result.current.isPublishedCurrent, false);
});

test("a delayed preview cannot update the panel after disconnect", async () => {
  resetNative({
    connected: true,
    siteStatus: (args) => status(args.siteId, true, "a".repeat(64)),
  });
  const { result } = await mountPublisher();
  await act(async () => result.current.setRevokeConfirmationOpen(true));
  assert.equal(result.current.revokeConfirmationOpen, true);
  const pendingPreview = deferred();
  handlers.set("sites_publisher_preview", () => pendingPreview.promise);

  let previewPromise;
  act(() => {
    previewPromise = result.current.runPreview();
  });
  await waitFor(() => assert.equal(result.current.isPreviewing, true));

  const pendingDisconnect = deferred();
  handlers.set("disconnect_sites_publisher", () => pendingDisconnect.promise);
  let disconnectPromise;
  act(() => {
    disconnectPromise = result.current.disconnect();
  });
  await waitFor(() => assert.equal(result.current.isDisconnecting, true));
  assert.equal(result.current.isPreviewing, false);
  assert.equal(result.current.revokeConfirmationOpen, false);

  await act(async () => {
    pendingDisconnect.resolve(undefined);
    await disconnectPromise;
  });
  assert.equal(result.current.connected, false);
  assert.equal(result.current.siteStatus, null);

  await act(async () => {
    pendingPreview.resolve({
      previewUrl:
        "http://127.0.0.1:3351/previews/dddddddddddddddddddddddddddddddd",
      expiresInSeconds: 1800,
    });
    await previewPromise;
  });
  assert.equal(result.current.previewUrl, null);
  assert.equal(result.current.isPreviewing, false);
  assert.equal(
    result.current.message,
    "Removed this publisher token from the OS keyring.",
  );
});

test("a delayed publish cannot read publisher status after disconnect", async () => {
  resetNative({ connected: true });
  const { result, props } = await mountPublisher();
  const pendingPublish = deferred();
  handlers.set("publish_sites_site", () => pendingPublish.promise);
  const expectedHash = await (
    await import("./publisherApi.ts")
  ).siteContentHash("site_a", props.document.title, props.document.files);

  let publishPromise;
  act(() => {
    publishPromise = result.current.publish();
  });
  await waitFor(() =>
    assert.ok(calls.some((call) => call.command === "publish_sites_site")),
  );

  const pendingDisconnect = deferred();
  handlers.set("disconnect_sites_publisher", () => pendingDisconnect.promise);
  let disconnectPromise;
  act(() => {
    disconnectPromise = result.current.disconnect();
  });
  await waitFor(() => assert.equal(result.current.isDisconnecting, true));
  assert.equal(result.current.isPublishing, false);
  await act(async () => {
    pendingDisconnect.resolve(undefined);
    await disconnectPromise;
  });
  const statusReadsAfterDisconnect = calls.filter(
    (call) => call.command === "sites_publisher_site_status",
  ).length;

  await act(async () => {
    pendingPublish.resolve({
      siteId: "site_a",
      contentHash: expectedHash,
      publicUrl: "https://public.example/sites/site_a",
      alreadyPublished: false,
    });
    await publishPromise;
  });

  assert.equal(result.current.connected, false);
  assert.equal(result.current.siteStatus, null);
  assert.equal(result.current.isPublishing, false);
  assert.equal(
    result.current.message,
    "Removed this publisher token from the OS keyring.",
  );
  assert.equal(
    calls.filter((call) => call.command === "sites_publisher_site_status")
      .length,
    statusReadsAfterDisconnect,
    "late publish must not issue readback after the operator token was removed",
  );
});

test("revoke confirmation closes on site change and cannot revoke the newly selected site", async () => {
  resetNative({
    connected: true,
    siteStatus: (args) => status(args.siteId, true, "a".repeat(64)),
  });
  const { result, props, rerender } = await mountPublisher();
  await act(async () => result.current.setRevokeConfirmationOpen(true));
  assert.equal(result.current.revokeConfirmationOpen, true);

  await act(async () =>
    rerender({ ...props, siteId: "site_b", document: makeDocument("site_b") }),
  );
  await waitFor(() =>
    assert.equal(result.current.siteStatus?.siteId, "site_b"),
  );
  assert.equal(result.current.revokeConfirmationOpen, false);
  await act(async () => result.current.revoke());
  assert.equal(
    calls.some((call) => call.command === "revoke_sites_site"),
    false,
  );
});

test("a delayed revoke for site A cannot overwrite site B status", async () => {
  resetNative({
    connected: true,
    siteStatus: (args) =>
      status(args.siteId, args.siteId === "site_a", "a".repeat(64)),
  });
  const { result, props, rerender } = await mountPublisher();
  await act(async () => result.current.setRevokeConfirmationOpen(true));
  const pendingRevoke = deferred();
  handlers.set("revoke_sites_site", () => pendingRevoke.promise);

  let revokePromise;
  act(() => {
    revokePromise = result.current.revoke();
  });
  await waitFor(() => assert.equal(result.current.isRevoking, true));
  assert.equal(
    calls.find((call) => call.command === "revoke_sites_site").args.siteId,
    "site_a",
  );

  await act(async () =>
    rerender({ ...props, siteId: "site_b", document: makeDocument("site_b") }),
  );
  await waitFor(() =>
    assert.equal(result.current.siteStatus?.siteId, "site_b"),
  );
  await act(async () => {
    pendingRevoke.resolve(true);
    await revokePromise;
  });

  assert.equal(result.current.siteStatus?.siteId, "site_b");
  assert.equal(result.current.siteStatus?.published, false);
  assert.notEqual(
    result.current.message?.startsWith("Publication revoked"),
    true,
  );
});

test("revoke confirmation closes when the publisher scope changes", async () => {
  resetNative({
    connected: true,
    siteStatus: (args) => status(args.siteId, true, "a".repeat(64)),
  });
  const { result, props, rerender } = await mountPublisher();
  await act(async () => result.current.setRevokeConfirmationOpen(true));
  assert.equal(result.current.revokeConfirmationOpen, true);

  await act(async () => rerender({ ...props, expectedRelayUrl: RELAY_B }));
  await waitFor(() =>
    assert.equal(result.current.siteStatus?.siteId, "site_a"),
  );
  assert.equal(result.current.revokeConfirmationOpen, false);
  await act(async () => result.current.revoke());
  assert.equal(
    calls.some((call) => call.command === "revoke_sites_site"),
    false,
  );
});

test("pending preview completion after unmount performs no further hook render", async () => {
  resetNative({ connected: true });
  let renderCount = 0;
  const props = baseProps();
  const rendered = renderHook(
    (value) => {
      renderCount += 1;
      return useSitesPublisher(value);
    },
    { initialProps: props },
  );
  await waitFor(() =>
    assert.equal(rendered.result.current.siteStatus?.siteId, "site_a"),
  );
  const pendingPreview = deferred();
  handlers.set("sites_publisher_preview", () => pendingPreview.promise);
  let previewPromise;
  act(() => {
    previewPromise = rendered.result.current.runPreview();
  });
  await waitFor(() => assert.equal(rendered.result.current.isPreviewing, true));
  await act(async () => rendered.unmount());
  const rendersAfterUnmount = renderCount;
  await act(async () => {
    pendingPreview.resolve({
      previewUrl:
        "http://127.0.0.1:3351/previews/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      expiresInSeconds: 1800,
    });
    await previewPromise;
  });
  assert.equal(renderCount, rendersAfterUnmount);
});
