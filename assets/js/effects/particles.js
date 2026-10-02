import { RM, isMobile } from '../core/utils.js';
let recolorFn = () => { };
/** تغيير ألوان النقاط (يُستدعى من الثيمات) */
export const recolor = (c) => recolorFn(c);
/** مجسم نقاط ثلاثي الأبعاد يتحول بين أربعة أشكال */
export function initParticles() {
    if (typeof THREE === 'undefined')
        return;
    const N = 5000, cv = document.getElementById('gl');
    const r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(55, 1, .1, 100);
    const S = [[], [], [], []];
    for (let i = 0; i < N; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * 6.283, q = Math.sqrt(1 - u * u);
        S[0].push(2.2 * q * Math.cos(a), 2.2 * u, 2.2 * q * Math.sin(a));
        const t = i / N * 6.283 * 3, R = 2 + .7 * Math.cos(1.5 * t);
        S[1].push(R * Math.cos(t) * .9, R * Math.sin(t) * .9, 1.1 * Math.sin(1.5 * t));
        S[2].push((Math.random() - .5) * 3.6, (Math.random() - .5) * 3.6, (Math.random() - .5) * 3.6);
        const h = i / N * 6.283 * 6, s = i % 2 ? 1 : -1;
        S[3].push(1.3 * Math.cos(h + s * 3.14), (i / N - .5) * 5.4, 1.3 * Math.sin(h + s * 3.14));
    }
    const col = new Float32Array(N * 3), g = new THREE.BufferGeometry();
    const paint = (cs) => {
        const q = cs.map(x => new THREE.Color(x));
        for (let i = 0; i < N; i++) {
            const k = q[i % 3];
            col.set([k.r, k.g, k.b], i * 3);
        }
        g.attributes.color.needsUpdate = true;
    };
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S[0]), 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    paint(['#6f7bff', '#22e3c4', '#ffb547']);
    recolorFn = paint;
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: .035, vertexColors: true, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending }));
    sc.add(pts);
    let mx = 0, my = 0, shape = 0;
    addEventListener('pointermove', e => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; });
    setInterval(() => { shape = (shape + 1) % 4; }, 4200);
    const resize = () => { r.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.position.z = isMobile() ? 9 : 6; cam.updateProjectionMatrix(); };
    resize();
    addEventListener('resize', resize);
    const loop = () => {
        requestAnimationFrame(loop);
        const T = S[shape], p = g.attributes.position.array;
        for (let i = 0; i < N * 3; i++)
            p[i] += (T[i] - p[i]) * (RM ? 1 : .04);
        g.attributes.position.needsUpdate = true;
        if (!RM)
            pts.rotation.y += .0035;
        pts.rotation.x += ((my * .8 + scrollY * .0008) - pts.rotation.x) * .05;
        pts.position.x += (-mx * .6 - pts.position.x) * .05;
        pts.position.y = 1.3 - Math.min(scrollY / innerHeight, 1.6) * 1.2;
        cv.style.opacity = String(Math.max(.15, 1 - scrollY / (innerHeight * 1.4)));
        r.render(sc, cam);
    };
    loop();
}
