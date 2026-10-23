// Desktop-only authoring. Hosted reports fill this ordinary XLSX using ExcelJS.
import fs from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import JSZip from 'jszip';
if (!process.env.BRILJANTE_ARTIFACT_RUNTIME) throw new Error('Set BRILJANTE_ARTIFACT_RUNTIME to the bundled artifact-tool entry point.');
const { Workbook, SpreadsheetFile } = await import(pathToFileURL(process.env.BRILJANTE_ARTIFACT_RUNTIME).href);
const workbook = Workbook.create(), sheet = workbook.worksheets.add('Register');
sheet.showGridLines = false;
sheet.getRange('A1:J10').format.font = { name:'Arial',size:11,color:'#263B50' };
sheet.getRange('A1:J1').format.rowHeight = 12;
sheet.getRange('A2:J4').format.rowHeight = 23;
sheet.getRange('A5').values = [['Paid learner register']];
sheet.getRange('A5:J5').format.font = { name:'Arial',size:17,bold:true,color:'#17385F' };
sheet.getRange('A5:J5').format.rowHeight = 30;
sheet.getRange('A6').values = [['All schools']];
sheet.getRange('A6:J8').format.rowHeight = 22;
sheet.getRange('A9:J9').format.rowHeight = 12;
sheet.freezePanes.freezeRows(10);
workbook.recalculate();
await fs.mkdir(new URL('../assets/reports/',import.meta.url),{recursive:true});
const destination=fileURLToPath(new URL('../assets/reports/report-base.xlsx',import.meta.url));
await (await SpreadsheetFile.exportXlsx(workbook)).save(destination);
// ExcelJS accepts SpreadsheetML's default namespace, not the equivalent x:-prefixed form.
const zip=await JSZip.loadAsync(await fs.readFile(destination));
for(const entry of Object.values(zip.files))if(!entry.dir&&entry.name.endsWith('.xml')){
  const xml=await entry.async('string');
  zip.file(entry.name,xml.replace(/(<\/?)x:/g,'$1').replaceAll('xmlns:x=','xmlns='));
}
await fs.writeFile(destination,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
console.log('Report workbook template created.');
