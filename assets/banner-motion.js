/* Shared, finite choreography used by the website and its HyperFrames review. */
(() => {
  function mount(container, products) {
    const first = container.querySelector('.workbook-slide');
    return products.map((product, index) => {
      const slide = index === 0 ? first : first.cloneNode(true);
      slide.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
      slide.dataset.grade = product.title.replace('Graad ', '');
      slide.querySelector('.banner-grade').textContent = product.title;
      slide.querySelectorAll('a').forEach((link) => { link.href = `/product/${product.slug}/`; });
      slide.querySelectorAll('img').forEach((image, i) => {
        image.src = product.images[i];
        image.alt = i === 0 ? `${product.title} Afrikaans-werkboek` : `${product.title} voorbeeldbladsy ${i}`;
        image.removeAttribute('fetchpriority');
        image.decoding = 'async';
      });
      if (index > 0) container.append(slide);
      return slide;
    });
  }
  function timeline(slides, gsap) {
    const tl = gsap.timeline({ paused: true });
    const copies = slides.map((slide) => slide.querySelector('.workbook-banner-copy'));
    const covers = slides.map((slide) => slide.querySelector('.workbook-banner-cover img'));
    const pages = slides.map((slide) => [...slide.querySelectorAll('.workbook-banner-samples img')]);
    tl.set(slides, { opacity: 0 }, 0);
    tl.set(slides[0], { opacity: 1 }, 0);
    tl.set([...copies, ...covers, ...pages.flat()], { opacity: 1, x: 0, y: 0, rotation: 0, scale: 1 }, 0);
    for (let step = 1; step <= slides.length; step++) {
      const from = (step - 1) % slides.length;
      const to = step % slides.length;
      const at = step * 5 - 0.7;
      tl.fromTo(copies[from], { opacity: 1, y: 0 }, { opacity: 0, y: -10, duration: 0.25, ease: 'power2.in', immediateRender: false }, at);
      tl.fromTo(covers[from], { opacity: 1, x: 0, y: 0, rotation: 0, scale: 1 }, { opacity: 0, x: -26, y: -7, rotation: -2, scale: 0.98, duration: 0.4, ease: 'power2.in', immediateRender: false }, at);
      tl.fromTo(pages[from], { opacity: 1, y: 0 }, { opacity: 0, y: -14, duration: 0.22, stagger: 0.035, ease: 'power2.in', immediateRender: false }, at + 0.02);
      tl.set([copies[to], covers[to], ...pages[to]], { opacity: 0 }, at + 0.24);
      tl.set(slides[to], { opacity: 1 }, at + 0.25);
      tl.fromTo(copies[to], { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out', immediateRender: false }, at + 0.28);
      tl.fromTo(covers[to], { opacity: 0, x: 32, y: 8, rotation: 2.5, scale: 0.97 }, { opacity: 1, x: 0, y: 0, rotation: 0, scale: 1, duration: 0.72, ease: 'power3.out', immediateRender: false }, at + 0.25);
      // Adapted from the installed stagger-cascade primitive; artwork is unchanged.
      tl.fromTo(pages[to], { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.57, stagger: 0.07, ease: 'power2.out', immediateRender: false }, at + 0.32);
      tl.set(slides[from], { opacity: 0 }, at + 0.4);
    }
    return tl;
  }
  window.BriljanteBannerMotion = { mount, timeline, stateAt: (time, count = 5) => Math.floor((time + 0.3) / 5) % count };
})();
