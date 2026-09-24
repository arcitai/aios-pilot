import assert from "node:assert/strict";
import test from "node:test";
import { businessWorkspaces } from "./workspaceSelection.ts";
import {
  BUSINESS_CHANNEL_DESCRIPTION,
  BUSINESS_CONTEXT_RESOURCE,
  isBusinessContextChannel,
} from "../../shared/lib/appWorkspaceChannel.ts";

const legacy = {
  id: "legacy-id",
  channelType: "stream",
  visibility: "private",
  description: BUSINESS_CHANNEL_DESCRIPTION,
  isMember: true,
  archivedAt: null,
};
const registered = {
  ...legacy,
  id: "host-context-id",
  resourceType: BUSINESS_CONTEXT_RESOURCE,
  description: "Company knowledge",
};

test("host context is preferred without losing explicit legacy IDs", () => {
  assert.deepEqual(businessWorkspaces([legacy, registered]), [
    registered,
    legacy,
  ]);
  assert.deepEqual(businessWorkspaces([legacy]), [legacy]);
  assert.equal(isBusinessContextChannel(registered), true);
});

test("future types and inaccessible groups cannot masquerade as legacy context", () => {
  const future = { ...legacy, resourceType: "future:v2" };
  assert.equal(isBusinessContextChannel(future), false);
  for (const change of [
    { isMember: false },
    { visibility: "open" },
    { archivedAt: "2026-09-24" },
    { channelType: "dm" },
  ]) {
    assert.deepEqual(
      businessWorkspaces([
        { ...legacy, ...change },
        { ...registered, ...change },
      ]),
      [],
    );
  }
  assert.deepEqual(businessWorkspaces([future]), []);
});

test("ambiguous host references are reported rather than choosing an arbitrary company", () => {
  assert.throws(
    () => businessWorkspaces([registered, { ...registered, id: "second" }]),
    /more than one business context/,
  );
});
