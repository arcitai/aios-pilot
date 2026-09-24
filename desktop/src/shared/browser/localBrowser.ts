/** Real native IPC over the explicitly enabled localhost development companion. */
type Callback = { run: (value: unknown) => void; once: boolean };
type RpcResult = {
  ok: boolean;
  value?: unknown;
  raw?: number[];
  error?: unknown;
};
type BridgeEvent = { callback: number; payload: unknown };
const PREFIX = "/__aios";
const SERIALIZE_TO_IPC = "__TAURI_TO_IPC_KEY__";

class LocalBackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function installLocalBrowserBridge() {
  if (import.meta.env.MODE !== "browser" || "__TAURI_INTERNALS__" in window)
    return;
  const callbacks = new Map<number, Callback>();
  const listeners = new Map<number, number>();
  let stopped = false;
  let clientId = "";

  async function post(path: string, payload: unknown, timeout = 220_000) {
    const response = await fetch(`${PREFIX}/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload, (_key, value) => {
        if (
          value &&
          typeof value === "object" &&
          typeof value[SERIALIZE_TO_IPC] === "function"
        )
          return value[SERIALIZE_TO_IPC]();
        if (value instanceof Uint8Array) return Array.from(value);
        if (value instanceof ArrayBuffer)
          return Array.from(new Uint8Array(value));
        return value;
      }),
      signal: AbortSignal.timeout(timeout),
    });
    const value = await response.json();
    if (!response.ok)
      throw new LocalBackendError(
        typeof value.error === "string"
          ? value.error
          : `Local backend returned ${response.status}`,
        response.status,
      );
    return value;
  }

  function notice(message: string | null) {
    let banner = document.getElementById("aios-browser-connection-notice");
    if (!message) {
      banner?.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "aios-browser-connection-notice";
      banner.setAttribute("role", "alert");
      banner.style.cssText =
        "position:fixed;inset:0 0 auto;z-index:99999;background:#fff3d6;color:#482f00;padding:10px 16px;font:14px/1.4 system-ui;box-shadow:0 1px 4px #0002";
      document.body.append(banner);
    }
    banner.textContent = message;
  }

  function runCallback(id: number, value: unknown) {
    const callback = callbacks.get(id);
    if (!callback) return;
    if (callback.once) callbacks.delete(id);
    callback.run(value);
  }

  async function invoke(command: string, args: Record<string, unknown> = {}) {
    // Browser chrome belongs to the browser; these display-only operations
    // must never expose or focus the hidden companion window.
    if (command === "plugin:window|set_title") {
      document.title = String(args.title ?? "AIOS Pilot");
      return;
    }
    if (
      [
        "plugin:window|show",
        "plugin:window|set_focus",
        "plugin:window|unminimize",
        "plugin:window|start_dragging",
      ].includes(command)
    )
      return;
    if (command === "plugin:window|is_focused") return document.hasFocus();
    if (command === "plugin:window|is_visible")
      return document.visibilityState === "visible";
    let result: RpcResult;
    try {
      result = await post("rpc", { clientId, command, args });
    } catch (error) {
      notice(
        "Connection to the local backend was interrupted. Your open edits are still here; check the development terminal before retrying.",
      );
      throw error;
    }
    if (!result.ok) throw result.error ?? new Error("Native command failed");
    if (
      command === "plugin:event|listen" &&
      typeof result.value === "number" &&
      typeof args.handler === "number"
    )
      listeners.set(result.value, args.handler);
    return result.raw ? Uint8Array.from(result.raw).buffer : result.value;
  }

  try {
    const deadline = Date.now() + 120_000;
    let health: { service?: unknown; mode?: unknown };
    for (;;) {
      try {
        health = await post("health", {}, 10_000);
        break;
      } catch (error) {
        if (
          Date.now() >= deadline ||
          !(
            error instanceof TypeError ||
            (error instanceof LocalBackendError && error.status === 503)
          )
        )
          throw error;
        notice(
          "Starting the local app… Waiting for the backend or macOS keychain approval.",
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (
      health.service !== "aios-browser-backend" ||
      health.mode !== "real-native"
    )
      throw new Error("Unexpected localhost backend");
    ({ clientId } = await post("connect", {}, 10_000));
    notice(null);
  } catch (cause) {
    notice(
      "The local backend is not ready. Check the development terminal and any macOS keychain prompt, then reload this page.",
    );
    throw cause;
  }

  const internals = {
    invoke,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    transformCallback(run: (value: unknown) => void, once = false) {
      if (callbacks.size >= 2048)
        throw new Error("Too many active browser callbacks. Reload this tab.");
      let id: number;
      do {
        id = crypto.getRandomValues(new Uint32Array(1))[0];
      } while (callbacks.has(id));
      callbacks.set(id, { run: run ?? (() => {}), once });
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    runCallback,
    // Local native files are not exposed through a general filesystem endpoint.
    // File pickers/import commands still use the actual native backend.
    convertFileSrc(_path: string) {
      throw new Error(
        "Native file URLs are unavailable in the browser. Use the app’s import or export action.",
      );
    },
  };
  Object.assign(window, {
    __TAURI_INTERNALS__: internals,
    __TAURI_EVENT_PLUGIN_INTERNALS__: {
      unregisterListener(_event: string, id: number) {
        const callback = listeners.get(id);
        if (callback !== undefined) callbacks.delete(callback);
        listeners.delete(id);
      },
    },
    __AIOS_LOCAL_BROWSER__: true,
  });

  window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      void fetch(`${PREFIX}/disconnect`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
        keepalive: true,
      }).catch(() => {});
      callbacks.clear();
      listeners.clear();
    },
    { once: true },
  );

  async function poll() {
    let failures = 0;
    while (!stopped) {
      try {
        const result: { events: BridgeEvent[]; overflowed: boolean } =
          await post("events", { clientId }, 30_000);
        if (stopped) return;
        if (result.overflowed) {
          notice(
            "Live updates fell behind. Save or copy your open edits, then reload this page to reconnect.",
          );
          return;
        }
        if (failures > 0) notice(null);
        failures = 0;
        for (const event of result.events) {
          const payload = event.payload as {
            binary?: boolean;
            message?: number[];
          } | null;
          if (payload?.binary && Array.isArray(payload.message)) {
            runCallback(event.callback, {
              ...payload,
              message: Uint8Array.from(payload.message).buffer,
            });
          } else {
            runCallback(event.callback, event.payload);
          }
        }
      } catch {
        if (stopped) return;
        failures++;
        notice(
          "Live updates are disconnected. Your open edits are still here. Reconnecting…",
        );
        if (failures >= 8) {
          notice(
            "The local backend is unavailable. Save or copy your open edits, then restart the development server and reload.",
          );
          return;
        }
        await new Promise((resolve) =>
          window.setTimeout(resolve, Math.min(1000 * 2 ** failures, 15_000)),
        );
      }
    }
  }
  void poll();
}
