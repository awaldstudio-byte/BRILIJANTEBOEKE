import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const {FileBlob,SpreadsheetFile}=await import(pathToFileURL(process.env.BRILJANTE_ARTIFACT_RUNTIME).href);
const input=process.argv[2];
const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(input));
console.log((await workbook.inspect({kind:'sheet',include:'id,name',maxChars:1500})).ndjson);
const preview=await workbook.render({sheetName:workbook.worksheets.getItemAt(0).name,range:'A1:J17',scale:1.3,format:'png'});
await fs.writeFile(input+'.png',new Uint8Array(await preview.arrayBuffer()));
