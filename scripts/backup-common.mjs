import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finished, pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

export const projectRef = 'cigyxjfzbjlgbrduzcpw';
export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const magic = Buffer.from('BBDBAK1\n');

export function options(argv = process.argv.slice(2)) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error('Use named options only.');
    const name = argv[i].slice(2);
    if (Object.hasOwn(result, name)) throw new Error('Duplicate option.');
    result[name] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return result;
}

export function keyFromEnvironment(env = process.env) {
  const encoded = env.BRILJANTE_BACKUP_KEY || '';
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('BRILJANTE_BACKUP_KEY must contain exactly 32 random bytes encoded as base64. Never put it in arguments or Git.');
  }
  return key;
}

export function command(executable, args, { env = process.env, input, ignoreOutput = false } = {}) {
  const child = spawn(executable, args, { env, windowsHide: true, stdio: ['pipe', ignoreOutput ? 'ignore' : 'pipe', ignoreOutput ? 'ignore' : 'pipe'] });
  let output = '', diagnostic = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', part => { if (output.length < 1_000_000) output += part; });
  child.stderr?.on('data', part => { if (diagnostic.length < 8192) diagnostic += part; });
  child.stdin.on('error', () => {});
  if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  return new Promise((resolveResult, reject) => {
    child.on('error', () => reject(new Error(`${executable} could not be started. Check the documented runtime prerequisites.`)));
    child.on('close', code => {
      if (code !== 0) reject(new Error(`${executable} failed (${code}). No database output or connection details were logged.`));
      else resolveResult(output.trim());
    });
  });
}

export async function secureOutputDirectory(value) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Output directory must be an absolute path outside this repository.');
  const path = resolve(value);
  const assertOutside = candidate => {
    const part = relative(repository, candidate);
    if (!part || (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part))) throw new Error('Backups must remain outside the repository and public output.');
  };
  assertOutside(path);
  const marker = join(path, '.briljante-private-backup');
  const existing = await stat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing) {
    if (!existing.isDirectory()) throw new Error('Backup output must be a directory.');
    await stat(marker).catch(() => { throw new Error('Use a new private directory or an existing directory created by these backup tools.'); });
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  assertOutside(await realpath(path));
  if (process.platform === 'win32') {
    const identity = await command('whoami', []);
    await command('icacls', [path, '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)F`]);
  }
  if (!existing) await writeFile(marker, 'Briljante private encrypted backup directory\n', { flag: 'wx', mode: 0o600 });
  return path;
}

export async function validateContainer(name) {
  if (!/^briljante-backup-rehearsal-[a-z0-9-]+$/.test(name)) throw new Error('Only a named Briljante disposable rehearsal container is allowed.');
  const data = JSON.parse(await command('docker', ['inspect', '--format', '{{json .HostConfig}}', name]));
  const label = await command('docker', ['inspect', '--format', '{{index .Config.Labels "com.awaldstudio.briljante.backup-rehearsal"}}', name]);
  if (label !== '1' || data.NetworkMode !== 'none' || Object.keys(data.PortBindings || {}).length) throw new Error('Rehearsal container must have the expected label, no network and no published ports.');
}

export async function databaseTools(args, { restoring = false } = {}) {
  const database = args.database || process.env.PGDATABASE;
  if (typeof database !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(database)) throw new Error('A simple explicit database name is required.');
  if (restoring && (!args['acknowledge-disposable-local-target'] || !/^briljante_restore_[a-z0-9_]+$/.test(database))) {
    throw new Error('Restore requires a disposable briljante_restore_* database and --acknowledge-disposable-local-target.');
  }
  if (args.container) {
    await validateContainer(args.container);
    return { database, endpoint: 'isolated-docker-fixture', call: (tool, extra = []) => ['docker', ['exec', '-i', args.container, tool, '-U', 'postgres', ...extra]], env: process.env };
  }
  const host = process.env.PGHOST || '';
  const local = ['127.0.0.1', '::1', 'localhost'].includes(host);
  if (restoring && !local) throw new Error('This rehearsal restore tool refuses every remote host.');
  if (!local) {
    const direct = host === `db.${projectRef}.supabase.co`;
    const pooler = /^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) && process.env.PGUSER === `postgres.${projectRef}`;
    if ((!direct && !pooler) || process.env.BRILJANTE_BACKUP_PROJECT_REF !== projectRef) throw new Error('Remote backup must explicitly identify the dedicated Briljante project.');
    if (process.env.PGSSLMODE !== 'verify-full' || !process.env.PGSSLROOTCERT || !process.env.PGPASSFILE || process.env.PGPASSWORD) {
      throw new Error('Remote backup requires verify-full TLS, PGSSLROOTCERT and private PGPASSFILE; do not supply PGPASSWORD.');
    }
    await stat(process.env.PGSSLROOTCERT); await stat(process.env.PGPASSFILE);
  } else if (!args['local-fixture']) throw new Error('Local backup/restore requires --local-fixture.');
  const env = { ...process.env, PGDATABASE: database, PGAPPNAME: 'briljante-backup-rehearsal', PGCONNECT_TIMEOUT: '15' };
  return { database, endpoint: local ? 'loopback-fixture' : 'dedicated-supabase', call: (tool, extra = []) => [args['pg-bin'] ? resolve(args['pg-bin'], process.platform === 'win32' ? `${tool}.exe` : tool) : tool, extra], env };
}

export function spawnDatabase(tools, tool, extra) {
  const [program, arguments_] = tools.call(tool, extra);
  const child = spawn(program, arguments_, { env: tools.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const done = new Promise((resolveDone, reject) => {
    child.on('error', () => reject(new Error(`${tool} could not start.`)));
    child.on('close', code => code === 0 ? resolveDone() : reject(new Error(`${tool} failed (${code}); raw diagnostics were suppressed.`)));
  });
  return { child, done };
}

export async function encryptDump(tools, path, key, metadata) {
  const iv = randomBytes(12);
  const header = Buffer.from(JSON.stringify({ version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), ...metadata }));
  const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(header);
  const temporary = `${path}.part`;
  const out = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
  const { child, done } = spawnDatabase(tools, 'pg_dump', ['--format=custom', '--no-owner', '--dbname', tools.database]);
  child.stdin.end();
  try {
    out.write(magic); out.write(length); out.write(header);
    await Promise.all([pipeline(child.stdout, cipher, out, { end: false }), done]);
    out.end(cipher.getAuthTag()); await finished(out);
  } catch (error) {
    child.kill(); out.destroy(); await unlink(temporary).catch(() => {}); throw error;
  }
  return temporary;
}

export async function readEncryptedArchive(path, key) {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const prefix = Buffer.alloc(magic.length + 4); await handle.read(prefix, 0, prefix.length, 0);
    if (!prefix.subarray(0, magic.length).equals(magic)) throw new Error('Unrecognised encrypted backup.');
    const length = prefix.readUInt32BE(magic.length);
    if (length < 32 || length > 16384 || size <= prefix.length + length + 16) throw new Error('Invalid encrypted backup framing.');
    const header = Buffer.alloc(length); await handle.read(header, 0, length, prefix.length);
    const details = JSON.parse(header.toString('utf8'));
    if (details.version !== 1 || details.algorithm !== 'aes-256-gcm') throw new Error('Unsupported backup format.');
    const tag = Buffer.alloc(16); await handle.read(tag, 0, 16, size - 16);
    const dataStart = prefix.length + length, dataEnd = size - 17;
    const decrypt = () => {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(details.iv, 'base64'));
      decipher.setAAD(header); decipher.setAuthTag(tag);
      return { input: createReadStream(path, { start: dataStart, end: dataEnd }), decipher };
    };
    // Authenticate the entire archive before pg_restore may make any writes.
    const first = decrypt();
    await pipeline(first.input, first.decipher, new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
    return { details, decrypt };
  } finally { await handle.close(); }
}
