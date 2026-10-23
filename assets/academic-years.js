export function periodForYear(periods,schoolId,yearId) {
  return periods.filter(period=>period.school_id===schoolId&&period.academic_year_id===yearId)
    .sort((a,b)=>Date.parse(b.closes_at)-Date.parse(a.closes_at))[0];
}

export function initAcademicYears({state,preview,api,tr,setView,escapeHtml}) {
  const $=selector=>document.querySelector(selector);
  const select=$('#school-form [name=academic_year_id]');
  select.setAttribute('aria-label',tr('Akademiese jaar','Academic year'));
  const control=document.createElement('span');control.className='academic-year-control';
  const addButton=document.createElement('button');addButton.type='button';addButton.id='add-academic-year';
  addButton.className='btn btn-outline';addButton.textContent=tr('Voeg jaar by','Add year');
  select.replaceWith(control);control.append(select,addButton);
  const form=$('#academic-year-form'), input=$('#academic-year-value'), message=$('#academic-year-message');
  let saving=false;
  function render(selectedId=$('#school-form [name=academic_year_id]').value) {
    const years=state.catalog.academic_years;
    const select=$('#school-form [name=academic_year_id]');
    select.innerHTML=years.map(year=>`<option value="${escapeHtml(year.id)}">${escapeHtml(year.year)}</option>`).join('');
    if(years.some(year=>year.id===selectedId))select.value=selectedId;
    $('#academic-year-list').innerHTML=years.map(year=>`<li><strong>${escapeHtml(year.year)}</strong></li>`).join('')||`<li>${tr('Geen akademiese jare nie.','No academic years yet.')}</li>`;
    form.hidden=state.staff?.role!=='administrator';
    $('#add-academic-year').hidden=form.hidden;
    if(!input.value)input.value=String(Math.min(2100,Math.max(2026,...years.map(year=>year.year))+1));
  }
  $('#add-academic-year').addEventListener('click',()=>{setView('years');input.focus();});
  $('#academic-year-back').addEventListener('click',()=>{setView('schools');$('#school-form [name=academic_year_id]').focus();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(saving)return;
    saving=true;const button=form.querySelector('[type=submit]');button.disabled=true;message.textContent='';message.classList.remove('is-success');
    try {
      const year=Number(input.value);
      let result;
      if(preview){
        const existing=state.catalog.academic_years.find(item=>item.year===year);
        result={academic_year:existing||{id:crypto.randomUUID(),year,label:`${year} Academic Year`,is_active:true},created:!existing};
      }else result=await api('/api/admin-schools',{method:'POST',body:JSON.stringify({action:'create_academic_year',year})});
      const current=$('#school-form [name=academic_year_id]').value;
      const editingPeriod=!!$('#school-form [name=period_id]').value;
      state.catalog.academic_years=[...state.catalog.academic_years.filter(item=>item.id!==result.academic_year.id),result.academic_year].sort((a,b)=>b.year-a.year);
      // Never rerender/reset the school form: preserve its unsaved fields and
      // existing period selection while adding a year elsewhere in the UI.
      render(editingPeriod?current:result.academic_year.id);
      message.textContent=result.created
        ?tr(`Akademiese jaar ${year} is bygevoeg. Dit is nou op die skoolvorm beskikbaar.`,`Academic year ${year} added. It is now available in the school form.`)
        :tr(`Akademiese jaar ${year} bestaan reeds en is beskikbaar.`,`Academic year ${year} already exists and is available.`);
      message.classList.add('is-success');
      input.value=String(Math.min(2100,year+1));
    }catch(error){message.textContent=error.message;}
    finally{saving=false;button.disabled=false;}
  });
  return {render};
}
