import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lanesBetween, lanesForPaths } from "./aios-ci-lanes.mjs";

test("a frontend-only change retains policy checks without native compilation", () => {
  assert.deepEqual(lanesForPaths(["desktop/src/App.tsx", "web/src/main.ts", "docs/guide.md"]), ["frontends"]);
});

test("native and mobile changes keep their real platform checks", () => {
  assert.deepEqual(lanesForPaths(["desktop/src-tauri/src/main.rs", "mobile/lib/main.dart"]), ["native", "frontends", "mobile"]);
});

test("shared contracts, toolchains and unknown build inputs require every lane", () => {
  const expected = ["backend", "native", "frontends", "mobile"];
  for (const path of ["crates/buzz-core/src/lib.rs", "crates/buzz-core/fixture.md", "migrations/0051.sql", "Cargo.lock", "pnpm-lock.yaml", ".github/workflows/aios-ci.yml", "scripts/aios-ci-lanes.mjs", "new-platform/build.config"]) {
    assert.deepEqual(lanesForPaths([path]), expected, path);
  }
});

test("Git comparison includes deleted paths and refuses an unavailable revision", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aios-ci-lanes-"));
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=CI Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  try {
    git("init", "--quiet");
    mkdirSync(join(cwd, "mobile/lib"), { recursive: true });
    writeFileSync(join(cwd, "mobile/lib/old.dart"), "fixture\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "base");
    const base = git("rev-parse", "HEAD");
    git("rm", "mobile/lib/old.dart");
    git("commit", "--quiet", "-m", "remove mobile source");
    const head = git("rev-parse", "HEAD");
    assert.deepEqual(lanesBetween(base, head, cwd), ["frontends", "mobile"]);
    assert.throws(() => lanesBetween("0".repeat(40), head, cwd));
    assert.throws(() => lanesBetween("--help", head, cwd), /full commit SHA/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
