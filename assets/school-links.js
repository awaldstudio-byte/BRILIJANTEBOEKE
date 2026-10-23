// Parent school links are public catalogue links, not staff authentication.
export function schoolAccess(search) {
  const params = new URLSearchParams(search);
  return {
    token: params.get('school') ?? params.get('code') ?? '',
    identifier: params.get('identifier') ?? '',
    periodId: params.get('period') ?? '',
  };
}

export function schoolOrderLink(origin, identifier, language = 'en', periodId = '') {
  const params = new URLSearchParams();
  if (identifier) params.set('identifier', identifier);
  if (periodId) params.set('period', periodId);
  params.set('lang', language === 'en' ? 'en' : 'af');
  return `${origin.replace(/\/$/, '')}/order/?${params}`;
}

export function paymentReadiness(config, preview = false) {
  return { enabled: preview || config?.payments_enabled === true };
}
