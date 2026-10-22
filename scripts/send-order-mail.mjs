import { serviceClient } from '../api/_lib/supabase.js';
import { mailSettings,createMailTransport,drainOrderMail } from '../api/_lib/order-mail.js';

// Run only from an authorised server/scheduled worker with server-side settings.
// Dry run is the default; --send explicitly permits sending already queued jobs.
const settings=mailSettings();
const transport=createMailTransport(settings);
try {
  if(!process.argv.includes('--send')) {
    await transport.verify();
    console.log('SMTP authenticated; no email sent.');
  } else {
    console.log(JSON.stringify(await drainOrderMail(serviceClient(),transport,settings)));
  }
} catch(error) {
  console.error('Order email check failed.', /^[A-Z0-9_]{1,60}$/.test(error.code || '')?error.code:'CHECK_FAILED');
  process.exitCode=1;
} finally {transport.close();}
