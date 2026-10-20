import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const excluded = new Set([".git", ".vercel", "node_modules", "supabase", "test", "docs"]);
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !excluded.has(entry.name)) await visit(path);
    else if (entry.isFile() && entry.name.endsWith(".html")) {
      const original = await readFile(path, "utf8");
      const updated = original.replace('<div class="policy-links"><a href="/privacy-policy-2/">', '<div class="policy-links"><a href="/frequently-asked-questions/">FAQ</a> | <a href="/privacy-policy-2/">');
      if (updated !== original) { await writeFile(path, updated); console.log(path); }
    }
  }
}
await visit(process.cwd());
