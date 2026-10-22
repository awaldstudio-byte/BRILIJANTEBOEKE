import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const pages = ['index.html','404.html','about/index.html','books/index.html','catalogue/index.html','contact/index.html','request-quote/index.html','quote/index.html', ...['graad-1','graad-2','graad-3','graad-4-werkboek','graad-5','graad-6','graad-7'].map(slug=>`product/${slug}/index.html`), 'privacy-policy-2/index.html','refund_returns/index.html','frequently-asked-questions/index.html'];

test('every original-theme public page credits A WALD STUDIO and retains client ownership and policies', async () => {
  for (const path of pages) {
    const html = await readFile(new URL(`../${path}`,import.meta.url),'utf8');
    assert.doesNotMatch(html,/brightwebstudio/i,path);
    assert.equal((html.match(/class="awald-credit"/g)||[]).length,1,path);
    assert.match(html, /href="https:\/\/awaldstudio\.com\/" target="_blank" rel="noopener noreferrer" aria-label="Website maintained by A WALD STUDIO"/);
    assert.match(html, /<img src="\/assets\/images\/awald-studio-logo\.png" width="703" height="682" alt=""/);
    const footer = html.match(/<footer[\s\S]*?<\/footer>/)[0];
    assert.match(footer,/Briljante Boeke/);
    for(const link of ['frequently-asked-questions','privacy-policy-2','refund_returns']) assert.ok(footer.includes(`href="/${link}/"`),path);
  }
});

test('studio footer logo is the exact approved original, not a substitute', async () => {
  const logo = await readFile(new URL('../assets/images/awald-studio-logo.png',import.meta.url));
  assert.equal(createHash('sha256').update(logo).digest('hex'),'5ce47f0d90f17947ff3f3c4996afbb5d6bbb5dfa37897390f321ce542ca31647');
});
