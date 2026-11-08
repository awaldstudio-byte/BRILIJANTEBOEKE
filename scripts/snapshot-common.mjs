import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import {readFile,writeFile,mkdir,rm,realpath} from 'node:fs/promises';
import {join,resolve,relative,sep,isAbsolute} from 'node:path';
import {command,secureOutputDirectory,projectRef} from './backup-common.mjs';

export {projectRef,secureOutputDirectory};
export const gpgDefault='C:\\Program Files\\Git\\usr\\bin\\gpg.exe';
const gpgHome=(home,gpg)=>process.platform==='win32'&&/[/\\]Git[/\\]/i.test(gpg)?home.replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase()).replaceAll('\\','/'):home;
export function run(executable,args,{input,env=process.env,max=256*1024*1024,ignoreOutput=false}={}){
 return new Promise((resolveResult,reject)=>{
  const p=spawn(executable,args,{env,windowsHide:true,stdio:['pipe',ignoreOutput?'ignore':'pipe',ignoreOutput?'ignore':'pipe']});let size=0,parts=[];
  p.stdout?.on('data',part=>{size+=part.length;if(size>max){p.kill();reject(Error('Snapshot command output exceeds the safe limit.'));}else parts.push(part);});
  // Diagnostics can contain SQL/data; intentionally never collect or print them.
  p.stderr?.on('data',()=>{});p.stdin.on('error',()=>{});p.on('error',()=>reject(Error('Snapshot runtime could not be started.')));
  p.on('close',code=>code===0?resolveResult(Buffer.concat(parts)):reject(Error(`Snapshot command failed (${code}); no data or connection details were logged.`)));
  p.stdin.end(input);
 });
}
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const qi=value=>'"'+String(value).replaceAll('"','""')+'"';
export const qs=value=>"'"+String(value).replaceAll("'","''")+"'";
export async function safeRemoveChild(parent,child){
 const base=await realpath(parent),target=await realpath(child);const r=relative(base,target);
 if(!r||r.startsWith(`..${sep}`)||isAbsolute(r)||(!['key-work','recovery-key-work','disposable-cluster'].includes(r)&&!/^bbkey-[a-f0-9]{12}$/.test(r)))throw Error('Refusing cleanup outside the named private work directory.');
 await rm(target,{recursive:true,force:false});
}
export async function protectKey(secret,path){
 if(process.platform!=='win32')throw Error('This owner-bound recovery key helper requires Windows DPAPI.');
 const script="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $s=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $p=[Security.Cryptography.ProtectedData]::Protect($s,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [IO.File]::WriteAllBytes($env:BRILJANTE_SNAPSHOT_KEY_FILE,$p)";
 await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:secret.toString('base64'),env:{...process.env,BRILJANTE_SNAPSHOT_KEY_FILE:path}});
}
export async function unprotectKey(path){
 const script="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $p=[IO.File]::ReadAllBytes($env:BRILJANTE_SNAPSHOT_KEY_FILE); $s=[Security.Cryptography.ProtectedData]::Unprotect($p,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($s))";
 const data=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,BRILJANTE_SNAPSHOT_KEY_FILE:path}});return Buffer.from(data.toString(),'base64');
}
export async function keypair(directory,{gpg=gpgDefault}={}){
 // Git's MSYS GnuPG uses Unix sockets with a short path limit. Keep its
 // disposable keyring short and owner-only; the retained key is DPAPI wrapped.
 const keyBase=await secureOutputDirectory(join(homedir(),'.codex-private','bbkey-'+randomBytes(6).toString('hex')));
 const home=join(keyBase,'key-work'),toolHome=gpgHome(home,gpg);await mkdir(home,{mode:0o700});
 try{
  const args=['--homedir',toolHome,'--batch','--pinentry-mode','loopback','--passphrase',''];
  await run(gpg,[...args,'--quick-generate-key','Briljante encrypted data recovery <backup@awaldstudio.invalid>','rsa3072','cert','0']);
  const listing=(await run(gpg,['--homedir',toolHome,'--batch','--with-colons','--list-secret-keys'])).toString();
  const fingerprint=listing.split('\n').find(line=>line.startsWith('fpr:'))?.split(':')[9];if(!/^[A-F0-9]{40}$/.test(fingerprint||''))throw Error('Snapshot public-key identity could not be verified.');
  await run(gpg,[...args,'--quick-add-key',fingerprint,'rsa3072','encr','0']);
  const publicKey=await run(gpg,['--homedir',toolHome,'--batch','--armor','--export',fingerprint]);
  const secret=await run(gpg,[...args,'--export-secret-keys',fingerprint]);
  const keyPath=join(directory,'recovery-private-key.dpapi');await protectKey(secret,keyPath);secret.fill(0);
  await writeFile(join(directory,'recovery-public-key.asc'),publicKey,{flag:'wx',mode:0o600});
  return {publicKey:publicKey.toString(),fingerprint,keyPath};
 }finally{
  await run(gpg.replace(/gpg\.exe$/i,'gpgconf.exe'),['--homedir',toolHome,'--kill','all']).catch(()=>{});
  await safeRemoveChild(keyBase,home);await safeRemoveChild(join(homedir(),'.codex-private'),keyBase);
 }
}
export async function decryptSnapshot(directory,keyPath,ciphertext,{gpg=gpgDefault}={}){
 const keyBase=await secureOutputDirectory(join(homedir(),'.codex-private','bbkey-'+randomBytes(6).toString('hex')));
 const home=join(keyBase,'recovery-key-work'),toolHome=gpgHome(home,gpg);await mkdir(home,{mode:0o700});let secret;
 try{secret=await unprotectKey(keyPath);await run(gpg,['--homedir',toolHome,'--batch','--import'],{input:secret});secret.fill(0);return await run(gpg,['--homedir',toolHome,'--batch','--pinentry-mode','loopback','--passphrase','','--decrypt'],{input:ciphertext});}
 finally{secret?.fill(0);await run(gpg.replace(/gpg\.exe$/i,'gpgconf.exe'),['--homedir',toolHome,'--kill','all']).catch(()=>{});await safeRemoveChild(keyBase,home);await safeRemoveChild(join(homedir(),'.codex-private'),keyBase);}
}

// No persistent function, file access or writes occur in this export. The only
// key sent to the database is the public encryption key. XMLTABLE decodes JSON
// text without corrupting XML entities. All dynamic identifiers are catalogued
// and quoted by PostgreSQL, rather than taken from a request or row value.
export function snapshotSql(publicKey){
 if(!publicKey.startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----')||publicKey.includes('$briljante_public_key$'))throw Error('Invalid snapshot public key.');
 return `with relations as materialized (
 select c.oid,n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,coalesce(c.relacl::text,'') as acl,c.relkind,c.relispartition,
  pg_get_userbyid(c.relowner) as owner
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where (n.nspname in ('public','auth','storage') or (n.nspname='supabase_migrations' and c.relname='schema_migrations')) and c.relkind in ('r','p') and not c.relispartition
), tables as materialized (
 select r.*,x.data::jsonb as rows,
 (select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum),'[]') from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=r.oid and a.attnum>0 and not a.attisdropped) as columns,
 (select coalesce(jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid,true)) order by c.conname),'[]') from pg_constraint c where c.conrelid=r.oid) as constraints,
 (select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_indexdef(i.indexrelid)) order by c.relname),'[]') from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid=r.oid) as indexes,
 (select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled) order by t.tgname),'[]') from pg_trigger t where t.tgrelid=r.oid and not t.tgisinternal) as triggers,
 (select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') from pg_policies p where p.schemaname=r.schema_name and p.tablename=r.table_name) as policies
 from relations r cross join lateral xmltable('/table/row' passing query_to_xml(format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) as data from %I.%I t',r.schema_name,r.table_name),false,false,'') columns data text path 'data') x
), document as materialized (
 select jsonb_build_object('format','briljante-encrypted-data-snapshot','version',1,'project_ref','${projectRef}','captured_at',statement_timestamp(),'server_version',current_setting('server_version'),'timezone',current_setting('TimeZone'),'transaction_snapshot',pg_current_snapshot()::text,
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('schema',schema_name,'name',table_name,'owner',owner,'rls',rls,'force_rls',force_rls,'acl',acl,'kind',relkind,'columns',columns,'constraints',constraints,'indexes',indexes,'triggers',triggers,'policies',policies,'row_count',jsonb_array_length(rows),'rows_sha256',encode(extensions.digest(rows::text,'sha256'),'hex'),'rows',rows) order by schema_name,table_name),'[]') from tables),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',coalesce(p.proacl::text,'')) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','storage') and p.prokind in ('f','p') and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')),
 'views',(select coalesce(jsonb_agg(to_jsonb(v) order by v.schemaname,v.viewname),'[]') from pg_views v where v.schemaname in ('public','auth','storage')),
 'enums',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,'labels',(select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid)) order by n.nspname,t.typname),'[]') from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','auth','storage') and t.typtype='e'),
 'sequences',(select coalesce(jsonb_agg(to_jsonb(s) order by s.schemaname,s.sequencename),'[]') from pg_sequences s where s.schemaname in ('public','auth','storage')),
 'extensions',(select coalesce(jsonb_agg(jsonb_build_object('name',extname,'version',extversion) order by extname),'[]') from pg_extension)) as payload
), encrypted as materialized (
 select extensions.pgp_pub_encrypt(payload::text,extensions.dearmor($briljante_public_key$${publicKey}$briljante_public_key$),'cipher-algo=aes256,compress-algo=1') as bytes from document
), encoded as materialized (
 select replace(encode(bytes,'base64'),E'\\n','') as content,encode(extensions.digest(bytes,'sha256'),'hex') as encrypted_sha256 from encrypted
)
select part as part_no,ceil(length(content)/6000.0)::integer as total_parts,encrypted_sha256,substring(content from (part-1)*6000+1 for 6000) as encrypted_chunk from encoded cross join lateral generate_series(1,ceil(length(content)/6000.0)::integer) part order by part;\n`;
}
export const inventorySql=`select n.nspname as schema_name,count(*) as table_count,sum(pg_total_relation_size(c.oid)) as bytes from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage','supabase_migrations') and c.relkind in ('r','p') and not c.relispartition group by n.nspname order by n.nspname;\n`;
