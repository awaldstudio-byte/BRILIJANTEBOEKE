import { readFileSync } from 'node:fs';

const logo = readFileSync(new URL('../../assets/images/logo.png', import.meta.url));
export const orderLogoCid = 'briljante-order-logo@briljanteboeke.co.za';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => new Intl.NumberFormat('en-ZA', {style:'currency',currency:'ZAR'}).format(cents / 100);

export function orderEmailContent(order, {parent, demo = false, replyTo, appOrigin}) {
  const school = order.schools?.name || 'School / Skool';
  const year = order.ordering_periods?.academic_years?.year;
  const title = parent ? 'Order confirmation' : 'Payment confirmation';
  const amount = money(order.amount_cents);
  const lines = (order.order_items || []).map(item => ({
    learner: `${item.learners?.first_name || ''} ${item.learners?.last_name || ''}`.trim(),
    book: item.description_snapshot, quantity: item.quantity, amount: money(item.line_total_cents),
  }));
  const introduction = demo
    ? (parent ? 'Your test order has been recorded successfully.' : 'A test school order has completed the simulated payment step.')
    : (parent ? 'Thank you. Your payment has been verified and your workbook order is confirmed.' : 'A school workbook payment has been verified and the order is recorded as paid.');
  const delivery = 'Payment confirmation is not a dispatch or delivery notification. Books are delivered in bulk to the school under its confirmed delivery arrangements.';
  const text = ['Briljante Boeke', `${demo ? 'DEMO - ' : ''}${title} / ${parent ? 'Bestelbevestiging' : 'Betalingsbevestiging'}`, '',
    ...(demo ? ['TEST ONLY. No money was charged. No real payment has been received.', ''] : []),
    introduction, '', `Order / Bestelling: ${order.reference}`, `School / Skool: ${school}`, ...(year ? [`Academic year / Akademiese jaar: ${year}`] : []),
    `${demo ? 'Simulated amount / Toetsbedrag' : 'Amount paid / Bedrag betaal'}: ${amount}`, '',
    ...lines.map(item => `${item.learner} | ${item.book} | Qty: ${item.quantity} | ${item.amount}`), '',
    ...(!parent ? [`Parent / Ouer: ${order.parent_first_name || ''} ${order.parent_last_name || ''}`, `Email: ${order.parent_email}`, `Mobile: ${order.parent_mobile || ''}`, ''] : []),
    delivery, 'Betalingsbevestiging is nie ’n versendings- of afleweringskennisgewing nie. Boeke word volgens die skool se bevestigde reëlings in grootmaat by die skool afgelewer.', '',
    ...(!parent ? [`View the order in the staff dashboard: ${appOrigin}/admin/?lang=en`, ''] : []),
    `Queries / Navrae: ${replyTo}`, 'Please quote your order reference when contacting us.', 'Briljante Boeke'].join('\n');
  const rows = lines.map(item => `<tr><td style="padding:16px 0;border-bottom:1px solid #e1e7ec;vertical-align:top;word-break:break-word;"><strong style="color:#18385f;font-size:15px;">${escape(item.learner)}</strong><br><span style="font-size:13px;color:#596675;">${escape(item.book)}<br>Quantity / Aantal: ${escape(item.quantity)}</span></td><td align="right" style="padding:16px 0 16px 12px;border-bottom:1px solid #e1e7ec;vertical-align:top;color:#18385f;font-size:14px;white-space:nowrap;">${escape(item.amount)}</td></tr>`).join('');
  return {text, html:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Briljante Boeke - ${title}</title>
<style>@media only screen and (max-width:480px){.email-outer{padding:24px 12px!important}.email-card{padding:28px 22px!important}.email-title{font-size:25px!important;line-height:32px!important}.email-amount{font-size:29px!important}.email-logo{width:128px!important;height:auto!important}}</style></head>
<body style="margin:0;padding:0;background-color:#f1f4f6;color:#18385f;font-family:Roboto,Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escape(demo ? 'Test only. No money was charged.' : introduction)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f1f4f6"><tr><td class="email-outer" align="center" style="padding:40px 20px;">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;table-layout:fixed;">
<tr><td align="center" style="padding:0 0 28px;"><img class="email-logo" src="cid:${orderLogoCid}" width="144" height="103" alt="Briljante Boeke" style="display:block;width:144px;height:auto;border:0;"></td></tr>
<tr><td class="email-card" bgcolor="#ffffff" style="padding:40px 44px;background-color:#ffffff;border-top:4px solid #31bfc4;word-wrap:break-word;overflow-wrap:anywhere;">
${demo ? '<p style="margin:0 0 24px;padding:14px;background:#fff4dc;color:#6b4b0a;font-size:13px;line-height:21px;"><strong>DEMO / TOETS</strong><br>No money was charged. No real payment has been received.</p>' : ''}
<h1 class="email-title" style="margin:0 0 12px;color:#18385f;font-size:28px;line-height:36px;font-weight:700;">${title}</h1>
<p lang="af" style="margin:0 0 26px;color:#596675;font-size:14px;line-height:23px;">${parent ? 'Bestelbevestiging' : 'Betalingsbevestiging'}</p>
${parent ? `<p style="margin:0 0 12px;color:#424f5e;font-size:16px;line-height:26px;">Hello ${escape(order.parent_first_name || 'there')},</p>` : ''}
<p style="margin:0 0 26px;color:#424f5e;font-size:16px;line-height:26px;">${escape(introduction)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#edf5f7" style="padding:22px;background-color:#edf5f7;border:1px solid #d8e8ec;">
<p style="margin:0 0 8px;color:#465d70;font-size:11px;line-height:18px;font-weight:700;letter-spacing:1px;">${demo ? 'SIMULATED PAYMENT / TOETSBETALING' : 'PAYMENT RECEIVED / BETALING ONTVANG'}</p>
<p class="email-amount" style="margin:0 0 12px;font-size:34px;line-height:42px;font-weight:700;color:#18385f;">${escape(amount)}</p>
<p style="margin:0;color:#465d70;font-size:14px;line-height:23px;">Order / Bestelling<br><strong style="color:#18385f;">${escape(order.reference)}</strong></p></td></tr></table>
<p style="margin:26px 0 4px;color:#18385f;font-size:17px;line-height:25px;font-weight:700;">${escape(school)}</p>
${year ? `<p style="margin:0 0 8px;color:#596675;font-size:13px;line-height:21px;">Academic year / Akademiese jaar: ${escape(year)}</p>` : ''}
${rows ? `<table width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;"><thead><tr><th align="left" style="padding:16px 0 8px;font-size:12px;color:#596675;border-bottom:1px solid #e1e7ec;">LEARNER AND WORKBOOK</th><th align="right" style="padding:16px 0 8px;font-size:12px;color:#596675;border-bottom:1px solid #e1e7ec;">AMOUNT</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
${!parent ? `<h2 style="margin:26px 0 8px;font-size:16px;line-height:24px;color:#18385f;">Parent contact</h2><p style="margin:0;color:#596675;font-size:14px;line-height:24px;">${escape(order.parent_first_name)} ${escape(order.parent_last_name)}<br>${escape(order.parent_email)}<br>${escape(order.parent_mobile)}</p><p style="margin:26px 0;"><a href="${escape(appOrigin)}/admin/?lang=en" style="display:inline-block;background:#18385f;color:#ffffff;text-decoration:none;padding:14px 22px;font-size:14px;line-height:22px;font-weight:700;">View order dashboard</a></p>` : ''}
<h2 style="margin:26px 0 8px;font-size:16px;line-height:24px;color:#18385f;">School delivery / Skoolaflewering</h2>
<p style="margin:0 0 10px;color:#596675;font-size:14px;line-height:23px;">${escape(delivery)}</p>
<p lang="af" style="margin:0;color:#596675;font-size:13px;line-height:21px;">Boeke word volgens die skool se bevestigde reëlings in grootmaat by die skool afgelewer. Hierdie e-pos beteken nie dat die boeke reeds versend is nie.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-top:28px;"><div style="border-top:1px solid #e1e7ec;font-size:0;line-height:0;">&nbsp;</div></td></tr><tr><td style="padding-top:20px;color:#596675;font-size:13px;line-height:22px;">Need help? / Hulp nodig?<br><a href="mailto:${escape(replyTo)}" style="color:#18385f;text-decoration:underline;">${escape(replyTo)}</a><br>Please quote your order reference.</td></tr></table>
</td></tr><tr><td align="center" style="padding:22px 12px 0;color:#64717e;font-size:12px;line-height:20px;">Sent by Briljante Boeke / Gestuur deur Briljante Boeke<br><a href="https://www.briljanteboeke.co.za/" style="color:#465d70;text-decoration:underline;">www.briljanteboeke.co.za</a></td></tr></table>
<!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`,
    attachments:[{filename:'briljante-boeke-logo.png',content:logo,contentType:'image/png',contentDisposition:'inline',cid:orderLogoCid}]};
}
