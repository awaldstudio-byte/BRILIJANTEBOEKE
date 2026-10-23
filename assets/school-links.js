// An identifier names a school; it never replaces its private access code.
export function schoolAccess(search) {
  const params = new URLSearchParams(search);
  return {
    token: params.get('school') ?? params.get('code') ?? '',
    identifier: params.get('identifier') ?? '',
  };
}

export function schoolOrderLink(origin, identifier, code = '', language = 'en') {
  const params = new URLSearchParams();
  if (identifier) params.set('identifier', identifier);
  if (code) params.set('school', code);
  params.set('lang', language === 'en' ? 'en' : 'af');
  return `${origin.replace(/\/$/, '')}/order/?${params}`;
}

export function paymentReadiness(config, preview = false) {
  return { enabled: preview || config?.payments_enabled === true };
}
