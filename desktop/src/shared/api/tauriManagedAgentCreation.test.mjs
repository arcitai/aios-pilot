import assert from "node:assert/strict";
import test from "node:test";
import { createManagedAgent } from "./tauriManagedAgentCreation.ts";

const scope = {
  expectedRelayUrl: "wss://workspace.example",
  expectedSignerPubkey: "a".repeat(64),
};
const selection = {
  contextId: "550e8400-e29b-41d4-a716-446655440000",
  relayUrl: scope.expectedRelayUrl,
  loading: "when_needed",
};
const rawSelection = {
  context_id: selection.contextId,
  relay_url: selection.relayUrl,
  loading: selection.loading,
};
const input = {
  name: "Assistant",
  personaId: "saved-definition",
  backend: { type: "local" },
  spawnAfterCreate: true,
  requestScope: scope,
};

// This fixture enforces the native stopped-create contract. It does not grant
// access on a real host or launch a model.
function bridge({
  context = null,
  startError = null,
  profileError = null,
  protocol = 1,
} = {}) {
  const calls = [];
  const agent = {
    pubkey: "b".repeat(64),
    name: "Assistant",
    relay_url: scope.expectedRelayUrl,
    backend: { type: "local" },
    status: "stopped",
    business_context: context,
  };
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command, args) => {
        calls.push({ command, args });
        if (command === "managed_agent_business_context_protocol")
          return protocol;
        if (command === "create_managed_agent") {
          assert.equal(
            args.input.spawnAfterCreate,
            false,
            "scoped native creation must be stopped",
          );
          assert.equal(args.expectedRelayUrl, scope.expectedRelayUrl);
          assert.equal(args.expectedSignerPubkey, scope.expectedSignerPubkey);
          return {
            agent,
            private_key_nsec: "fixture-only",
            spawn_error: null,
            profile_sync_error: profileError,
          };
        }
        if (command === "start_managed_agent") {
          assert.equal(args.pubkey, agent.pubkey);
          assert.equal(args.expectedRelayUrl, scope.expectedRelayUrl);
          assert.equal(args.expectedSignerPubkey, scope.expectedSignerPubkey);
          if (startError) throw new Error(startError);
          return { ...agent, status: "running" };
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    },
  };
  return calls;
}

test("scoped creation saves stopped then starts the same identity in the captured workspace", async () => {
  const calls = bridge();
  const created = await createManagedAgent(input);
  assert.equal(created.agent.status, "running");
  assert.deepEqual(
    calls.map((c) => c.command),
    ["create_managed_agent", "start_managed_agent"],
  );
});

test("a failure after creation returns the durable agent for recovery without another create", async () => {
  const calls = bridge({ startError: "Workspace changed before start" });
  const created = await createManagedAgent(input);
  assert.equal(created.agent.pubkey, "b".repeat(64));
  assert.match(created.spawnError, /Workspace changed/);
  assert.equal(
    calls.filter((c) => c.command === "create_managed_agent").length,
    1,
  );
});

test("company setup requires verified matching access before start", async () => {
  for (const context of [
    null,
    { desired: rawSelection, applied: null, operation: null },
    {
      desired: rawSelection,
      applied: { ...rawSelection, loading: "full" },
      operation: null,
    },
  ]) {
    const calls = bridge({ context });
    const result = await createManagedAgent({
      ...input,
      businessContext: { selection, acknowledgeChannelHistory: true },
    });
    assert.match(result.spawnError, /not confirmed/);
    assert.equal(
      calls.some((c) => c.command === "start_managed_agent"),
      false,
    );
  }
  const calls = bridge({
    context: { desired: rawSelection, applied: rawSelection, operation: null },
  });
  const result = await createManagedAgent({
    ...input,
    businessContext: { selection, acknowledgeChannelHistory: true },
  });
  assert.equal(result.spawnError, null);
  assert.equal(calls.at(-1).command, "start_managed_agent");
});

test("old native support and absent scope fail before identity creation", async () => {
  const calls = bridge({ protocol: 0 });
  const businessContext = { selection, acknowledgeChannelHistory: true };
  await assert.rejects(
    createManagedAgent({ ...input, businessContext }),
    /does not support/,
  );
  await assert.rejects(
    createManagedAgent({ ...input, requestScope: undefined, businessContext }),
    /captured workspace/,
  );
  assert.equal(
    calls.some((c) => c.command === "create_managed_agent"),
    false,
  );
});

test("explicit stopped creation and incomplete profile sync do not start a process", async () => {
  let calls = bridge();
  await createManagedAgent({ ...input, spawnAfterCreate: false });
  assert.equal(calls.length, 1);
  calls = bridge({ profileError: "Profile sync interrupted" });
  const result = await createManagedAgent(input);
  assert.equal(result.profileSyncError, "Profile sync interrupted");
  assert.equal(
    calls.some((c) => c.command === "start_managed_agent"),
    false,
  );
});
