import { pipeline } from 'node:stream/promises';
import { databaseTools, keyFromEnvironment, options, readEncryptedArchive, spawnDatabase } from './backup-common.mjs';

try {
  const args = options();
  if (args.help) {
    console.log('node scripts/restore-db.mjs --archive FILE --database briljante_restore_NAME --acknowledge-disposable-local-target [--pg-bin DIRECTORY] [--local-fixture | --container ISOLATED_NAME]');
    process.exit(0);
  }
  const key = keyFromEnvironment();
  const archive = await readEncryptedArchive(args.archive, key);
  const tools = await databaseTools(args, { restoring: true });
  const check = spawnDatabase(tools, 'psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--dbname', tools.database, '--command', "select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and c.relkind in ('r','p','v','m','S','f')) + (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema');"]);
  let count = ''; check.child.stdout.on('data', part => { count += part; }); check.child.stdin.end(); await check.done;
  if (count.trim() !== '0') throw new Error('Restore refuses a nonempty target. Create a new disposable local database.');
  const { child, done } = spawnDatabase(tools, 'pg_restore', ['--clean', '--if-exists', '--single-transaction', '--exit-on-error', '--no-owner', '--dbname', tools.database]);
  child.stdout.resume();
  const stream = archive.decrypt();
  try { await Promise.all([pipeline(stream.input, stream.decipher, child.stdin), done]); }
  catch (error) { child.kill(); throw error; }
  key.fill(0);
  console.log(JSON.stringify({ restored: true, database: tools.database, endpoint: tools.endpoint, sourceCreatedAt: archive.details.createdAt, note: 'Disposable logical restore only; verify data, roles/RLS and application behavior separately.' }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
