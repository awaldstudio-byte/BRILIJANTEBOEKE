import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/banner-motion.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const motion = context.window.BriljanteBannerMotion;

test('banner state follows all seven grades in order and returns to Grade 1', () => {
  for (let index = 0; index < 7; index++) {
    assert.equal(motion.stateAt(index * 5 + 1.3), index);
  }
  assert.equal(motion.stateAt(4.69), 0);
  assert.equal(motion.stateAt(4.71), 1);
  assert.equal(motion.stateAt(25.39), 5);
  assert.equal(motion.stateAt(30.39), 6);
  assert.equal(motion.stateAt(35.39), 0);
  assert.equal(motion.stateAt(25.39, 5), 0, 'The helper remains parameterized for other slide counts');
});

test('mount assigns the seven registered covers and four sample pages in natural grade order', async () => {
  const registry = await readFile(new URL('../assets/site.js', import.meta.url), 'utf8');
  const registryEnd = registry.indexOf('const byId=');
  assert.notEqual(registryEnd, -1);
  const products = vm.runInNewContext(`${registry.slice(0, registryEnd)}; PRODUCTS`, {}, { timeout: 1000 });
  assert.deepEqual(Array.from(products, (product) => product.title), Array.from({ length: 7 }, (_, index) => `Graad ${index + 1}`));

  function template() {
    const grade = {};
    const links = [{}, {}];
    const images = Array.from({ length: 5 }, () => ({ removeAttribute() {} }));
    return {
      dataset: {}, grade, links, images,
      querySelector: () => grade,
      querySelectorAll: (selector) => selector === 'a' ? links : selector === 'img' ? images : [],
      cloneNode: template,
    };
  }
  const first = template();
  const appended = [];
  const slides = motion.mount({ querySelector: () => first, append: (slide) => appended.push(slide) }, products);
  assert.equal(slides.length, 7);
  assert.equal(slides[0], first);
  assert.equal(appended.length, 6);
  slides.forEach((slide, index) => {
    assert.equal(products[index].images.length, 5);
    assert.equal(slide.dataset.grade, String(index + 1));
    assert.equal(slide.grade.textContent, `Graad ${index + 1}`);
    assert.deepEqual(slide.images.map((image) => image.src), Array.from(products[index].images));
    assert.equal(slide.images[0].alt, `Graad ${index + 1} Afrikaans-werkboek`);
    assert.equal(slide.images[4].alt, `Graad ${index + 1} voorbeeldbladsy 4`);
    assert.ok(slide.links.every((link) => link.href === `/product/${products[index].slug}/`));
  });
});

test('incoming artwork is hidden before its parent is revealed, preventing a transition flash', () => {
  const calls = [];
  const timeline = {
    set(...args) { calls.push({ method: 'set', args }); return this; },
    fromTo(...args) { calls.push({ method: 'fromTo', args }); return this; },
  };
  const slides = Array.from({ length: 7 }, (_, index) => ({
    copy: { kind: 'copy', index }, cover: { kind: 'cover', index },
    pages: Array.from({ length: 4 }, (_, page) => ({ kind: 'page', index, page })),
    querySelector(selector) { return selector.includes('copy') ? this.copy : this.cover; },
    querySelectorAll() { return this.pages; },
  }));
  assert.equal(motion.timeline(slides, { timeline: options => {
    assert.equal(options.paused, true);
    return timeline;
  } }), timeline);
  for (let step = 1; step <= slides.length; step++) {
    const incoming = slides[step % slides.length];
    const at = step * 5 - 0.7;
    const hidden = calls.find(call => call.method === 'set' && Array.isArray(call.args[0]) && call.args[0][0] === incoming.copy && call.args[2] === at + 0.24);
    assert.ok(hidden, `Incoming grade ${step % slides.length + 1} needs a pre-reveal hidden state`);
    assert.equal(hidden.args[1].opacity, 0);
    assert.equal(hidden.args[0].length, 6);
    assert.ok(calls.find(call => call.method === 'set' && call.args[0] === incoming && call.args[1].opacity === 1 && call.args[2] === at + 0.25));
  }
});

test('website motion dependencies are local and Grade 1 is the static no-script fallback', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="workbook-banner-grid workbook-slide" data-grade="1"/);
  assert.match(html, /id="banner-grade"[^>]*>Graad 1</);
  assert.match(html, /id="banner-cover"[^>]+src="\/assets\/images\/grade-1\/cover\.png"/);
  assert.deepEqual([...html.matchAll(/data-banner-grade="(\d+)"/g)].map((match) => match[1]), ['1', '2', '3', '4', '5', '6', '7']);
  assert.match(html, /class="workbook-banner-controls" hidden/);
  assert.doesNotMatch(html, /banner-playback|banner-play-icon|banner-pause-icon/);
  assert.match(html, /class="banner-rotation-control" hidden/);
  assert.match(html, /src="\/assets\/vendor\/gsap-3\.14\.2\.min\.js"/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
});
