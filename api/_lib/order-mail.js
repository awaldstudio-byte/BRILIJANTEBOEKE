import nodemailer from 'nodemailer';

const address = /^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
export function mailSettings(source = process.env) {
  const port = Number(source.SMTP_PORT || 465);
  const from = source.MAIL_FROM || '';
  const replyTo = source.MAIL_REPLY_TO || 'info@briljanteboeke.co.za';
  if (source.MAIL_ENABLED !== 'true' || !source.SMTP_HOST || !source.SMTP_USER || !source.SMTP_PASSWORD ||
      ![465,587].includes(port) || !address.test(from) || !from.toLowerCase().endsWith('@briljanteboeke.co.za') || !address.test(replyTo)) {
    throw Object.assign(new Error('Order email is not configured.'), {code:'MAIL_NOT_CONFIGURED'});
  }
  return {host:source.SMTP_HOST,port,user:source.SMTP_USER,password:source.SMTP_PASSWORD,from,replyTo,
    staff:(source.BRILJANTE_NOTIFICATION_EMAILS || '').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)};
}

export function createMailTransport(settings) {
  return nodemailer.createTransport({host:settings.host,port:settings.port,secure:settings.port===465,
    requireTLS:true,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},
    auth:{user:settings.user,pass:settings.password},connectionTimeout:8000,greetingTimeout:8000,socketTimeout:12000,
    disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
}

export function paidOrderMessage(job,order,settings) {
  if (order.status!=='paid' || !order.paid_at) throw Object.assign(new Error('A verified paid order is required.'),{code:'ORDER_NOT_PAID'});
  if (!address.test(job.recipient) || /[\r\n]/.test(order.reference) || !Number.isSafeInteger(order.amount_cents) || order.amount_cents<0) {
    throw Object.assign(new Error('Invalid notification data.'),{code:'INVALID_NOTIFICATION'});
  }
  const parent = job.kind === 'parent_order_paid';
  const staff = job.kind === 'staff_order_paid';
  const recipient=job.recipient.toLowerCase();
  if ((!parent && !staff) || (parent && recipient!==order.parent_email.toLowerCase()) || (staff && !settings.staff.includes(recipient))) {
    throw Object.assign(new Error('Notification recipient is not authorised.'),{code:'RECIPIENT_NOT_AUTHORISED'});
  }
  const amount=new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(order.amount_cents/100);
  const school=order.schools?.name || 'School / Skool';
  const text=[parent?'Payment confirmation / Betalingsbevestiging':'Paid school order / Betaalde skoolbestelling','',
    `Order / Bestelling: ${order.reference}`,`School / Skool: ${school}`,`Amount paid / Bedrag betaal: ${amount}`,'',
    parent?'Your payment has been verified. Your workbook order is recorded as paid.':'A school workbook order has been verified as paid. Sign into the staff dashboard to view its details.',
    parent?'U betaling is geverifieer. U werkboekbestelling is as betaal aangeteken.':'’n Skoolwerkboekbestelling is as betaal geverifieer. Meld by die personeelportaal aan vir besonderhede.','',
    'Payment confirmation is not a dispatch or delivery notification. Books are delivered in bulk to the school under its confirmed delivery arrangements.',
    'Betalingsbevestiging is nie ’n versendings- of afleweringskennisgewing nie. Boeke word volgens die skool se bevestigde reëlings in grootmaat by die skool afgelewer.','',
    `Queries / Navrae: ${settings.replyTo}`,'Briljante Boeke'].join('\n');
  if (!/^[0-9a-f-]{36}$/i.test(job.id)) throw Object.assign(new Error('Invalid job identifier.'),{code:'INVALID_NOTIFICATION'});
  return {from:{name:'Briljante Boeke',address:settings.from},replyTo:settings.replyTo,to:job.recipient,
    subject:`Briljante Boeke — ${order.reference} — Payment received / Betaling ontvang`,
    messageId:`<order-${job.id}@briljanteboeke.co.za>`,text,disableFileAccess:true,disableUrlAccess:true};
}

// Claims use compare-and-set so concurrent workers cannot send the same queued job.
// SMTP acknowledgement and database updates cannot form one atomic transaction.
// Ambiguous failures remain failed/processing for review, never blindly resent.
export async function drainOrderMail(database,transport,settings,{limit=5,now=new Date(),orderId}={}) {
  let query=database.from('notification_jobs').select('id,order_id,kind,recipient,status,attempts')
    .eq('status','queued').lte('next_attempt_at',now.toISOString());
  if(orderId) query=query.eq('order_id',orderId);
  const due=await query.order('created_at').limit(Math.min(5,Math.max(1,limit)));
  if(due.error) throw new Error('Notification queue could not be read.');
  const summary={sent:0,failed:0,skipped:0};
  for(const job of due.data || []) {
    const claim=await database.from('notification_jobs').update({status:'processing',attempts:job.attempts+1,last_error:null})
      .eq('id',job.id).eq('status','queued').select('id').maybeSingle();
    if(claim.error) throw new Error('Notification claim failed.');
    if(!claim.data){summary.skipped++;continue;}
    let accepted=false;
    try {
      const result=await database.from('orders').select('reference,status,paid_at,amount_cents,parent_email,schools(name)').eq('id',job.order_id).single();
      if(result.error) throw Object.assign(new Error('Order lookup failed.'),{code:'ORDER_LOOKUP_FAILED'});
      const sent=await transport.sendMail(paidOrderMessage(job,result.data,settings));
      accepted=sent.accepted?.some(x=>String(x).toLowerCase()===job.recipient.toLowerCase())===true;
      if(!accepted) throw Object.assign(new Error('Mail server did not accept recipient.'),{code:'MAIL_NOT_ACCEPTED'});
      const saved=await database.from('notification_jobs').update({status:'sent',sent_at:new Date().toISOString(),last_error:null}).eq('id',job.id).eq('status','processing');
      if(saved.error) throw Object.assign(new Error('Accepted mail requires reconciliation.'),{code:'ACCEPTED_RECONCILE_REQUIRED'});
      summary.sent++;
    } catch(error) {
      const code=accepted?'ACCEPTED_RECONCILE_REQUIRED':(/^[A-Z0-9_]{1,60}$/.test(error.code || '')?error.code:'MAIL_DELIVERY_UNCERTAIN');
      const saved=await database.from('notification_jobs').update({status:'failed',last_error:code}).eq('id',job.id).eq('status','processing');
      if(saved.error) throw new Error('Notification outcome requires manual reconciliation.');
      summary.failed++;
    }
  }
  return summary;
}

export function schedulePaidOrderMail({database,orderId,verified,paymentStatus,schedule,source=process.env,transportFactory=createMailTransport}) {
  if(!verified || paymentStatus!=='COMPLETE' || source.MAIL_ENABLED!=='true') return false;
  // Registration/provider errors must never prevent acknowledging an already
  // committed payment. Durable queued jobs remain available for recovery.
  try {
    const settings=mailSettings(source);
    const transport=transportFactory(settings);
    const task=drainOrderMail(database,transport,settings,{orderId})
      .catch(()=>console.error('order-mail: queued delivery requires review'))
      .finally(()=>transport.close());
    schedule(task);
    return true;
  } catch {
    console.error('order-mail: sender configuration requires review');
    return false;
  }
}
