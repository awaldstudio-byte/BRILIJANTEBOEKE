export function initSchoolMaterials({panel,school,periodId,language,preview,tr,api}) {
  const section=document.createElement('section');
  section.className='school-materials';section.setAttribute('aria-label',tr('Skool se QR-kode en plakkaat','School QR code and poster'));
  const query=new URLSearchParams({school_id:school.id,period_id:periodId,lang:language});
  section.innerHTML=`<h3>${tr('QR-kode en plakkaat','QR code and poster')}</h3><p>${tr('Laai die QR-kode af, of skep ’n A4-plakkaat met die skool se naam, logo, grade en sluitingsdatum.','Download the QR code, or create an A4 poster with the school’s name, logo, grades and closing date.')}</p><div class="school-logo-preview" hidden><img alt="${tr('Gestoorde skoollogo','Saved school logo')}" /></div><label>${tr('Skoollogo (PNG of JPG, hoogstens 2 MB)','School logo (PNG or JPG, up to 2 MB)')}<input type="file" accept="image/png,image/jpeg" data-school-logo /></label><button class="btn btn-outline" data-upload-logo type="button">${tr('Stoor skoollogo','Save school logo')}</button><div class="share-actions"><a class="btn btn-outline" href="/api/admin-school-materials?${query}&format=qr">${tr('Laai QR-kode af (PNG)','Download QR (PNG)')}</a><a class="btn btn-primary" href="/api/admin-school-materials?${query}&format=poster">${tr('Laai plakkaat af (PDF)','Download poster (PDF)')}</a></div><p class="quiet-text">${tr('Geen skoollogo beskikbaar nie? Die plakkaat gebruik steeds die skoolnaam en Briljante Boeke se handelsmerk.','No school logo yet? The poster will still use the school name and Briljante Boeke branding.')}</p><p class="quiet-text">${tr('Voorskouskakels is vir toetsing. Laai ’n nuwe plakkaat af nadat die regte webadres en betalings gereed is. Laai ook weer af as gedrukte besonderhede verander.','Preview links are for testing. Download a fresh poster once the final domain and payments are ready, and whenever printed details change.')}</p><p data-material-status role="status"></p>`;
  panel.append(section);
  const status=section.querySelector('[data-material-status]'),image=section.querySelector('img'),previewBox=section.querySelector('.school-logo-preview');
  const show=logo=>{previewBox.hidden=!logo;if(logo)image.src=logo;};
  const upload=section.querySelector('[data-upload-logo]');
  if(preview){
    for(const a of section.querySelectorAll('a')){a.removeAttribute('href');a.setAttribute('aria-disabled','true');}
    upload.disabled=true;status.textContent=tr('Demonstrasie: gebruik ’n gestoorde skool om aflaaie en logo-oplaaie te toets.','Demonstration: use a saved school to test downloads and logo uploads.');return;
  }
  api(`/api/admin-school-materials?school_id=${encodeURIComponent(school.id)}&format=logo`).then(result=>show(result.logo)).catch(error=>{status.textContent=error.message;});
  for(const link of section.querySelectorAll('a'))link.addEventListener('click',async event=>{
    event.preventDefault();
    if(link.getAttribute('aria-disabled')==='true')return;
    link.setAttribute('aria-disabled','true');
    status.textContent=tr('Aflaai word voorberei…','Preparing download…');
    try {
      const response=await fetch(link.href,{credentials:'same-origin'});
      if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||tr('Die aflaai kon nie voorberei word nie.','The download could not be prepared.'));}
      const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'school-ordering-download';
      document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      status.textContent=tr('Aflaai is gereed.','Download ready.');
    }catch(error){status.textContent=error.message;}finally{link.removeAttribute('aria-disabled');}
  });
  upload.addEventListener('click',async()=>{
    const file=section.querySelector('[data-school-logo]').files[0];
    if(!file||!['image/png','image/jpeg'].includes(file.type)||file.size>2*1024*1024){status.textContent=tr('Kies ’n PNG- of JPG-logo van hoogstens 2 MB.','Choose a PNG or JPG logo up to 2 MB.');return;}
    upload.disabled=true;status.textContent=tr('Logo word gestoor…','Saving logo…');
    try {
      const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error(tr('Die lêer kon nie gelees word nie.','The file could not be read.')));reader.readAsDataURL(file);});
      const result=await api(`/api/admin-school-materials?school_id=${encodeURIComponent(school.id)}`,{method:'POST',body:JSON.stringify({logo_base64:base64})});
      show(result.logo);status.textContent=tr('Skoollogo is gestoor. Nuwe plakkate sal dit gebruik.','School logo saved. New posters will include it.');
    }catch(error){status.textContent=error.message;}finally{upload.disabled=false;}
  });
}
