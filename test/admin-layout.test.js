import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../admin/index.html',import.meta.url),'utf8'),css=await readFile(new URL('../assets/phase1.css',import.meta.url),'utf8'),app=await readFile(new URL('../assets/admin-app.js',import.meta.url),'utf8');
test('dashboard notices have their own grid area and never become accidental sidebar columns',()=>{
  assert.match(html,/id="admin-app"[^>]*>\s*<div id="admin-notices"/);assert.match(css,/grid-template-areas: 'notices notices' 'navigation content'/);assert.doesNotMatch(app,/\$\('#admin-app'\)\.prepend/);assert.match(app,/\$\('#admin-notices'\)\.append\(demoNotice\)/);
});
test('dashboard main content and sidebar scroll independently, including compact navigation',()=>{
  assert.match(css,/\.admin-main\s*\{[^}]*grid-area: content[^}]*overflow: auto[^}]*overscroll-behavior: contain/);assert.match(css,/\.admin-nav\s*\{[^}]*grid-area: navigation[^}]*overflow-y: auto/);assert.match(css,/grid-template-areas: 'notices' 'navigation' 'content'/);assert.match(app,/\$\('\.admin-main'\)\.scrollTo/);
});
