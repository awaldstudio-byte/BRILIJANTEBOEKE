const technicalEmail = 'technical@awaldstudio.com';
const previewOrigin = 'https://briljante-preview-awaldstudio.vercel.app';
const previewProject = 'https://cigyxjfzbjlgbrduzcpw.supabase.co';

const previewDenied = () => Object.assign(new Error('Staff access on the preview is restricted to technical testing. Use the live administration site.'), { statusCode: 403 });

export function assertStaffEnvironmentConfiguration(source = process.env) {
  if (source.VERCEL_ENV === 'preview' && (source.APP_ORIGIN !== previewOrigin || source.SUPABASE_URL !== previewProject || source.DEMO_PAYMENTS_ENABLED !== 'true')) throw previewDenied();
}

export function assertStaffEnvironmentEmail(email, source = process.env) {
  assertStaffEnvironmentConfiguration(source);
  if (source.VERCEL_ENV === 'preview' && (typeof email !== 'string' || email.toLowerCase() !== technicalEmail)) throw previewDenied();
}
