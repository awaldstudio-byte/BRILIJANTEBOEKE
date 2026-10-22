import { readFileSync } from 'node:fs';

const logoContent = readFileSync(new URL('../../assets/images/logo.png', import.meta.url));
export const staffLogoCid = 'briljante-verification-logo@briljanteboeke.co.za';
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

export function staffVerificationContent(code, replyTo) {
  if (!/^\d{6,10}$/.test(code)) throw new Error('Invalid provider code.');
  if (typeof replyTo !== 'string' || !/^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(replyTo)) throw new Error('Invalid support address.');
  const support = escapeHtml(replyTo);
  return {
    text: [
      'Briljante Boeke', 'Email verification / E-posverifikasie', '',
      `Your verification code / U verifikasiekode: ${code}`, '',
      'Copy this code and enter it on the Briljante Boeke administration page where you requested it.',
      'Kopieer die kode en voer dit op die Briljante Boeke-administrasieblad in waar u dit aangevra het.', '',
      'Valid for 15 minutes. Single use only.', 'Geldig vir 15 minute. Slegs vir eenmalige gebruik.', '',
      'Do not share this code. Briljante Boeke will never ask you to send it by email or message.',
      'Moenie die kode deel nie. Briljante Boeke sal u nooit vra om dit per e-pos of boodskap te stuur nie.', '',
      'If you did not request this code, you can ignore this email.',
      'Indien u nie die kode aangevra het nie, kan u hierdie e-pos ignoreer.', '',
      `Help / Hulp: ${replyTo}`,
    ].join('\n'),
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Briljante Boeke — Email verification</title>
<style>@media only screen and (max-width:480px){.email-outer{padding:24px 12px!important}.email-card{padding:28px 24px!important}.email-title{font-size:25px!important;line-height:32px!important}.email-code{font-size:26px!important;letter-spacing:3px!important}.email-logo{width:128px!important;height:auto!important}}</style></head>
<body style="margin:0;padding:0;background-color:#f1f4f6;color:#18385f;font-family:Roboto,Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;color:#f1f4f6;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Your verification code is valid for 15 minutes. / U verifikasiekode is vir 15 minute geldig.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f1f4f6"><tr><td class="email-outer" align="center" style="padding:40px 20px;">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
<tr><td align="center" style="padding:0 0 28px;"><img class="email-logo" src="cid:${staffLogoCid}" width="144" height="103" alt="Briljante Boeke" style="display:block;width:144px;height:auto;border:0;color:#18385f;font-size:18px;"></td></tr>
<tr><td class="email-card" bgcolor="#ffffff" style="padding:40px 44px;background-color:#ffffff;border-top:4px solid #31bfc4;">
<h1 class="email-title" style="margin:0 0 22px;color:#18385f;font-size:28px;line-height:36px;font-weight:700;">Verify your email address</h1>
<p style="margin:0 0 10px;color:#424f5e;font-size:16px;line-height:26px;">Use the code below to continue with your Briljante Boeke administration account.</p>
<p lang="af" style="margin:0 0 28px;color:#596675;font-size:14px;line-height:23px;">Gebruik die kode hieronder om met u Briljante Boeke-administrasierekening voort te gaan.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#edf5f7" style="padding:22px 12px;background-color:#edf5f7;border:1px solid #d8e8ec;">
<p style="margin:0 0 10px;color:#465d70;font-size:11px;line-height:18px;font-weight:700;letter-spacing:1px;">VERIFICATION CODE / VERIFIKASIEKODE</p>
<p class="email-code" dir="ltr" style="margin:0;color:#18385f;font-family:'Courier New',Courier,monospace;font-size:30px;line-height:40px;font-weight:700;letter-spacing:4px;white-space:nowrap;">${code}</p>
</td></tr></table>
<p style="margin:14px 0 4px;color:#596675;font-size:13px;line-height:21px;">Select and copy the code, then paste it into the page where you requested it.</p>
<p lang="af" style="margin:0 0 24px;color:#596675;font-size:13px;line-height:21px;">Kies en kopieer die kode en plak dit op die blad waar u dit aangevra het.</p>
<p style="margin:0 0 6px;color:#18385f;font-size:14px;line-height:22px;font-weight:700;">Valid for 15 minutes. Single use only.</p>
<p lang="af" style="margin:0 0 26px;color:#596675;font-size:13px;line-height:21px;">Geldig vir 15 minute. Slegs vir eenmalige gebruik.</p>
<p style="margin:0 0 8px;color:#596675;font-size:13px;line-height:21px;">Do not share this code. Briljante Boeke will never ask you to send it by email or message. If you did not request it, you can ignore this email.</p>
<p lang="af" style="margin:0;color:#596675;font-size:13px;line-height:21px;">Moenie die kode deel nie. Briljante Boeke sal u nooit vra om dit per e-pos of boodskap te stuur nie. Indien u dit nie aangevra het nie, kan u hierdie e-pos ignoreer.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-top:28px;"><div style="border-top:1px solid #e1e7ec;font-size:0;line-height:0;">&nbsp;</div></td></tr><tr><td style="padding-top:20px;color:#596675;font-size:13px;line-height:22px;">Need help? / Hulp nodig?<br><a href="mailto:${support}" style="color:#18385f;text-decoration:underline;">${support}</a></td></tr></table>
</td></tr>
<tr><td align="center" style="padding:22px 12px 0;color:#64717e;font-size:12px;line-height:20px;">Sent by Briljante Boeke / Gestuur deur Briljante Boeke<br><a href="https://www.briljanteboeke.co.za/" style="color:#465d70;text-decoration:underline;">www.briljanteboeke.co.za</a></td></tr>
</table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`,
    attachments: [{ filename: 'briljante-boeke-logo.png', content: logoContent, contentType: 'image/png',
      contentDisposition: 'inline', cid: staffLogoCid }],
  };
}
