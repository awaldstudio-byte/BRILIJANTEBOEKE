import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const project='prj_nxGKfknjzuyslJKwzjfIVvM8CfSa',branch='codex/phase1-foundation';
const cli=process.env.BRILJANTE_VERCEL_CLI;
if(!cli||!cli.endsWith('vc.js')||process.argv.slice(2).some(value=>value!=='--apply'))throw Error('Provide CLI entry point and optional --apply.');
// These are public provider test credentials, not Briljante's live credentials.
// Source: support.payfast.help/portal/en/kb/articles/why-am-i-getting-a-merchant-id-merchant-key-error-20-9-2022
const settings={PAYFAST_MERCHANT_ID:'10004002',PAYFAST_MERCHANT_KEY:'q1cd2rdny4a53',PAYFAST_PASSPHRASE:'payfast',PAYFAST_MODE:'sandbox',PAYFAST_LIVE_ENABLED:'false',DEMO_PAYMENTS_ENABLED:'true',PAYFAST_SANDBOX_TESTS_ENABLED:'true'};
const sensitive=new Set(['PAYFAST_MERCHANT_ID','PAYFAST_MERCHANT_KEY','PAYFAST_PASSPHRASE']);
async function api(endpoint,method='GET',body){return new Promise((accept,reject)=>{const args=[resolve(cli),'api',endpoint,'--scope','awaldstudio','--raw','--method',method];if(body)args.push('--input','-');const child=spawn(process.execPath,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let text='';child.stdout.on('data',part=>text+=part);child.stderr.on('data',()=>{});child.on('error',()=>reject(Error('API_PROCESS_FAILED')));child.on('close',code=>{if(code)return reject(Error('API_REQUEST_FAILED'));try{accept(JSON.parse(text));}catch{reject(Error('API_RESPONSE_INVALID'));}});child.stdin.end(body?JSON.stringify(body):'');});}
try{
 const initial=await api(`/v9/projects/${project}`);if(initial.id!==project||initial.name!=='brilijanteboeke')throw Error('PROJECT_MISMATCH');
 const production=envs=>(envs||[]).filter(env=>env.target?.includes('production')).map(({id,key,type,target,gitBranch})=>({id,key,type,target,gitBranch})).sort((a,b)=>a.key.localeCompare(b.key));
 const before=production(initial.env);
 for(const [key,value] of Object.entries(settings)){
  if((initial.env||[]).some(env=>env.key===key&&env.target?.includes('preview')&&env.gitBranch===branch)){console.log(JSON.stringify({key,status:'preserved-existing-preview'}));continue;}
  if(process.argv.includes('--apply')){await api(`/v10/projects/${project}/env`,'POST',{key,value,type:sensitive.has(key)?'sensitive':'encrypted',target:['preview'],gitBranch:branch});console.log(JSON.stringify({key,status:'configured-preview'}));}
  else console.log(JSON.stringify({key,status:'planned-preview'}));
 }
 const final=await api(`/v9/projects/${project}`);if(JSON.stringify(before)!==JSON.stringify(production(final.env)))throw Error('PRODUCTION_METADATA_CHANGED');
 console.log(JSON.stringify({productionMetadataUnchanged:true,branch,apply:process.argv.includes('--apply')}));
}catch{console.error('Preview configuration requires secure review.');process.exitCode=1;}
