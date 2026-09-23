import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { JSDOM } from "jsdom";

const BUSINESS = "business_main";
const SITE = "site_channel_a";
const SIGNER = "1".repeat(64);
const RELAY = "wss://sites-relay.example";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

let act;
let cleanup;
let renderHook;
let waitFor;
let siteChannelDescription;
let newSiteDocument;
let useSitesWorkspace;
let getChannelsCalls = 0;
let getCanvasCalls = 0;
let pendingOldCanvas;
let pendingRefreshChannels;
let newCanvasResponse;

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function rawSiteChannel(description) {
  return {
    id: SITE,
    name: "site-campaign-1234",
    channel_type: "stream",
    visibility: "private",
    description,
    topic: null,
    purpose: null,
    member_count: 1,
    member_pubkeys: [SIGNER],
    last_message_at: null,
    archived_at: null,
    participants: [],
    participant_pubkeys: [SIGNER],
    is_member: true,
    ttl_seconds: null,
    ttl_deadline: null,
  };
}

function canvasResponse(title, revision) {
  const document = newSiteDocument(SITE, BUSINESS, title);
  return {
    content: JSON.stringify(document),
    event_id: revision,
    updated_at: 1_700_000_000,
    author: SIGNER,
  };
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
    invoke(command) {
      if (command === "get_channels") {
        getChannelsCalls += 1;
        if (getChannelsCalls === 2) return pendingRefreshChannels.promise;
        return Promise.resolve({
          hash: `channels-${getChannelsCalls}`,
          channels: [rawSiteChannel(siteChannelDescription(BUSINESS))],
          last_messages: {},
        });
      }
      if (command === "get_canvas") {
        getCanvasCalls += 1;
        if (getCanvasCalls === 1) return pendingOldCanvas.promise;
        return Promise.resolve(newCanvasResponse);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    },
    transformCallback: () => 1,
  };
  globalThis.__TAURI_INTERNALS__ = dom.window.__TAURI_INTERNALS__;
  ({ act, cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  ));
  ({ siteChannelDescription, newSiteDocument } = await import("./document.ts"));
  ({ useSitesWorkspace } = await import("./useSitesWorkspace.ts"));
});

afterEach(() => {
  cleanup();
  getChannelsCalls = 0;
  getCanvasCalls = 0;
  pendingOldCanvas = deferred();
  pendingRefreshChannels = deferred();
  newCanvasResponse = canvasResponse("Refreshed draft", "revision-new");
  localStorage.clear();
});

after(() => dom.window.close());

test("refresh invalidates a pending old canvas load before the channel list returns", async () => {
  pendingOldCanvas = deferred();
  pendingRefreshChannels = deferred();
  newCanvasResponse = canvasResponse("Refreshed draft", "revision-new");
  const { result } = renderHook(() =>
    useSitesWorkspace({
      businessChannelId: BUSINESS,
      expectedRelayUrl: RELAY,
      expectedSignerPubkey: SIGNER,
    }),
  );

  await waitFor(() => assert.equal(getCanvasCalls, 1));
  await act(async () => result.current.refreshWorkspace());
  await waitFor(() => assert.equal(getChannelsCalls, 2));
  assert.equal(result.current.draft, null);

  await act(async () => {
    pendingOldCanvas.resolve(canvasResponse("Stale draft", "revision-old"));
    await pendingOldCanvas.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(result.current.draft, null);
  assert.equal(result.current.selectedChannelId, null);

  await act(async () => {
    pendingRefreshChannels.resolve({
      hash: "channels-refreshed",
      channels: [rawSiteChannel(siteChannelDescription(BUSINESS))],
      last_messages: {},
    });
    await pendingRefreshChannels.promise;
  });
  await waitFor(() =>
    assert.equal(result.current.draft?.title, "Refreshed draft"),
  );
  assert.equal(result.current.revision, "revision-new");
});
