import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { databaseTools, encryptDump, keyFromEnvironment, options, projectRef, secureOutputDirectory } from './backup-common.mjs';

try {
  const args = options();
  if (args.help) {
    console.log('node scripts/backup-db.mjs --output-dir ABSOLUTE_PRIVATE_DIRECTORY --database NAME [--pg-bin DIRECTORY] [--local-fixture | --container ISOLATED_NAME]');
    process.exit(0);
  }
  const key = keyFromEnvironment();
  const tools = await databaseTools(args);
  const directory = await secureOutputDirectory(args['output-dir']);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(directory, `briljante-${timestamp}.bbdump`);
  const metadata = { createdAt: new Date().toISOString(), projectRef: tools.endpoint === 'dedicated-supabase' ? projectRef : 'synthetic-local-fixture', database: tools.database, scope: 'PostgreSQL logical database; global roles, Storage file bytes and service configuration excluded' };
  const temporary = await encryptDump(tools, path, key, metadata);
  await rename(temporary, path);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  const sha256 = digest.digest('hex');
  const manifest = { ...metadata, archive: path, bytes: (await stat(path)).size, sha256, encryption: 'AES-256-GCM; key retained separately by operator' };
  await writeFile(`${path}.json`, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  key.fill(0);
  console.log(JSON.stringify(manifest));
} catch (error) { console.error(error.message); process.exitCode = 1; }
