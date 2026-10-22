import { pathToFileURL } from 'node:url';
import { mailSettings, createMailTransport } from './order-mail.js';

// A one-off, build-only authentication check. No public route, mail delivery,
// queue processing, secret output, or change to MAIL_ENABLED is involved.
export async function verifySenderForBuild(source = process.env, transportFactory = createMailTransport) {
  if (source.SMTP_VERIFY_ON_BUILD !== 'true') return { checked: false };
  if (source.VERCEL_ENV !== 'preview') throw Object.assign(new Error('Preview required.'), { code: 'PREVIEW_REQUIRED' });
  const settings = mailSettings({ ...source, MAIL_ENABLED: 'true' });
  if (settings.host !== 'smtp.purelymail.com' || settings.user !== 'orders@briljanteboeke.co.za' ||
      settings.from !== 'orders@briljanteboeke.co.za') {
    throw Object.assign(new Error('Unexpected sender configuration.'), { code: 'SENDER_CONFIGURATION_MISMATCH' });
  }
  const transport = transportFactory(settings);
  try {
    await transport.verify();
    return { checked: true };
  } finally {
    transport.close();
  }
}

export function safeSmtpCheckCode(error) {
  const allowed = new Set(['EAUTH', 'ESOCKET', 'ETIMEDOUT', 'EDNS', 'ECONNECTION',
    'MAIL_NOT_CONFIGURED', 'PREVIEW_REQUIRED', 'SENDER_CONFIGURATION_MISMATCH']);
  return allowed.has(error?.code) ? error.code : 'SMTP_CHECK_FAILED';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifySenderForBuild();
    console.log(result.checked ? 'SMTP check: authenticated over verified TLS; no email sent.' : 'SMTP check: not requested.');
  } catch (error) {
    // Do not print provider response/error objects: they may contain credentials.
    console.error(`SMTP check failed: ${safeSmtpCheckCode(error)}. No email sent.`);
    process.exitCode = 1;
  }
}
