import { requireSameOrigin, requireStaff } from './_lib/auth.js';
import { env, requirePayFast } from './_lib/env.js';
import { demoEnvironment, demoSchoolId, demoStaffEmail } from './_lib/demo-payment.js';
import { json, methodNotAllowed, publicError, readJson } from './_lib/http.js';
import { assertDatabaseResult, serviceClient } from './_lib/supabase.js';
import { uuid } from './_lib/validation.js';
import { schoolIsOpen } from './_lib/school-ordering.js';
import { logoBucket, logoPath, normalizeSchoolLogo, readSchoolLogo, materialLink, qrPng, posterPdf } from './_lib/school-materials.js';

export default createSchoolMaterialsHandler();
export function createSchoolMaterialsHandler({authorize=requireStaff,checkOrigin=requireSameOrigin,databaseFactory=serviceClient,configuration=env,checkPayments=requirePayFast,now=()=>Date.now(),source=process.env}={}) {
  return async (req,res)=>{
    if(!['GET','POST'].includes(req.method))return methodNotAllowed(res,['GET','POST']);
    try {
      if(req.method==='POST')checkOrigin(req);
      const actor=await authorize(req,res,req.method==='POST'?['administrator']:['administrator','viewer']);
      const schoolId=uuid(req.query?.school_id,'Select a saved school.');
      if(schoolId===demoSchoolId&&!demoEnvironment(source))throw Object.assign(Error('The school was not found.'),{statusCode:404});
      if(req.method==='POST'&&source.VERCEL_ENV==='preview'&&(!demoEnvironment(source)||schoolId!==demoSchoolId||actor.user.email?.toLowerCase()!==demoStaffEmail)){
        throw Object.assign(Error('Preview changes are restricted to the dedicated test school and account.'),{statusCode:403});
      }
      const database=databaseFactory();
      const schoolResult=await database.from('schools').select('id, slug, name, status').eq('id',schoolId).maybeSingle();
      assertDatabaseResult(schoolResult.error);const school=schoolResult.data;
      if(!school)throw Object.assign(Error('The school was not found.'),{statusCode:404});
      if(req.method==='POST'){
        const body=await readJson(req,2_810_000),png=await normalizeSchoolLogo(body.logo_base64);
        const {error}=await database.storage.from(logoBucket).upload(logoPath(school.id),png,{contentType:'image/png',upsert:true,cacheControl:'0'});
        assertDatabaseResult(error);
        const audit=await database.from('audit_events').insert({actor_user_id:actor.user.id,action:'school_logo_updated',entity_type:'school',entity_id:school.id,details:{bytes:png.length}});
        assertDatabaseResult(audit.error);
        return json(res,200,{logo:`data:image/png;base64,${png.toString('base64')}`});
      }
      const format=req.query?.format;
      if(format==='logo'){const logo=await readSchoolLogo(database,school.id);return json(res,200,{logo:logo?`data:image/png;base64,${logo.toString('base64')}`:null});}
      if(!['qr','poster'].includes(format))throw Object.assign(Error('Choose a QR image or PDF poster.'),{statusCode:400});
      const periodId=uuid(req.query?.period_id,'Select a saved ordering period.');
      const periodResult=await database.from('ordering_periods').select('id, school_id, status, opens_at, closes_at, academic_years(year)').eq('id',periodId).eq('school_id',school.id).maybeSingle();
      assertDatabaseResult(periodResult.error);const period=periodResult.data;
      if(!period)throw Object.assign(Error('The school ordering period was not found.'),{statusCode:404});
      const config=configuration(),language=req.query.lang==='af'?'af':'en';
      let body,type;
      if(format==='qr'){body=await qrPng(materialLink(config.appOrigin,school,period,language));type='image/png';}
      else {
        const offerings=await database.from('school_grade_offerings').select('grades(code, sort_order)').eq('school_id',school.id).eq('ordering_period_id',period.id).eq('active',true).order('sort_order',{referencedTable:'grades'});
        assertDatabaseResult(offerings.error);
        let ready=false;try{checkPayments(config);ready=schoolIsOpen(school,period,now());}catch{/* Mark as preview. */}
        body=await posterPdf({school,period,gradeNames:(offerings.data??[]).map(item=>item.grades?.code).filter(Boolean),origin:config.appOrigin,language,schoolLogo:await readSchoolLogo(database,school.id),ready});
        type='application/pdf';
      }
      const filename=`${school.slug}-${period.academic_years?.year??'orders'}-${format==='qr'?'qr.png':'poster.pdf'}`;
      res.setHeader('Content-Type',type);res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
      return res.status(200).send(body);
    }catch(error){
      if(!error.statusCode || error.statusCode>=500)console.error('school-materials',{code:error.code});
      const result=publicError(error);return json(res,result.status,{error:result.message});
    }
  };
}
