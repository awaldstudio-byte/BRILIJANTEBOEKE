import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

// Only documented Vercel endpoints are used. Values stay in child-process pipes
// and memory; neither credentials nor API response bodies are logged or saved.
const project='prj_nxGKfknjzuyslJKwzjfIVvM8CfSa';
const branch='codex/phase1-foundation';
const canonical='https://www.briljanteboeke.co.za';
const cli=process.env.BRILJANTE_VERCEL_CLI;
if(!cli||!cli.endsWith('vc.js'))throw new Error('Set BRILJANTE_VERCEL_CLI to the installed Vercel vc.js entry point.');
const apply=process.argv.includes('--apply');
const configOnly=process.argv.includes('--configs-only');
if(process.argv.slice(2).some(x=>!['--apply','--configs-only'].includes(x)))throw new Error('Only --apply and --configs-only are supported.');
async function api(endpoint,method='GET',body){
  const args=[resolve(cli),'api',endpoint,'--scope','awaldstudio','--raw','--method',method];
  if(body!==undefined)args.push('--input','-');
  return new Promise((accept,reject)=>{
    const child=spawn(process.execPath,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',errorOutput='',oversized=false;
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2_000_000){oversized=true;child.kill();}});
    child.stderr.on('data',chunk=>{if(errorOutput.length<100000)errorOutput+=chunk;});
    child.on('error',()=>reject(new Error('VERCEL_API_PROCESS_FAILED')));
    child.on('close',code=>{if(code||oversized){const details=output+errorOutput;const safeReason=/git.?branch/i.test(details)?'TARGET_BRANCH_RESTRICTION':/permission|approval|action_required/i.test(details)?'PERMISSION_REVIEW':/sensitive|secret/i.test(details)?'SECRET_RESTRICTION':'VERCEL_API_REQUEST_FAILED';return reject(new Error(safeReason));}try{accept(JSON.parse(output));}catch{reject(new Error('VERCEL_API_RESPONSE_INVALID'));}});
    child.stdin.end(body===undefined?'':JSON.stringify(body));
  });
}
const fixed={APP_ORIGIN:canonical,MAIL_ENABLED:'true',AUTH_MAIL_ENABLED:'true',BRILJANTE_NOTIFICATION_EMAILS:'briljanteboeke@gmail.com'};
const clone=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','ORDER_TOKEN_SECRET','MAIL_FROM','MAIL_REPLY_TO','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD'];
const initial=await api(`/v9/projects/${project}`);
if(initial.id!==project||initial.name!=='brilijanteboeke'||initial.autoExposeSystemEnvs!==true)throw new Error('PROJECT_SETTINGS_REQUIRE_REVIEW');
const envs=initial.env||[];
const plans=[];
for(const key of [...Object.keys(fixed),...clone]){
  const existing=envs.filter(e=>e.key===key&&e.target?.includes('production'));
  if(existing.length){plans.push({key,action:'preserve-existing-production'});continue;}
  if(Object.hasOwn(fixed,key)){plans.push({key,action:'create-production-config'});continue;}
  const sources=envs.filter(e=>e.key===key&&e.target?.includes('preview')&&e.gitBranch===branch);
  if(sources.length!==1)throw new Error(`SOURCE_REQUIRES_REVIEW_${key}`);
  plans.push({key,action:sources[0].type==='sensitive'?'extend-secret-targets':'copy-production-config',source:sources[0]});
}
console.log(JSON.stringify({apply,project,plan:plans.map(({key,action})=>({key,action}))}));
for(const plan of plans){
  if(!apply||plan.action==='preserve-existing-production'||(configOnly&&plan.action==='extend-secret-targets'))continue;
  try{
    if(plan.action==='extend-secret-targets'){
      // Omit value/type/branch to retain encryption and branch-specific preview
      // behavior. The server rejects unsupported target/branch combinations.
      await api(`/v9/projects/${project}/env/${plan.source.id}`,'PATCH',{target:[...new Set([...plan.source.target,'production'])]});
    }else{
      let value=fixed[plan.key];
      if(plan.action==='copy-production-config'){
        const decrypted=await api(`/v1/projects/${project}/env/${plan.source.id}`);
        if(decrypted.decrypted!==true||typeof decrypted.value!=='string'||!decrypted.value)throw new Error('CONFIG_NOT_READABLE');
        value=decrypted.value;
        if(plan.key==='MAIL_FROM'&&value!=='orders@briljanteboeke.co.za')throw new Error('SENDER_REQUIRES_REVIEW');
        if(plan.key==='MAIL_REPLY_TO'&&!['info@briljanteboeke.co.za','briljanteboeke@gmail.com','sales@briljanteboeke.co.za'].includes(value))throw new Error('REPLY_REQUIRES_REVIEW');
        if(plan.key==='SMTP_PORT'&&!['465','587'].includes(value))throw new Error('PORT_REQUIRES_REVIEW');
      }
      await api(`/v10/projects/${project}/env`,'POST',{key:plan.key,value,type:'encrypted',target:['production']});
      value='';
    }
    console.log(JSON.stringify({key:plan.key,status:'configured'}));
  }catch(error){
    console.log(JSON.stringify({key:plan.key,status:'stopped-for-review',reason:error.message}));
    process.exitCode=1;break;
  }
}
if(apply){const final=await api(`/v9/projects/${project}`);console.log(JSON.stringify({productionKeys:(final.env||[]).filter(e=>e.target?.includes('production')).map(e=>e.key).sort()}));}
