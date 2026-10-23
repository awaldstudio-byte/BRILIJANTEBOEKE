export function initReportDownloads({language='en'}={}){
  const tr=(en,af)=>language==='af'?af:en;
  document.addEventListener('click',async event=>{
    const link=event.target.closest('[data-report-download]');if(!link)return;
    event.preventDefault();if(link.getAttribute('aria-disabled')==='true'||link.dataset.busy)return;
    const original=link.textContent;link.dataset.busy='1';link.setAttribute('aria-busy','true');link.textContent=tr('Preparing…','Word voorberei…');
    const message=document.querySelector('#report-message');if(message)message.textContent='';
    try{
      const response=await fetch(link.href,{credentials:'same-origin',cache:'no-store'});
      if(!response.ok){const result=await response.json().catch(()=>({}));throw Error(result.error||tr('The report could not be generated. Please try again.','Die verslag kon nie opgestel word nie. Probeer asseblief weer.'));}
      const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||'briljante-report';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      if(message)message.textContent=tr('Your report has downloaded.','U verslag is afgelaai.');
    }catch(error){if(message)message.textContent=error.message;else alert(error.message);}
    finally{link.textContent=original;delete link.dataset.busy;link.removeAttribute('aria-busy');}
  });
}
