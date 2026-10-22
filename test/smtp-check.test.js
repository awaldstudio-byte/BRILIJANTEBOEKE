import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySenderForBuild, safeSmtpCheckCode } from '../api/_lib/check-smtp.js';

const source = { SMTP_VERIFY_ON_BUILD: 'true', VERCEL_ENV: 'preview', MAIL_ENABLED: 'false',
  SMTP_HOST: 'smtp.purelymail.com', SMTP_PORT: '465', SMTP_USER: 'orders@briljanteboeke.co.za',
  SMTP_PASSWORD: 'synthetic-test-only', MAIL_FROM: 'orders@briljanteboeke.co.za' };

test('ordinary installations never connect to SMTP', async () => {
  assert.deepEqual(await verifySenderForBuild({}, () => { throw Error('Unexpected network access'); }), { checked: false });
});

test('explicit preview check authenticates only and does not enable runtime mail', async () => {
  let verified = 0, closed = 0;
  assert.deepEqual(await verifySenderForBuild(source, settings => {
    assert.equal(settings.password, source.SMTP_PASSWORD);
    return { async verify() { verified++; }, close() { closed++; } };
  }), { checked: true });
  assert.equal(verified, 1);
  assert.equal(closed, 1);
  assert.equal(source.MAIL_ENABLED, 'false');
});

test('check rejects production and unintended credential destinations', async () => {
  for (const changed of [{ VERCEL_ENV: 'production' }, { SMTP_HOST: 'attacker.invalid' },
    { SMTP_USER: 'another@briljanteboeke.co.za' }, { MAIL_FROM: 'another@briljanteboeke.co.za' }]) {
    await assert.rejects(verifySenderForBuild({ ...source, ...changed }, () => { throw Error('must not connect'); }),
      error => ['PREVIEW_REQUIRED', 'SENDER_CONFIGURATION_MISMATCH'].includes(error.code));
  }
});

test('failed authentication closes transport and only allow-listed error codes can be logged', async () => {
  let closed = false;
  const error = Object.assign(new Error('sensitive-provider-response'), { code: 'EAUTH' });
  await assert.rejects(verifySenderForBuild(source, () => ({
    async verify() { throw error; }, close() { closed = true; },
  })), { code: 'EAUTH' });
  assert.equal(closed, true);
  assert.equal(safeSmtpCheckCode(error), 'EAUTH');
  assert.equal(safeSmtpCheckCode({ code: 'SECRET_VALUE_IN_CODE' }), 'SMTP_CHECK_FAILED');
});
