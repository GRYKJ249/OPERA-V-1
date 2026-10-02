import { $, RM, rng } from '../core/utils.js';
import { t } from '../core/i18n.js';
const P = ['#6f7bff', '#22e3c4', '#ffb547', '#ff5d8f', '#eef1ff'], D = ['#0b0f2b', '#140b2e', '#0a1f2e', '#2a0f24'];
const NAMES = ['فكرة أولى', 'خطوط وألوان', 'توازن', 'حركة', 'فوضى منظمة', 'عمق', 'إيقاع', 'ضوء', 'تقاطع', 'هدوء', 'طاقة', 'بداية جديدة'];
/** يولّد لوحات SVG هندسية داخل المعرض */
export function buildGallery() {
    const r = rng(3), c = () => P[Math.floor(r() * 5)];
    $('ga').innerHTML = NAMES.map((n, k) => {
        let v = `<rect width="400" height="300" fill="${D[k % 4]}"/><circle cx="${80 + r() * 240}" cy="${60 + r() * 180}" r="${90 + r() * 60}" fill="${c()}" opacity=".18"/>`;
        for (let i = 0; i < 7; i++) {
            const x = r() * 400, y = r() * 300, z = 20 + r() * 70, f = c(), m = i % 4;
            v += m === 0 ? `<circle cx="${x}" cy="${y}" r="${z / 2}" fill="${f}" opacity=".85"/>`
                : m === 1 ? `<rect x="${x}" y="${y}" width="${z}" height="${z}" fill="none" stroke="${f}" stroke-width="4" transform="rotate(${r() * 90} ${x} ${y})"/>`
                    : m === 2 ? `<polygon points="${x},${y - z / 2} ${x + z / 2},${y + z / 2} ${x - z / 2},${y + z / 2}" fill="${f}" opacity=".8"/>`
                        : `<path d="M${x} ${y}q${z} ${-z} ${2 * z} 0" fill="none" stroke="${f}" stroke-width="5"/>`;
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${v}</svg>`;
        const nm = t(n);
        return `<figure class="rv"><img alt="${nm}" loading="lazy" src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}"><figcaption>${nm}</figcaption></figure>`;
    }).join('');
}
/** ميلان ثلاثي الأبعاد + عرض مكبّر للصور */
export function initGalleryFx() {
    const ga = $('ga'), lb = document.createElement('div');
    lb.id = 'lb';
    lb.innerHTML = '<div><img alt=""><p></p></div>';
    document.body.appendChild(lb);
    const fig = (e) => e.target.closest('figure');
    lb.onclick = () => lb.classList.remove('on');
    addEventListener('keydown', e => { if (e.key === 'Escape')
        lb.classList.remove('on'); });
    ga.addEventListener('pointermove', e => {
        const f = fig(e);
        if (!f || RM)
            return;
        const b = f.getBoundingClientRect(), x = (e.clientX - b.left) / b.width - .5, y = (e.clientY - b.top) / b.height - .5;
        f.style.transform = `perspective(700px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) scale(1.03)`;
    });
    ga.addEventListener('pointerout', e => { const f = fig(e); if (f)
        f.style.transform = ''; });
    ga.addEventListener('click', e => {
        const f = fig(e);
        if (!f)
            return;
        lb.querySelector('img').src = f.querySelector('img').src;
        lb.querySelector('p').textContent = f.querySelector('figcaption').textContent;
        lb.classList.add('on');
    });
}
