import { RM, ROOT, ls } from '../core/utils.js';
import { t } from '../core/i18n.js';
const q = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s);
/** المفضلة في المعرض (تُحفظ على الجهاز) */
export function initHearts(): void {
  const ga = document.getElementById('ga'); if (!ga) return;
  let fav: number[] = []; try { fav = JSON.parse(ls('op-fav') || '[]'); } catch { /* */ }
  ga.querySelectorAll('figure').forEach((f, i) => {
    const b = document.createElement('button'); b.className = 'hr'; b.setAttribute('aria-label', t('إضافة للمفضلة'));
    const sync = () => { b.textContent = fav.includes(i) ? '♥' : '♡'; b.classList.toggle('on', fav.includes(i)); }; sync();
    b.onclick = e => { e.stopPropagation(); fav = fav.includes(i) ? fav.filter(x => x !== i) : [...fav, i]; ls('op-fav', JSON.stringify(fav)); sync(); };
    f.appendChild(b);
  });
}
export function initFeatures(): void {
  const root = document.documentElement;
  // شاشة التحميل
  const ld = q('#ld'), hide = () => { ld?.classList.add('done'); setTimeout(() => ld?.remove(), 700); };
  if (document.readyState === 'complete') setTimeout(hide, 500); else addEventListener('load', () => setTimeout(hide, 500));
  // زر الدخول في الشريط العلوي
  const goLogin = () => { location.href = new URL('pages/login.html', ROOT).href; };
    const lb = q('.login'); lb?.addEventListener('click', goLogin);
  fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(j => { if (j?.user && lb) lb.textContent = j.user.displayName || j.user.email.split('@')[0]; }).catch(() => { /* لا يوجد خادم */ });
  // زر الأعلى + تأثيرات التمرير (الخلفية المتغيرة والبارالاكس)
  const up = q('#up'); up?.addEventListener('click', () => scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' }));
  addEventListener('scroll', () => {
    const y = scrollY, mx = document.body.scrollHeight - innerHeight || 1;
    up?.classList.toggle('on', y > 600);
    root.style.setProperty('--py', y * .15 + 'px'); root.style.setProperty('--h', String(230 + y / mx * 120)); root.style.setProperty('--sy', String(Math.round(y / mx * 100)));
  }, { passive: true });
  // ظهور كلمات العناوين تباعاً (بالكلمات لا بالحروف حتى لا ينكسر ربط العربية)
  document.querySelectorAll<HTMLElement>('h2.rv').forEach(h => { h.innerHTML = (h.textContent || '').trim().split(/\s+/).map((x, i) => `<span class="w" style="--i:${i}">${x}</span>`).join(' '); });
  // أزرار مغناطيسية
  if (!RM && matchMedia('(pointer:fine)').matches) document.querySelectorAll<HTMLElement>('.btn').forEach(b => {
    b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); b.style.translate = `${(e.clientX - r.left - r.width / 2) * .2}px ${(e.clientY - r.top - r.height / 2) * .3}px`; });
    b.addEventListener('pointerleave', () => { b.style.translate = ''; });
  });
  // عدّاد زيارات تجريبي
  const vc = q('#vc'); if (vc) { const n = (Number(ls('op-vc')) || 0) + 1; ls('op-vc', String(n)); vc.textContent = String(n); }
  // تذكّر موضع التمرير
  const sk = 'op-scroll-' + document.title;
  try { const y = Number(sessionStorage.getItem(sk)); if (y > 0) setTimeout(() => scrollTo(0, y), 700); addEventListener('pagehide', () => sessionStorage.setItem(sk, String(scrollY))); } catch { /* */ }
  // اختصارات: T للأعلى، L للدخول
  addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName) || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === 't') up?.click(); else if (k === 'l') goLogin();
  });
  // PWA
  navigator.serviceWorker?.register(new URL('assets/sw.js', ROOT).href, { scope: ROOT.pathname }).catch(() => { /* غير متاح في المعاينة أو بدون ترويسة النطاق */ });
}
