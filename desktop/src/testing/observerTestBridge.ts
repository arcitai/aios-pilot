import {
  injectObserverEventsForE2E,
  _testProcessLiveObserverEvents,
} from "@/features/agents/observerRelayStore";
import type { ObserverEvent } from "@/features/agents/ui/agentSessionTypes";

declare global {
  interface Window {
    __BUZZ_E2E_SEED_OBSERVER_EVENTS__?: (input: {
      agentPubkey: string;
      events: ObserverEvent[];
      /** Dispatch live management/control callbacks as well as transcript data. */
      live?: boolean;
    }) => void;
  }
}

/** Controlled UI fixtures only; this bypasses relay identity/decryption checks. */
export function installObserverTestBridge() {
  window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__ = ({
    agentPubkey,
    events,
    live,
  }) => {
    if (live) _testProcessLiveObserverEvents(agentPubkey, events);
    else injectObserverEventsForE2E(agentPubkey, events);
  };
}
