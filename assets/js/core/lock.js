/**
 * قفل التحريك الجانبي والزوم على الجوال.
 * الأساس في CSS (touch-action) وفي وسم viewport، وهنا الباقي لمتصفح iOS الذي يتجاهل بعضها.
 */
export function initLock() {
    const stop = (e) => e.preventDefault();
    // إيماءة القرص (pinch) في iOS Safari
    for (const t of ['gesturestart', 'gesturechange', 'gestureend'])
        document.addEventListener(t, stop, { passive: false });
    // لمسة بإصبعين أو أكثر
    document.addEventListener('touchmove', e => { if (e.touches.length > 1)
        e.preventDefault(); }, { passive: false });
    // منع التحريك الأفقي بإصبع واحد: نتتبّع اتجاه السحب ونلغيه إذا كان أفقياً
    let sx = 0, sy = 0;
    document.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    document.addEventListener('touchmove', e => {
        if (e.touches.length !== 1)
            return;
        const dx = Math.abs(e.touches[0].clientX - sx), dy = Math.abs(e.touches[0].clientY - sy);
        if (dx > dy && dx > 6 && e.cancelable)
            e.preventDefault();
    }, { passive: false });
}
