const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const tr = (language, af, en) => language === 'en' ? en : af;
export function refundPayment(order) {
  const attempts = (order.payment_attempts || []).filter(attempt => attempt.status === 'complete' && typeof attempt.provider_payment_id === 'string' && attempt.provider_payment_id.length);
  return order.status === 'paid' && Number.isSafeInteger(order.amount_cents) && order.amount_cents > 0 && attempts.length === 1 ? attempts[0] : null;
}
export function refundAction(order, { language = 'af', administrator = false, preview = false } = {}) {
  const record = order.order_refunds?.[0];
  if (order.status === 'refunded' && record) return `<br><small>${escape(tr(language,'Terugbetalingsverwysing: ','Refund reference: '))}${escape(record.provider_refund_reference)}</small>`;
  if (!administrator || preview || !refundPayment(order)) return '';
  return `<br><button type="button" class="text-button" data-record-refund="${escape(order.id)}">${tr(language,'Teken voltooide terugbetaling aan','Record completed refund')}</button>`;
}
export function refundDialogHtml(order, { language = 'af', now = new Date() } = {}) {
  const payment = refundPayment(order);
  if (!payment) throw new Error('Verified paid order required.');
  const copy = (af,en) => tr(language,af,en);
  const amount = new Intl.NumberFormat(language === 'en' ? 'en-ZA' : 'af-ZA',{style:'currency',currency:'ZAR'}).format(order.amount_cents/100);
  const localMaximum = new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  return `<form class="form-stack" data-refund-form>
    <h2 id="refund-title">${copy('Teken voltooide volle terugbetaling aan','Record completed full refund')}</h2>
    <p>${copy('Voltooi die terugbetaling eers in PayFast. Hierdie vorm teken die voltooide terugbetaling aan en kan geen geld stuur nie.','Complete the refund in PayFast first. This form records the completed refund and cannot send money.')}</p>
    <p><strong>${escape(order.reference)}</strong><br>${escape(order.schools?.name)}<br>${escape(order.parent_first_name)} ${escape(order.parent_last_name)}<br><strong>${escape(amount)}</strong></p>
    <p>${copy('Slegs die volle bestelbedrag kan hier aangeteken word. Boeke in ’n aktiewe afleweringsbatch moet eers nagegaan word.','Only the full order amount can be recorded here. Books in an active fulfilment batch require review first.')}</p>
    <label>${copy('Oorspronklike PayFast-transaksieverwysing','Original PayFast transaction reference')}<input name="provider_payment_id" value="${escape(payment.provider_payment_id)}" readonly required /></label>
    <label>${copy('Voltooide terugbetaling se bevestigingsverwysing','Completed refund confirmation reference')}<input name="provider_refund_reference" minlength="2" maxlength="100" autocomplete="off" required /><small>${copy('Gebruik die verwysing op PayFast se voltooide terugbetalingsrekord.','Use the reference on PayFast’s completed refund record.')}</small></label>
    <label>${copy('Datum en tyd waarop die terugbetaling voltooi is','Date and time the refund completed')}<input name="refunded_at" type="datetime-local" max="${escape(localMaximum)}" required /></label>
    <label>${copy('Rede vir terugbetaling','Refund reason')}<textarea name="reason" minlength="5" maxlength="500" rows="3" required></textarea></label>
    <label class="checkbox-field"><input name="confirm_external_refund" type="checkbox" required />${copy('Ek het bevestig dat die volle bedrag reeds in PayFast terugbetaal is.','I have confirmed that the full amount has already been refunded in PayFast.')}</label>
    <p class="form-message" data-refund-message role="status"></p>
    <div class="button-row"><button type="button" class="btn btn-outline" data-refund-close>${copy('Maak toe','Close')}</button><button type="submit" class="btn btn-primary">${copy('Teken voltooide terugbetaling aan','Record completed refund')}</button></div>
  </form>`;
}
export function initRefundReconciliation({ rows, getOrders, getStaff, preview, api, language = 'af', onRecorded, confirm = message => window.confirm(message) }) {
  let dialog;
  const copy = (af,en) => tr(language,af,en);
  const filter = document.querySelector('#order-filters [name=status]');
  if (filter && !filter.querySelector('option[value="refunded"]')) {
    const option=document.createElement('option');option.value='refunded';option.textContent=copy('Terugbetaal','Refunded');filter.append(option);
  }
  rows.addEventListener('click', event => {
    const button = event.target.closest('[data-record-refund]');
    if (!button || preview || getStaff()?.role !== 'administrator') return;
    const order=getOrders().find(item=>item.id===button.dataset.recordRefund);
    if (!order || !refundPayment(order)) return;
    if (dialog?.open) dialog.close();
    dialog=document.createElement('dialog');dialog.className='demo-payment-dialog';dialog.setAttribute('aria-labelledby','refund-title');
    dialog.innerHTML=refundDialogHtml(order,{language});document.body.append(dialog);
    dialog.querySelector('[data-refund-close]').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{dialog.remove();button.focus();},{once:true});
    dialog.querySelector('form').addEventListener('submit',async event=>{
      event.preventDefault();
      const form=event.currentTarget,message=form.querySelector('[data-refund-message]'),submit=form.querySelector('[type=submit]');
      if (submit.disabled || !form.reportValidity()) return;
      const values=Object.fromEntries(new FormData(form));
      if (!confirm(copy(`Teken die volle terugbetaling vir ${order.reference} aan? Bevestig dat die geld reeds in PayFast terugbetaal is.`,`Record the full refund for ${order.reference}? Confirm the money has already been refunded in PayFast.`))) return;
      let recorded=false;
      submit.disabled=true;form.querySelector('[data-refund-close]').disabled=true;message.textContent='';
      try {
        const refundedAt=new Date(values.refunded_at);
        if (!Number.isFinite(refundedAt.getTime())) throw new Error(copy('Kies ’n geldige voltooide terugbetalingsdatum.','Choose a valid completed refund date.'));
        const result=await api('/api/admin-orders/',{method:'POST',body:JSON.stringify({action:'record-full-refund',order_id:order.id,
          provider_payment_id:values.provider_payment_id,provider_refund_reference:values.provider_refund_reference,
          refunded_at:refundedAt.toISOString(),reason:values.reason,amount_cents:order.amount_cents,confirm_external_refund:values.confirm_external_refund==='on'})});
        if (result.money_moved !== false || result.refund?.order_status !== 'refunded') throw new Error(copy('Die rekord moet nagegaan word. Moenie weer ’n PayFast-terugbetaling stuur nie.','The record needs review. Do not send another PayFast refund.'));
        recorded=true;
        message.textContent=copy('Die voltooide terugbetaling is aangeteken. Hierdie aksie het geen geld gestuur of e-pos gestuur nie.','The completed refund is recorded. This action moved no money and sent no email.');
        for (const control of form.querySelectorAll('input,textarea')) control.disabled=true;
        await onRecorded();
      } catch(error) { message.textContent=recorded?copy('Die terugbetaling is aangeteken. Herlaai die dashboard om die jongste syfers te sien.','The refund is recorded. Reload the dashboard to see the latest figures.'):error.message;submit.disabled=recorded; }
      finally { form.querySelector('[data-refund-close]').disabled=false; }
    });
    dialog.showModal();
  });
}
