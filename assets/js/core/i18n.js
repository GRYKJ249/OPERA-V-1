import { EN } from './lang-en.js';
import { ls } from './utils.js';
const KEY = 'op-lang';
const norm = (s) => s.replace(/\s+/g, ' ').trim();
/** اللغة المختارة: اختيار المستخدم إن وُجد، وإلا لغة الجهاز (عربي أو إنجليزي، والبقية إنجليزي) */
function detectLang() {
    const saved = ls(KEY);
    if (saved === 'ar' || saved === 'en')
        return saved;
    const list = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
    for (const l of list) {
        const c = l.toLowerCase();
        if (c.startsWith('ar'))
            return 'ar';
        if (c.startsWith('en'))
            return 'en';
    }
    return 'en';
}
export const lang = detectLang();
/** ترجمة نص عربي إلى لغة الصفحة الحالية (العربية تبقى كما هي) */
export const t = (s) => (lang === 'en' ? EN[norm(s)] ?? s : s);
/** يضبط اتجاه الصفحة ويترجم كل النصوص والسمات إذا كانت اللغة إنجليزية */
export function applyLang() {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    if (lang === 'ar')
        return;
    const w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
        const p = n.parentElement?.tagName;
        if (p === 'SCRIPT' || p === 'STYLE')
            continue;
        const raw = n.nodeValue || '', en = EN[norm(raw)];
        if (en)
            n.nodeValue = (/^\s/.test(raw) ? ' ' : '') + en + (/\s$/.test(raw) ? ' ' : '');
    }
    document.querySelectorAll('[content],[placeholder],[aria-label],[title],[alt]').forEach(el => {
        for (const a of ['content', 'placeholder', 'aria-label', 'title', 'alt']) {
            const v = el.getAttribute(a), en = v && EN[norm(v)];
            if (en)
                el.setAttribute(a, en);
        }
    });
}
/** زر صغير للتبديل اليدوي بين اللغتين (يُحفظ الاختيار ويُعاد تحميل الصفحة) */
export function initLangSwitch() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lang';
    b.textContent = lang === 'ar' ? 'EN' : 'AR';
    b.setAttribute('aria-label', lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
    b.onclick = () => { ls(KEY, lang === 'ar' ? 'en' : 'ar'); location.reload(); };
    document.body.appendChild(b);
}
