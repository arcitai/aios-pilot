import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { JSDOM } from "jsdom";
import { createInitialAppsWorkspace } from "./types.ts";
import { appCanvasMarker } from "./canvasDocument.ts";
const signer = "a".repeat(64);
const scope = {
  communityId: "local",
  channelId: "business",
  expectedRelayUrl: "ws://127.0.0.1:3341",
  expectedSignerPubkey: signer,
};
const dom = new JSDOM("", { url: "http://localhost" });
let Store, invoke;
before(async () => {
  globalThis.window = dom.window;
  dom.window.__TAURI_INTERNALS__ = {
    invoke: (command, args) => invoke(command, args),
  };
  globalThis.__TAURI_INTERNALS__ = dom.window.__TAURI_INTERNALS__;
  ({ CanvasAppDocumentStore: Store } = await import("./canvasStore.ts"));
});
after(() => dom.window.close());
function fixture({ member = true, existing = false, corrupt = false } = {}) {
  const channels = [
    {
      id: "business",
      name: "Business",
      channel_type: "stream",
      visibility: "private",
      is_member: true,
      member_pubkeys: [signer],
    },
  ];
  const app = {
    id: "slides",
    name: "Slides",
    channel_type: "stream",
    visibility: "private",
    description: appCanvasMarker("business", "slides"),
    is_member: true,
    member_pubkeys: [signer],
  };
  if (existing) channels.push(app);
  let head = {
    content: "",
    event_id: corrupt ? "existing-invalid-event" : null,
    updated_at: null,
    author: null,
  };
  const writes = [];
  invoke = async (command, args) => {
    switch (command) {
      case "get_identity":
        return { pubkey: signer };
      case "get_relay_ws_url":
        return scope.expectedRelayUrl;
      case "get_channels":
        return { channels, hash: "current", last_messages: {} };
      case "create_channel": {
        channels.push(app);
        // Actual native creation reply contains metadata, not the membership list.
        return { ...app, is_member: false, member_pubkeys: [] };
      }
      case "get_channel_members": {
        assert.equal(args.expectedRelayUrl, scope.expectedRelayUrl);
        assert.equal(args.expectedSignerPubkey, signer);
        return {
          members: member ? [{ pubkey: signer, role: "admin" }] : [],
          next_cursor: null,
        };
      }
      case "get_canvas":
        return head;
      case "set_canvas": {
        writes.push(args);
        head = {
          content: args.content,
          event_id: "saved-revision",
          updated_at: 1,
          author: signer,
        };
        return { ok: true, event_id: head.event_id, verified: true };
      }
      default:
        throw new Error(`Unexpected native command: ${command}`);
    }
  };
  return { writes };
}
test("native metadata-only creation and empty no-head Canvas save and reopen", async () => {
  const { writes } = fixture();
  const store = new Store();
  const initial = createInitialAppsWorkspace("business");
  await store.load(scope, initial);
  const edited = structuredClone(initial);
  edited.documents.slides.title = "Actual native contract";
  await store.save(scope, edited);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expectedRevision, "none");
  const reopened = await new Store().load(scope, initial);
  assert.equal(reopened.documents.slides.title, "Actual native contract");
});
test("private channel membership must be read back before the first write", async () => {
  const { writes } = fixture({ member: false });
  const store = new Store();
  const initial = createInitialAppsWorkspace("business");
  await store.load(scope, initial);
  const edited = structuredClone(initial);
  edited.documents.slides.title = "Denied";
  await assert.rejects(
    store.save(scope, edited),
    /includes your active identity/,
  );
  assert.equal(writes.length, 0);
});
test("an existing empty app event is malformed, never treated as a new document", async () => {
  const { writes } = fixture({ existing: true, corrupt: true });
  await assert.rejects(new Store().load(scope), /not valid JSON/);
  assert.equal(writes.length, 0);
});
