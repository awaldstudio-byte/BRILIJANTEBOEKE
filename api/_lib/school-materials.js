import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { schoolOrderLink } from '../../assets/school-links.js';

export const logoBucket = 'briljante-school-logos';
export const maxLogoBytes = 2 * 1024 * 1024;
const brandLogo = readFileSync(new URL('../../assets/images/logo.png', import.meta.url));
const brandFont = readFileSync(new URL('../../assets/fonts/roboto-print-regular.ttf', import.meta.url));
const brandBold = readFileSync(new URL('../../assets/fonts/roboto-print-bold.ttf', import.meta.url));
export const logoPath = schoolId => `${schoolId}/logo.png`;

export async function normalizeSchoolLogo(base64) {
  if (typeof base64 !== 'string' || base64.length > 2_800_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw invalidLogo();
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > maxLogoBytes || bytes.toString('base64') !== base64) throw invalidLogo();
  try {
    const input = sharp(bytes, { limitInputPixels: 4_000_000, failOn: 'warning' });
    const meta = await input.metadata();
    if (!['png', 'jpeg'].includes(meta.format) || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height) throw invalidLogo();
    const png = await input.rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    if (png.length > maxLogoBytes) throw invalidLogo();
    return png;
  } catch { throw invalidLogo(); }
}
function invalidLogo() { return Object.assign(new Error('Choose a valid, non-animated PNG or JPG logo up to 2 MB and 4 million pixels.'), { statusCode: 400 }); }
export async function readSchoolLogo(database, schoolId) {
  const { data, error } = await database.storage.from(logoBucket).download(logoPath(schoolId));
  if (error) {
    if (String(error.statusCode) === '404' || /^(Object not found|The resource was not found)$/i.test(error.message)) return null;
    throw Object.assign(new Error('The school logo could not be loaded.'), { code: 'LOGO_STORAGE_UNAVAILABLE' });
  }
  if (data.size > maxLogoBytes) throw invalidLogo();
  return Buffer.from(await data.arrayBuffer());
}
export function materialLink(origin, school, period, language) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid ordering origin.');
  return schoolOrderLink(base.origin, school.slug, language, period.id);
}
export function qrPng(link) { return QRCode.toBuffer(link, { type: 'png', width: 1800, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }); }

export async function posterPdf({ school, period, gradeNames, origin, language = 'en', schoolLogo = null, ready = false }) {
  const link = materialLink(origin, school, period, language);
  const english = language === 'en';
  const tr = (af, en) => english ? en : af;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${school.name} - ${period.academic_years?.year ?? ''} workbook orders`);
  pdf.setAuthor('Briljante Boeke'); pdf.setSubject('School workbook ordering');
  pdf.setCreator('Briljante Boeke'); pdf.setProducer('Briljante Boeke');
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(brandFont, { subset: true });
  const bold = await pdf.embedFont(brandBold, { subset: true });
  const page = pdf.addPage([595.28, 841.89]), width = page.getWidth();
  const navy = rgb(.035,.204,.392), ink = rgb(.17,.20,.24), muted = rgb(.32,.38,.43), pale = rgb(.94,.97,.98), line = rgb(.85,.89,.92);
  const supported = new Set(font.getCharacterSet());
  const clean = value => [...String(value ?? '').replace(/[\r\n\t\x00-\x1f]/g,' ')].map(c => supported.has(c.codePointAt(0)) ? c : '?').join('');
  const text = (value,x,y,size=11,weight=false,color=ink) => page.drawText(clean(value),{x,y,size,font:weight?bold:font,color});
  const centered = (value,y,size=11,weight=false,color=ink) => { const face=weight?bold:font, str=clean(value);text(str,(width-face.widthOfTextAtSize(str,size))/2,y,size,weight,color); };
  function wrap(value, maxWidth, size, face=font) {
    const lines=[];let current='';
    for (const word of clean(value).split(/\s+/)) {
      const candidate=current?`${current} ${word}`:word;
      if(face.widthOfTextAtSize(candidate,size)<=maxWidth){current=candidate;continue;}
      if(current){lines.push(current);current='';}
      for(const ch of word){if(face.widthOfTextAtSize(current+ch,size)>maxWidth){lines.push(current);current='';}current+=ch;}
    }if(current)lines.push(current);return lines;
  }
  async function logo(bytes,x,y,maxWidth,maxHeight) {
    const embedded=await pdf.embedPng(bytes), scale=Math.min(maxWidth/embedded.width,maxHeight/embedded.height);
    const w=embedded.width*scale,h=embedded.height*scale;
    page.drawImage(embedded,{x:x+(maxWidth-w)/2,y:y+(maxHeight-h)/2,width:w,height:h});
  }
  page.drawRectangle({x:0,y:837.89,width,height:4,color:navy});
  await logo(brandLogo,42,748,103,67);
  if(schoolLogo)await logo(schoolLogo,width-148,745,106,72);
  page.drawLine({start:{x:42,y:731},end:{x:width-42,y:731},thickness:1,color:line});
  const preview = !ready || new URL(origin).hostname.endsWith('.vercel.app');
  if(preview){
    page.drawRectangle({x:42,y:703,width:width-84,height:20,color:pale});
    centered(tr('VOORSKOU - Nie vir verspreiding nie. Herlaai die plakkaat na bekendstelling.','PREVIEW - Not for distribution. Download a fresh poster after launch.'),710,8,false,muted);
  }
  const year=period.academic_years?.year ?? '';
  centered(tr(`${year} WERKBOEKBESTELLINGS`,`${year} WORKBOOK ORDERS`),678,11,true,navy);
  let size=28, schoolLines=wrap(school.name,width-100,size,bold);
  while(schoolLines.length>3 && size>10){size--;schoolLines=wrap(school.name,width-100,size,bold);}
  let y=642;for(const lineText of schoolLines){centered(lineText,y,size,true,navy);y-=size+5;}
  centered(tr('Skandeer om die skool se werkboeke te bestel.','Scan to order your school workbooks.'),y-9,13,false,muted);
  const qr=QRCode.create(link,{errorCorrectionLevel:'M'}).modules;
  const qrSize=232, cell=qrSize/(qr.size+8), left=(width-qrSize)/2, bottom=292;
  page.drawRectangle({x:left-10,y:bottom-10,width:qrSize+20,height:qrSize+20,color:rgb(1,1,1),borderColor:line,borderWidth:1});
  for(let row=0;row<qr.size;row++)for(let col=0;col<qr.size;col++)if(qr.get(row,col))page.drawRectangle({x:left+(col+4)*cell,y:bottom+qrSize-(row+5)*cell,width:cell+.005,height:cell+.005,color:rgb(0,0,0)});
  const closing=new Intl.DateTimeFormat(english?'en-ZA':'af-ZA',{day:'numeric',month:'long',year:'numeric',timeZone:'Africa/Johannesburg'}).format(new Date(period.closes_at));
  centered(tr(`Bestel teen ${closing}`,`Order by ${closing}`),258,14,true,navy);
  centered(tr(`Beskikbare grade: ${gradeNames.join(', ')}`,`Available grades: ${gradeNames.join(', ')}`),236,11,false,muted);
  const steps=[
    tr('1. Skandeer die QR-kode met u foon se kamera.','1. Scan the QR code with your phone camera.'),
    tr('2. Kies die toepaslike graad vir elke kind.','2. Choose the correct grade for each child.'),
    preview?tr('3. Besigtig die bestelstappe; betaling is nog nie beskikbaar nie.','3. Preview the order steps; payment is not available yet.'):tr('3. Vul u besonderhede in en betaal aanlyn.','3. Complete your details and pay online.'),
  ];let stepY=200;for(const step of steps){centered(step,stepY,10.5);stepY-=18;}
  centered(tr('Geen rekening of toegangskode nodig nie.','No account or access code needed.'),132,10,false,muted);
  centered(tr('Of maak hierdie skakel oop:','Or open this link:'),110,9,false,muted);
  let linkY=96;for(const lineText of wrap(link,width-90,7.4)){centered(lineText,linkY,7.4,false,navy);linkY-=10;}
  page.drawLine({start:{x:42,y:60},end:{x:width-42,y:60},thickness:1,color:line});
  centered(tr('Boeke word in grootmaat by die skool afgelewer.','Books are delivered to the school in bulk.'),43,9,false,muted);
  centered('Briljante Boeke  |  info@briljanteboeke.co.za',27,8.5,false,muted);
  return Buffer.from(await pdf.save());
}
