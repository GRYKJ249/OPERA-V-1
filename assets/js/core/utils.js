export const $ = (id) => document.getElementById(id);
export const RM = matchMedia('(prefers-reduced-motion:reduce)').matches;
/** مولّد أرقام عشوائية ثابت بحسب البذرة */
export const rng = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
/** قراءة/كتابة آمنة في localStorage (تعمل حتى لو كان التخزين محظوراً) */
export const ls = (k, v) => {
    try {
        if (v !== undefined) {
            localStorage.setItem(k, v);
            return v;
        }
        return localStorage.getItem(k);
    }
    catch {
        // التخزين محظور (مثلاً داخل إطار معزول): نحفظ في window.name فهو يبقى بعد إعادة التحميل
        let o = {};
        try {
            o = JSON.parse(window.name || '{}') || {};
        }
        catch { /* */ }
        if (v !== undefined) {
            o[k] = v;
            try {
                window.name = JSON.stringify(o);
            }
            catch { /* */ }
            return v;
        }
        return o[k] ?? null;
    }
};
export const isMobile = () => document.documentElement.dataset.device === 'mobile';
/** جذر الموقع (هذا الملف يُترجم إلى assets/js/core/utils.js، لذلك الجذر ثلاث مستويات للأعلى) */
export const ROOT = new URL('../../../', import.meta.url);
