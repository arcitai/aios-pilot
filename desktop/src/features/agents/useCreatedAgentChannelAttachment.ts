import { toast } from "sonner";

import { attachManagedAgentToChannel } from "./channelAgents";
import type { Channel, CreateManagedAgentResponse } from "@/shared/api/types";
import { useProfilePanel } from "@/shared/context/ProfilePanelContext";
import { requestOpenEditAgent } from "./openEditAgentEvent";

type TargetChannel = Pick<Channel, "id" | "name">;

async function attach(
  created: CreateManagedAgentResponse,
  targetChannel: TargetChannel,
) {
  const attached = await attachManagedAgentToChannel(targetChannel.id, {
    agent: created.agent,
    role: "bot",
    ensureRunning: true,
  });
  created.agent = attached.agent;
}

function showAttachmentFailure(
  created: CreateManagedAgentResponse,
  targetChannel: TargetChannel,
  cause: unknown,
  toastId?: string | number,
) {
  const error = cause instanceof Error ? cause.message : "Failed to add agent.";
  const id = toast.warning("Agent created", {
    description: `${created.agent.name} couldn’t be added to #${targetChannel.name}. ${error}`,
    id: toastId,
    action: {
      label: "Try again",
      onClick: (event) => {
        event.preventDefault();
        toast.loading("Agent created", {
          description: `Adding ${created.agent.name} to #${targetChannel.name}…`,
          id,
        });
        void attach(created, targetChannel).then(
          () => {
            toast.success("Agent created", {
              description: `Added ${created.agent.name} to #${targetChannel.name}`,
              id,
            });
          },
          (retryCause: unknown) => {
            showAttachmentFailure(created, targetChannel, retryCause, id);
          },
        );
      },
    },
  });
}

/** Keeps creation successful when its optional channel attachment fails. */
export function useCreatedAgentChannelAttachment() {
  const { openProfilePanel } = useProfilePanel();
  async function presentCreatedAgent(
    created: CreateManagedAgentResponse,
    targetChannel?: TargetChannel | null,
  ) {
    const setupError = created.spawnError ?? created.profileSyncError;
    if (setupError) {
      toast.warning("Agent created, but setup needs attention", {
        description: `${created.agent.name}: ${setupError}`,
        action: openProfilePanel
          ? {
              label: "Review agent",
              onClick: async () => {
                // Navigation can replace a panel that already resolves this
                // identity. Dispatch after it settles so that old panel cannot
                // consume the request immediately before it unmounts.
                await openProfilePanel(created.agent.pubkey);
                requestOpenEditAgent(created.agent.pubkey);
              },
            }
          : undefined,
      });
      return;
    }
    if (!targetChannel) {
      toast.success("Agent created");
      return;
    }

    try {
      await attach(created, targetChannel);
      toast.success("Agent created");
    } catch (cause) {
      showAttachmentFailure(created, targetChannel, cause);
    }
  }

  return { presentCreatedAgent };
}
