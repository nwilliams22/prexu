import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const script = resolve("scripts/check-release-version.mjs");
const files = ["package.json", "package-lock.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"];

function fixture(t) {
  const dir = mkdtempSync(join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || tmpdir(), "prexu-release-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src-tauri"));
  for (const file of files) writeFileSync(join(dir, file), readFileSync(file));
  const version = JSON.parse(readFileSync(join(dir, "package.json"))).version;
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
  return { dir, version, run };
}

test("accepts consistent versions and the matching release tag", (t) => {
  const { version, run } = fixture(t);
  assert.equal(run().status, 0);
  const result = run("--tag", `v${version}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release version verified/);
});

test("rejects old, malformed, empty and missing tag arguments", (t) => {
  const { run } = fixture(t);
  for (const tag of ["v0.0.0", "0.8.0", "v0.8.0-beta.1", "v0.8.0/other", ""]) {
    assert.equal(run("--tag", tag).status, 1, `accepted ${tag}`);
  }
  assert.equal(run("--tag").status, 1);
  assert.equal(run("--unknown").status, 1);
});

for (const file of files) {
  test(`rejects version drift in ${file}`, (t) => {
    const { dir, version, run } = fixture(t);
    const path = join(dir, file);
    const content = readFileSync(path, "utf8");
    const modified = file.endsWith("Cargo.lock")
      ? content.replace(`name = "prexu"\nversion = "${version}"`, 'name = "prexu"\nversion = "0.0.0"')
      : content.replace(`"${version}"`, '"0.0.0"');
    assert.notEqual(modified, content, "fixture mutation must change the app version");
    writeFileSync(path, modified);
    const result = run();
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /expected/);
  });
}

test("rejects npm lock root-package drift independently of its top-level version", (t) => {
  const { dir, run } = fixture(t);
  const path = join(dir, "package-lock.json");
  const lock = JSON.parse(readFileSync(path));
  lock.packages[""].version = "0.0.0";
  writeFileSync(path, JSON.stringify(lock));
  assert.equal(run().status, 1);
});

test("fails closed if Cargo app metadata is missing", (t) => {
  const { dir, run } = fixture(t);
  writeFileSync(join(dir, "src-tauri/Cargo.lock"), 'version = 4\n[[package]]\nname = "unrelated"\nversion = "0.8.0"\n');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected one prexu package/);
});

test("rejects consistently set prerelease metadata for the stable release workflow", (t) => {
  const { dir, version, run } = fixture(t);
  for (const file of files) {
    const path = join(dir, file);
    writeFileSync(path, readFileSync(path, "utf8").replaceAll(`"${version}"`, `"${version}-rc.1"`));
  }
  const result = run("--tag", `v${version}-rc.1`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /stable N.N.N/);
});
