// Builds the signed desktop bundle, then proves the shipped DMG carries no owner
// path. Rust embeds its absolute source paths unless they are remapped, so every
// build maps them away and scans the delivered image — the bytes the owner would
// install — with a raw-byte, case-insensitive grep.
//
//   node scripts/build-desktop.mjs                 # build, then scan
//   node scripts/build-desktop.mjs --scan <dmg>    # scan an existing image only
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

const home = homedir();
const markers = [`/Users/${basename(home)}`, "_orchestra", ".cargo/registry", ".rustup"];

// Returns true when the image is clean; prints one proof line either way.
function scan(dmg) {
  const mount = mkdtempSync(join(tmpdir(), "storage-paths-"));
  try {
    execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg], { stdio: "ignore" });
    const files = execFileSync("/usr/bin/find", [mount, "-type", "f"]).toString().split("\n").filter(Boolean).length;
    let hits = [];
    try {
      const out = execFileSync(
        "/usr/bin/grep",
        ["-r", "-a", "-i", "-l", ...markers.flatMap((marker) => ["-e", marker]), mount],
        { encoding: "utf8" },
      );
      hits = out.split("\n").filter(Boolean);
    } catch (error) {
      // grep exits 1 when nothing matched; anything else means the scan itself failed.
      if (error.status !== 1) throw error;
    }
    if (hits.length) {
      console.error(`owner paths found in ${basename(dmg)}:\n  ` + hits.join("\n  "));
      return false;
    }
    console.log(
      `paths: ${files} files in ${basename(dmg)} scanned (raw bytes, case-insensitive); ` +
        `${markers.join(", ")} absent`,
    );
    return true;
  } finally {
    execFileSync("hdiutil", ["detach", mount], { stdio: "ignore" });
  }
}

const args = process.argv.slice(2);
const scanAt = args.indexOf("--scan");
if (scanAt !== -1) {
  const dmg = args[scanAt + 1];
  if (!dmg) throw new Error("--scan needs a DMG path");
  process.exitCode = scan(dmg) ? 0 : 1;
} else {
  const rustflags = [
    process.env.RUSTFLAGS ?? "",
    // rustc lets the last matching prefix win, so the registry and rustup rules
    // come last: they must remove those tokens too, not just the owner name.
    `--remap-path-prefix=${home}=/build`,
    `--remap-path-prefix=${home}/.cargo/registry=/build/registry`,
    `--remap-path-prefix=${home}/.rustup=/build/rustup`,
  ].join(" ").trim();
  execFileSync(join("node_modules", ".bin", "tauri"), ["build", ...args], {
    stdio: "inherit",
    env: { ...process.env, RUSTFLAGS: rustflags },
  });

  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const arch = execFileSync("rustc", ["--print", "host-tuple"]).toString().trim().split("-")[0];
  const dmg = `src-tauri/target/release/bundle/dmg/${config.productName}_${config.version}_${arch}.dmg`;
  if (!scan(dmg)) process.exitCode = 1;
}
