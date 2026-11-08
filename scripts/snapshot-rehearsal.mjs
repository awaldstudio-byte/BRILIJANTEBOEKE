import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {options,repository} from './backup-common.mjs';
import {run,secureOutputDirectory,keypair,snapshotSql,safeRemoveChild} from './snapshot-common.mjs';
const args=options();if(args.help){console.log('node scripts/snapshot-rehearsal.mjs --work-dir NEW_PRIVATE_DIRECTORY --key-dir SEPARATE_PRIVATE_DIRECTORY --pg-bin PG17_BIN');process.exit(0);}
const directory=await secureOutputDirectory(args['work-dir']),keys=await secureOutputDirectory(args['key-dir']);if(directory===keys||!args['pg-bin'])throw Error('Separate private work and key directories and PostgreSQL 17 binaries are required.');
const key=await keypair(keys,{gpg:args.gpg}),cluster=join(directory,'disposable-cluster'),bin=resolve(args['pg-bin']),exe=n=>join(bin,process.platform==='win32'?`${n}.exe`:n);await mkdir(cluster,{mode:0o700});
const socket=createServer();await new Promise((ok,no)=>{socket.once('error',no);socket.listen(0,'127.0.0.1',ok);});const port=socket.address().port;await new Promise(ok=>socket.close(ok));
const env={...process.env,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'postgres',PGDATABASE:'briljante_snapshot_fixture',PGSSLMODE:'disable'};delete env.PGPASSWORD;delete env.PGPASSFILE;delete env.PGSERVICE;
const sql=content=>run(exe('psql'),['--no-psqlrc','--quiet','--tuples-only','--no-align','--set','ON_ERROR_STOP=1','--dbname',env.PGDATABASE],{env,input:content});let started=false;
try{
 await run(exe('initdb'),['--pgdata',cluster,'--username','postgres','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale']);
 await run(exe('pg_ctl'),['--pgdata',cluster,'--log',join(directory,'postgres.log'),'--options',`-h 127.0.0.1 -p ${port} -c shared_buffers=32MB -c max_connections=10 -c log_min_error_statement=panic`,'--wait','start'],{ignoreOutput:true});started=true;
 await run(exe('createdb'),['--maintenance-db=postgres',env.PGDATABASE],{env});
 await sql(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema extensions;create schema auth;create table auth.users(id uuid primary key,email text,huge_integer numeric,metadata jsonb);create schema storage;create table storage.objects(id uuid primary key,name text);create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text);
 insert into auth.users values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','operator@example.invalid',900719925474099313131,'{"example":"XML & <tag> \\"quotes\\""}');insert into storage.objects values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic metadata only');`);
 const migrations=(await readdir(join(repository,'supabase','migrations'))).filter(n=>n.endsWith('.sql')&&n.slice(0,14)<='20261027112816').sort();
 for(const file of migrations){await sql(await readFile(join(repository,'supabase','migrations',file),'utf8'));await sql(`insert into supabase_migrations.schema_migrations values('${file.slice(0,14)}','${file.slice(15).replaceAll("'","''")}');`);}
 const acceptance=await readFile(join(repository,'test','phase1-acceptance.sql'),'utf8'),end=acceptance.toLowerCase().lastIndexOf('rollback;');if(end<0)throw Error('Unexpected fixture acceptance source.');await sql(acceptance.slice(0,end)+'commit;');
 const csv=await run(exe('psql'),['--no-psqlrc','--quiet','--csv','--set','ON_ERROR_STOP=1','--dbname',env.PGDATABASE],{env,input:snapshotSql(key.publicKey)});
 await writeFile(join(directory,'synthetic-encrypted-export.csv'),csv,{flag:'wx',mode:0o600});
}finally{if(started)await run(exe('pg_ctl'),['--pgdata',cluster,'--mode','fast','--wait','stop']);await safeRemoveChild(directory,cluster);}
const result=await run(process.execPath,[join(repository,'scripts','verify-hosted-snapshot.mjs'),'--input',join(directory,'synthetic-encrypted-export.csv'),'--key-file',key.keyPath,'--work-dir',join(directory,'recovery'),'--pg-bin',bin,'--synthetic']);console.log(result.toString().trim());
