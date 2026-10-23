import { serviceClient } from '../api/_lib/supabase.js';
import { logoBucket, maxLogoBytes } from '../api/_lib/school-materials.js';
const expected='cigyxjfzbjlgbrduzcpw.supabase.co';
if(new URL(process.env.SUPABASE_URL).hostname!==expected)throw Error('Refusing an unexpected Supabase project.');
const database=serviceClient();
let result=await database.storage.getBucket(logoBucket);
if(result.error){
  if(!/not found/i.test(result.error.message))throw Error('Could not inspect logo storage.');
  result=await database.storage.createBucket(logoBucket,{public:false,fileSizeLimit:maxLogoBytes,allowedMimeTypes:['image/png']});
  if(result.error)throw Error('Could not create private school logo storage.');
}
const verify=await database.storage.getBucket(logoBucket);
if(verify.error||verify.data.public||Number(verify.data.file_size_limit)!==maxLogoBytes||!verify.data.allowed_mime_types?.includes('image/png'))throw Error('Private logo storage verification failed.');
console.log(JSON.stringify({project:'cigyxjfzbjlgbrduzcpw',bucket:logoBucket,public:verify.data.public,maxBytes:verify.data.file_size_limit}));
