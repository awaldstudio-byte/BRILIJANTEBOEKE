import { mailSettings, createMailTransport, drainOrderMail } from './order-mail.js';
import { demoStaffEmail } from './demo-payment.js';
import { sandboxEnvironment } from './sandbox-payment.js';
export function scheduleSandboxMail({ database, orderId, verified, paymentStatus, schedule, source = process.env, transportFactory = createMailTransport }) {
  if (!sandboxEnvironment(source) || !verified || paymentStatus !== 'COMPLETE') return false;
  try {
    const settings = { ...mailSettings({ ...source, MAIL_ENABLED: 'true', BRILJANTE_NOTIFICATION_EMAILS: demoStaffEmail }), demoOnly: true };
    const transport = transportFactory(settings);
    schedule(drainOrderMail(database, transport, settings, { orderId })
      .catch(() => console.error('sandbox-mail: queued delivery requires review')).finally(() => transport.close()));
    return true;
  } catch { console.error('sandbox-mail: sender configuration requires review'); return false; }
}
