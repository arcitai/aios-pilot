import { readFileSync, lstatSync } from "node:fs";

const ROUTES = new Set(["health", "connect", "disconnect", "rpc", "events"]);
const MAX_BODY_BYTES = 1024 * 1024;

/** Explicit origin/Host checks prevent cross-site calls and DNS rebinding. */
export function acceptsBrowserRequest(request, origin) {
  const url = new URL(origin);
  return (
    request.method === "POST" &&
    request.headers.host === url.host &&
    request.headers.origin === origin &&
    request.headers["content-type"]?.split(";")[0] === "application/json"
  );
}

export function localBrowserProxy() {
  const origin = process.env.AIOS_BROWSER_ORIGIN;
  const port = process.env.AIOS_BROWSER_BRIDGE_PORT;
  const tokenPath = process.env.AIOS_BROWSER_TOKEN_FILE;
  if (!origin || !port || !tokenPath || process.env.AIOS_BROWSER_DEV !== "1")
    throw new Error(
      "Use scripts/aios-browser to start the real browser development mode.",
    );
  const frontend = new URL(origin);
  if (
    frontend.hostname !== "127.0.0.1" ||
    frontend.protocol !== "http:" ||
    frontend.origin !== origin
  )
    throw new Error("Browser frontend must use an explicit loopback origin.");
  if (
    !/^\d+$/.test(port) ||
    Number(port) < 1024 ||
    Number(port) > 65535 ||
    frontend.port === port
  )
    throw new Error("Invalid native bridge port.");
  const metadata = lstatSync(tokenPath);
  if (
    !metadata.isFile() ||
    metadata.size !== 64 ||
    (metadata.mode & 0o077) !== 0
  )
    throw new Error("Browser token file must be private and contain 64 bytes.");
  const token = readFileSync(tokenPath, "utf8");
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error("Invalid browser token.");
  let inflight = 0;

  return {
    name: "aios-real-local-browser",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__aios/")) return next();
        const route = request.url.slice("/__aios/".length);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json");
        response.setHeader("X-Content-Type-Options", "nosniff");
        const fail = (code, message) => {
          response.statusCode = code;
          response.end(JSON.stringify({ ok: false, error: message }));
        };
        if (!acceptsBrowserRequest(request, origin) || !ROUTES.has(route))
          return fail(403, "Local browser request refused");
        if (inflight >= 64) return fail(429, "Local browser backend is busy");
        inflight++;
        try {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of request) {
            bytes += chunk.length;
            if (bytes > MAX_BODY_BYTES) {
              fail(413, "Request is too large");
              return;
            }
            chunks.push(chunk);
          }
          const native = await fetch(`http://127.0.0.1:${port}/${route}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: origin,
              Authorization: `Bearer ${token}`,
            },
            body: Buffer.concat(chunks),
            signal: AbortSignal.timeout(215_000),
          });
          response.statusCode = native.status;
          if (!native.body) return response.end();
          let received = 0;
          for await (const chunk of native.body) {
            received += chunk.length;
            if (received > 8 * 1024 * 1024) {
              response.destroy(
                new Error(
                  "Native response exceeded the development transport limit",
                ),
              );
              return;
            }
            response.write(chunk);
          }
          response.end();
        } catch {
          if (!response.headersSent)
            fail(503, "The native development backend is not available");
          else response.destroy();
        } finally {
          inflight--;
        }
      });
    },
  };
}
