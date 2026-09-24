import {
  fromRawManagedAgent,
  invokeTauri,
  type RawManagedAgent,
} from "./tauri";
import type { CanvasScope } from "./canvasTypes";
import type { BusinessContextSelection } from "./businessContextTypes";
import { toRawBusinessContextSelection } from "./businessContextWire";

/** Old companions ignore unknown create fields; fail before they can mint an agent. */
export async function requireBusinessContextSupport() {
  let protocol: unknown;
  try {
    protocol = await invokeTauri<unknown>(
      "managed_agent_business_context_protocol",
    );
  } catch {
    throw new Error(
      "Update the workspace companion to set up company knowledge for this agent. Your draft is still here.",
    );
  }
  if (protocol !== 1) {
    throw new Error(
      "This workspace companion does not support company knowledge setup. Your draft is still here.",
    );
  }
}

/** Set or unwind a private instance's context; the native boundary owns grants. */
export async function setManagedAgentBusinessContext(
  pubkey: string,
  selection: BusinessContextSelection | null,
  acknowledgeChannelHistory: boolean,
  scope: CanvasScope,
) {
  await requireBusinessContextSupport();
  return fromRawManagedAgent(
    await invokeTauri<RawManagedAgent>("set_managed_agent_business_context", {
      input: {
        pubkey,
        selection: selection ? toRawBusinessContextSelection(selection) : null,
        acknowledge_channel_history: acknowledgeChannelHistory,
        expected_relay_url: scope.expectedRelayUrl,
        expected_signer_pubkey: scope.expectedSignerPubkey,
      },
    }),
  );
}

/** Reconcile the same durable operation; never mint another agent on retry. */
export async function retryManagedAgentBusinessContext(
  pubkey: string,
  operationId: string,
  scope: CanvasScope,
) {
  await requireBusinessContextSupport();
  return fromRawManagedAgent(
    await invokeTauri<RawManagedAgent>("retry_managed_agent_business_context", {
      input: {
        pubkey,
        operation_id: operationId,
        expected_relay_url: scope.expectedRelayUrl,
        expected_signer_pubkey: scope.expectedSignerPubkey,
      },
    }),
  );
}
