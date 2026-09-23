import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LayoutTemplate } from "lucide-react";

import "@/shared/styles/globals.css";
import type { Channel } from "@/shared/api/types";
import { AppsWorkspace } from "./AppsWorkspace";
import type { AppsExtensionRenderContext } from "./extensions";

const RELAY = "wss://relay.example.test";
const OWNER = "a".repeat(64);
const FIZZ = "b".repeat(64);
const REVIEWER = "c".repeat(64);
const BUSINESS_ID = "business-preview-1";

type NativeCall = { command: string; args?: Record<string, unknown> };
type TestState = {
  invocations: NativeCall[];
  dirty: boolean;
  mounts: number;
  delayInvite: boolean;
  inviteStarted: boolean;
  releaseInvite?: () => void;
};

declare global {
  interface Window {
    __AIOS_APPS_TEST_STATE__: TestState;
    __TAURI_INTERNALS__?: {
      invoke: <T>(
        command: string,
        args?: Record<string, unknown>,
      ) => Promise<T>;
    };
  }
}

window.__AIOS_APPS_TEST_STATE__ = {
  invocations: [],
  dirty: false,
  mounts: 0,
  delayInvite: false,
  inviteStarted: false,
};

const channels: Channel[] = [
  {
    id: BUSINESS_ID,
    name: "Pilot business",
    channelType: "stream",
    visibility: "private",
    description: "",
    topic: null,
    purpose: null,
    memberCount: 1,
    memberPubkeys: [OWNER],
    lastMessageAt: null,
    archivedAt: null,
    participants: [],
    participantPubkeys: [],
    isMember: true,
    ttlSeconds: null,
    ttlDeadline: null,
  },
];

function toRawChannel(channel: Channel) {
  return {
    id: channel.id,
    name: channel.name,
    channel_type: channel.channelType,
    visibility: channel.visibility,
    description: channel.description,
    topic: channel.topic,
    purpose: channel.purpose,
    member_count: channel.memberCount,
    member_pubkeys: channel.memberPubkeys,
    last_message_at: channel.lastMessageAt,
    archived_at: channel.archivedAt,
    participants: channel.participants,
    participant_pubkeys: channel.participantPubkeys,
    is_member: channel.isMember,
    ttl_seconds: channel.ttlSeconds,
    ttl_deadline: channel.ttlDeadline,
  };
}

function memberResponse(channelId: string) {
  const channel = channels.find((entry) => entry.id === channelId);
  return {
    members: (channel?.memberPubkeys ?? []).map((pubkey) => ({
      pubkey,
      role: pubkey === OWNER ? "owner" : pubkey === FIZZ ? "bot" : "member",
      is_agent: pubkey === FIZZ,
      joined_at: "2026-09-24T12:00:00Z",
      display_name:
        pubkey === OWNER ? "Gustav" : pubkey === FIZZ ? "Fizz" : "Reviewer",
    })),
    next_cursor: null,
  };
}

window.__TAURI_INTERNALS__ = {
  invoke: async <T,>(command: string, args?: Record<string, unknown>) => {
    const testState = window.__AIOS_APPS_TEST_STATE__;
    testState.invocations.push({ command, args });
    let result: unknown;
    switch (command) {
      case "get_relay_ws_url":
        result = RELAY;
        break;
      case "get_identity":
        result = { pubkey: OWNER, display_name: "Gustav" };
        break;
      case "get_channels":
        result = {
          hash: "preview-hash",
          channels: channels.map(toRawChannel),
          last_messages: {},
        };
        break;
      case "list_managed_agents":
        result = [
          {
            pubkey: FIZZ,
            name: "Fizz",
            persona_id: "builtin:fizz",
            relay_url: RELAY,
            acp_command: "fizz",
            agent_command: "fizz",
            agent_args: [],
            mcp_command: "",
            turn_timeout_seconds: 60,
            idle_timeout_seconds: null,
            max_turn_duration_seconds: null,
            parallelism: 1,
            system_prompt: null,
            model: null,
            provider: null,
            persona_out_of_date: false,
            persona_orphaned: false,
            needs_restart: false,
            status: "stopped",
            pid: null,
            created_at: "2026-09-24T12:00:00Z",
            updated_at: "2026-09-24T12:00:00Z",
            last_started_at: null,
            last_stopped_at: null,
            last_exit_code: null,
            last_error: null,
            last_error_code: null,
            log_path: "",
            start_on_app_launch: false,
            backend: { type: "local" },
            backend_agent_id: null,
          },
        ];
        break;
      case "get_channel_members":
        result = memberResponse(String(args?.channelId ?? ""));
        break;
      case "create_channel": {
        const description = String(args?.description ?? "");
        const isCalendar = description.endsWith(":calendar");
        const members = isCalendar ? [OWNER, REVIEWER] : [OWNER];
        const created: Channel = {
          id: `app-preview-${channels.length}`,
          name: String(args?.name ?? "app"),
          channelType: String(
            args?.channelType ?? "stream",
          ) as Channel["channelType"],
          visibility: String(
            args?.visibility ?? "private",
          ) as Channel["visibility"],
          description,
          topic: null,
          purpose: null,
          memberCount: members.length,
          memberPubkeys: members,
          lastMessageAt: null,
          archivedAt: null,
          participants: [],
          participantPubkeys: [],
          isMember: true,
          ttlSeconds: null,
          ttlDeadline: null,
        };
        channels.push(created);
        result = toRawChannel(created);
        break;
      }
      case "add_channel_members": {
        const target = channels.find((entry) => entry.id === args?.channelId);
        const pubkeys = (args?.pubkeys as string[] | undefined) ?? [];
        if (!target) throw new Error("Channel not found");
        if (testState.delayInvite) {
          testState.delayInvite = false;
          testState.inviteStarted = true;
          await new Promise<void>((resolve) => {
            testState.releaseInvite = () => {
              target.memberPubkeys = [
                ...new Set([...target.memberPubkeys, ...pubkeys]),
              ];
              target.memberCount = target.memberPubkeys.length;
              resolve();
            };
          });
        } else {
          target.memberPubkeys = [
            ...new Set([...target.memberPubkeys, ...pubkeys]),
          ];
          target.memberCount = target.memberPubkeys.length;
        }
        result = { added: pubkeys, errors: [] };
        break;
      }
      default:
        throw new Error(`Unexpected native call: ${command}`);
    }
    return result as T;
  },
};

function SitesProbe({ onDirtyChange }: AppsExtensionRenderContext) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    window.__AIOS_APPS_TEST_STATE__.mounts += 1;
  }, []);
  return (
    <label>
      Site draft
      <input
        aria-label="Site draft"
        value={draft}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          onDirtyChange?.(event.currentTarget.value.length > 0);
        }}
      />
    </label>
  );
}

function Preview() {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    window.__AIOS_APPS_TEST_STATE__.dirty = dirty;
  }, [dirty]);

  return (
    <>
      <output data-testid="host-dirty-state">
        {dirty ? "dirty" : "clean"}
      </output>
      <AppsWorkspace
        channelId={BUSINESS_ID}
        companyName="Pilot business"
        embedded
        nativeScope={{
          expectedRelayUrl: RELAY,
          expectedSignerPubkey: OWNER,
        }}
        onDirtyChange={setDirty}
        extensionApps={[
          {
            id: "sites",
            title: "Sites",
            description: "Build and publish your website.",
            Icon: LayoutTemplate,
            render: (context) => <SitesProbe {...context} />,
          },
        ]}
      />
    </>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Preview />);
