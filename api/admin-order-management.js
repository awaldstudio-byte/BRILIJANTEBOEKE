import {requireStaff,requireSameOrigin} from './_lib/auth.js';
import {json,methodNotAllowed,readJson,publicError} from './_lib/http.js';
import {serviceClient,assertDatabaseResult} from './_lib/supabase.js';
import {uuid} from './_lib/validation.js';
import {sha256} from './_lib/crypto.js';
import {demoEnvironment,demoSchoolId,demoStaffEmail,excludeDemoOrders,isDemoRecord} from './_lib/demo-payment.js';
import {managementInput,managementError,withRefundTotals} from './_lib/order-management.js';
const columns='id,reference,status,amount_cents,paid_at,created_at,management_version,parent_first_name,parent_last_name,parent_email,parent_mobile,school_id,ordering_period_id,schools(name),ordering_periods(name,academic_years(year)),learners(id,first_name,last_name,class_name,grade_id,grades(name)),order_items(id,learner_id,description_snapshot,quantity,line_total_cents,unit_price_cents),payment_attempts(id,status,provider_payment_id,amount_cents),order_refunds(provider_refund_reference,amount_cents,refunded_at),order_item_refunds(order_item_id,amount_cents,provider_refund_reference,refunded_at),refund_requests:order_refund_requests(id,status,item_ids,amount_cents,reason,email_received_at,source_email_reference,review_reason,created_at,reviewed_at,completed_at)';
const fail=(message,statusCode)=>Object.assign(new Error(message),{statusCode});
function pageNumber(value) {
 const page=value??'1';
 if(typeof page!=='string'||!/^[1-9]\d{0,3}$/.test(page)||Number(page)>1000)throw fail('Choose a valid results page.',400);
 return Number(page);
}
export function createOrderManagementHandler({authorize=requireStaff,checkOrigin=requireSameOrigin,databaseFactory=serviceClient,source=process.env,now=Date.now}={}){
 return async function handler(req,res){
  if(!['GET','POST'].includes(req.method))return methodNotAllowed(res,['GET','POST']);
  try{
   if(req.method==='POST')checkOrigin(req);
   const {user}=await authorize(req,res,req.method==='POST'?['administrator']:['administrator','viewer']),database=databaseFactory();
   if(req.method==='GET'&&req.query?.requests==='1'){
    const page=pageNumber(req.query.page),size=100,offset=(page-1)*size;
    let query=database.from('order_refund_requests').select('id,order_id,status,item_ids,amount_cents,reason,email_received_at,created_at,orders!inner(id,reference,school_id,status,parent_first_name,parent_last_name,parent_email,schools(name))')
      .in('status',['requested','approved']);
    if(!demoEnvironment(source))query=excludeDemoOrders(query,'orders.');
    const result=await query.order('created_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+size);
    assertDatabaseResult(result.error);
    if(!Array.isArray(result.data))throw fail('The request queue could not be loaded.',503);
    return json(res,200,{requests:result.data.slice(0,size),page,has_more:result.data.length>size});
   }
   if(req.method==='GET'){
    const id=uuid(req.query?.order_id),relatedPage=pageNumber(req.query?.related_page),offset=(relatedPage-1)*50,result=await database.from('orders').select(columns).eq('id',id).maybeSingle();assertDatabaseResult(result.error);if(!result.data)throw fail('Order not found.',404);
    if(!demoEnvironment(source)&&isDemoRecord(result.data))throw fail('Order not found.',404);
    const email=result.data.parent_email.trim().replace(/[\\%_]/g,'\\$&');
    let relatedQuery=database.from('orders').select('id,reference,status,created_at,schools(name)').ilike('parent_email',email);
    if(!demoEnvironment(source))relatedQuery=excludeDemoOrders(relatedQuery);
    const [related,audit]=await Promise.all([relatedQuery.order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+50),database.from('audit_events').select('action,created_at,details').eq('entity_type','order').eq('entity_id',id).order('created_at',{ascending:false}).limit(50)]);
    assertDatabaseResult(related.error);assertDatabaseResult(audit.error);
    if(!Array.isArray(related.data))throw fail('Related orders could not be loaded.',503);
    return json(res,200,{order:withRefundTotals(result.data),related_orders:related.data.slice(0,50),related_page:relatedPage,related_has_more:related.data.length>50,audit:audit.data||[]});
   }
   const input=managementInput(await readJson(req,16000),now());
   const context=await database.from('orders').select('id,reference,school_id').eq('id',input.orderId).maybeSingle();assertDatabaseResult(context.error);if(!context.data)throw fail('Order not found.',404);
   if(isDemoRecord(context.data)){
    if(!demoEnvironment(source)||context.data.school_id!==demoSchoolId||user.email?.toLowerCase()!==demoStaffEmail)throw fail('Demo changes require the dedicated technical test account and school.',403);
    if(input.action==='correct-details'&&input.payload.parent.email!==demoStaffEmail)throw fail('Keep the approved technical mailbox for this sandbox order.',403);
   }else if(source.VERCEL_ENV!=='production')throw fail('Real parent records cannot be changed from this preview.',403);
   const rate=await database.rpc('consume_staff_auth_limit',{p_key:sha256(`order-management:${user.id}`),p_limit:60,p_seconds:3600});assertDatabaseResult(rate.error);if(rate.data!==true)throw fail('Too many changes. Please try again later.',429);
   const result=await database.rpc('manage_order_record',{p_order_id:input.orderId,p_expected_version:input.expectedVersion,p_actor:user.id,p_action:input.action,p_payload:input.payload});
   if(result.error)throw managementError(result.error);return json(res,result.data?.reused?200:201,{result:result.data,money_moved:false});
  }catch(error){const result=publicError(managementError(error));if(result.status>=500)console.error('order-management',{code:error.code});return json(res,result.status,{error:result.message});}
 };
}
export default createOrderManagementHandler();
