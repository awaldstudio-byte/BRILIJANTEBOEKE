import {randomUUID} from 'node:crypto';
import {waitUntil} from '@vercel/functions';
import {requireSameOrigin,requireStaff} from './_lib/auth.js';
import {json,methodNotAllowed,publicError,readJson} from './_lib/http.js';
import {assertDatabaseResult,serviceClient} from './_lib/supabase.js';
import {optionalText,uuid} from './_lib/validation.js';
import {demoEnvironment,demoSchoolId,demoStaffEmail} from './_lib/demo-payment.js';
import {shippingSettings,scheduleShippingMail,verifyShippingWork} from './_lib/shipping-mail.js';
import {shippingEmailPreview} from './_lib/shipping-email.js';
const statuses=new Set(['created','packing','ready','dispatched','delivered','cancelled']);
const notifyStatus=status=>['dispatched','delivered'].includes(status);
const fail=(message,statusCode=400)=>Object.assign(Error(message),{statusCode});
const databaseErrors={BATCH_NOT_FOUND:['The batch was not found.',404],EMPTY_BATCH:['The batch contains no books.',409],INVALID_BATCH_TRANSITION:['This status change is not allowed. Dispatched batches can only be marked delivered; delivered and cancelled batches are final.',409],BATCH_RECORDS_REQUIRE_REVIEW:['Some batch records are unpaid, refunded, from another school, or mix test and live orders. Review this batch before continuing.',409],INVALID_DEMO_BATCH:['Demo updates are restricted to the dedicated test school.',403]};
export function createFulfilmentHandler({authorize=requireStaff,checkOrigin=requireSameOrigin,databaseFactory=serviceClient,source=process.env,schedule=waitUntil,launch=scheduleShippingMail}={}){
  async function batchContext(database,id){
    const result=await database.from('fulfilment_batches').select('id,school_id,ordering_period_id,status,label').eq('id',id).maybeSingle();assertDatabaseResult(result.error);if(!result.data)throw fail('The batch was not found.',404);
    const first=await database.from('fulfilment_batch_items').select('order_reference').eq('batch_id',id).order('id').limit(1);assertDatabaseResult(first.error);if(!first.data?.length)throw fail('The batch contains no books.',409);
    return {...result.data,demo:first.data[0].order_reference.startsWith('DEMO-')};
  }
  function sendingAllowed(batch,user){
    if(batch.demo){if(!demoEnvironment(source)||batch.school_id!==demoSchoolId||user.email?.toLowerCase()!==demoStaffEmail)throw fail('Demo shipping updates are restricted to the technical test account and test school.',403);}
    else if(source.VERCEL_ENV!=='production')throw fail('Live parent shipping emails are not enabled on the preview.',403);
    try{const settings=shippingSettings(source);if(settings.demoOnly!==batch.demo)throw Error();}catch{throw fail('The shipping email sender is not configured for this environment.',503);}
  }
  return async function handler(req,res){
    if(!['GET','POST','PATCH'].includes(req.method))return methodNotAllowed(res,['GET','POST','PATCH']);
    try{
      if(req.method==='POST'&&req.headers['x-briljante-shipping-worker']==='1'){
        const body=await readJson(req,2000);if(!verifyShippingWork(body,source))throw fail('Shipping worker access denied.',403);
        shippingSettings(source);launch({database:databaseFactory(),batchId:body.batch_id,hop:body.hop,schedule,source});return json(res,202,{accepted:true});
      }
      if(req.method!=='GET')checkOrigin(req);
      const {user}=await authorize(req,res,req.method==='GET'?['administrator','viewer']:['administrator']);
      const database=databaseFactory();
      if(req.method==='GET'){
        if(req.query?.email_preview){
          const id=uuid(req.query.email_preview),event=req.query.event==='delivered'?'delivered':'dispatched',batch=await batchContext(database,id);
          const result=await database.rpc('shipping_batch_recipients',{p_batch_id:id,p_event:event,p_demo:batch.demo,p_occurred_at:new Date().toISOString()}).limit(1);assertDatabaseResult(result.error);
          if(!result.data?.length)throw fail('No paid parent orders are available for this preview.',409);
          res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
          return res.status(200).send(shippingEmailPreview(result.data[0].payload));
        }
        const [batches,counts]=await Promise.all([
          database.from('fulfilment_batches').select('id,school_id,ordering_period_id,label,status,created_at,dispatched_at,delivered_at,schools(name),ordering_periods(name,academic_years(year)),fulfilment_batch_items(count)').order('created_at',{ascending:false}),
          database.rpc('shipping_notification_counts'),
        ]);assertDatabaseResult(batches.error);assertDatabaseResult(counts.error);
        return json(res,200,{batches:(batches.data||[]).map(batch=>({...batch,notifications:(counts.data||[]).filter(row=>row.batch_id===batch.id)}))});
      }
      const body=await readJson(req,8000);
      if(req.method==='POST'&&body?.action==='send-pending'){
        const id=uuid(body.id),batch=await batchContext(database,id);sendingAllowed(batch,user);launch({database,batchId:id,schedule,source});return json(res,202,{queued:true});
      }
      if(req.method==='POST'){
        const schoolId=uuid(body?.school_id),periodId=uuid(body?.period_id),label=optionalText(body?.label,160);if(label.length<2)throw fail('Enter a batch name.');
        const result=await database.rpc('create_fulfilment_batch',{p_school_id:schoolId,p_ordering_period_id:periodId,p_label:label,p_created_by:user.id});assertDatabaseResult(result.error);
        const audit=await database.from('audit_events').insert({actor_user_id:user.id,action:'fulfilment_batch_created',entity_type:'fulfilment_batch',entity_id:result.data.id,details:{school_id:schoolId,ordering_period_id:periodId,item_count:result.data.item_count}});assertDatabaseResult(audit.error);
        return json(res,201,{batch:result.data});
      }
      const id=uuid(body?.id);if(!statuses.has(body?.status))throw fail('Select a valid fulfilment status.');
      const batch=await batchContext(database,id);
      if(notifyStatus(body.status)){if(body.confirm_notifications!==true)throw fail('Confirm the parent shipping update before changing this status.',409);sendingAllowed(batch,user);}
      const changed=await database.rpc('transition_fulfilment_batch',{p_batch_id:id,p_status:body.status,p_actor:user.id,p_demo:batch.demo});assertDatabaseResult(changed.error);
      let started=false;
      if(notifyStatus(body.status)){try{started=launch({database,batchId:id,schedule,source});}catch{console.error('shipping-mail',{code:'SHIPPING_SCHEDULE_REQUIRES_REVIEW'});}}
      return json(res,200,{batch:changed.data,notifications_started:started});
    }catch(error){
      if(databaseErrors[error.message])error=fail(...databaseErrors[error.message]);
      if(error.statusCode!==401)console.error('admin-fulfilment',{code:error.code,status:error.statusCode});
      const result=publicError(error);return json(res,result.status,{error:result.message});
    }
  };
}
export default createFulfilmentHandler();
