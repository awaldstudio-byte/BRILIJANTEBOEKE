import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require('C:/Users/natha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin=(process.env.REVIEW_ORIGIN||'http://127.0.0.1:4318').replace(/\/$/,'');
const output=resolve(process.env.REVIEW_OUTPUT||'../../outputs/briljante-awald-footer-review/local');
const routes=['/','/books/','/about/','/contact/','/catalogue/','/quote/','/request-quote/','/product/graad-1/','/product/graad-2/','/product/graad-3/','/product/graad-4-werkboek/','/product/graad-5/','/product/graad-6/','/product/graad-7/','/privacy-policy-2/','/refund_returns/','/frequently-asked-questions/','/404.html'];
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const errors=[], results=[];
try{
  const response=await fetch(origin+'/assets/images/awald-studio-logo.png');
  assert.equal(response.status,200);
  assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),'5ce47f0d90f17947ff3f3c4996afbb5d6bbb5dfa37897390f321ce542ca31647');
  for(const [width,height] of [[1440,1000],[768,1024],[390,844],[320,740]]){
    const page=await browser.newPage({viewport:{width,height}});
    page.on('pageerror',error=>errors.push(error.message));
    for(const path of routes){
      const response=await page.goto(origin+path,{waitUntil:'networkidle'});
      assert.equal(response.status(),200,`${path} HTTP`);
      const credit=page.locator('.awald-credit');
      assert.equal(await credit.count(),1,`${path} credit count`);
      await credit.scrollIntoViewIfNeeded();
      await credit.locator('img').evaluate(image=>image.decode());
      await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${path} ${width} overflow`);
      const metrics=await credit.evaluate(link=>{
        const box=link.getBoundingClientRect(),img=link.querySelector('img'),logo=img.getBoundingClientRect();
        return {x:box.x,width:box.width,height:box.height,logoWidth:logo.width,logoHeight:logo.height,loaded:img.complete&&img.naturalWidth===703,href:link.href,rel:link.rel,target:link.target,background:getComputedStyle(link.closest('.footer-middle,.footer-studio-row')).backgroundColor};
      });
      assert.equal(metrics.href,'https://awaldstudio.com/');
      assert.equal(metrics.target,'_blank');
      assert.equal(metrics.rel,'noopener noreferrer');
      assert.equal(metrics.loaded,true);
      assert.ok(metrics.logoWidth>=60 && metrics.logoWidth<=68);
      assert.ok(Math.abs(metrics.logoWidth/metrics.logoHeight-703/682)<.01);
      assert.ok(metrics.x>=0 && metrics.x+metrics.width<=width);
      assert.equal(metrics.background,'rgb(9, 52, 100)');
      const footer=page.locator('.site-footer');
      assert.doesNotMatch(await footer.innerText(),/brightwebstudio/i);
      assert.match(await footer.innerText(),/Briljante Boeke/);
      assert.equal(await footer.locator('.policy-links a').count(),3);
      await credit.focus();
      assert.equal(await credit.evaluate(link=>getComputedStyle(link).outlineStyle),'solid');
      if(['/','/books/','/privacy-policy-2/'].includes(path)){
        await footer.screenshot({path:`${output}/${path==='/'?'home':path.split('/')[1]}-${width}.png`});
      }
      results.push({path,viewport:`${width}x${height}`,...metrics});
    }
    await page.close();
  }
  assert.deepEqual(errors,[]);
  await writeFile(output+'/results.json',JSON.stringify({origin,logoHashVerified:true,errors,results},null,2));
  console.log(`Verified official logo and all 18 public footers at four widths (${results.length} checks), no overflow or script errors.`);
}finally{await browser.close();}
