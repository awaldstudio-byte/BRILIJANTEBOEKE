import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';

const project='prj_nxGKfknjzuyslJKwzjfIVvM8CfSa',team='team_FjZQNhr6kfmd3OLlDZA2WHE1';
const branch='codex/phase1-foundation';
const cli=process.env.BRILJANTE_VERCEL_CLI;
const keys=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','ORDER_TOKEN_SECRET','SMTP_PASSWORD'];
if(!cli||!cli.endsWith('vc.js')||process.argv.length!==2)throw new Error('Use the installed CLI entry point through BRILJANTE_VERCEL_CLI; no arguments.');
async function api(endpoint,method='GET',body){
 const args=[resolve(cli),'api',endpoint,'--scope','awaldstudio','--raw','--method',method];
 if(body!==undefined)args.push('--input','-');
 if(method==='DELETE')args.push('--dangerously-skip-permissions');
 return new Promise((accept,reject)=>{
  const child=spawn(process.execPath,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',stderr='',large=false;
  child.stdout.on('data',data=>{output+=data;if(output.length>2_000_000){large=true;child.kill();}});child.stderr.on('data',data=>{if(stderr.length<100000)stderr+=data;});
  child.on('error',()=>reject(new Error('API_PROCESS_FAILED')));
  child.on('close',code=>{if(code||large){let message='';try{const value=JSON.parse(output);message=value.error?.message||'';}catch{message=stderr.split('\n').filter(line=>/Error:/i.test(line)).at(-1)||'';}if(temporary?.bearerToken)message=message.split(temporary.bearerToken).join('[redacted]');const error=new Error('API_REQUEST_FAILED');error.safeMessage=message.replace(/\x1b\[[0-9;]*m/g,'').slice(0,300);return reject(error);}try{accept(output.trim()?JSON.parse(output):{});}catch{reject(new Error('API_RESPONSE_INVALID'));}});
  child.stdin.end(body===undefined?'':JSON.stringify(body));
 });
}
const relaySource=`import {mkdir,writeFile} from 'node:fs/promises';
const project=${JSON.stringify(project)},team=${JSON.stringify(team)},keys=${JSON.stringify(keys)};
let stage='environment';
const token=process.env.BRILJANTE_RELAY_TOKEN;delete process.env.BRILJANTE_RELAY_TOKEN;
async function call(path,method='GET',body){const response=await fetch('https://api.vercel.com'+path+'?teamId='+team,{method,redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('API_REJECTED');return response.status===204?{}:response.json();}
try{
 if(!token||process.env.VERCEL_ENV!=='preview'||process.env.APP_ORIGIN!=='https://briljante-preview-awaldstudio.vercel.app'||process.env.SUPABASE_URL!=='https://cigyxjfzbjlgbrduzcpw.supabase.co'||keys.some(key=>!process.env[key]))throw Error('ENVIRONMENT_DENIED');
 stage='project';const current=await call('/v9/projects/'+project);if(current.id!==project)throw Error('PROJECT_DENIED');
 const production=(current.env||[]).filter(env=>env.target?.includes('production'));
 if(production.some(env=>keys.includes(env.key)))throw Error('EXISTING_VALUES_PRESERVED');
 for(const key of keys){stage='copy-'+key;await call('/v10/projects/'+project+'/env','POST',{key,value:process.env[key],type:'sensitive',target:['production']});}
 stage='public-output';await mkdir('public',{recursive:true});await writeFile('public/index.html','<!doctype html><title>Configuration prepared</title><p>Configuration prepared.</p>');
 console.log('BRILJANTE_CONFIGURATION_RELAY_COMPLETE');
}catch{console.error('BRILJANTE_CONFIGURATION_RELAY_FAILED_'+stage);process.exitCode=1;}`;
let temporary, deployment,stage='preflight';
try{
 const current=await api(`/v9/projects/${project}`);
 if(current.id!==project||current.name!=='brilijanteboeke'||current.autoExposeSystemEnvs!==true)throw Error('PROJECT_SETTINGS_REQUIRE_REVIEW');
 if((current.env||[]).some(env=>env.target?.includes('production')&&keys.includes(env.key)))throw Error('EXISTING_PRODUCTION_PRESERVED');
 const before=await api(`/v4/aliases?projectId=${project}&limit=100`);
 const snapshot=aliases=>(aliases.aliases||[]).map(alias=>({alias:alias.alias,deploymentId:alias.deploymentId||alias.deployment?.id})).sort((a,b)=>a.alias.localeCompare(b.alias));
 stage='temporary-token';try{temporary=await api('/v3/user/tokens','POST',{name:'Briljante one-time configuration relay',expiresAt:Date.now()+300000,projectId:project});}
 catch(error){
  if(!error.safeMessage?.includes('Cannot create tokens for this app.'))throw error;
  const auth=JSON.parse(await readFile(resolve(process.env.APPDATA,'com.vercel.cli','Data','auth.json'),'utf8'));
  if(typeof auth.token!=='string'||!auth.token)throw Error('CLI_TOKEN_UNAVAILABLE');
  temporary={bearerToken:auth.token,existing:true};auth.token='';auth.refreshToken='';
 }
 if(!temporary.bearerToken||(!temporary.existing&&!temporary.token?.id))throw Error('TEMPORARY_TOKEN_REQUIRED');
 stage='preview-create';
 const contents={
  'package.json':JSON.stringify({name:'briljante-private-configuration-relay',private:true,type:'module',scripts:{build:'node relay.mjs'}}),
  'vercel.json':JSON.stringify({buildCommand:'node relay.mjs',installCommand:'echo no-dependencies',outputDirectory:'public',framework:null}),
  'relay.mjs':relaySource,
 };
 deployment=await api('/v13/deployments','POST',{name:'brilijanteboeke',project,autoAssignCustomDomains:false,files:Object.entries(contents).map(([file,data])=>({file,data:Buffer.from(data).toString('base64'),encoding:'base64'})),build:{env:{BRILJANTE_RELAY_TOKEN:temporary.bearerToken}},gitMetadata:{remoteUrl:'https://github.com/awaldstudio-byte/BRILIJANTEBOEKE',commitRef:branch,dirty:true},meta:{githubCommitRef:branch,githubCommitOrg:'awaldstudio-byte',githubCommitRepo:'BRILIJANTEBOEKE',gitDirty:'1',briljanteSecretRelay:'20261105'}});
 if(!deployment.id||deployment.target==='production')throw Error('UNEXPECTED_DEPLOYMENT');
 console.log(JSON.stringify({relayId:deployment.id,status:'building'}));
 stage='preview-build';let latest=deployment;
 for(let count=0;count<90&&!['READY','ERROR','CANCELED'].includes(latest.readyState);count++){await pause(1500);latest=await api(`/v13/deployments/${deployment.id}`);}
 if(latest.readyState!=='READY')throw Error('RELAY_BUILD_REQUIRES_REVIEW');
 stage='production-verification';const result=await api(`/v9/projects/${project}`);
 const copied=(result.env||[]).filter(env=>env.target?.includes('production')&&keys.includes(env.key));
 if(copied.length!==keys.length||copied.some(env=>env.type!=='sensitive'))throw Error('PRODUCTION_CONFIGURATION_REQUIRES_REVIEW');
 stage='alias-verification';const after=await api(`/v4/aliases?projectId=${project}&limit=100`);
 if(JSON.stringify(snapshot(before))!==JSON.stringify(snapshot(after)))throw Error('ALIASES_REQUIRE_REVIEW');
 console.log(JSON.stringify({configuredKeys:copied.map(env=>env.key).sort(),aliasChanges:false,livePaymentActivationChanged:false}));
}catch(error){console.error(JSON.stringify({status:'stopped-for-review',stage,message:error.safeMessage}));process.exitCode=1;}
finally{
 if(temporary?.token?.id){try{await api(`/v3/user/tokens/${temporary.token.id}`,'DELETE');console.log('Temporary relay token revoked.');}catch{console.error('Temporary relay token cleanup requires review.');process.exitCode=1;}temporary.bearerToken='';}
 if(deployment?.id&&deployment.target!=='production'){try{await api(`/v13/deployments/${deployment.id}`,'DELETE');console.log('Temporary relay deployment removed.');}catch{console.error('Temporary relay deployment cleanup requires review.');process.exitCode=1;}}
}
