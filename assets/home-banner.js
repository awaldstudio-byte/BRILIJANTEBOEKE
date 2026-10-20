(() => {
  const banner = document.querySelector('.workbook-banner');
  if (!banner || !window.gsap || !window.BriljanteBannerMotion || typeof PRODUCTS === 'undefined') return;
  const controls = [...banner.querySelectorAll('[data-banner-grade]')];
  const products = controls.map((button) => PRODUCTS.find((product) => product.title === `Graad ${button.dataset.bannerGrade}`));
  if (products.some((product) => !product)) return;
  const motion = window.BriljanteBannerMotion;
  const slides = motion.mount(banner.querySelector('.workbook-slides'), products);
  const tl = motion.timeline(slides, window.gsap);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const rotation = banner.querySelector('.banner-rotation-control');
  let userPaused = false, keyboardStopped = false, manualHold = false, visible = false, ready = false, active = -1;
  let holdTimer, input = 'keyboard';
  function sync(index) {
    if (index === active) return;
    active = index;
    slides.forEach((slide, i) => {
      slide.inert = i !== index;
      slide.setAttribute('aria-hidden', String(i !== index));
      slide.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    });
    const current = slides[index];
    current.querySelector('.banner-grade').id = 'banner-grade';
    current.querySelector('.workbook-banner-cover').id = 'banner-cover-link';
    current.querySelector('.workbook-banner-cover img').id = 'banner-cover';
    current.querySelector('.banner-book-link').id = 'banner-book-link';
    controls.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    banner.dataset.grade = slides[index].dataset.grade;
  }
  function updatePlayback() {
    const stopped = userPaused || keyboardStopped;
    if (rotation) {
      rotation.hidden = !ready || reduced.matches;
      rotation.textContent = stopped ? 'Begin animasie | Start animation' : 'Onderbreek animasie | Stop animation';
    }
    const state = !ready ? 'loading' : reduced.matches ? 'reduced-motion' : stopped ? 'user-paused' : manualHold ? 'manual-hold' : !visible || document.hidden ? 'offscreen' : 'running';
    const running = state === 'running';
    tl.paused(!running);
    banner.dataset.playing = String(running);
    banner.dataset.playbackState = state;
  }
  tl.eventCallback('onUpdate', () => sync(motion.stateAt(tl.time(), slides.length)));
  tl.repeat(-1);
  tl.seek(0);
  sync(0);
  banner.querySelector('.workbook-banner-controls').hidden = false;
  controls.forEach((button, index) => button.addEventListener('click', (event) => {
    clearTimeout(holdTimer);
    manualHold = event.detail !== 0;
    if (!manualHold) keyboardStopped = true;
    tl.pause().seek(index * 5 + 1.3);
    sync(index);
    banner.querySelector('.banner-status').textContent = `${products[index].title} gekies. ${products[index].title.replace('Graad', 'Grade')} selected.`;
    if (manualHold) holdTimer = setTimeout(() => {
      manualHold = false;
      tl.seek(index * 5 + 4);
      updatePlayback();
    }, 8000);
    updatePlayback();
  }));
  // Pointer hover is deliberately not a playback gate: the hero occupies most of the viewport.
  banner.addEventListener('pointerdown', () => { input = 'pointer'; }, true);
  banner.addEventListener('keydown', (event) => {
    input = 'keyboard';
    if (event.target !== rotation) { keyboardStopped = true; updatePlayback(); }
  }, true);
  banner.addEventListener('focusin', (event) => {
    if (input === 'keyboard' || event.target.matches(':focus-visible')) {
      keyboardStopped = true;
      updatePlayback();
    }
  });
  rotation?.addEventListener('click', () => {
    const restart = userPaused || keyboardStopped;
    userPaused = !restart;
    keyboardStopped = false;
    manualHold = false;
    clearTimeout(holdTimer);
    updatePlayback();
  });
  document.addEventListener('visibilitychange', updatePlayback);
  reduced.addEventListener('change', () => { if (reduced.matches) tl.pause().seek(active * 5 + 1.3); updatePlayback(); });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; updatePlayback(); }, { threshold: 0.15 }).observe(banner);
  Promise.allSettled([...banner.querySelectorAll('img')].map((image) => image.decode())).then((results) => {
    ready = results.every((result) => result.status === 'fulfilled');
    updatePlayback();
  });
  updatePlayback();
})();
