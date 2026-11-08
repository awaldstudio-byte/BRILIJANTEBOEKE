import { readFileSync } from 'node:fs';

const logo = readFileSync(new URL('../../assets/images/logo.png', import.meta.url));
export const orderLogoCid = 'briljante-order-logo@briljanteboeke.co.za';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => new Intl.NumberFormat('en-ZA', {style:'currency',currency:'ZAR'}).format(cents / 100);
const percentage = (paid,expected) => expected > 0 ? Math.min(100,Math.round(paid/expected*100)) : 0;
// Table-based bars work without scripts, remote images or CSS layout support.
const progressBar = percent => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td height="8" bgcolor="#e1eaf0" style="height:8px;background:#e1eaf0;font-size:0;line-height:0;">${percent > 0 ? `<table role="presentation" width="${percent}%" cellspacing="0" cellpadding="0" border="0"><tr><td height="8" bgcolor="#31bfc4" style="height:8px;background:#31bfc4;font-size:0;line-height:0;">&nbsp;</td></tr></table>` : '&nbsp;'}</td></tr></table>`;

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
  const progress = !parent ? order.school_progress : null;
  const progressDate = progress ? new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'}).format(new Date(progress.captured_at)) : '';
  const overallPercent = progress ? percentage(progress.grades.reduce((sum,g)=>sum+Math.min(g.expected,g.paid),0),progress.totals.expected) : 0;
  const progressNote = 'Outstanding figures are based on the school’s expected quantities and configured prices, not an identified list of children with unpaid orders. Extra payments for one grade do not reduce another grade’s outstanding balance.';
  const progressText = progress ? ['School progress / Skoolvordering',`Snapshot: ${progressDate} (South Africa)`,
    `Books: expected ${progress.totals.expected} | paid ${progress.totals.paid} | outstanding ${progress.totals.outstanding}`,`Overall progress: ${overallPercent}% of expected books paid`,
    `Value: expected ${money(progress.totals.expected_value_cents)} | ${demo?'simulated paid':'paid'} ${money(progress.totals.paid_value_cents)} | outstanding ${money(progress.totals.outstanding_value_cents)}`,
    ...progress.grades.map(g=>`${g.name}: expected ${g.expected} | paid ${g.paid} | outstanding ${g.outstanding} | progress ${percentage(g.paid,g.expected)}% | expected value ${money(g.expected_value_cents)} | paid value ${money(g.paid_value_cents)} | outstanding value ${money(g.outstanding_value_cents)}`),
    progressNote,''] : [];
  const text = ['Briljante Boeke', `${demo ? 'DEMO - ' : ''}${title} / ${parent ? 'Bestelbevestiging' : 'Betalingsbevestiging'}`, '',
    ...(demo ? ['TEST ONLY. No money was charged. No real payment has been received.', ''] : []),
    introduction, '', `Order / Bestelling: ${order.reference}`, `School / Skool: ${school}`, ...(year ? [`Academic year / Akademiese jaar: ${year}`] : []),
    `${demo ? 'Simulated amount / Toetsbedrag' : 'Amount paid / Bedrag betaal'}: ${amount}`, '',
    ...lines.map(item => `${item.learner} | ${item.book} | Qty: ${item.quantity} | ${item.amount}`), '',
    ...(!parent ? [`Parent / Ouer: ${order.parent_first_name || ''} ${order.parent_last_name || ''}`, `Email: ${order.parent_email}`, `Mobile: ${order.parent_mobile || ''}`, ''] : []),
    ...progressText,
    delivery, 'Betalingsbevestiging is nie ’n versendings- of afleweringskennisgewing nie. Boeke word volgens die skool se bevestigde reëlings in grootmaat by die skool afgelewer.', '',
    ...(!parent ? [`View the order in the staff dashboard: ${appOrigin}/admin/?lang=en`, ''] : []),
    `Queries / Navrae: ${replyTo}`, 'Please quote your order reference when contacting us.', 'Briljante Boeke'].join('\n');
  const rows = lines.map(item => `<tr><td style="padding:16px 0;border-bottom:1px solid #e1e7ec;vertical-align:top;word-break:break-word;"><strong style="color:#18385f;font-size:15px;">${escape(item.learner)}</strong><br><span style="font-size:13px;color:#596675;">${escape(item.book)}<br>Quantity / Aantal: ${escape(item.quantity)}</span></td><td align="right" style="padding:16px 0 16px 12px;border-bottom:1px solid #e1e7ec;vertical-align:top;color:#18385f;font-size:14px;white-space:nowrap;">${escape(item.amount)}</td></tr>`).join('');
  const progressHtml = progress ? `<h2 style="margin:30px 0 8px;font-size:20px;line-height:28px;color:#18385f;">School progress / Skoolvordering</h2>
<p style="margin:0 0 16px;color:#596675;font-size:12px;line-height:20px;">${escape(school)}${year ? ` - ${escape(year)}` : ''}<br>Snapshot: ${escape(progressDate)} (South Africa)${demo ? '<br>Simulated payments only. No money received.' : ''}</p>
<table width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout:fixed;border-collapse:collapse;background:#edf5f7;"><thead><tr>${['Expected','Paid','Outstanding'].map(h=>`<th style="padding:12px 4px 5px;font-size:12px;line-height:18px;color:#465d70;overflow-wrap:anywhere;">${h}</th>`).join('')}</tr></thead><tbody><tr>${['expected','paid','outstanding'].map(k=>`<td align="center" style="padding:0 4px 14px;color:#18385f;font-size:23px;line-height:30px;font-weight:700;">${progress.totals[k]}<br><span style="font-size:11px;font-weight:400;color:#596675;">books</span></td>`).join('')}</tr></tbody></table>
<p style="margin:16px 0 8px;color:#18385f;font-size:13px;line-height:21px;"><strong>Overall progress: ${overallPercent}%</strong><br><span style="color:#596675;font-size:12px;">Of expected books paid</span></p>${progressBar(overallPercent)}
<table width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:12px;border-collapse:collapse;font-size:13px;line-height:21px;color:#465d70;">${[['Expected value',progress.totals.expected_value_cents],[demo?'Simulated paid value':'Paid value',progress.totals.paid_value_cents],['Outstanding value',progress.totals.outstanding_value_cents]].map(([label,value])=>`<tr><td style="padding:7px 0;border-bottom:1px solid #e1e7ec;">${label}</td><td align="right" style="padding:7px 0 7px 6px;border-bottom:1px solid #e1e7ec;color:#18385f;font-weight:700;white-space:nowrap;">${escape(money(value))}</td></tr>`).join('')}</table>
<h3 style="margin:24px 0 8px;font-size:16px;line-height:24px;color:#18385f;">Progress by grade</h3>
<table width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout:fixed;border-collapse:collapse;font-size:12px;line-height:19px;color:#465d70;"><colgroup><col width="22%"><col width="24%"><col width="20%"><col width="34%"></colgroup><thead><tr>${['Grade','Expected','Paid','Outstanding'].map(h=>`<th align="left" style="padding:10px 3px;border-bottom:1px solid #d4e0eb;overflow-wrap:anywhere;font-size:11px;">${h}</th>`).join('')}</tr></thead><tbody>${progress.grades.map(g=>`<tr><td style="padding:12px 3px 5px;overflow-wrap:anywhere;">${escape(g.name)}</td>${['expected','paid','outstanding'].map(k=>`<td style="padding:12px 3px 5px;">${g[k]}</td>`).join('')}</tr><tr><td colspan="4" style="padding:0 3px 12px;border-bottom:1px solid #e1e7ec;"><p style="margin:0 0 5px;text-align:right;font-size:11px;line-height:17px;color:#596675;">${percentage(g.paid,g.expected)}% of expected books paid</p>${progressBar(percentage(g.paid,g.expected))}</td></tr>`).join('')}</tbody></table>
<p style="margin:14px 0;color:#596675;font-size:12px;line-height:20px;">${escape(progressNote)}</p>` : '';
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
${rows ? `<table width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;"><thead><tr><th align="left" style="padding:16px 0 8px;font-size:12px;color:#596675;border-bottom:1px solid #e1e7ec;">CHILD AND WORKBOOK</th><th align="right" style="padding:16px 0 8px;font-size:12px;color:#596675;border-bottom:1px solid #e1e7ec;">AMOUNT</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
${progressHtml}
${!parent ? `<h2 style="margin:26px 0 8px;font-size:16px;line-height:24px;color:#18385f;">Parent contact</h2><p style="margin:0;color:#596675;font-size:14px;line-height:24px;">${escape(order.parent_first_name)} ${escape(order.parent_last_name)}<br>${escape(order.parent_email)}<br>${escape(order.parent_mobile)}</p><p style="margin:26px 0;"><a href="${escape(appOrigin)}/admin/?lang=en" style="display:inline-block;background:#18385f;color:#ffffff;text-decoration:none;padding:14px 22px;font-size:14px;line-height:22px;font-weight:700;">View order dashboard</a></p>` : ''}
<h2 style="margin:26px 0 8px;font-size:16px;line-height:24px;color:#18385f;">School delivery / Skoolaflewering</h2>
<p style="margin:0 0 10px;color:#596675;font-size:14px;line-height:23px;">${escape(delivery)}</p>
<p lang="af" style="margin:0;color:#596675;font-size:13px;line-height:21px;">Boeke word volgens die skool se bevestigde reëlings in grootmaat by die skool afgelewer. Hierdie e-pos beteken nie dat die boeke reeds versend is nie.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-top:28px;"><div style="border-top:1px solid #e1e7ec;font-size:0;line-height:0;">&nbsp;</div></td></tr><tr><td style="padding-top:20px;color:#596675;font-size:13px;line-height:22px;">Need help? / Hulp nodig?<br><a href="mailto:${escape(replyTo)}" style="color:#18385f;text-decoration:underline;">${escape(replyTo)}</a><br>Please quote your order reference.</td></tr></table>
</td></tr><tr><td align="center" style="padding:22px 12px 0;color:#64717e;font-size:12px;line-height:20px;">Sent by Briljante Boeke / Gestuur deur Briljante Boeke<br><a href="https://www.briljanteboeke.co.za/" style="color:#465d70;text-decoration:underline;">www.briljanteboeke.co.za</a></td></tr></table>
<!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`,
    attachments:[{filename:'briljante-boeke-logo.png',content:logo,contentType:'image/png',contentDisposition:'inline',cid:orderLogoCid}]};
}
