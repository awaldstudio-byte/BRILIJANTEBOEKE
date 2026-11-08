import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {options,repository} from './backup-common.mjs';
import {projectRef,secureOutputDirectory,decryptSnapshot,run,hash,qi,qs,safeRemoveChild} from './snapshot-common.mjs';

export function readCsv(text){
 const rows=[];let row=[],value='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){value+='"';i++;}else if(c==='"')quoted=false;else value+=c;}
  else if(c==='"'){if(value)throw Error('Malformed encrypted CSV.');quoted=true;}
  else if(c===','){row.push(value);value='';}
  else if(c==='\n'){row.push(value);if(row.some(v=>v.length))rows.push(row);row=[];value='';}
  else if(c!=='\r')value+=c;
 }
 if(quoted)throw Error('Truncated encrypted CSV.');row.push(value);if(row.some(v=>v.length))rows.push(row);
 const header=rows.shift()?.map((v,i)=>i===0?v.replace(/^\uFEFF/,''):v);
 if(!header||header.join(',')!=='part_no,total_parts,encrypted_sha256,encrypted_chunk')throw Error('Unexpected encrypted snapshot columns.');
 const parts=rows.map(r=>({part:Number(r[0]),total:Number(r[1]),sha:r[2],chunk:r[3]})).sort((a,b)=>a.part-b.part);
 const total=parts[0]?.total,sha=parts[0]?.sha;
 if(!Number.isSafeInteger(total)||total<1||total>20000||parts.length!==total||!/^[a-f0-9]{64}$/.test(sha||''))throw Error('Encrypted snapshot export is incomplete.');
 if(parts.some((r,i)=>r.part!==i+1||r.total!==total||r.sha!==sha||!/^[A-Za-z0-9+/=]+$/.test(r.chunk||'')))throw Error('Encrypted snapshot parts differ or are missing.');
 const cipher=Buffer.from(parts.map(r=>r.chunk).join(''),'base64');if(hash(cipher)!==sha)throw Error('Encrypted snapshot checksum does not match.');return cipher;
}

async function verify(){
 const args=options();if(args.help){console.log('node scripts/verify-hosted-snapshot.mjs --input ENCRYPTED_CSV --key-file DPAPI_KEY --work-dir NEW_PRIVATE_DIRECTORY --pg-bin PG17_DIRECTORY');return;}
 const directory=await secureOutputDirectory(args['work-dir']),key=resolve(args['key-file']||'');
 if(!args.input||!args['key-file']||!args['pg-bin'])throw Error('Input, owner-protected key file, private work directory and PostgreSQL 17 binaries are required.');
 const cipher=readCsv(await readFile(resolve(args.input),'utf8'));
 await writeFile(join(directory,'hosted-data-snapshot.pgp'),cipher,{flag:'wx',mode:0o600});
 const plaintext=await decryptSnapshot(directory,key,cipher,{gpg:args.gpg});let snapshot;
 try{snapshot=JSON.parse(plaintext.toString('utf8'));}catch{throw Error('Decrypted snapshot is not valid JSON.');}
 assert.equal(snapshot.format,'briljante-encrypted-data-snapshot');assert.equal(snapshot.version,1);assert.equal(snapshot.project_ref,projectRef);
 if(!Array.isArray(snapshot.tables)||!snapshot.tables.length||snapshot.tables.length>500)throw Error('Unexpected snapshot table inventory.');
 const seen=new Set();for(const t of snapshot.tables){if(!['public','auth','storage','supabase_migrations'].includes(t.schema)||!/^\w+$/.test(t.name)||seen.has(t.schema+'.'+t.name)||!Array.isArray(t.rows)||t.rows.length!==t.row_count||!/^[a-f0-9]{64}$/.test(t.rows_sha256))throw Error('Snapshot table metadata is invalid.');seen.add(t.schema+'.'+t.name);}
 const report={projectRef,startedAt:new Date().toISOString(),capturedAt:snapshot.captured_at,mode:'hosted-encrypted-data-snapshot-local-recovery',encryptedSha256:hash(cipher),decryptedPayloadSha256:hash(plaintext),realClientDataUsed:!args['synthetic'],providerOrMailUsed:false,limits:['Not pg_dump; not a full managed Supabase service restore.','Storage rows are metadata; Storage file bytes require separate recovery.','Windows DPAPI key requires the current Windows identity/machine; independent recovery key copy remains an operational action.'],tests:{}};
 const bin=resolve(args['pg-bin']),exe=n=>join(bin,process.platform==='win32'?`${n}.exe`:n),cluster=join(directory,'disposable-cluster');await mkdir(cluster,{mode:0o700});
 const socket=createServer();await new Promise((ok,no)=>{socket.once('error',no);socket.listen(0,'127.0.0.1',ok);});const port=socket.address().port;await new Promise(ok=>socket.close(ok));
 const env={...process.env,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'postgres',PGDATABASE:'briljante_restore_hosted_snapshot',PGSSLMODE:'disable'};delete env.PGPASSWORD;delete env.PGPASSFILE;delete env.PGSERVICE;
 const sql=content=>run(exe('psql'),['--no-psqlrc','--quiet','--tuples-only','--no-align','--set','ON_ERROR_STOP=1','--dbname',env.PGDATABASE],{env,input:content});let started=false;
 try{
  report.postgresql=(await run(exe('pg_dump'),['--version'])).toString().trim();if(!/PostgreSQL\) 17\./.test(report.postgresql))throw Error('Use PostgreSQL 17 binaries.');
  await run(exe('initdb'),['--pgdata',cluster,'--username','postgres','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale']);
  await run(exe('pg_ctl'),['--pgdata',cluster,'--log',join(directory,'postgres.log'),'--options',`-h 127.0.0.1 -p ${port} -c shared_buffers=32MB -c max_connections=10 -c log_statement=none -c log_min_error_statement=panic`,'--wait','start'],{ignoreOutput:true});started=true;
  await run(exe('createdb'),['--maintenance-db=postgres',env.PGDATABASE],{env});
  await sql(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema extensions;create extension pgcrypto with schema extensions;create schema auth;create table auth.users(id uuid primary key,email text);create schema storage;`);
  const available=(await readdir(join(repository,'supabase','migrations'))).filter(n=>n.endsWith('.sql')).sort();
  const migrationRows=snapshot.tables.find(t=>t.schema==='supabase_migrations'&&t.name==='schema_migrations')?.rows;
  let versions;
  if(Array.isArray(migrationRows)&&migrationRows.length){versions=migrationRows.map(r=>String(r.version));report.migrationSource='exported hosted migration history';}
  else{const through=args['through-migration'];if(!/^\d{14}$/.test(through||''))throw Error('Hosted migration history is absent. Explicitly identify the known pre-migration source with --through-migration; table-column parity will still be checked.');versions=available.filter(n=>n.slice(0,14)<=through).map(n=>n.slice(0,14));report.migrationSource='explicit source boundary; hosted table columns checked independently';}
  if(versions.some(v=>!/^\d{14}$/.test(v)))throw Error('Unknown migration version format.');
  for(const version of [...versions].sort()){const file=available.find(n=>n.startsWith(version+'_'));if(!file)throw Error('Hosted migration source is missing locally.');await sql(await readFile(join(repository,'supabase','migrations',file),'utf8'));}
  report.migrationVersions=[...versions].sort();report.tests.knownApplicationMigrationsRebuilt=true;
  // Keep exact raw JSON bytes through this boundary. Parsing/restringifying row
  // values in JavaScript could round large PostgreSQL integers.
  await sql(`set timezone=${qs(snapshot.timezone)};create schema backup_archive;create table backup_archive.document(data jsonb not null);insert into backup_archive.document select convert_from(decode('${plaintext.toString('hex')}','hex'),'UTF8')::jsonb;`);
  const archiveHashes=JSON.parse((await sql(`select jsonb_object_agg(t->>'schema'||'.'||(t->>'name'),jsonb_build_object('count',jsonb_array_length(t->'rows'),'sha256',encode(extensions.digest((t->'rows')::text,'sha256'),'hex'))) from backup_archive.document d cross join lateral jsonb_array_elements(d.data->'tables') t;`)).toString());
  for(const t of snapshot.tables){assert.equal(archiveHashes[t.schema+'.'+t.name].count,t.row_count);assert.equal(archiveHashes[t.schema+'.'+t.name].sha256,t.rows_sha256);}
  report.tests.allSchemaDataRecoveredInArchive=true;report.tableCount=snapshot.tables.length;
  const publics=snapshot.tables.filter(t=>t.schema==='public'),names=publics.map(t=>qi('public')+'.'+qi(t.name));
  const localColumns=JSON.parse((await sql(`select jsonb_object_agg(relname,cols) from (select c.relname,jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'generated',a.attgenerated) order by a.attnum) cols from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped group by c.relname) x;`)).toString());
  assert.deepEqual(Object.keys(localColumns).sort(),publics.map(t=>t.name).sort());
  for(const t of publics)assert.deepEqual(localColumns[t.name],t.columns.map(c=>({name:c.name,type:c.type,generated:c.generated})));
  report.tests.applicationTableColumnsMatchHosted=true;
  const fks=JSON.parse((await sql(`select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid,true)) order by c.relname,k.conname),'[]') from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and k.contype='f';`)).toString());
  let restore=`begin;set local timezone=${qs(snapshot.timezone)};`;
  for(const f of fks)restore+=`alter table public.${qi(f.table)} drop constraint ${qi(f.name)};`;
  restore+=`truncate ${names.join(',')} restart identity cascade;insert into auth.users(id,email) select (u->>'id')::uuid,u->>'email' from backup_archive.document d cross join lateral jsonb_array_elements(d.data->'tables') t cross join lateral jsonb_array_elements(t->'rows') u where t->>'schema'='auth' and t->>'name'='users';set local session_replication_role=replica;`;
  for(const t of publics){const cols=t.columns.filter(c=>!c.generated).map(c=>qi(c.name)).join(',');restore+=`insert into public.${qi(t.name)}(${cols}) overriding system value select ${cols} from backup_archive.document d cross join lateral jsonb_array_elements(d.data->'tables') t cross join lateral jsonb_populate_recordset(null::public.${qi(t.name)},t->'rows') r where t->>'schema'='public' and t->>'name'=${qs(t.name)};`;}
  restore+='set local session_replication_role=origin;';for(const f of fks)restore+=`alter table public.${qi(f.table)} add constraint ${qi(f.name)} ${f.definition};`;restore+='commit;';await sql(restore);
  report.tests.allApplicationForeignKeysValidated=true;
  const actual={};for(const t of publics){actual[t.name]=JSON.parse((await sql(`set timezone=${qs(snapshot.timezone)};select jsonb_build_object('count',count(*),'sha256',encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'sha256'),'hex')) from public.${qi(t.name)} t;`)).toString());assert.equal(actual[t.name].count,t.row_count);assert.equal(actual[t.name].sha256,t.rows_sha256);}
  report.tests.allApplicationTableDataMatchesHosted=true;report.applicationTableCount=publics.length;
  report.schemaMetadataSha256=(await sql(`select encode(extensions.digest(((data - 'tables' - 'captured_at' - 'transaction_snapshot')||jsonb_build_object('tables',(select jsonb_agg(t-'rows'-'row_count'-'rows_sha256' order by t->>'schema',t->>'name') from jsonb_array_elements(data->'tables') t)))::text,'sha256'),'hex') from backup_archive.document;`)).toString().trim();
  report.tables=snapshot.tables.map(t=>({schema:t.schema,name:t.name,rowCount:t.row_count,sha256:t.rows_sha256}));
  const tampered=Buffer.from(cipher);tampered[Math.floor(tampered.length/2)]^=1;let denied=false;try{await decryptSnapshot(directory,key,tampered,{gpg:args.gpg});}catch{denied=true;}assert.equal(denied,true);report.tests.tamperedCiphertextRejected=true;
  report.passed=true;
 }finally{
  plaintext.fill(0);snapshot=null;
  if(started){await run(exe('pg_ctl'),['--pgdata',cluster,'--mode','fast','--wait','stop']);report.localClusterStopped=true;}
  await safeRemoveChild(directory,cluster);report.localPlaintextClusterRemoved=true;report.completedAt=new Date().toISOString();
  await writeFile(join(directory,'recovery-result.json'),JSON.stringify(report,null,2),{mode:0o600});
 }
 console.log(JSON.stringify({passed:report.passed,tableCount:report.tableCount,applicationTableCount:report.applicationTableCount,tests:report.tests,reportPath:join(directory,'recovery-result.json')}));
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')))await verify();
