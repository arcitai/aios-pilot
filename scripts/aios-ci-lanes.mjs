import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const allLanes = ["backend", "native", "frontends", "mobile"];

export function lanesForPaths(paths) {
  // Frontend and repository policy checks are always required. Shared backend,
  // toolchain and unknown paths conservatively require the complete matrix.
  const selected = new Set(["frontends"]);
  for (const path of paths) {
    if (path.startsWith("desktop/src-tauri/")) selected.add("native");
    else if (path.startsWith("desktop/") || path.startsWith("web/")) continue;
    else if (path.startsWith("mobile/")) selected.add("mobile");
    else if ((path.startsWith("docs/") || !path.includes("/")) && path.endsWith(".md")) continue;
    else return allLanes;
  }
  return allLanes.filter((lane) => selected.has(lane));
}

export function lanesBetween(base, revision, cwd = process.cwd()) {
  // Resolve commits and propagate Git errors; an unavailable base must never
  // become an empty diff that silently omits required checks.
  for (const ref of [base, revision]) {
    if (!/^[a-f0-9]{40}$/.test(ref ?? "")) throw new Error("Expected a full commit SHA");
    execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd, stdio: "pipe" });
  }
  const paths = execFileSync("git", ["diff", "--name-only", "-z", base, revision, "--"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).split("\0").filter(Boolean);
  return lanesForPaths(paths);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(lanesBetween(process.argv[2], process.argv[3])));
}
