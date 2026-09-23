import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Real loopback publisher; only the desktop IPC/keyring seam is substituted. */
export async function startSitesPublisherFixture(binary: string) {
  const directory = await mkdtemp(join(tmpdir(), "aios-sites-browser-"));
  const token = randomBytes(32).toString("hex");
  const managerUrl = "http://127.0.0.1:3352";
  const child = spawn(binary, [], {
    env: {
      ...process.env,
      AIOS_SITES_ADMIN_TOKEN: token,
      AIOS_SITES_DATA_DIR: directory,
      AIOS_SITES_PUBLIC_ORIGIN: "http://127.0.0.1:3351",
      AIOS_SITES_PUBLIC_BIND: "127.0.0.1:3351",
      AIOS_SITES_ADMIN_BIND: "127.0.0.1:3352",
      AIOS_SITES_CONTAINER_MODE: "0",
      AIOS_SITES_ENABLE_DEV_PREVIEW: "1",
    },
    stdio: "ignore",
  });
  let spawnError: Error | null = null;
  child.on("error", (error) => {
    spawnError = error;
  });
  const exited = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([exited, delay(2000)]);
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
  async function request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`${managerUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`Fixture publisher returned HTTP ${response.status}`);
    return response.json();
  }
  try {
    let ready = false;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null)
        throw new Error(
          "Fixture publisher exited; ports 3351/3352 must be free.",
        );
      try {
        await request("/api/status");
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    if (!ready) throw new Error("Fixture publisher did not become ready.");
  } catch (error) {
    await stop();
    throw error;
  }
  let connected = false;
  async function invoke(command: string, args: Record<string, unknown>) {
    if (
      args.managerUrl !== managerUrl ||
      args.expectedRelayUrl !== "ws://localhost:3000" ||
      args.expectedSignerPubkey !== "deadbeef".repeat(8)
    ) {
      throw new Error(
        "Publisher fixture received an unexpected desktop scope.",
      );
    }
    if (command === "sites_publisher_status") {
      const status = connected ? await request("/api/status") : null;
      return { connected, version: status?.version ?? null };
    }
    if (command === "connect_sites_publisher") {
      if (args.token !== token) throw new Error("Incorrect fixture token.");
      const status = await request("/api/status");
      connected = true;
      return { connected, version: status.version };
    }
    if (command === "disconnect_sites_publisher") {
      connected = false;
      return;
    }
    if (!connected) throw new Error("Fixture publisher is disconnected.");
    const path = `/api/sites/${encodeURIComponent(String(args.siteId))}`;
    switch (command) {
      case "sites_publisher_site_status":
        return request(path);
      case "sites_publisher_preview":
        return request("/api/previews", "POST", {
          title: args.title,
          files: args.files,
        });
      case "publish_sites_site":
        return request(path, "PUT", { title: args.title, files: args.files });
      case "revoke_sites_site":
        return (await request(path, "DELETE")).revoked;
      default:
        throw new Error(`Unexpected publisher command ${command}`);
    }
  }
  return { token, invoke, stop };
}
