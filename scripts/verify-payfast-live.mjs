import {readFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Read-only provider connectivity check. No transaction or refund is created.
const input='C:\\Users\\natha\\.codex-private\\briljante-release-20261105\\merchant-input.json';
const encode=value=>encodeURIComponent(String(value)).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g,'+');
let credentials;
try{
  credentials=JSON.parse(await readFile(input,'utf8'));
  if(!/^\d{8}$/.test(credentials.PAYFAST_MERCHANT_ID)||!credentials.PAYFAST_PASSPHRASE)throw Error('PRIVATE_INPUT_INVALID');
  const fields={'merchant-id':credentials.PAYFAST_MERCHANT_ID,passphrase:credentials.PAYFAST_PASSPHRASE,timestamp:new Date().toISOString().replace(/\.\d{3}Z$/,'+00:00'),version:'v1'};
  const signature=createHash('md5').update(Object.keys(fields).sort().map(key=>`${key}=${encode(fields[key])}`).join('&')).digest('hex');
  const response=await fetch('https://api.payfast.co.za/ping',{method:'GET',headers:{'merchant-id':fields['merchant-id'],timestamp:fields.timestamp,version:fields.version,signature},redirect:'error',signal:AbortSignal.timeout(15000)});
  const body=await response.text();
  let parsed;try{parsed=JSON.parse(body);}catch{}
  const isPing=value=>typeof value==='string'&&value.replace(/^"|"$/g,'').trim().toLowerCase()==='payfast api';
  const recognised=response.ok&&(isPing(body)||isPing(parsed?.data?.response)||isPing(parsed?.response));
  const htmlTitle=body.match(/<title[^>]*>([^<]{0,120})<\/title>/i)?.[1];
  console.log(JSON.stringify({endpoint:'live-ping',httpStatus:response.status,recognisedResponse:recognised,contentType:response.headers.get('content-type'),responseLength:body.length,htmlTitle,responseFields:parsed&&typeof parsed==='object'?Object.keys(parsed):[],dataFields:parsed?.data&&typeof parsed.data==='object'?Object.keys(parsed.data):[],status:typeof parsed?.status==='string'?parsed.status:undefined,financialAction:false}));
  if(!recognised)process.exitCode=1;
}catch{console.error('Read-only PayFast check could not be verified.');process.exitCode=1;}
finally{if(credentials)for(const key of Object.keys(credentials))credentials[key]='';await unlink(input).catch(()=>{});}
