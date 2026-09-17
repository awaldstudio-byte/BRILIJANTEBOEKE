import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ignoredDirectories = new Set([".git", ".vercel", "node_modules"]);
const sourceFiles = [];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile() && path.endsWith(".js")) sourceFiles.push(path);
  }
}

await collect(process.cwd());
sourceFiles.sort();

for (const file of sourceFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Checked ${sourceFiles.length} JavaScript files.`);
