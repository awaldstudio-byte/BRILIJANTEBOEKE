import {createHmac,timingSafeEqual} from 'node:crypto';
import {mailSettings,createMailTransport} from './order-mail.js';
import {demoEnvironment,demoOrigin,demoSchoolId,demoStaffEmail} from './demo-payment.js';
import {shippingEmailContent} from './shipping-email.js';
const address=/^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedOrigins=new Set([demoOrigin,'https://www.briljanteboeke.co.za','https://briljanteboeke.co.za']);
const failed=(code,message='Shipping updates require technical review.')=>Object.assign(Error(message),{code});
export function shippingSettings(source=process.env){
  if(!allowedOrigins.has(source.APP_ORIGIN)||source.SUPABASE_URL!=='https://cigyxjfzbjlgbrduzcpw.supabase.co')throw failed('SHIPPING_ENVIRONMENT_DENIED');
  const demo=demoEnvironment(source);
  if(!demo&&(source.VERCEL_ENV!=='production'||source.APP_ORIGIN===demoOrigin))throw failed('SHIPPING_ENVIRONMENT_DENIED');
  return {...mailSettings(demo?{...source,MAIL_ENABLED:'true'}:source),demoOnly:demo};
}
export function shippingMessage(job,settings){
  const p=job.payload;
  if(!uuid.test(job.id)||!uuid.test(job.batch_id)||!['dispatched','delivered'].includes(job.event)||!address.test(job.recipient)||
    !p||p.batch_id!==job.batch_id||p.event!==job.event||p.recipient!==job.recipient||p.demo!==job.demo||job.demo!==settings.demoOnly||
    !Array.isArray(p.items)||!p.items.length||p.items.some(item=>!Number.isSafeInteger(item.quantity)||item.quantity<1)||!Number.isFinite(Date.parse(p.occurred_at)))throw failed('INVALID_SHIPPING_JOB');
  if(job.demo&&p.school_id!==demoSchoolId)throw failed('DEMO_MAIL_DENIED');
  const recipient=job.demo?demoStaffEmail:job.recipient;
  return {from:{name:'Briljante Boeke',address:settings.from},replyTo:settings.replyTo,to:recipient,
    subject:`${job.demo?'[DEMO] ':''}Briljante Boeke — ${job.event==='delivered'?'Books delivered to school / Boeke afgelewer':'Books dispatched / Boeke versend'}`,
    messageId:`<shipping-${job.id}@briljanteboeke.co.za>`,...shippingEmailContent(p),disableFileAccess:true,disableUrlAccess:true};
}
export function signShippingWork(batchId,hop,source=process.env,now=Date.now()){
  if(!uuid.test(batchId)||!Number.isInteger(hop)||hop<0||hop>500||!source.ORDER_TOKEN_SECRET)throw failed('INVALID_SHIPPING_WORK');
  const timestamp=Math.floor(now/1000);
  const signature=createHmac('sha256',source.ORDER_TOKEN_SECRET).update(`briljante-shipping-worker-v1:${batchId}:${hop}:${timestamp}`).digest('hex');
  return {batch_id:batchId,hop,timestamp,signature};
}
export function verifyShippingWork(body,source=process.env,now=Date.now()){
  if(!body||!Number.isInteger(body.timestamp)||Math.abs(Math.floor(now/1000)-body.timestamp)>60||typeof body.signature!=='string'||!/^[a-f0-9]{64}$/.test(body.signature))return false;
  try{const expected=signShippingWork(body.batch_id,body.hop,source,body.timestamp*1000).signature;return timingSafeEqual(Buffer.from(body.signature,'hex'),Buffer.from(expected,'hex'));}catch{return false;}
}
export async function drainShippingMail(database,settings,{batchId,transportFactory=createMailTransport}={}){
  const claimed=await database.rpc('claim_shipping_notifications',{p_batch_id:batchId,p_limit:12});
  if(claimed.error)throw failed('SHIPPING_CLAIM_FAILED');
  const jobs=claimed.data||[],summary={claimed:jobs.length,sent:0,failed:0};if(!jobs.length)return summary;
  const transport=transportFactory(settings);let index=0;
  async function work(){
    while(index<jobs.length){const job=jobs[index++];let accepted=false;
      try{const message=shippingMessage(job,settings),result=await transport.sendMail(message);accepted=result.accepted?.some(value=>String(value).toLowerCase()===message.to.toLowerCase())===true;if(!accepted)throw failed('MAIL_NOT_ACCEPTED');
        const saved=await database.from('shipping_notification_jobs').update({status:'sent',sent_at:new Date().toISOString(),last_error:null}).eq('id',job.id).eq('status','processing');if(saved.error)throw failed('ACCEPTED_RECONCILE_REQUIRED');summary.sent++;
      }catch(error){const code=accepted?'ACCEPTED_RECONCILE_REQUIRED':/^[A-Z0-9_]{1,60}$/.test(error.code||'')?error.code:'MAIL_DELIVERY_UNCERTAIN';const saved=await database.from('shipping_notification_jobs').update({status:'failed',last_error:code}).eq('id',job.id).eq('status','processing');if(saved.error)throw failed('SHIPPING_OUTCOME_REQUIRES_REVIEW');summary.failed++;}
    }
  }
  try{const results=await Promise.allSettled(Array.from({length:Math.min(4,jobs.length)},()=>work()));const rejected=results.find(result=>result.status==='rejected');if(rejected)throw rejected.reason;}finally{transport.close();}
  return summary;
}
export function scheduleShippingMail({database,batchId,schedule,hop=0,source=process.env,transportFactory=createMailTransport,fetcher=fetch}){
  const settings=shippingSettings(source);
  const task=drainShippingMail(database,settings,{batchId,transportFactory}).then(async summary=>{
    if(!summary.claimed||hop>=500)return;
    const pending=await database.from('shipping_notification_jobs').select('id').eq('batch_id',batchId).eq('status','queued').limit(1);
    if(pending.error)throw failed('SHIPPING_QUEUE_LOOKUP_FAILED');
    if(pending.data?.length){const work=signShippingWork(batchId,hop+1,source),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
      try{const response=await fetcher(`${source.APP_ORIGIN}/api/admin-fulfilment/`,{method:'POST',headers:{'Content-Type':'application/json','X-Briljante-Shipping-Worker':'1'},body:JSON.stringify(work),signal:controller.signal,redirect:'error'});if(!response.ok)throw failed('SHIPPING_CONTINUATION_FAILED');}finally{clearTimeout(timeout);}
    }
  }).catch(error=>console.error('shipping-mail',{code:/^[A-Z0-9_]{1,60}$/.test(error.code||'')?error.code:'SHIPPING_WORKER_REQUIRES_REVIEW'}));
  schedule(task);return true;
}
