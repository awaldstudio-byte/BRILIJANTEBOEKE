export function confirmAdminAction({title,message,confirmLabel,cancelLabel,document:doc=document}) {
  const prior=doc.activeElement;
  return new Promise(resolve=>{
    const dialog=doc.createElement('dialog');dialog.className='admin-confirmation';
    const heading=doc.createElement('h2');heading.id='admin-confirm-title';heading.textContent=title;
    const description=doc.createElement('p');description.textContent=message;
    const actions=doc.createElement('div');actions.className='admin-confirmation-actions';
    const cancel=doc.createElement('button');cancel.type='button';cancel.className='btn btn-outline';cancel.textContent=cancelLabel;
    const accept=doc.createElement('button');accept.type='button';accept.className='btn btn-primary';accept.textContent=confirmLabel;
    dialog.setAttribute('aria-labelledby',heading.id);dialog.append(heading,description,actions);actions.append(cancel,accept);
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();if(prior?.isConnected)prior.focus();resolve(value);};
    cancel.addEventListener('click',()=>finish(false));accept.addEventListener('click',()=>finish(true));
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
    dialog.addEventListener('close',()=>finish(false));doc.body.append(dialog);dialog.showModal();cancel.focus();
  });
}
