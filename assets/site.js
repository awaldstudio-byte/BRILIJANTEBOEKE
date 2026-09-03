
(function(){
 const body=document.body;
 const saved=localStorage.getItem('bb-lang')||'af';
 function setLang(lang){body.dataset.lang=lang;localStorage.setItem('bb-lang',lang);document.documentElement.lang=lang==='af'?'af':'en';document.querySelectorAll('[data-lang-btn]').forEach(b=>b.classList.toggle('on',b.dataset.langBtn===lang));}
 setLang(saved);
 document.querySelectorAll('[data-lang-btn]').forEach(b=>b.addEventListener('click',()=>setLang(b.dataset.langBtn)));
 const mt=document.querySelector('.mobile-toggle'), mm=document.querySelector('.mobile-menu'); if(mt&&mm) mt.addEventListener('click',()=>mm.classList.toggle('open'));
 document.querySelectorAll('[data-mail-form]').forEach(form=>form.addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(form);const to=form.dataset.to||'sales@briljanteboeke.co.za';let subject=fd.get('subject')||'Briljante Boeke enquiry';let lines=[];for(const [k,v] of fd.entries()){if(k==='subject'||!v) continue;lines.push(`${k}: ${v}`)}location.href=`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;}));
 const q=new URLSearchParams(location.search); const requested=q.get('grade'); if(requested){const box=document.querySelector(`input[name="Grade ${requested}"]`); if(box) box.checked=true;}
 document.querySelectorAll('[data-copy]').forEach(btn=>btn.addEventListener('click',async()=>{await navigator.clipboard.writeText(btn.dataset.copy);const old=btn.textContent;btn.textContent='Copied';setTimeout(()=>btn.textContent=old,1300)}));
})();
