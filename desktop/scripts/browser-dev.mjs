import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const desktop = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.dirname(desktop);
const frontendPort = 1437;
const bridgePort = 1438;
const origin = `http://127.0.0.1:${frontendPort}`;
const runtime = mkdtempSync(path.join(tmpdir(), "aios-browser-"));
chmodSync(runtime, 0o700);
const tokenFile = path.join(runtime, "bridge-token");
const token = randomBytes(32).toString("hex");
writeFileSync(tokenFile, token, { mode: 0o600 });
const config = JSON.parse(
  readFileSync(path.join(desktop, "src-tauri/tauri.aios.conf.json"), "utf8"),
);
config.identifier = "xyz.block.buzz.app.demo.aios-browser-local";
config.productName = "AIOS Browser Dev";
config.plugins["deep-link"].desktop.schemes = ["buzz-demo-aios-browser-local"];
const base = JSON.parse(
  readFileSync(path.join(desktop, "src-tauri/tauri.conf.json"), "utf8"),
);
config.build = { ...config.build, beforeDevCommand: "", devUrl: origin };
config.app = {
  ...config.app,
  windows: [
    {
      ...base.app.windows[0],
      label: "main",
      visible: false,
      url: "browser-host.html",
    },
  ],
};
const configFile = path.join(runtime, "tauri.browser.json");
writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
const env = {
  ...process.env,
  AIOS_BROWSER_DEV: "1",
  AIOS_BROWSER_ORIGIN: origin,
  AIOS_BROWSER_BRIDGE_PORT: String(bridgePort),
  AIOS_BROWSER_TOKEN_FILE: tokenFile,
  BUZZ_BUILD_DEMO_SLUG: "aios-browser-local",
  BUZZ_BUILD_AUTO_CONNECT_DEFAULT_RELAY: "1",
  BUZZ_RELAY_URL: "ws://127.0.0.1:3341",
  BUZZ_RELAY_HTTP: "http://127.0.0.1:3341",
  CARGO_BUILD_JOBS: "1",
  VITE_PORT: String(frontendPort),
  CARGO_TARGET_DIR: path.join(desktop, "src-tauri/target"),
  PATH: `${path.join(root, "target/debug")}:${process.env.PATH ?? ""}`,
};
for (const key of [
  "BUZZ_PRIVATE_KEY",
  "BUZZ_SHARE_IDENTITY",
  "BUZZ_RESET_WEBVIEW_STATE",
  "BUZZ_UPDATER_ENDPOINT",
  "BUZZ_UPDATER_PUBLIC_KEY",
  "BUZZ_BUILD_AGENT_ENV",
  "BUZZ_BUILD_RELAY_RECONNECT_CMD",
  "BUZZ_BUILD_BUZZ_AGENT_PROVIDER",
  "BUZZ_BUILD_BUZZ_AGENT_MODEL",
  "BUZZ_DEV_KEYRING_SERVICE",
  "BUZZ_BUILD_AGENT_ACCESS_OWNER_ONLY",
])
  delete env[key];
const children = new Set();
let stopping = false;

function run(executable, args) {
  const child = spawn(executable, args, {
    cwd: desktop,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.add(child);
  child.once("error", (error) => {
    console.error(error.message);
    void stop(1);
  });
  child.once("exit", (code) => {
    // Keep the process group registered: descendants may outlive their parent.
    if (!stopping) void stop(code || 1);
  });
  return child;
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  const active = [...children];
  for (const child of active) {
    if (!child.pid) continue;
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  await Promise.race([
    Promise.all(
      active.map((child) =>
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise((resolve) => child.once("exit", resolve)),
      ),
    ),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);
  for (const child of children) {
    if (!child.pid) continue;
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  rmSync(runtime, { recursive: true, force: true });
  process.exit(code);
}
process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));

run(process.execPath, [
  path.join(desktop, "node_modules/vite/bin/vite.js"),
  "--mode",
  "browser",
  "--host",
  "127.0.0.1",
]);
run("pnpm", ["tauri", "dev", "--no-watch", "--config", configFile]);

async function ready() {
  for (let attempt = 0; attempt < 900 && !stopping; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${bridgePort}/health`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          Authorization: `Bearer ${token}`,
        },
        body: "{}",
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok && (await response.json()).mode === "real-native") {
        console.log(
          `\nAIOS is ready at ${origin}/#/business\nReal local backend; saved data uses a separate browser-development identity.\nStop with Ctrl+C. No desktop package was built.\n`,
        );
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!stopping) {
    console.error("Local backend did not become ready within 15 minutes.");
    await stop(1);
  }
}
void ready();
