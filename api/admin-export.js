import { requireStaff } from './_lib/auth.js';
import { methodNotAllowed } from './_lib/http.js';
import { serviceClient } from './_lib/supabase.js';
import { reportOptions, loadReport } from './_lib/report-data.js';
import { reportXlsx, reportPdf, reportCsv } from './_lib/report-documents.js';

export function createReportHandler({ authorize=requireStaff,databaseFactory=serviceClient,load=loadReport }={}) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method!=='GET')return methodNotAllowed(res,['GET']);
    try {
      await authorize(req,res);
      const options=reportOptions(req.query);
      const report=await load(databaseFactory(),options);
      const bytes=await (options.format==='pdf'?reportPdf(report):options.format==='csv'?reportCsv(report):reportXlsx(report));
      if(bytes.length>4_000_000)throw Object.assign(new Error('This report is too large to download. Select a school or ordering period and try again.'),{statusCode:413});
      const suffix=report.school?.name?'-'+report.school.name.normalize('NFKD').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,70).toLowerCase():'';
      const filename=`briljante-${options.report==='batch'?'school-batch':'paid-learners'}${suffix}-${report.capturedAt.slice(0,10)}.${options.format}`;
      res.setHeader('Content-Type',options.format==='pdf'?'application/pdf':options.format==='csv'?'text/csv; charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
      return res.status(200).send(bytes);
    } catch(error) {
      console.error('admin-export',{code:error.code,status:error.statusCode});
      return res.status(error.statusCode??500).json({error:error.statusCode>=400&&error.statusCode<500?error.message:'The report could not be generated. Please try again.'});
    }
  };
}
export default createReportHandler();
