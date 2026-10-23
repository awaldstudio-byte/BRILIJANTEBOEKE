const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Parent-facing output uses only this order and the parent's entered details.
// Staff navigation, delivery diagnostics and internal recipients stay internal.
export function parentOrderResult({order,parent,language='en'}) {
  const tr=(af,en)=>language==='en'?en:af;
  const amount=new Intl.NumberFormat(language==='en'?'en-ZA':'af-ZA',{style:'currency',currency:'ZAR'}).format(order.amount_cents/100);
  return `<p class="phase-label">DEMO / TOETS</p><h2>${tr('Bestelling ontvang','Order received')}</h2><p>${tr('Dankie','Thank you')}, ${escape(parent.first_name)}. ${tr('U toetsbestelling is aangeteken. Geen geld is gehef nie.','Your test order has been recorded. No money was charged.')}</p><div class="total-line"><span>${escape(order.reference)}</span><strong>${escape(amount)}</strong></div><p>${tr('Kontroleer','Check')} <strong>${escape(parent.email)}</strong> ${tr('vir u bestelbevestiging. Indien dit nie opdaag nie, kontak Briljante Boeke met u bestelverwysing.','for your order confirmation. If it does not arrive, contact Briljante Boeke with your order reference.')}</p><div class="button-row"><a class="btn btn-primary" href="/order/status/?reference=${encodeURIComponent(order.reference)}&lang=${language==='en'?'en':'af'}">${tr('Bekyk bestelling','View order')}</a></div>`;
}
