import {spawn} from 'node:child_process';
import {lstat,readFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';

// Run only after the account owner's merchant details have been supplied through
// the private staging path. No credential is accepted on a command line.
const project='prj_nxGKfknjzuyslJKwzjfIVvM8CfSa';
const input='C:\\Users\\natha\\.codex-private\\briljante-release-20261105\\merchant-input.json';
const names=['PAYFAST_MERCHANT_ID','PAYFAST_MERCHANT_KEY','PAYFAST_PASSPHRASE'];
const cli=process.env.BRILJANTE_VERCEL_CLI;
async function api(endpoint,method='GET',body){
  if(!cli||!cli.endsWith('vc.js'))throw new Error('CLI_REQUIRED');
  const args=[resolve(cli),'api',endpoint,'--scope','awaldstudio','--raw','--method',method];
  if(body!==undefined)args.push('--input','-');
  return new Promise((accept,reject)=>{
    const child=spawn(process.execPath,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',stderr='',oversized=false;
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2_000_000){oversized=true;child.kill();}});
    child.stderr.on('data',chunk=>{if(stderr.length<100000)stderr+=chunk;});
    child.on('error',()=>reject(new Error('API_PROCESS_FAILED')));
    child.on('close',code=>{if(code||oversized){
      let apiCode='',message='';
      try{const parsed=JSON.parse(output);apiCode=parsed.error?.code||parsed.code||'';message=parsed.error?.message||parsed.message||'';}catch{message=stderr.split('\n').filter(line=>/Error:/i.test(line)).at(-1)||'';}
      for(const value of Object.values(credentials||{}))if(typeof value==='string'&&value)message=message.split(value).join('[redacted]');
      const failure=new Error('API_REQUEST_FAILED');
      failure.safeDetails={apiCode:/^[a-zA-Z0-9_-]{1,80}$/.test(apiCode)?apiCode:undefined,message:message.replace(/\x1b\[[0-9;]*m/g,'').slice(0,500)};
      return reject(failure);
    }try{accept(JSON.parse(output));}catch{reject(new Error('API_RESPONSE_INVALID'));}});
    child.stdin.end(body===undefined?'':JSON.stringify(body));
  });
}
let credentials,stage='input-file';
try{
  if(process.argv.length!==2)throw new Error('NO_ARGUMENTS_ALLOWED');
  const file=await lstat(input);
  if(!file.isFile()||file.isSymbolicLink()||file.size>4096)throw new Error('INPUT_REQUIRES_REVIEW');
  stage='input-parse';credentials=JSON.parse(await readFile(input,'utf8'));
  stage='input-fields';
  if(!credentials||Object.keys(credentials).sort().join(',')!==[...names].sort().join(',')||names.some(key=>typeof credentials[key]!=='string'||!credentials[key]||credentials[key]!==credentials[key].trim()||credentials[key].length>256))throw new Error('INPUT_REQUIRES_REVIEW');
  stage='merchant-format';if(!/^\d{5,12}$/.test(credentials.PAYFAST_MERCHANT_ID)||['10000100','10004002'].includes(credentials.PAYFAST_MERCHANT_ID)||!/^[a-z\d]{6,100}$/i.test(credentials.PAYFAST_MERCHANT_KEY))throw new Error('INPUT_REQUIRES_REVIEW');
  stage='project-read';const current=await api(`/v9/projects/${project}`);
  if(current.id!==project||current.name!=='brilijanteboeke'||current.autoExposeSystemEnvs!==true)throw new Error('PROJECT_REQUIRES_REVIEW');
  stage='conflict-check';const production=(current.env||[]).filter(env=>env.target?.includes('production'));
  if(production.some(env=>[...names,'PAYFAST_MODE','PAYFAST_LIVE_ENABLED'].includes(env.key)))throw new Error('EXISTING_CONFIGURATION_PRESERVED');
  for(const key of names){stage=`merchant-save-${key}`;await api(`/v10/projects/${project}/env`,'POST',{key,value:credentials[key],type:'sensitive',target:['production']});}
  stage='mode-save';await api(`/v10/projects/${project}/env`,'POST',{key:'PAYFAST_MODE',value:'live',type:'encrypted',target:['production']});
  stage='live-disabled-save';await api(`/v10/projects/${project}/env`,'POST',{key:'PAYFAST_LIVE_ENABLED',value:'false',type:'encrypted',target:['production']});
  stage='verification';const verified=await api(`/v9/projects/${project}`);
  const created=(verified.env||[]).filter(env=>env.target?.includes('production')&&[...names,'PAYFAST_MODE','PAYFAST_LIVE_ENABLED'].includes(env.key));
  if(created.length!==5||created.filter(env=>names.includes(env.key)).some(env=>env.type!=='sensitive'))throw new Error('SAVED_CONFIGURATION_REQUIRES_REVIEW');
  console.log(JSON.stringify({configuredKeys:created.map(env=>env.key).sort(),liveEnabled:false,deployed:false}));
}catch(error){
  const safeCodes=new Set(['CLI_REQUIRED','NO_ARGUMENTS_ALLOWED','INPUT_REQUIRES_REVIEW','PROJECT_REQUIRES_REVIEW','EXISTING_CONFIGURATION_PRESERVED','API_PROCESS_FAILED','API_REQUEST_FAILED','API_RESPONSE_INVALID','SAVED_CONFIGURATION_REQUIRES_REVIEW']);
  console.error(JSON.stringify({status:'stopped-for-secure-review',stage,code:safeCodes.has(error.message)?error.message:'INPUT_OR_API_REQUIRES_REVIEW',api:error.safeDetails}));process.exitCode=1;
}finally{
  if(credentials)for(const key of Object.keys(credentials))credentials[key]='';
  try{await unlink(input);console.log('Private merchant input removed.');}catch{}
}
