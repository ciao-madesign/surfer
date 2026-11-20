// Micro-animazioni della landing: comparsa allo scorrimento e parallasse leggera sulle foto.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// comparsa
const sel = 'h1,h2,.lead,.eyebrow,.actions,.phone,.step,.list>div,.trio>*,.faq details,.band p,.final>div>*,.sec>p,.sec .ph,.credits';
const items = [...document.querySelectorAll(sel)];
items.forEach((e) => {
  e.classList.add('rv');
  const sibs = [...e.parentElement.children].filter((c) => c.classList.contains('rv') || items.includes(c));
  e.style.setProperty('--d', `${Math.min(sibs.indexOf(e), 4) * 0.09}s`);
});
if (reduce || !('IntersectionObserver' in window)) items.forEach((e) => e.classList.add('in'));
else {
  const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  items.forEach((e) => io.observe(e));
}

// parallasse: l'immagine si sposta di poco rispetto al riquadro, con un leggero zoom
if (!reduce) {
  const imgs = [...document.querySelectorAll('.band img,.final img,.ph img')];
  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = innerHeight;
    for (const img of imgs) {
      const box = img.parentElement.getBoundingClientRect();
      if (box.bottom < -50 || box.top > vh + 50) continue;
      const p = (box.top + box.height / 2 - vh / 2) / (vh / 2 + box.height / 2);   // -1 (sopra) … 1 (sotto)
      const k = Math.max(-1, Math.min(1, p));
      img.style.setProperty('--py', `${(-k * box.height * 0.05).toFixed(1)}px`);
      img.style.setProperty('--sc', (1.1 + (1 - Math.abs(k)) * 0.05).toFixed(3));
    }
  };
  const req = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  addEventListener('scroll', req, { passive: true }); addEventListener('resize', req); update();
}
