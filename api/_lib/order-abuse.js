import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

const unavailable = () => Object.assign(new Error('Ordering protection is temporarily unavailable. Please try again shortly.'), {statusCode:503,code:'ORDER_PROTECTION_UNAVAILABLE'});
const limited = () => Object.assign(new Error('Too many ordering attempts. Please wait before trying again, or contact Briljante for assistance.'), {statusCode:429,code:'ORDER_RATE_LIMIT'});
// Vercel overwrites this header at its trusted edge. Never choose the first
// address from an arbitrary X-Forwarded-For list supplied by the caller.
export function trustedOrderingIp(req, source=process.env) {
  // Live checkout is deployed on Vercel. When system variables are disabled,
  // the socket may be the same internal proxy for every customer. Treating it
  // as a trusted client would unfairly throttle the whole school community.
  if(source.VERCEL!=='1') throw unavailable();
  const value=req.headers?.['x-vercel-forwarded-for'];
  if(typeof value!=='string' || value!==value.trim() || value.includes(',') || !isIP(value)) throw unavailable();
  const ip=value.replace(/^::ffff:/i,'');
  return isIP(ip)===4 ? ip : new URL(`https://[${ip}]/`).hostname.slice(1,-1);
}
function key(settings,...parts) {
  if(typeof settings.orderTokenSecret!=='string' || settings.orderTokenSecret.length<16) throw unavailable();
  return createHmac('sha256',settings.orderTokenSecret).update(JSON.stringify(['public-order-abuse-v1',...parts])).digest('hex');
}
function sameOrigin(req,settings) {
  if(typeof req.headers?.origin!=='string' || req.headers.origin.replace(/\/$/,'')!==settings.appOrigin || req.headers['sec-fetch-site']==='cross-site') {
    throw Object.assign(new Error('The request origin is invalid.'),{statusCode:403});
  }
}
async function consume(database,res,args,deduplicated=false) {
  let result;
  try { result=await database.rpc(deduplicated?'consume_order_submission_limit':'consume_order_traffic_limit',args); }
  catch { throw unavailable(); }
  if(result.error || typeof result.data!=='boolean') throw unavailable();
  // The longest possible time until this fixed bucket resets is its duration.
  // Do not advertise a one-minute retry when an hourly quota was exhausted.
  if(!result.data) {res.setHeader('Retry-After',String(args.p_seconds));throw limited();}
}
export async function protectPublicTraffic({req,res,database,settings,source=process.env}) {
  sameOrigin(req,settings);
  const ip=trustedOrderingIp(req,source);
  // Shared networks are allowed hundreds of distinct parent requests. These
  // broad request limits still bound repeated invalid/private-token attempts.
  await consume(database,res,{p_key:key(settings,'traffic-minute',ip),p_limit:240,p_seconds:60});
  await consume(database,res,{p_key:key(settings,'traffic-hour',ip),p_limit:1000,p_seconds:3600});
}
export async function protectOrderSubmission({req,res,database,settings,input,source=process.env}) {
  const ip=trustedOrderingIp(req,source);
  const request=key(settings,'submission',input.idempotencyKey,input.schoolIdentifier||input.schoolToken,input.orderingPeriodId);
  // Creation quotas count distinct requests, not an interrupted order's retries.
  await consume(database,res,{p_key:key(settings,'creation-ip',ip),p_request:request,p_limit:600,p_seconds:3600},true);
  await consume(database,res,{p_key:key(settings,'creation-parent',ip,input.parent.email.toLowerCase()),p_request:request,p_limit:20,p_seconds:3600},true);
}
export async function protectCheckout({res,database,settings,order}) {
  // Called only after the atomic preparation RPC verified the private token.
  // Knowing a public order reference cannot consume its private order quota.
  await consume(database,res,{p_key:key(settings,'checkout-order',order.id),p_limit:30,p_seconds:3600});
}
