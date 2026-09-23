import * as React from "react";

import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import type {
  HuddleActiveBinding,
  HuddleStartScope,
} from "@/features/huddle/HuddleContext.types";
import {
  businessVoiceBindingMatches,
  validateBusinessVoiceScope,
  type BusinessVoiceScope,
} from "./businessVoiceScope";

export interface BusinessVoiceHuddlePort {
  isStarting: boolean;
  huddleError: string | null;
  clearHuddleError: () => void;
  micConnected: boolean;
  activeEphemeralChannelId: string | null;
  activeHuddleBinding: HuddleActiveBinding | null;
  startHuddle: (
    parentChannelId: string,
    memberPubkeys: string[],
    channelName?: string,
    scope?: HuddleStartScope,
  ) => Promise<void>;
  leaveHuddle: () => Promise<boolean>;
}

export interface BusinessVoiceActionProps extends BusinessVoiceScope {
  huddle: BusinessVoiceHuddlePort;
}

type VoiceActionState =
  | "ready"
  | "starting"
  | "active"
  | "audio-unavailable"
  | "ending"
  | "leave-failed"
  | "other-huddle";

function getActionState(
  scope: BusinessVoiceScope,
  huddle: BusinessVoiceHuddlePort,
  endingScope: BusinessVoiceScope | null,
  leaveFailedScope: BusinessVoiceScope | null,
): VoiceActionState {
  if (endingScope === scope) return "ending";
  if (huddle.activeHuddleBinding) {
    if (
      !businessVoiceBindingMatches(scope, huddle.activeHuddleBinding) ||
      huddle.activeEphemeralChannelId !==
        huddle.activeHuddleBinding.ephemeralChannelId
    ) {
      return "other-huddle";
    }
    return huddle.micConnected ? "active" : "audio-unavailable";
  }
  if (leaveFailedScope === scope) return "leave-failed";
  return huddle.isStarting ? "starting" : "ready";
}

function errorText(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Voice could not be started. Check your microphone and try again.";
}

/** Explicit, workspace-bound entry to the existing private huddle voice flow. */
export function BusinessVoiceAction({
  channelId,
  channelName,
  relayUrl,
  signerPubkey,
  mainAgentPubkey,
  huddle,
}: BusinessVoiceActionProps) {
  const scope = React.useMemo<BusinessVoiceScope>(
    () => ({ channelId, channelName, relayUrl, signerPubkey, mainAgentPubkey }),
    [channelId, channelName, relayUrl, signerPubkey, mainAgentPubkey],
  );
  const validationError = validateBusinessVoiceScope(scope);
  const [endingScope, setEndingScope] =
    React.useState<BusinessVoiceScope | null>(null);
  const [leaveFailedScope, setLeaveFailedScope] =
    React.useState<BusinessVoiceScope | null>(null);
  const actionState = getActionState(
    scope,
    huddle,
    endingScope,
    leaveFailedScope,
  );
  const [actionError, setActionError] = React.useState<{
    scope: BusinessVoiceScope;
    message: string;
  } | null>(null);
  const [huddleErrorScope, setHuddleErrorScope] =
    React.useState<BusinessVoiceScope | null>(null);
  const visibleError =
    validationError ??
    (huddleErrorScope === scope ? huddle.huddleError : null) ??
    (actionError?.scope === scope ? actionError.message : null);

  const startVoice = async () => {
    if (validationError || actionState !== "ready") return;
    setActionError(null);
    setLeaveFailedScope(null);
    setHuddleErrorScope(scope);
    huddle.clearHuddleError();
    try {
      await huddle.startHuddle(channelId, [mainAgentPubkey], channelName, {
        relayUrl,
        signerPubkey,
      });
    } catch (error) {
      setActionError({ scope, message: errorText(error) });
    }
  };

  const endVoice = async () => {
    setActionError(null);
    setLeaveFailedScope(null);
    setEndingScope(scope);
    setHuddleErrorScope(scope);
    huddle.clearHuddleError();
    let failed = false;
    try {
      if (!(await huddle.leaveHuddle())) {
        failed = true;
        setActionError({
          scope,
          message: "The voice session could not be ended cleanly. Try again.",
        });
      }
    } catch (error) {
      failed = true;
      setActionError({ scope, message: errorText(error) });
    }
    setEndingScope(null);
    if (failed) setLeaveFailedScope(scope);
  };

  return (
    <Card
      aria-labelledby="business-voice-title"
      data-testid="business-voice-action"
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base" id="business-voice-title">
          Talk with your main agent
        </CardTitle>
        <CardDescription>
          Start a private, temporary voice huddle in{" "}
          {channelName || "this workspace"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {actionState === "ready" && (
          <p className="text-sm text-muted-foreground">
            Your microphone is requested only after you choose Start voice. The
            huddle connects this workspace to its main agent.
          </p>
        )}
        {actionState === "starting" && (
          <p className="text-sm" role="status">
            Preparing the private huddle and microphone access…
          </p>
        )}
        {actionState === "active" && (
          <p className="text-sm" role="status">
            Microphone connected. Voice is active with your main agent.
          </p>
        )}
        {actionState === "audio-unavailable" && (
          <p className="text-sm" role="status">
            The private huddle is open, but its microphone is not connected. End
            this session before trying again.
          </p>
        )}
        {actionState === "ending" && (
          <p className="text-sm" role="status">
            Ending the voice session…
          </p>
        )}
        {actionState === "leave-failed" && (
          <p className="text-sm" role="status">
            Microphone capture is disconnected, but the session could not be
            confirmed as ended. Retry ending it before starting another voice
            session.
          </p>
        )}
        {actionState === "other-huddle" && (
          <p className="text-sm" role="status">
            Another voice huddle is open, or its workspace binding is
            unavailable. Use the active huddle controls to end it before
            starting voice here.
          </p>
        )}
        {visibleError && (
          <p className="text-sm text-destructive" role="alert">
            {visibleError}
          </p>
        )}
        {actionState === "active" ||
        actionState === "audio-unavailable" ||
        actionState === "leave-failed" ? (
          <Button onClick={() => void endVoice()} variant="destructive">
            {actionState === "leave-failed"
              ? "Retry ending voice session"
              : "End voice session"}
          </Button>
        ) : actionState === "ending" ? (
          <Button disabled variant="destructive">
            Ending voice…
          </Button>
        ) : (
          <Button
            disabled={
              Boolean(validationError) ||
              actionState === "starting" ||
              actionState === "other-huddle"
            }
            onClick={() => void startVoice()}
          >
            {actionState === "starting" ? "Starting voice…" : "Start voice"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
