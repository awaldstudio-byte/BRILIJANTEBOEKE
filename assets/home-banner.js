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
  const playback = banner.querySelector('.banner-playback');
  let userPaused = reduced.matches, hovered = false, focused = false, visible = false, ready = false, active = -1;
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
    playback.hidden = reduced.matches;
    playback.setAttribute('aria-pressed', String(userPaused));
    playback.setAttribute('aria-label', userPaused ? 'Speel animasie | Play animation' : 'Onderbreek animasie | Pause animation');
    playback.querySelector('span').textContent = userPaused ? 'Speel | Play' : 'Onderbreek | Pause';
    const running = ready && visible && !document.hidden && !userPaused && !hovered && !focused && !reduced.matches;
    tl.paused(!running);
    banner.dataset.playing = String(running);
  }
  tl.eventCallback('onUpdate', () => sync(motion.stateAt(tl.time(), slides.length)));
  tl.repeat(-1);
  tl.seek(0);
  sync(0);
  banner.querySelector('.workbook-banner-controls').hidden = false;
  controls.forEach((button, index) => button.addEventListener('click', () => {
    userPaused = true;
    tl.pause().seek(index * 5 + 1.3);
    sync(index);
    banner.querySelector('.banner-status').textContent = `${products[index].title} gekies. Animasie onderbreek. ${products[index].title.replace('Graad', 'Grade')} selected.`;
    updatePlayback();
  }));
  playback.addEventListener('click', () => { userPaused = !userPaused; hovered = false; updatePlayback(); });
  banner.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') { hovered = true; updatePlayback(); } });
  banner.addEventListener('pointerleave', () => { hovered = false; updatePlayback(); });
  banner.addEventListener('focusin', (event) => { focused = event.target !== playback; updatePlayback(); });
  banner.addEventListener('focusout', (event) => { focused = banner.contains(event.relatedTarget) && event.relatedTarget !== playback; updatePlayback(); });
  document.addEventListener('visibilitychange', updatePlayback);
  reduced.addEventListener('change', () => { if (reduced.matches) { userPaused = true; tl.pause().seek(active * 5 + 1.3); } updatePlayback(); });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; updatePlayback(); }, { threshold: 0.15 }).observe(banner);
  Promise.allSettled([...banner.querySelectorAll('img')].map((image) => image.decode())).then((results) => {
    ready = results.every((result) => result.status === 'fulfilled');
    updatePlayback();
  });
  updatePlayback();
})();
