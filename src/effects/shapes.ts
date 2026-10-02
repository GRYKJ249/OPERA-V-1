import { rng } from '../core/utils.js';
const COLORS = ['var(--a)', 'var(--b)', 'var(--c)', 'var(--d)', 'var(--fg)'];
const CLIPS = ['50% 0,100% 100%,0 100%', '50% 0,100% 38%,82% 100%,18% 100%,0 38%', '25% 5%,75% 5%,100% 50%,75% 95%,25% 95%,0 50%', '50% 0,100% 50%,50% 100%,0 50%', '50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%', '35% 0,65% 0,65% 35%,100% 35%,100% 65%,65% 65%,65% 100%,35% 100%,35% 65%,0 65%,0 35%,35% 35%'];
/** 100 تشكيل هندسي عشرة أنواع تطفو في خلفية الصفحة */
export function buildShapes(count = 100): void {
  const H = Math.max(document.body.scrollHeight, 2000), r = rng(7), wrap = document.createElement('div');
  wrap.id = 'sh';
  for (let n = 0; n < count; n++) {
    const t = n % 10, c = COLORS[(n * 3 + (n >> 3)) % 5], z = 28 + r() * 110, e = document.createElement('i');
    let st = `width:${z}px;height:${z}px;`;
    if (t < 6) st += `background:${c};clip-path:polygon(${CLIPS[t]});`;
    else if (t === 6) st += `border:3px solid ${c};border-radius:50%;`;
    else if (t === 7) st += `border:3px solid ${c};`;
    else if (t === 8) st += `background-image:radial-gradient(${c} 2px,transparent 2.6px);background-size:14px 14px;`;
    else st += `height:${z / 2}px;background:${c};border-radius:${z}px ${z}px 0 0;`;
    e.style.cssText = st + `top:${r() * H}px;left:${r() * 96}%;--o:${(.1 + r() * .22).toFixed(2)};--t:${(7 + r() * 12).toFixed(1)}s;--dx:${Math.round(r() * 80 - 40)}px;--dy:${Math.round(r() * 120 - 60)}px;--r:${Math.round(r() * 240 - 120)}deg;`;
    wrap.appendChild(e);
  }
  document.body.prepend(wrap);
}
