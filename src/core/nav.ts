import { RM } from './utils.js';
/**
 * روابط # (الأقسام والعودة للأعلى) تعمل بالجافاسكربت، فتشتغل حتى داخل الإطارات
 * والمتصفحات التي تُعطّل الانتقال إلى المراسي. الرابط الذي لا يحتوي قسماً يرجع للأعلى.
 */
export function initNav() {
    document.addEventListener('click', (e: MouseEvent) => {
        const a = (e.target as Element).closest?.('a[href^="#"]') as HTMLAnchorElement | null;
        if (!a || e.defaultPrevented)
            return;
        const id = decodeURIComponent((a.getAttribute('href') || '').slice(1));
        const el = id ? document.getElementById(id) : null;
        if (id && !el)
            return;
        e.preventDefault();
        const y = el ? el.getBoundingClientRect().top + scrollY - 8 : 0;
        scrollTo({ top: Math.max(0, y), behavior: RM ? 'auto' : 'smooth' });
    });
}
