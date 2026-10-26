import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { copyFile, mkdir, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, relative, resolve, sep } from 'node:path';
import { command, options, repository, secureOutputDirectory } from './backup-common.mjs';

const args = options();
if (args.help) {
  console.log('node scripts/backup-rehearsal.mjs --pg-bin ABSOLUTE_PG17_BIN --work-dir ABSOLUTE_PRIVATE_DIRECTORY');
  process.exit(0);
}
if (!args['pg-bin']) throw new Error('Provide the directory containing PostgreSQL 17 initdb, pg_ctl, psql, pg_dump and pg_restore.');
const bin = resolve(args['pg-bin']);
const directory = await secureOutputDirectory(args['work-dir']);
const cluster = join(directory, 'disposable-cluster');
await mkdir(cluster, { mode: 0o700 }); // Refuse an existing cluster.
const exe = name => join(bin, process.platform === 'win32' ? `${name}.exe` : name);
const socket = createServer();
await new Promise((resolveReady, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolveReady); });
const port = socket.address().port;
await new Promise(resolveClosed => socket.close(resolveClosed));
const fixture = 'briljante_fixture_source', target = 'briljante_restore_rehearsal';
const key = randomBytes(32).toString('base64');
const env = { ...process.env, PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'postgres', PGDATABASE: fixture, PGSSLMODE: 'disable', BRILJANTE_BACKUP_KEY: key };
delete env.PGPASSWORD; delete env.PGPASSFILE; delete env.PGSERVICE;
const sql = (database, content) => command(exe('psql'), ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--dbname', database], { env, input: content });
const report = { startedAt: new Date().toISOString(), mode: 'synthetic-loopback-PostgreSQL', realClientDataUsed: false, realProviderOrMailUsed: false, tests: {} };
let started = false;

const fingerprintSql = `
create function pg_temp.backup_fingerprint() returns jsonb language plpgsql as $$
declare r record; n bigint; h text; tables jsonb:='{}';
begin
  for r in select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,coalesce(c.relacl::text,'') acl
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','auth','storage') and c.relkind='r' order by n.nspname,c.relname loop
    execute format('select count(*),md5(coalesce(string_agg(row_to_json(t)::text,chr(10) order by row_to_json(t)::text),%L)) from %I.%I t','',r.nspname,r.relname) into n,h;
    tables:=tables||jsonb_build_object(r.nspname||'.'||r.relname,jsonb_build_object('count',n,'contentDigest',h,'rls',r.relrowsecurity,'forceRls',r.relforcerowsecurity,'acl',r.acl));
  end loop;
  return jsonb_build_object('tables',tables,'functions',(
    select md5(coalesce(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),chr(10) order by p.proname,pg_get_function_identity_arguments(p.oid)),''))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'));
end $$;
select pg_temp.backup_fingerprint();`;

try {
  report.postgresql = await command(exe('pg_dump'), ['--version']);
  if (!/PostgreSQL\) 17\./.test(report.postgresql)) throw new Error('Rehearsal expects PostgreSQL major version 17, matching supabase/config.toml.');
  await command(exe('initdb'), ['--pgdata', cluster, '--username', 'postgres', '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--no-locale']);
  await command(exe('pg_ctl'), ['--pgdata', cluster, '--log', join(directory, 'postgres.log'), '--options', `-h 127.0.0.1 -p ${port} -c shared_buffers=32MB -c max_connections=10`, '--wait', 'start'], { ignoreOutput: true });
  started = true;
  await command(exe('createdb'), ['--maintenance-db=postgres', fixture], { env });
  await command(exe('createdb'), ['--maintenance-db=postgres', target], { env });
  await sql(fixture, `create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema extensions; create schema auth; create table auth.users(id uuid primary key,email text);
    create schema storage; create table storage.objects(id uuid primary key,name text);
    insert into auth.users values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','operator@example.invalid');
    insert into storage.objects values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-logo-metadata-only.png');`);
  const migrationDirectory = join(repository, 'supabase', 'migrations');
  const migrations = (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql')).sort();
  for (const migration of migrations) await sql(fixture, await readFile(join(migrationDirectory, migration), 'utf8'));
  report.migrations = migrations;
  report.tests.allMigrationsApply = true;
  await sql(fixture, "update public.staff_access_approvals set auth_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',password_set_at=now(),setup_completed_at=now() where email='technical@awaldstudio.com';");
  const phaseOne = await readFile(join(repository, 'test', 'phase1-acceptance.sql'), 'utf8');
  await sql(fixture, phaseOne);
  report.tests.phaseOneRollbackAcceptance = true;
  const rollbackAt = phaseOne.toLowerCase().lastIndexOf('rollback;');
  assert.ok(rollbackAt > 0, 'Existing acceptance script must have an explicit rollback.');
  // Persist this synthetic fixture only inside the disposable cluster to exercise data restoration.
  await sql(fixture, phaseOne.slice(0, rollbackAt) + 'commit;');
  await sql(fixture, `
    insert into public.schools(id,slug,name) values('edabcd03-1854-43ca-ac93-45c71e9ef012','synthetic-test-school','Synthetic Test School');
    insert into public.ordering_periods(id,school_id,academic_year_id,name,opens_at,closes_at,status,class_required)
    values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','edabcd03-1854-43ca-ac93-45c71e9ef012','92cd8cf0-5a03-4a48-934a-3d27d1377b9a','Synthetic sandbox fixture',now()-interval '1 day',now()+interval '30 days','open',false);
    insert into public.school_access(school_id,ordering_period_id,token_hash)
    values('edabcd03-1854-43ca-ac93-45c71e9ef012','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',repeat('d',64));
    insert into public.school_grade_offerings(id,school_id,ordering_period_id,grade_id,book_id,price_cents,expected_quantity)
    select gen_random_uuid(),'edabcd03-1854-43ca-ac93-45c71e9ef012','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',grade_id,id,default_price_cents,20
    from public.books where sku in ('815','825');
    do $$ declare result jsonb;again jsonb;kids jsonb;attempt uuid;begin
      select jsonb_agg(jsonb_build_object('first_name','Fictional','last_name','Learner','offering_id',id) order by id) into kids
      from public.school_grade_offerings where school_id='edabcd03-1854-43ca-ac93-45c71e9ef012';
      begin
        perform public.create_sandbox_school_order(repeat('d',64),'sandbox:rejected-fixture',repeat('e',64),'{"first_name":"Fictional","last_name":"Parent","email":"wrong@example.invalid","mobile":"0825550123","consent":{"accepted":true,"policy_version":"2026-10-20"}}',kids);
        raise exception 'Incorrect sandbox recipient accepted';
      exception when sqlstate 'P0001' then if sqlerrm<>'SANDBOX_ORDER_DENIED' then raise;end if;end;
      result:=public.create_sandbox_school_order(repeat('d',64),'sandbox:backup-fixture',repeat('e',64),'{"first_name":"Fictional","last_name":"Parent","email":"technical@awaldstudio.com","mobile":"0825550123","consent":{"accepted":true,"policy_version":"2026-10-20"}}',kids);
      if result->>'reference' not like 'DEMO-BB-%' or result->>'status'<>'pending_payment' or (result->>'amount_cents')::integer<>66000 then raise exception 'Sandbox classification/payment gate failed';end if;
      again:=public.create_sandbox_school_order(repeat('d',64),'sandbox:backup-fixture',repeat('e',64),'{"first_name":"Fictional","last_name":"Parent","email":"technical@awaldstudio.com","mobile":"0825550123","consent":{"accepted":true,"policy_version":"2026-10-20"}}',kids);
      if again->>'id'<>result->>'id' or not (again->>'reused')::boolean then raise exception 'Sandbox duplicate was not reused';end if;
      if has_function_privilege('anon','public.create_sandbox_school_order(text,text,text,jsonb,jsonb)','execute') or has_function_privilege('authenticated','public.create_sandbox_school_order(text,text,text,jsonb,jsonb)','execute') then raise exception 'Sandbox RPC exposed';end if;
      -- Synthetic verified-event fixture, never a genuine provider callback.
      insert into public.payment_attempts(order_id,merchant_payment_id,amount_cents,status,checkout_payload)
      values((result->>'id')::uuid,result->>'reference',66000,'pending','{"mode":"sandbox","qa":"synthetic backup rehearsal"}') returning id into attempt;
      perform public.process_payfast_notification(attempt,repeat('f',64),'synthetic-provider-fixture','COMPLETE','verified','','{"qa":"synthetic backup rehearsal; no provider contacted"}',array['staff@example.invalid']);
    end $$;`);
  report.tests.sandboxWrapperSyntheticClassificationIdempotencyAndRecipientAcceptance = true;
  for (const name of ['shipping-acceptance.sql', 'refund-reconciliation-acceptance.sql']) await sql(fixture, await readFile(join(repository, 'test', name), 'utf8'));
  report.tests.shippingAndRefundRollbackAcceptanceBeforeBackup = true;
  const before = JSON.parse(await sql(fixture, fingerprintSql));
  const backupText = await command(process.execPath, [join(repository, 'scripts', 'backup-db.mjs'), '--output-dir', join(directory, 'encrypted'), '--database', fixture, '--pg-bin', bin, '--local-fixture'], { env });
  const backup = JSON.parse(backupText);
  report.archive = { path: backup.archive, bytes: backup.bytes, sha256: backup.sha256, fixtureKeyRetained: false };
  const restoreArgs = [join(repository, 'scripts', 'restore-db.mjs'), '--archive', backup.archive, '--database', target, '--pg-bin', bin, '--local-fixture', '--acknowledge-disposable-local-target'];
  await assert.rejects(command(process.execPath, restoreArgs, { env: { ...env, BRILJANTE_BACKUP_KEY: randomBytes(32).toString('base64') } }));
  report.tests.wrongKeyRejectedBeforeRestore = true;
  const damaged = join(directory, 'encrypted', 'tampered.bbdump');
  await copyFile(backup.archive, damaged);
  const damagedFile = await open(damaged, 'r+');
  try { const byte = Buffer.alloc(1); await damagedFile.read(byte, 0, 1, backup.bytes - 32); byte[0] ^= 1; await damagedFile.write(byte, 0, 1, backup.bytes - 32); }
  finally { await damagedFile.close(); }
  const damagedArgs = [...restoreArgs]; damagedArgs[damagedArgs.indexOf(backup.archive)] = damaged;
  await assert.rejects(command(process.execPath, damagedArgs, { env }));
  report.tests.tamperedArchiveRejectedBeforeRestore = true;
  assert.equal(await sql(target, "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and c.relkind='r';"), '0');
  report.tests.rejectedArchivesLeftTargetEmpty = true;
  await command(process.execPath, restoreArgs, { env });
  const after = JSON.parse(await sql(target, fingerprintSql));
  assert.deepEqual(after, before);
  report.tests.allTableDataRlsGrantsAndFunctionsMatch = true;
  report.tableCount = Object.keys(after.tables).length;
  report.syntheticCounts = Object.fromEntries(Object.entries(after.tables).map(([name, value]) => [name, value.count]));
  await assert.rejects(command(process.execPath, restoreArgs, { env }));
  report.tests.nonemptyTargetRejected = true;
  for (const name of ['staff-access-acceptance.sql', 'academic-years-acceptance.sql', 'shipping-acceptance.sql', 'refund-reconciliation-acceptance.sql']) await sql(target, await readFile(join(repository, 'test', name), 'utf8'));
  report.tests.restoredStaffAcademicYearShippingAndRefundRollbackAcceptance = true;
  const publicTables = Object.entries(after.tables).filter(([name]) => name.startsWith('public.'));
  assert.ok(publicTables.every(([, value]) => value.rls), 'Every application table must retain RLS.');
  report.tests.everyApplicationTableRetainsRls = true;
  report.fingerprintSha256 = createHash('sha256').update(JSON.stringify(after)).digest('hex');
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.message; process.exitCode = 1;
} finally {
  if (started) {
    await command(exe('pg_ctl'), ['--pgdata', cluster, '--mode', 'fast', '--wait', 'stop'], { ignoreOutput: true });
    report.clusterStopped = true;
  }
  // Only this newly created synthetic cluster may be removed. Binaries/backups are retained.
  const actualCluster = await realpath(cluster);
  const actualDirectory = await realpath(directory);
  const childPath = relative(actualDirectory, actualCluster);
  if (childPath === 'disposable-cluster' && actualCluster.startsWith(actualDirectory + sep)) {
    await rm(actualCluster, { recursive: true }); report.syntheticClusterRemoved = true;
  }
  report.completedAt = new Date().toISOString();
  const reportPath = join(directory, 'rehearsal-result.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...report, reportPath }));
}
