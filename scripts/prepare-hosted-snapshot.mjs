import {writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {options} from './backup-common.mjs';
import {secureOutputDirectory,keypair,snapshotSql,inventorySql} from './snapshot-common.mjs';
const args=options();
if(args.help){console.log('node scripts/prepare-hosted-snapshot.mjs --output-dir ABSOLUTE_PRIVATE_DIRECTORY --key-dir SEPARATE_ABSOLUTE_PRIVATE_DIRECTORY');process.exit(0);}
const directory=await secureOutputDirectory(args['output-dir']),keys=await secureOutputDirectory(args['key-dir']);
if(resolve(directory)===resolve(keys))throw Error('Keep the owner-protected recovery key in a separate directory from the snapshot.');
const key=await keypair(keys,{gpg:args.gpg});
const query=join(directory,'encrypted-export.sql');
await writeFile(query,snapshotSql(key.publicKey),{flag:'wx',mode:0o600});
await writeFile(join(directory,'inventory.sql'),inventorySql,{flag:'wx',mode:0o600});
await writeFile(join(directory,'preparation.json'),JSON.stringify({projectRef:'cigyxjfzbjlgbrduzcpw',preparedAt:new Date().toISOString(),publicKeyFingerprint:key.fingerprint,keyProtection:'Windows DPAPI CurrentUser; requires this Windows identity and machine; independent key recovery still required',keyFile:key.keyPath,exportFormat:'Encrypted JSON data and schema metadata; not pg_dump or full managed-service recovery'},null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({prepared:true,query,keyFile:key.keyPath,publicKeyFingerprint:key.fingerprint,warning:'Inspect inventory before export. SQL is read-only; only the public key is sent to the database.'}));
