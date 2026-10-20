import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/banner-motion.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const motion = context.window.BriljanteBannerMotion;

test('banner state follows all five grades and returns to the first grade', () => {
  for (let index = 0; index < 5; index++) {
    assert.equal(motion.stateAt(index * 5 + 1.3), index);
  }
  assert.equal(motion.stateAt(4.69), 0);
  assert.equal(motion.stateAt(4.71), 1);
  assert.equal(motion.stateAt(25.39), 0);
});

test('incoming artwork is hidden before its parent is revealed, preventing a transition flash', () => {
  const calls = [];
  const timeline = {
    set(...args) { calls.push({ method: 'set', args }); return this; },
    fromTo(...args) { calls.push({ method: 'fromTo', args }); return this; },
  };
  const slides = Array.from({ length: 5 }, (_, index) => ({
    copy: { kind: 'copy', index }, cover: { kind: 'cover', index },
    pages: Array.from({ length: 4 }, (_, page) => ({ kind: 'page', index, page })),
    querySelector(selector) { return selector.includes('copy') ? this.copy : this.cover; },
    querySelectorAll() { return this.pages; },
  }));
  assert.equal(motion.timeline(slides, { timeline: options => {
    assert.equal(options.paused, true);
    return timeline;
  } }), timeline);
  for (let step = 1; step <= 5; step++) {
    const incoming = slides[step % 5];
    const at = step * 5 - 0.7;
    const hidden = calls.find(call => call.method === 'set' && Array.isArray(call.args[0]) && call.args[0][0] === incoming.copy && call.args[2] === at + 0.24);
    assert.ok(hidden, `Incoming grade ${step % 5 + 3} needs a pre-reveal hidden state`);
    assert.equal(hidden.args[1].opacity, 0);
    assert.equal(hidden.args[0].length, 6);
    assert.ok(calls.find(call => call.method === 'set' && call.args[0] === incoming && call.args[1].opacity === 1 && call.args[2] === at + 0.25));
  }
});

test('website motion dependencies are local and the static first grade remains in HTML', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="workbook-banner-grid workbook-slide" data-grade="3"/);
  assert.match(html, /class="workbook-banner-controls" hidden/);
  assert.match(html, /src="\/assets\/vendor\/gsap-3\.14\.2\.min\.js"/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
});
