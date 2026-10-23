import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sharp from 'sharp';

const logo = readFileSync(new URL('../../assets/images/logo.png',import.meta.url));
const regular = readFileSync(new URL('../../assets/fonts/roboto-print-regular.ttf',import.meta.url));
const boldBytes = readFileSync(new URL('../../assets/fonts/roboto-print-bold.ttf',import.meta.url));
const templatePath = new URL('../../assets/reports/report-base.xlsx',import.meta.url);
const navy='17385F',turquoise='269EA4',ink='263B50',pale='F2F6FA';
const tr=(r,en,af)=>r.language==='af'?af:en;
export const localDate=(value,language='en',withTime=true)=>value?new Intl.DateTimeFormat(language==='af'?'af-ZA':'en-ZA',{day:'2-digit',month:'short',year:'numeric',...(withTime?{hour:'2-digit',minute:'2-digit',hour12:false}:{}),timeZone:'Africa/Johannesburg'}).format(new Date(value)):'';
const context=r=>[r.period?.academic_years?.year,r.period?.name,r.batch?.label].filter(Boolean).join(' · ');
const countLine=r=>`${r.quantity} ${tr(r,r.quantity===1?'book':'books',r.quantity===1?'boek':'boeke')}  ·  ${r.orderCount} ${tr(r,r.orderCount===1?'order':'orders',r.orderCount===1?'bestelling':'bestellings')}`;
function notice(r){return r.hasDemo?tr(r,'Includes DEMO orders. Demo payments are simulated; no money was received.','Sluit DEMO-bestellings in. Demonstrasiebetalings is gesimuleer; geen geld is ontvang nie.'):r.batch?tr(r,'Fixed batch allocation. Later paid orders are not included.','Vaste batchtoewysing. Latere betaalde bestellings is nie ingesluit nie.'):tr(r,'Paid orders only. Learners are listed by grade and surname.','Slegs betaalde bestellings. Leerders is volgens graad en van gerangskik.');}

export async function reportXlsx(report){
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(readFileSync(templatePath));
  workbook.creator='Briljante Boeke';workbook.lastModifiedBy='Briljante Boeke';workbook.title=report.title;workbook.subject=report.scope;workbook.created=new Date(report.capturedAt);workbook.modified=new Date(report.capturedAt);
  const brandOnWhite=await sharp(logo).resize(128,66,{fit:'contain',background:'#FFFFFF'}).flatten({background:'#FFFFFF'}).png().toBuffer();
  const brandImage=workbook.addImage({buffer:brandOnWhite,extension:'png'}),schoolImage=report.schoolLogo?workbook.addImage({buffer:report.schoolLogo,extension:'png'}):null;
  const schoolMeta=report.schoolLogo?await sharp(report.schoolLogo).metadata():null;
  for(const [index,section] of report.sections.entries()){
    const sheet=index===0?workbook.worksheets[0]:workbook.addWorksheet(section.name);sheet.name=section.name;
    const last=section.columns.length;sheet.properties.defaultRowHeight=24;sheet.properties.tabColor={argb:navy};sheet.columns=section.columns.map(c=>({key:c.key,width:c.width}));
    // Imported XLSX cells may share style objects. Isolate them before styling the header.
    for(let row=1;row<=10;row++)for(let column=1;column<=Math.max(10,last);column++)sheet.getCell(row,column).style={font:{name:'Arial',size:11,color:{argb:ink}},fill:{type:'pattern',pattern:'none'},alignment:{horizontal:'left',vertical:'middle'}};
    sheet.views=[{state:'frozen',ySplit:10,showGridLines:false}];sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'10:10',margins:{left:.3,right:.3,top:.4,bottom:.45,header:.15,footer:.2},horizontalCentered:true};
    sheet.headerFooter={oddFooter:`&LBriljante Boeke&R${tr(report,'Page','Bladsy')} &P / &N`};
    for(let row=1;row<=10;row++){const r=sheet.getRow(row);r.height=row===1?12:row===5?30:row===9?12:23;r.font={name:'Arial',size:11,color:{argb:ink}};}
    sheet.addImage(brandImage,{tl:{col:.12,row:1.18},ext:{width:128,height:66},editAs:'absolute'});
    if(schoolImage!==null){const scale=Math.min(70/schoolMeta.width,68/schoolMeta.height),columnPx=section.columns.at(-1).width*7+5;sheet.addImage(schoolImage,{tl:{col:last-1+Math.max(0,(columnPx-76)/columnPx),row:1.15},ext:{width:schoolMeta.width*scale,height:schoolMeta.height*scale},editAs:'absolute'});}
    for(const [row,value]of[[5,section.name],[6,report.scope+(context(report)?` · ${context(report)}`:'')],[7,`${countLine(report)}  |  ${tr(report,'Generated','Opgestel')}: ${localDate(report.capturedAt,report.language)} SAST`],[8,notice(report)]]){
      sheet.mergeCells(row,1,row,last);const cell=sheet.getCell(row,1);cell.value=value;cell.alignment={vertical:'middle',wrapText:true};if(row===5)cell.font={name:'Arial',size:17,bold:true,color:{argb:navy}};if(row===8){cell.font={name:'Arial',size:10,color:{argb:'526779'}};sheet.getRow(row).height=30;}
    }
    const header=sheet.getRow(10);header.height=32;section.columns.forEach((c,i)=>{const cell=header.getCell(i+1);cell.value=c.label;cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:navy}};cell.font={name:'Arial',size:11,bold:true,color:{argb:'FFFFFF'}};cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};});
    section.rows.forEach((record,index)=>{
      const row=sheet.getRow(index+11);let lines=1;section.columns.forEach((c,i)=>{const cell=row.getCell(i+1),value=record[c.key];
        if(c.type==='date'){cell.value=value?new Date(new Date(value).getTime()+2*3600000):null;cell.numFmt='dd mmm yyyy hh:mm';}else{cell.value=value??'';cell.numFmt=c.type==='money'?'"R" #,##0.00':c.type==='integer'?'0':'@';}
        cell.font={name:'Arial',size:11,color:{argb:ink}};cell.alignment={vertical:'middle',horizontal:['integer','money'].includes(c.type)?'right':'left',wrapText:true,indent:1};if(index%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:pale}};lines=Math.max(lines,Math.ceil(String(value??'').length/Math.max(8,c.width-4)));
      });row.height=Math.max(28,lines*16+10);
    });
    if(!section.rows.length){sheet.mergeCells(11,1,11,last);sheet.getCell(11,1).value=tr(report,'No paid learners match this selection.','Geen betaalde leerders pas by hierdie keuse nie.');sheet.getRow(11).height=32;}
    const end=10+section.rows.length;sheet.autoFilter={from:{row:10,column:1},to:{row:Math.max(10,end),column:last}};
    const qty=section.columns.findIndex(c=>c.key==='quantity'),amount=section.columns.findIndex(c=>c.key==='amount'),sumIndex=qty>=0?qty:amount;
    if(sumIndex>=0&&section.rows.length){const row=sheet.getRow(end+2);row.height=30;row.font={name:'Arial',size:11,bold:true,color:{argb:navy}};row.getCell(1).value=qty>=0?tr(report,'TOTAL BOOKS','TOTALE BOEKE'):tr(report,'TOTAL PAID (ZAR)','TOTAAL BETAAL (ZAR)');const cell=row.getCell(sumIndex+1),letter=cell.address.replace(/\d+/g,'');cell.value={formula:`SUM(${letter}11:${letter}${end})`,result:section.rows.reduce((sum,item)=>sum+item[section.columns[sumIndex].key],0)};cell.numFmt=qty>=0?'0':'"R" #,##0.00';}
    sheet.pageSetup.printArea=`A1:${sheet.getColumn(last).letter}${end+3}`;
  }return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function reportPdf(report){
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);pdf.setTitle(`${report.title} - ${report.scope}`);pdf.setAuthor('Briljante Boeke');pdf.setCreator('Briljante Boeke');pdf.setProducer('Briljante Boeke');pdf.setCreationDate(new Date(report.capturedAt));
  const font=await pdf.embedFont(regular,{subset:true}),bold=await pdf.embedFont(boldBytes,{subset:true}),brandImage=await pdf.embedPng(logo),schoolImage=report.schoolLogo?await pdf.embedPng(report.schoolLogo):null;
  const width=841.89,height=595.28,margin=36,usable=width-2*margin,color=hex=>rgb(...hex.match(/../g).map(v=>parseInt(v,16)/255)),supported=new Set(font.getCharacterSet());
  const clean=value=>[...String(value??'').replace(/[\x00-\x1f]/g,' ')].map(ch=>supported.has(ch.codePointAt(0))?ch:'?').join('');
  function wrap(value,max,size,face=font){const lines=[];let current='';for(const word of clean(value).split(/\s+/)){const candidate=current?`${current} ${word}`:word;if(face.widthOfTextAtSize(candidate,size)<=max){current=candidate;continue;}if(current){lines.push(current);current='';}for(const ch of word){if(face.widthOfTextAtSize(current+ch,size)>max){lines.push(current);current='';}current+=ch;}}if(current)lines.push(current);return lines.length?lines:[''];}
  let page,y;
  function text(value,x,top,size=10,strong=false,tone=ink){page.drawText(clean(value),{x,y:height-top-size,size,font:strong?bold:font,color:color(tone)});}
  function image(embedded,x,top,maxW,maxH,background=false){if(background)page.drawRectangle({x,y:height-top-maxH,width:maxW,height:maxH,color:color(navy)});const scale=Math.min((maxW-8)/embedded.width,(maxH-6)/embedded.height);page.drawImage(embedded,{x:x+(maxW-embedded.width*scale)/2,y:height-top-(maxH+embedded.height*scale)/2,width:embedded.width*scale,height:embedded.height*scale});}
  function newPage(section,label,columns,widths){
    page=pdf.addPage([width,height]);page.drawRectangle({x:0,y:height-4,width,height:4,color:color(turquoise)});image(brandImage,margin,17,112,57);if(schoolImage)image(schoolImage,width-margin-72,14,72,64);
    text(section.name,margin+130,23,19,true,navy);let top=49;for(const line of wrap(`${report.scope}${context(report)?` · ${context(report)}`:''}`,usable-220,10,bold)){text(line,margin+130,top,10,true);top+=13;}y=Math.max(91,top+14);
    text(`${countLine(report)}  |  ${tr(report,'Generated','Opgestel')}: ${localDate(report.capturedAt,report.language)} SAST`,margin,y,9,false,'526779');y+=19;for(const line of wrap(notice(report),usable,9)){text(line,margin,y,9,false,'526779');y+=12;}
    if(label){y+=8;for(const line of wrap(label,usable,10,bold)){text(line,margin,y,10,true,navy);y+=14;}}y+=10;
    const headers=columns.map((c,i)=>wrap(c.label,widths[i]-16,9,bold)),headerHeight=Math.max(30,...headers.map(lines=>lines.length*12+14));page.drawRectangle({x:margin,y:height-y-headerHeight,width:usable,height:headerHeight,color:color(navy)});let x=margin;headers.forEach((lines,i)=>{lines.forEach((line,j)=>text(line,x+8,y+7+j*12,9,true,'FFFFFF'));x+=widths[i];});y+=headerHeight;
  }
  for(const section of report.sections.filter(s=>!s.internal)){
    const groups=new Map();for(const record of section.rows){const label=report.batch||report.period?'':[...(!report.school?[record.school]:[]),record.year,record.period].filter(Boolean).join(' · ');if(!groups.has(label))groups.set(label,[]);groups.get(label).push(record);}if(!groups.size)groups.set('',[]);
    const columns=section.columns.filter(c=>!['school','year','period'].includes(c.key)),weights={grade:55,learner:160,class:54,book:190,quantity:42,reference:150,paidAt:105},sum=columns.reduce((n,c)=>n+(weights[c.key]||70),0),widths=columns.map(c=>(weights[c.key]||70)/sum*usable);
    for(const[label,records]of groups){newPage(section,label,columns,widths);if(!records.length){text(tr(report,'No paid learners match this selection.','Geen betaalde leerders pas by hierdie keuse nie.'),margin+8,y+16,11);continue;}
      records.forEach((record,index)=>{const cells=columns.map((c,i)=>wrap(c.type==='date'?localDate(record[c.key],report.language,false):record[c.key],widths[i]-16,10)),rowHeight=Math.max(30,...cells.map(lines=>lines.length*13+14)),totalSpace=index===records.length-1?31:0;if(y+rowHeight+totalSpace>height-57)newPage(section,label,columns,widths);if(y+rowHeight+totalSpace>height-57)throw Object.assign(new Error('A report row is too long to print. Please shorten the workbook or learner details.'),{statusCode:422});if(index%2===0)page.drawRectangle({x:margin,y:height-y-rowHeight,width:usable,height:rowHeight,color:color(pale)});let x=margin;cells.forEach((lines,i)=>{lines.forEach((line,j)=>text(line,x+8,y+7+j*13,10));x+=widths[i];});y+=rowHeight;});
      if(y+31>height-57)newPage(section,label,columns,widths);text(`${tr(report,'Total books','Totale boeke')}: ${records.reduce((sum,row)=>sum+row.quantity,0)}`,margin+8,y+12,10,true,navy);
    }
  }
  const pages=pdf.getPages();pages.forEach((p,i)=>{page=p;p.drawLine({start:{x:margin,y:35},end:{x:width-margin,y:35},thickness:.6,color:color('D4DFE8')});text('Briljante Boeke',margin,height-25,8,false,'526779');text(`${tr(report,'Page','Bladsy')} ${i+1} / ${pages.length}`,width-margin-66,height-25,8,false,'526779');});return Buffer.from(await pdf.save());
}

export function reportCsv(report){
  const section=report.sections.find(s=>s.name===tr(report,'Paid learner register','Betaalde leerderlys'))||report.sections.at(-1);
  const cell=value=>{let text=String(value??'');if(/^[\s]*[=+\-@]|^[\t\r\n]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`;};
  const rows=[section.columns.map(c=>c.label),...section.rows.map(row=>section.columns.map(c=>c.type==='date'?localDate(row[c.key],report.language):row[c.key]))];
  if(report.batch){const packing=report.sections[0];rows.unshift([report.title],[report.scope],[context(report)],[],packing.columns.map(c=>c.label),...packing.rows.map(row=>packing.columns.map(c=>row[c.key])),[],[section.name]);}
  return Buffer.from('\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n'),'utf8');
}
