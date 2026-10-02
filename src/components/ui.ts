import { $, RM } from '../core/utils.js';
export function initWords(): void {
  const rs = [...document.querySelectorAll<HTMLElement>('#rot span')]; let i = 0;
  if (!rs.length) return;
  setInterval(() => {
    const o = rs[i]; o.className = 'out'; i = (i + 1) % rs.length;
    const n = rs[i]; n.style.transition = 'none'; n.className = ''; void n.offsetWidth; n.style.transition = ''; n.className = 'on';
    setTimeout(() => { o.className = ''; }, 800);
  }, 2600);
}
export function initScroll(): void {
  addEventListener('pointermove', e => { $('glow').style.transform = `translate(${e.clientX}px,${e.clientY}px)`; });
  const count = (b: HTMLElement) => {
    const t = Number(b.dataset.n), s = performance.now();
    const f = (n: number) => { const p = Math.min((n - s) / 1400, 1); b.textContent = Math.round(t * (1 - (1 - p) ** 3)).toLocaleString('en'); if (p < 1) requestAnimationFrame(f); };
    f(s);
  };
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const el = e.target as HTMLElement; el.classList.add('in'); io.unobserve(el);
    if (el.classList.contains('stats')) el.querySelectorAll<HTMLElement>('b').forEach(count);
  }), { threshold: .2 });
  document.querySelectorAll('.rv').forEach(e => io.observe(e));
}
export function initTrail(): void {
  if (!matchMedia('(pointer:fine)').matches || RM) return;
  const dots: HTMLElement[] = [], pos: number[][] = []; let X = -50, Y = -50;
  for (let i = 0; i < 9; i++) {
    const d = document.createElement('i'); d.className = 'tr'; d.style.opacity = String((1 - i / 9) * .7); d.style.scale = String(1 - i * .08);
    document.body.appendChild(d); dots.push(d); pos.push([X, Y]);
  }
  addEventListener('pointermove', e => { X = e.clientX; Y = e.clientY; });
  const f = () => {
    let x = X, y = Y;
    dots.forEach((d, i) => { const p = pos[i]; p[0] += (x - p[0]) * .35; p[1] += (y - p[1]) * .35; d.style.transform = `translate(${p[0]}px,${p[1]}px)`; x = p[0]; y = p[1]; });
    requestAnimationFrame(f);
  };
  f();
}
