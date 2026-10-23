export function allowedBatchStatuses(current){
  if(['delivered','cancelled'].includes(current))return[current];
  if(current==='dispatched')return['dispatched','delivered'];
  return['created','packing','ready','dispatched','cancelled'];
}
export function shippingUpdateSummary(rows,event){
  const summary={sent:0,queued:0,processing:0,review:0};
  for(const row of rows||[])if(row.event===event){const key=row.status==='failed'?'review':row.status;if(key in summary)summary[key]+=Number(row.count);}
  return summary;
}
