import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/home-banner.js', import.meta.url), 'utf8');
const motionSource = await readFile(new URL('../assets/banner-motion.js', import.meta.url), 'utf8');
const motionContext = { window: {} };
vm.runInNewContext(motionSource, motionContext);
const { stateAt } = motionContext.window.BriljanteBannerMotion;

class Element {
  dataset = {};
  attributes = new Map();
  listeners = new Map();
  hidden = false;
  textContent = '';
  focusVisible = false;

  addEventListener(type, callback) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const callback of this.listeners.get(type) ?? []) {
      callback({ target: this, ...event });
    }
  }

  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  matches(selector) { return selector === ':focus-visible' && this.focusVisible; }
}

function createController({ reducedMotion = false } = {}) {
  const banner = new Element();
  const rotation = new Element();
  const status = new Element();
  const controlsContainer = new Element();
  controlsContainer.hidden = true;
  const controls = Array.from({ length: 7 }, (_, index) => {
    const button = new Element();
    button.dataset.bannerGrade = String(index + 1);
    return button;
  });
  const slides = controls.map((control) => {
    const slide = new Element();
    slide.dataset.grade = control.dataset.bannerGrade;
    const nodes = new Map([
      ['.banner-grade', new Element()],
      ['.workbook-banner-cover', new Element()],
      ['.workbook-banner-cover img', new Element()],
      ['.banner-book-link', new Element()],
    ]);
    slide.querySelector = (selector) => nodes.get(selector);
    slide.querySelectorAll = (selector) => selector === '[id]' ? [...nodes.values()] : [];
    return slide;
  });
  const decodes = slides.flatMap(() => Array.from({ length: 5 }, () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  }));
  const images = decodes.map(({ promise }) => ({ decode: () => promise }));
  const slideContainer = new Element();
  const elements = new Map([
    ['.workbook-slides', slideContainer],
    ['.banner-rotation-control', rotation],
    ['.workbook-banner-controls', controlsContainer],
    ['.banner-status', status],
  ]);
  banner.querySelector = (selector) => elements.get(selector);
  banner.querySelectorAll = (selector) => selector === 'img' ? images : selector === '[data-banner-grade]' ? controls : [];

  const document = new Element();
  document.hidden = false;
  document.querySelector = (selector) => selector === '.workbook-banner' ? banner : null;
  const reduced = new Element();
  reduced.matches = reducedMotion;

  let now = 0;
  let nextTimer = 1;
  const timers = new Map();
  const callbacks = new Map();
  const timeline = {
    isPaused: true,
    currentTime: 0,
    repeats: 0,
    eventCallback(name, callback) { callbacks.set(name, callback); return this; },
    repeat(value) { this.repeats = value; return this; },
    time() { return this.currentTime; },
    paused(value) { this.isPaused = value; return this; },
    pause() { this.isPaused = true; return this; },
    seek(time) {
      this.currentTime = time;
      callbacks.get('onUpdate')?.();
      return this;
    },
    advance(milliseconds) {
      if (!this.isPaused) this.seek((this.currentTime + milliseconds / 1000) % (slides.length * 5));
    },
  };
  const observers = [];
  class IntersectionObserver {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
    observe(element) { this.element = element; }
  }
  const gsap = { timeline: () => timeline };
  const motion = {
    stateAt,
    mount(container, products) {
      assert.equal(container, slideContainer);
      assert.equal(products.length, slides.length);
      return slides;
    },
    timeline: (_slides, api) => api.timeline({ paused: true }),
  };
  vm.runInNewContext(source, {
    window: { gsap, BriljanteBannerMotion: motion },
    document,
    PRODUCTS: controls.map((control) => ({ title: `Graad ${control.dataset.bannerGrade}` })),
    matchMedia(query) {
      assert.equal(query, '(prefers-reduced-motion: reduce)');
      return reduced;
    },
    IntersectionObserver,
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });

  function advance(milliseconds) {
    const end = now + milliseconds;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.due <= end)
        .sort(([, left], [, right]) => left.due - right.due)[0];
      if (!next) break;
      const [id, timer] = next;
      timeline.advance(timer.due - now);
      now = timer.due;
      timers.delete(id);
      timer.callback();
    }
    timeline.advance(end - now);
    now = end;
  }

  return {
    banner, controls, controlsContainer, document, rotation, slides, status, timeline, timers, observers,
    advance,
    async decodeImages() {
      decodes.forEach(({ resolve }) => resolve());
      await Promise.all(decodes.map(({ promise }) => promise));
      await Promise.resolve();
    },
    intersect(isIntersecting) { observers[0].callback([{ isIntersecting }]); },
    setReducedMotion(matches) { reduced.matches = matches; reduced.emit('change'); },
    setDocumentHidden(hidden) { document.hidden = hidden; document.emit('visibilitychange'); },
    pointerSelect(index) {
      const target = controls[index];
      banner.emit('pointerdown', { target });
      banner.emit('focusin', { target });
      target.emit('click', { detail: 1 });
    },
    keyboardFocus(target = controls[0]) { banner.emit('focusin', { target }); },
  };
}

function assertPlayback(controller, state, running = state === 'running') {
  assert.equal(controller.banner.dataset.playbackState, state);
  assert.equal(controller.banner.dataset.playing, String(running));
  assert.equal(controller.timeline.isPaused, !running);
}

async function runningController(options) {
  const controller = createController(options);
  controller.intersect(true);
  await controller.decodeImages();
  return controller;
}

test('starts automatically after images decode and the banner becomes visible', async () => {
  const controller = createController();
  assertPlayback(controller, 'loading');
  assert.equal(controller.rotation.hidden, true);
  assert.equal(controller.controlsContainer.hidden, false);
  controller.intersect(true);
  assertPlayback(controller, 'loading');
  await controller.decodeImages();

  assertPlayback(controller, 'running');
  assert.equal(controller.rotation.hidden, false);
  assert.equal(controller.timeline.repeats, -1);
  assert.equal(controller.banner.dataset.grade, '1');
  controller.advance(5000);
  assert.equal(controller.banner.dataset.grade, '2');
  assert.equal(controller.controls[1].getAttribute('aria-pressed'), 'true');
  assert.equal(controller.slides[0].inert, true);
  assert.equal(controller.slides[1].inert, false);
});

test('autoplay visits all seven grades and loops back to Grade 1', async () => {
  const controller = await runningController();
  for (let grade = 1; grade <= 7; grade++) {
    assert.equal(controller.banner.dataset.grade, String(grade));
    assert.equal(controller.controls[grade - 1].getAttribute('aria-pressed'), 'true');
    assert.equal(controller.slides.filter((slide) => !slide.inert).length, 1);
    controller.advance(5000);
  }
  assert.equal(controller.banner.dataset.grade, '1');
  assertPlayback(controller, 'running');
});

test('a pointer grade selection holds for eight seconds and then resumes automatically', async () => {
  const controller = await runningController();
  controller.pointerSelect(2);
  assertPlayback(controller, 'manual-hold');
  assert.equal(controller.banner.dataset.grade, '3');
  assert.equal(controller.timeline.time(), 11.3);
  assert.match(controller.status.textContent, /Graad 3 gekies/);

  controller.advance(7999);
  assertPlayback(controller, 'manual-hold');
  assert.equal(controller.timeline.time(), 11.3);
  controller.advance(1);
  assertPlayback(controller, 'running');
  assert.equal(controller.timeline.time(), 14);
  controller.advance(1000);
  assert.equal(controller.banner.dataset.grade, '4');
});

test('a repeated pointer selection replaces the previous hold timer', async () => {
  const controller = await runningController();
  controller.pointerSelect(1);
  controller.advance(4000);
  controller.pointerSelect(6);
  assert.equal(controller.timers.size, 1);
  assert.equal(controller.banner.dataset.grade, '7');

  controller.advance(4000);
  assertPlayback(controller, 'manual-hold');
  assert.equal(controller.timeline.time(), 31.3);
  controller.advance(3999);
  assertPlayback(controller, 'manual-hold');
  controller.advance(1);
  assertPlayback(controller, 'running');
  assert.equal(controller.timeline.time(), 34);
  controller.advance(1000);
  assert.equal(controller.banner.dataset.grade, '1');
});

test('keyboard focus stops playback until the rotation control is explicitly activated', async () => {
  const controller = await runningController();
  controller.keyboardFocus();
  assertPlayback(controller, 'user-paused');
  assert.match(controller.rotation.textContent, /Start animation/);
  controller.banner.emit('focusout', { target: controller.controls[0] });
  controller.advance(20000);
  assertPlayback(controller, 'user-paused');

  controller.pointerSelect(3);
  controller.advance(8000);
  assertPlayback(controller, 'user-paused');
  controller.rotation.emit('click', { detail: 1 });
  assertPlayback(controller, 'running');
  assert.match(controller.rotation.textContent, /Stop animation/);
});

test('a keyboard grade selection stays paused after the selected grade is shown', async () => {
  const controller = await runningController();
  controller.banner.emit('keydown', { target: controller.controls[2], key: 'Enter' });
  controller.controls[2].emit('click', { detail: 0 });
  assertPlayback(controller, 'user-paused');
  assert.equal(controller.banner.dataset.grade, '3');
  assert.equal(controller.timers.size, 0);
  controller.advance(20000);
  assertPlayback(controller, 'user-paused');

  controller.banner.emit('keydown', { target: controller.rotation, key: 'Enter' });
  controller.rotation.emit('click', { detail: 0 });
  assertPlayback(controller, 'running');
});

test('reduced motion can be toggled off without leaving a stale paused state', async () => {
  const controller = await runningController({ reducedMotion: true });
  assertPlayback(controller, 'reduced-motion');
  assert.equal(controller.rotation.hidden, true);
  assert.equal(controller.banner.dataset.grade, '1');
  controller.setReducedMotion(false);
  assertPlayback(controller, 'running');
  assert.equal(controller.rotation.hidden, false);

  controller.advance(5000);
  controller.setReducedMotion(true);
  assertPlayback(controller, 'reduced-motion');
  assert.equal(controller.banner.dataset.grade, '2');
  assert.equal(controller.timeline.time(), 6.3);
  controller.setReducedMotion(false);
  assertPlayback(controller, 'running');

  controller.rotation.emit('click');
  assertPlayback(controller, 'user-paused');
  controller.setReducedMotion(true);
  controller.setReducedMotion(false);
  assertPlayback(controller, 'user-paused');
  controller.rotation.emit('click');
  assertPlayback(controller, 'running');
});

test('viewport and document visibility gate playback and resume it when visible again', async () => {
  const controller = createController();
  await controller.decodeImages();
  assertPlayback(controller, 'offscreen');
  assert.equal(controller.observers[0].element, controller.banner);
  assert.equal(controller.observers[0].options.threshold, 0.15);

  controller.intersect(true);
  assertPlayback(controller, 'running');
  controller.intersect(false);
  assertPlayback(controller, 'offscreen');
  const stoppedAt = controller.timeline.time();
  controller.advance(10000);
  assert.equal(controller.timeline.time(), stoppedAt);
  controller.intersect(true);
  assertPlayback(controller, 'running');
  controller.setDocumentHidden(true);
  assertPlayback(controller, 'offscreen');
  controller.setDocumentHidden(false);
  assertPlayback(controller, 'running');
});

test('an expired pointer hold cannot restart an offscreen banner', async () => {
  const controller = await runningController();
  controller.pointerSelect(1);
  controller.intersect(false);
  controller.advance(8000);
  assertPlayback(controller, 'offscreen');
  controller.intersect(true);
  assertPlayback(controller, 'running');
});
