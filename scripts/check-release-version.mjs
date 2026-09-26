import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Run from the repository root. No dependencies are needed before npm ci.
const read = (path) => readFileSync(resolve(path), "utf8");
const readJson = (path) => JSON.parse(read(path));
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function tomlVersion(section, label) {
  const version = section?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) throw new Error(`Missing version in ${label}`);
  return version;
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--tag")) {
    throw new Error("Usage: node scripts/check-release-version.mjs [--tag vN.N.N]");
  }
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  const cargo = read("src-tauri/Cargo.toml").split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
  const cargoPackages = read("src-tauri/Cargo.lock").split(/^\[\[package\]\]\s*$/m);
  const appPackages = cargoPackages.filter((section) => /^name\s*=\s*"prexu"\s*$/m.test(section));
  if (appPackages.length !== 1) throw new Error("Expected one prexu package in src-tauri/Cargo.lock");

  const versions = {
    "package.json": pkg.version,
    "package-lock.json": lock.version,
    "package-lock.json packages[root]": lock.packages?.[""]?.version,
    "src-tauri/tauri.conf.json": readJson("src-tauri/tauri.conf.json").version,
    "src-tauri/Cargo.toml": tomlVersion(cargo, "src-tauri/Cargo.toml [package]"),
    "src-tauri/Cargo.lock prexu": tomlVersion(appPackages[0], "src-tauri/Cargo.lock prexu"),
  };
  if (typeof pkg.version !== "string" || !stableVersion.test(pkg.version)) {
    throw new Error("App version must be a stable N.N.N version");
  }
  for (const [path, version] of Object.entries(versions)) {
    if (version !== pkg.version) throw new Error(`${path}: expected ${pkg.version}, got ${version}`);
  }
  if (args.length && args[1] !== `v${pkg.version}`) {
    throw new Error(`Release tag must be v${pkg.version}, got ${JSON.stringify(args[1])}`);
  }
  console.log(`Release version verified: ${pkg.version}${args.length ? ` (${args[1]})` : ""}`);
} catch (error) {
  console.error(`Release version check failed: ${error.message}`);
  process.exitCode = 1;
}
