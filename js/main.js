/*
 * Page motion: split type, a liquid variable-font name, the portrait blob,
 * magnetic buttons, and a few small conveniences (email, progress,
 * lightbox).
 */
(function () {
  'use strict';

  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Shared per-frame state.
  // moved starts at -Infinity: until the pointer actually moves, it isn't
  // "active" (0 made the first 2.5s after load look like recent movement).
  const mouse = { x: innerWidth / 2, y: innerHeight / 2, moved: -Infinity };
  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.moved = performance.now();
  }, { passive: true });

  // Closed Catmull-Rom spline through points, as an SVG path of cubic
  // Béziers. Used by the portrait and the blobbies.
  const smoothPath = (pts) => {
    const n = pts.length;
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ` +
        `${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ` +
        `${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return `${d}Z`;
  };

  const tickers = [];
  function loop(now) {
    for (const fn of tickers) fn(now);
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------ split text
  document.querySelectorAll('[data-split]').forEach((el) => {
    const mode = el.dataset.split || 'chars';
    const text = el.textContent.trim();
    el.textContent = '';
    const parts = mode === 'words' ? text.split(/\s+/) : [...text];
    const offset = Number(el.dataset.splitOffset || 0);
    parts.forEach((part, i) => {
      const clip = document.createElement('span');
      clip.className = 'split__clip';
      const inner = document.createElement('span');
      inner.className = mode === 'words' ? 'split__word' : 'split__char';
      inner.textContent = part;
      inner.style.setProperty('--i', i + offset);
      clip.append(inner);
      el.append(clip);
      if (mode === 'words' && i < parts.length - 1) el.append(' ');
    });
  });
  // Entrances start once the display font is ready, so nothing animates in a
  // fallback font and then jumps when Archivo swaps in. Give up waiting after
  // 1.5s so a slow or blocked font never holds the page back.
  const fontsReady = Promise.race([
    document.fonts.load('900 100px Archivo').then(() => document.fonts.ready),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]).catch(() => {});
  fontsReady.then(() => requestAnimationFrame(() => root.classList.add('is-ready')));

  // ------------------------------------------------ stable hover widening
  // Titles that widen on hover keep the line breaks they have at rest, and
  // only widen as far as their longest line still fits (--wdth-fit).
  const textWidth = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getBoundingClientRect().width;
  };

  function lockLines(el) {
    if (!el.clientWidth) return; // not laid out yet (e.g. in the closed drawer)
    const cs = getComputedStyle(el);
    const rest = parseFloat(cs.getPropertyValue('--wdth'));
    const hover = parseFloat(cs.getPropertyValue('--wdth-hover'));
    const text = (el.dataset.text ??= el.textContent.trim().replace(/\s+/g, ' '));

    el.style.transition = 'none';
    el.style.fontVariationSettings = `"wdth" ${rest}`;

    // Lay the text out as individual words (split after spaces and hyphens,
    // where it may break) and group them by the line they land on.
    el.textContent = '';
    const tokens = text.split(/(?<=[\s-])/).map((t) => {
      const span = document.createElement('span');
      span.textContent = t;
      el.append(span);
      return span;
    });
    const lines = [];
    let top = -Infinity;
    for (const token of tokens) {
      const t = token.getBoundingClientRect().top;
      if (t > top + 2) { lines.push(''); top = t; }
      lines[lines.length - 1] += token.textContent;
    }
    el.textContent = '';
    const lineEls = lines.map((line) => {
      const span = document.createElement('span');
      span.className = 'lock-line';
      span.textContent = line;
      el.append(span);
      return span;
    });

    // Width is close to linear in "wdth", so two measurements give the limit.
    const room = el.clientWidth - 2;
    const lo = lineEls.map(textWidth);
    el.style.fontVariationSettings = `"wdth" ${hover}`;
    const hi = lineEls.map(textWidth);
    let fit = hover;
    lineEls.forEach((_, i) => {
      if (hi[i] > room) fit = Math.min(fit, rest + (hover - rest) * clamp((room - lo[i]) / (hi[i] - lo[i]), 0, 1));
    });
    el.style.setProperty('--wdth-fit', fit.toFixed(1));
    el.dataset.lockedAt = el.clientWidth;

    el.style.removeProperty('font-variation-settings');
    void el.offsetWidth;
    el.style.removeProperty('transition');
  }

  const lockable = [...document.querySelectorAll('.entry__title, .reads__title, .next__title')];
  const relock = () => lockable.forEach(lockLines);
  relock();
  document.fonts.ready.then(relock);
  const lockObserver = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      if (Number(target.dataset.lockedAt) !== target.clientWidth) lockLines(target);
    }
  });
  lockable.forEach((el) => lockObserver.observe(el));

  // --------------------------------------------- liquid variable-font name
  const chars = [...document.querySelectorAll('.hero__name .split__char')];
  const hero = document.querySelector('.hero');
  if (chars.length && hero && !reduceMotion) {
    const state = chars.map(() => ({ w: 62, g: 500, open: 0, cx: 0, cy: 0 }));
    const targets = new Float32Array(chars.length);
    const BREATH = 9; // idle breathing, in "wdth" units either side of rest
    const baseOf = new Float32Array(chars.length).fill(100);
    const ampOf = new Float32Array(chars.length).fill(BREATH);
    let born = Infinity; // set when the entrance starts
    let last = performance.now();
    let pointerPull = 0; // eases between 0 (idle) and 1 (pointer moving)
    let heroVisible = true;
    new IntersectionObserver(([entry]) => { heroVisible = entry.isIntersecting; }).observe(hero);

    // A letter's width is close to linear in its "wdth" axis, so a small
    // per-letter model lets us rein in the widening before a line overflows.
    const lines = [...hero.querySelectorAll('.hero__line')].map((el) => ({
      el,
      idx: [...el.querySelectorAll('.split__char')].map((c) => chars.indexOf(c)),
      room: Infinity,
    }));
    const slope = new Float32Array(chars.length), icept = new Float32Array(chars.length);
    const settings = (w, g) => `"wdth" ${w.toFixed(1)}, "wght" ${g.toFixed(0)}`;
    // Resting width and weight come from CSS (condensed and heavier on phones).
    const nameEl = hero.querySelector('.hero__name');
    let restW = 100, restG = 820;
    const weightFor = (w) => clamp(restG + (w - restW) * 3, 100, 900);

    function measure() {
      const cs = getComputedStyle(nameEl);
      restW = parseFloat(cs.getPropertyValue('--name-wdth')) || 100;
      restG = parseFloat(cs.getPropertyValue('--name-wght')) || 820;
      const widthsAt = (w) => {
        for (const c of chars) c.style.fontVariationSettings = settings(w, weightFor(w));
        return chars.map((c) => c.parentElement.getBoundingClientRect().width);
      };
      const lo = widthsAt(62), hi = widthsAt(125);
      chars.forEach((c, i) => {
        slope[i] = (hi[i] - lo[i]) / 63;
        icept[i] = lo[i] - slope[i] * 62;
        c.style.fontVariationSettings = settings(state[i].w, state[i].g);
      });
      for (const line of lines) {
        const cs = getComputedStyle(line.el);
        line.room = (line.el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) * 0.98;

        // Settle each line once, here, rather than correcting every frame:
        // rest at restW (or condensed just enough to fit), and breathe only as
        // much as fits. Letters breathe out of phase, so the line's widest
        // moment is the magnitude of the summed sines, |Σ slope·e^(i·0.8·n)|.
        let sumA = 0, sumB = 0, sx = 0, sy = 0;
        for (const i of line.idx) {
          sumA += icept[i];
          sumB += slope[i];
          sx += slope[i] * Math.cos(i * 0.8);
          sy += slope[i] * Math.sin(i * 0.8);
        }
        const base = clamp((line.room - sumA) / sumB, 62, restW);
        const peak = Math.hypot(sx, sy) * BREATH;
        const headroom = line.room - (sumA + sumB * base);
        const amp = peak > 0 ? BREATH * clamp(headroom / peak, 0, 1) : BREATH;
        for (const i of line.idx) { baseOf[i] = base; ampOf[i] = amp; }
      }
    }

    // Idle breathing always fits (see measure); this only reins in the
    // widening near the pointer.
    function fit() {
      for (const line of lines) {
        let rest = 0, extra = 0, sumA = 0, sumB = 0;
        for (const i of line.idx) {
          rest += icept[i] + slope[i] * baseOf[i];
          extra += slope[i] * (targets[i] - baseOf[i]);
          sumA += icept[i];
          sumB += slope[i];
        }
        if (rest + extra <= line.room) continue;
        if (rest <= line.room && extra > 0) {
          // Scale the widening down just enough to fit.
          const k = (line.room - rest) / extra;
          for (const i of line.idx) targets[i] = baseOf[i] + (targets[i] - baseOf[i]) * k;
        } else {
          // Even at rest it's too wide: condense the whole line to fit.
          const w = clamp((line.room - sumA) / sumB, 62, 125);
          for (const i of line.idx) targets[i] = Math.min(targets[i], w);
        }
      }
    }

    measure();
    fontsReady.then(() => {
      measure();
      born = performance.now();
    });
    new ResizeObserver(() => requestAnimationFrame(measure)).observe(nameEl);

    tickers.push((now) => {
      // Ease by elapsed time, so it settles at the same pace on any display.
      const dt = Math.min(64, now - last);
      last = now;
      const ease = 1 - Math.pow(1 - 0.12, dt / 16.667);
      if (!heroVisible) return;
      const since = now - born;
      const active = finePointer && now - mouse.moved < 2500;
      // Fade the pointer effect in and out instead of switching it.
      pointerPull = lerp(pointerPull, active ? 1 : 0, 1 - Math.pow(0.9, dt / 16.667));
      for (let i = 0; i < chars.length; i++) {
        const s = state[i];
        // Each letter unfolds from condensed once its entrance begins.
        const open = s.open = clamp((since - 350 - i * 70) / 900, 0, 1);
        let target = 62 + (baseOf[i] - 62) * open;
        if (open >= 1) {
          // Breathing fades in over ~1.6s after the letter lands, rather than
          // starting mid-wave (which made each letter lurch as it settled).
          const settle = clamp((since - 1250 - i * 70) / 1600, 0, 1);
          const breathe = settle * settle * (3 - 2 * settle);
          target = baseOf[i] + Math.sin(now / 1100 + i * 0.8) * ampOf[i] * breathe;
          if (pointerPull > 0.001) {
            const d = Math.hypot(s.cx - mouse.x, (s.cy - mouse.y) * 0.7);
            const f = Math.exp(-(d * d) / (240 * 240));
            target = lerp(target - 6 * pointerPull, 125, f * pointerPull);
          }
        }
        targets[i] = clamp(target, 62, 125);
      }
      fit();
      for (let i = 0; i < chars.length; i++) {
        const s = state[i];
        s.w = lerp(s.w, targets[i], ease);
        s.g = lerp(s.g, s.open >= 1 ? weightFor(s.w) : 500 + s.open * (restG - 500), ease);
        chars[i].style.fontVariationSettings = settings(s.w, s.g);
      }
      for (let i = 0; i < chars.length; i++) {
        const r = chars[i].getBoundingClientRect();
        state[i].cx = r.left + r.width / 2;
        state[i].cy = r.top + r.height / 2;
      }
    });
  }

  // --------------------------------------------------------- portrait blob
  // The outline is a circle nudged by a few slow, overlapping waves, so it
  // stays smooth like a pebble or a droplet. Near the pointer the whole
  // shape leans and stretches toward it on a soft spring. The terracotta
  // shade underneath is the same shape, offset like a print layer.
  const portrait = document.querySelector('.portrait');
  if (portrait) {
    const blob = portrait.querySelector('.portrait__blob');
    const shade = portrait.querySelector('.portrait__shade');
    const SAMPLES = 36;
    // [harmonic, amplitude, phase, speed in rad/s]
    const waves = [[2, 0.035, 0.4, 0.23], [3, 0.025, 2.1, -0.17], [4, 0.012, 4.2, 0.11]];
    const lean = { x: 0, y: 0, vx: 0, vy: 0 };
    let visible = true;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(portrait);

    const draw = (now) => {
      const size = portrait.clientWidth;
      if (!size) return;
      // The layers overhang the portrait box (see CSS): c is the layer's
      // centre, R stays relative to the portrait. Waves plus a full lean peak
      // at ~0.5 × size, still inside the layer.
      const c = blob.clientWidth / 2, R = size * 0.44;
      const t = reduceMotion ? 0 : now / 1000;

      // Lean: a vector toward the pointer, strongest on the portrait and
      // fading out ~300px away, eased on a soft spring.
      const box = portrait.getBoundingClientRect();
      const dx = mouse.x - (box.left + size / 2), dy = mouse.y - (box.top + size / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const active = finePointer && !reduceMotion && now - mouse.moved < 2500;
      const pull = active ? clamp(1 - (dist - R) / 300, 0, 1) : 0;
      const tx = (dx / dist) * pull, ty = (dy / dist) * pull;
      lean.vx = lean.vx * 0.86 + (tx - lean.x) * 0.035;
      lean.vy = lean.vy * 0.86 + (ty - lean.y) * 0.035;
      lean.x += lean.vx;
      lean.y += lean.vy;
      const leanAmount = Math.hypot(lean.x, lean.y), leanAngle = Math.atan2(lean.y, lean.x);

      const pts = [];
      for (let i = 0; i < SAMPLES; i++) {
        const a = (i / SAMPLES) * Math.PI * 2;
        let r = 1;
        for (const [k, amp, phase, speed] of waves) r += amp * Math.sin(k * a + phase + speed * t);
        // Lean toward the pointer (1st harmonic) and stretch along it (2nd).
        r += leanAmount * (0.05 * Math.cos(a - leanAngle) + 0.03 * Math.cos(2 * (a - leanAngle)));
        pts.push([c + Math.cos(a) * R * r, c + Math.sin(a) * R * r]);
      }
      const path = `path("${smoothPath(pts)}")`;
      blob.style.clipPath = path;
      shade.style.clipPath = path;
      // The shade shifts a little away from the pointer for depth.
      shade.style.transform = `translate(${(12 - lean.x * 6).toFixed(2)}px, ${(10 - lean.y * 6).toFixed(2)}px)`;
    };

    portrait.classList.add('is-live');
    if (reduceMotion) {
      // One still frame, redrawn only if the size changes.
      new ResizeObserver(() => draw(0)).observe(portrait);
    } else {
      tickers.push((now) => { if (visible) draw(now); });
    }
  }

  // ------------------------------------------------- scroll-linked chrome
  const nav = document.querySelector('.nav');
  const progress = document.querySelector('.progress');
  function chrome() {
    const y = window.scrollY, vh = window.innerHeight;
    nav && nav.classList.toggle('is-scrolled', y > 24);
    if (progress) {
      const max = document.documentElement.scrollHeight - vh;
      progress.style.transform = `scaleX(${max > 0 ? clamp(y / max, 0, 1) : 0})`;
    }
  }
  window.addEventListener('scroll', chrome, { passive: true });
  window.addEventListener('resize', chrome, { passive: true });
  chrome();

  // ------------------------------------------------------- mid-century shapes
  // Simple mid-century forms fill the space above the name: suns, a half-moon
  // bowl, a ring, soft pebbles and a kidney that wobble like liquid, and the
  // Claude and Codex marks. Each floats gently, leans away from
  // the pointer, boings when clicked or tapped, and can be dragged; let go
  // and it springs home. Shapes near the edges run partly off-screen.
  const shapeLayer = document.querySelector('.blobs');
  if (shapeLayer && hero) {
    const svg = shapeLayer.querySelector('svg');
    const NS = 'http://www.w3.org/2000/svg';
    const C = { t: 'var(--terracotta)', m: 'var(--mustard)', s: 'var(--sage)', g: 'var(--teal)', k: 'var(--fg)' };
    // kind, home (fx, fy as a share of the band above the name; past 0–1
    // runs off-screen), r (radius as a share of the band's height), rot (deg).
    const LAYOUTS = {
      wide: [
        { kind: 'sun', fx: 0.02, fy: 0.5, r: 0.4, color: C.t },
        { kind: 'kidney', fx: 0.24, fy: 0.5, r: 0.24, color: C.s, rot: 12 },
        { kind: 'half', fx: 0.5, fy: -0.1, r: 0.46, color: C.m, rot: 180 },
        { kind: 'pebble', fx: 0.63, fy: 0.64, r: 0.15, color: C.g },
        { kind: 'claude', fx: 0.74, fy: 0.3, r: 0.2, color: C.t },
        { kind: 'pebble', fx: 0.86, fy: 0.6, r: 0.24, color: C.s },
        { kind: 'ring', fx: 0.985, fy: 0.12, r: 0.28, color: C.k },
        { kind: 'codex', fx: 0.4, fy: 0.72, r: 0.16, color: C.k },
      ],
      narrow: [
        { kind: 'sun', fx: 0.02, fy: 0.55, r: 0.36, color: C.t },
        { kind: 'half', fx: 0.82, fy: -0.1, r: 0.4, color: C.m, rot: 180 },
        { kind: 'pebble', fx: 0.55, fy: 0.45, r: 0.16, color: C.g },
        { kind: 'claude', fx: 0.9, fy: 0.74, r: 0.14, color: C.t },
        { kind: 'codex', fx: 0.5, fy: 0.82, r: 0.12, color: C.k },
      ],
    };

    // The Claude spark's outline as points on a 24×24 grid (centred on
    // 12,12), so its rays can stretch and pull back one after another.
    const SPARK = '4.709,15.955 9.429,13.308 9.509,13.078 9.429,12.95 9.2,12.95 8.41,12.902 5.712,12.829 3.373,12.732 1.107,12.61 .536,12.489 0,11.784 .055,11.432 .535,11.111 1.221,11.171 2.741,11.274 5.019,11.432 6.671,11.529 9.12,11.784 9.509,11.784 9.564,11.627 9.43,11.529 9.327,11.432 6.969,9.836 4.417,8.148 3.081,7.176 2.357,6.685 1.993,6.223 1.835,5.215 2.491,4.493 3.372,4.553 3.597,4.614 4.49,5.3 6.398,6.776 8.889,8.609 9.254,8.913 9.399,8.81 9.418,8.737 9.254,8.463 7.899,6.017 6.453,3.527 5.809,2.495 5.639,1.876 5.535,1.147 6.283,.134 6.696,0 7.692,.134 8.112,.498 8.732,1.912 9.734,4.141 11.289,7.171 11.745,8.069 11.988,8.901 12.079,9.156 12.237,9.156 12.237,9.01 12.365,7.304 12.602,5.209 12.832,2.514 12.912,1.754 13.288,.844 14.035,.352 14.619,.632 15.099,1.317 15.032,1.761 14.746,3.612 14.187,6.515 13.823,8.457 14.035,8.457 14.278,8.215 15.263,6.909 16.915,4.845 17.645,4.025 18.495,3.121 19.042,2.69 20.075,2.69 20.835,3.819 20.495,4.985 19.431,6.332 18.55,7.474 17.286,9.174 16.496,10.534 16.569,10.644 16.757,10.624 19.613,10.018 21.156,9.738 22.997,9.423 23.83,9.811 23.921,10.206 23.593,11.013 21.624,11.499 19.315,11.961 15.876,12.774 15.834,12.804 15.883,12.865 17.432,13.011 18.094,13.047 19.716,13.047 22.736,13.272 23.526,13.794 24,14.432 23.921,14.917 22.706,15.537 21.066,15.148 17.237,14.238 15.925,13.909 15.743,13.909 15.743,14.019 16.836,15.087 18.842,16.897 21.351,19.227 21.478,19.805 21.156,20.26 20.816,20.211 18.611,18.554 17.76,17.807 15.834,16.187 15.706,16.187 15.706,16.357 16.15,17.006 18.495,20.527 18.617,21.607 18.447,21.96 17.839,22.173 17.171,22.051 15.797,20.126 14.382,17.959 13.239,16.016 13.099,16.096 12.425,23.35 12.109,23.72 11.38,24 10.773,23.539 10.451,22.792 10.773,21.316 11.162,19.392 11.477,17.862 11.763,15.962 11.933,15.33 11.921,15.288 11.781,15.306 10.347,17.273 8.167,20.218 6.441,22.063 6.027,22.227 5.31,21.857 5.377,21.195 5.778,20.606 8.166,17.57 9.606,15.688 10.536,14.602 10.53,14.444 10.475,14.444 4.132,18.56 3.002,18.706 2.515,18.25 2.576,17.504 2.807,17.261 4.715,15.949 4.709,15.955'.split(' ').map((p) => p.split(',').map(Number));
    // The Claude spark and the Codex cloud, as 24×24 artwork centred on
    // 12,12. The Codex cursor is kept apart so it can blink.
    const LOGO = {
      claude: `M${SPARK.join('L')}Z`,
      codex: 'M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393z',
    };
    const CURSOR = 'M12.728 14.547a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z';

    const el = (tag, attrs) => {
      const node = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      return node;
    };
    const setStyle = (node, styles) => { Object.assign(node.style, styles); return node; };

    // Build a shape's static parts in its own coordinates (centred on 0,0).
    // Returns the organic path to reshape every frame, if the kind has one.
    function build(group, spec, R) {
      group.replaceChildren();
      let live = null;
      const add = (node) => { group.append(node); return node; };
      switch (spec.kind) {
        case 'sun':
          add(setStyle(el('circle', { r: R }), { fill: spec.color }));
          break;
        case 'half': // a dome; rotate 180 for a bowl hanging from the top
          add(setStyle(el('path', { d: `M${-R},0A${R},${R} 0 0 1 ${R},0Z` }), { fill: spec.color }));
          break;
        case 'claude':
        case 'codex': {
          const logo = add(setStyle(el('path', { d: LOGO[spec.kind], transform: `scale(${(R / 12).toFixed(3)}) translate(-12 -12)` }),
            { fill: spec.color, fillRule: 'evenodd' }));
          if (spec.kind === 'codex' || !reduceMotion) live = logo; // the cursor blinks; the spark's rays pulse
          break;
        }
        case 'ring':
          add(setStyle(el('circle', { r: R * 0.97 }), { fill: 'none', stroke: spec.color, strokeWidth: 2 }));
          break;
        default: // pebble, kidney: soft organic forms that wobble
          live = add(setStyle(el('path', {}), { fill: spec.color }));
      }
      // Invisible hit area, so every shape (even thin lines) is easy to grab.
      add(setStyle(el('circle', { r: R }), { fill: 'transparent' })).classList.add('shape__hit');
      return live;
    }

    const shapes = LAYOUTS.wide.map((_, n) => {
      const group = el('g', {});
      group.classList.add('shape');
      svg.append(group);
      return { group, seed: n * 1.93 + 0.4, spec: null, live: null, R: 0, hx: 0, hy: 0, px: NaN, py: 0, vx: 0, vy: 0,
        scale: 1, vs: 0, turn: 0, vt: 0, dent: 0, dentAt: 0, grab: null, shown: false };
    });

    let box = hero.getBoundingClientRect();
    function layout() {
      box = hero.getBoundingClientRect();
      const name = hero.querySelector('.hero__name').getBoundingClientRect();
      const aside = hero.querySelector('.hero__aside').getBoundingClientRect();
      // The band runs edge to edge, from the top of the screen to just above
      // the name and portrait.
      const W = box.width;
      const H = Math.max(0, Math.min(name.top, aside.top) - box.top - 16);
      svg.setAttribute('viewBox', `0 0 ${W.toFixed(1)} ${box.height.toFixed(1)}`);
      const specs = W < 640 ? LAYOUTS.narrow : LAYOUTS.wide;
      shapes.forEach((sh, i) => {
        const spec = specs[i];
        sh.shown = Boolean(spec) && H > 70;
        sh.group.style.display = sh.shown ? '' : 'none';
        if (!sh.shown) return;
        const R = spec.r * H;
        const key = `${spec.kind}|${spec.color}|${R.toFixed(1)}`;
        sh.spec = spec;
        sh.R = R;
        if (sh.key !== key) {
          sh.key = key;
          sh.live = build(sh.group, spec, R);
          sh.fresh = true;
        }
        sh.hx = spec.fx * W;
        // Keep the bottom (with room to wobble) above the name; an upright
        // dome sits on its flat side, so only its top extends upward.
        const below = spec.kind === 'half' && !spec.rot ? 0.04 : 1.12;
        sh.hy = Math.min(spec.fy * H, H - sh.R * below);
        if (Number.isNaN(sh.px)) { sh.px = sh.hx; sh.py = sh.hy; }
      });
      // Draw rebuilt shapes now, in the same frame, rather than waiting for
      // the next tick (a freshly built pebble has no outline until drawn).
      const t = reduceMotion ? 0 : performance.now() / 1000;
      for (const sh of shapes) if (sh.shown && sh.fresh) { render(sh, t); sh.fresh = false; }
    }

    // Soft organic outline for pebbles and kidneys, in local coordinates.
    const WAVES = [[2, 0.055, 0.34], [3, 0.035, -0.26], [4, 0.015, 0.18]];
    const organic = (sh, t) => {
      const stretch = sh.spec.kind === 'kidney' ? 1.45 : 1;
      const pts = [];
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        let r = 1;
        WAVES.forEach(([k, amp, speed], j) => { r += amp * Math.sin(k * a + sh.seed * (j + 1) + speed * t); });
        if (sh.spec.kind === 'kidney') r -= 0.12 * Math.max(0, Math.cos(a - Math.PI / 2)) ** 3; // the kidney's pinch
        const facing = Math.max(0, Math.cos(a - sh.dentAt));
        r -= sh.dent * facing * facing * 0.2; // pushed in where the pointer pokes
        pts.push([Math.cos(a) * sh.R * r * stretch, Math.sin(a) * sh.R * r]);
      }
      return smoothPath(pts);
    };

    // Like a loading spinner: a soft swell runs clockwise around the spark,
    // about once a second, over a gentle breathing and rippling of the rays.
    const spark = (sh, t) => {
      const breathe = 0.95 + 0.03 * Math.sin(t * 2.2 + sh.seed);
      let d = '';
      for (const [x, y] of SPARK) {
        const dx = x - 12, dy = y - 12, a = Math.atan2(dy, dx);
        const f = breathe + 0.18 * ((1 + Math.cos(a - t * 6 - sh.seed)) / 2) ** 4
          + 0.06 * Math.sin(5 * a + t * 3.1) + 0.04 * Math.sin(3 * a - t * 2.3 + sh.seed);
        d += `${d ? 'L' : 'M'}${(12 + dx * f).toFixed(2)},${(12 + dy * f).toFixed(2)}`;
      }
      return `${d}Z`;
    };

    function render(sh, t) {
      const spec = sh.spec;
      // Gentle sway, except for shapes with a flat edge, which stay level.
      const sway = spec.kind === 'half' ? 0 : 4;
      let angle = (spec.rot || 0) + Math.sin(t * 0.4 + sh.seed) * sway;
      if (spec.kind === 'claude') angle = (sh.turn + sh.seed * 40) % 360;
      if (sh.live) {
        sh.live.setAttribute('d', spec.kind === 'claude' ? spark(sh, t)
          : spec.kind === 'codex' ? (t % 1.06 < 0.53 ? LOGO.codex + CURSOR : LOGO.codex)
          : organic(sh, t));
      }
      sh.group.setAttribute('transform', `translate(${sh.px.toFixed(1)} ${sh.py.toFixed(1)}) rotate(${angle.toFixed(2)}) scale(${sh.scale.toFixed(3)})`);
    }

    // Physics in fixed 60Hz steps so it feels the same on any display.
    const step = (t, now) => {
      const pointerOn = finePointer && now - mouse.moved < 2500;
      const mx = mouse.x - box.left, my = mouse.y - box.top;
      for (const sh of shapes) {
        if (!sh.shown) continue;
        let tx = sh.hx + Math.sin(t * 0.33 + sh.seed) * sh.R * 0.08;
        let ty = sh.hy + Math.cos(t * 0.27 + sh.seed * 1.7) * sh.R * 0.1;
        let dent = 0;
        if (sh.grab) {
          tx = sh.grab.x + sh.grab.dx;
          ty = sh.grab.y + sh.grab.dy;
        } else if (pointerOn) {
          const dx = sh.px - mx, dy = sh.py - my, d = Math.hypot(dx, dy) || 1;
          const reach = sh.R + 140;
          if (d < reach) {
            const f = 1 - d / reach;
            tx += (dx / d) * f * f * 44;
            ty += (dy / d) * f * f * 44;
            dent = f;
            sh.dentAt = Math.atan2(-dy, -dx);
          }
        }
        sh.dent += (dent - sh.dent) * 0.15;
        const k = sh.grab ? 0.3 : 0.05, damping = sh.grab ? 0.55 : 0.88;
        sh.vx = (sh.vx + (tx - sh.px) * k) * damping;
        sh.vy = (sh.vy + (ty - sh.py) * k) * damping;
        sh.px += sh.vx;
        sh.py += sh.vy;
        sh.vs = (sh.vs + (1 - sh.scale) * 0.16) * 0.84; // boing
        sh.scale += sh.vs;
        sh.vt += (0.1 - sh.vt) * 0.03; // spin (the Claude spark), easing back to a slow turn
        sh.turn += sh.vt;
      }
    };

    // Grab to drag (and boing); release to spring home. A grab follows its
    // own pointer from where it went down: a touch has no pointermove before
    // it lands, so the shared position would still be the previous touch.
    svg.addEventListener('pointerdown', (e) => {
      const group = e.target.closest('.shape');
      const sh = shapes.find((x) => x.group === group);
      if (!sh || reduceMotion) return;
      e.preventDefault();
      sh.vs += 0.09;
      sh.vt += 14; // the Claude spark whirls
      sh.grab = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: sh.px - e.clientX, dy: sh.py - e.clientY };
      try { group.setPointerCapture(e.pointerId); } catch { /* drag without capture */ }
    });
    // Browsers ignore touch-action on SVG shapes, so a touch drag would turn
    // into a page pan and cancel the grab. Keep touches on a shape for it.
    svg.addEventListener('touchstart', (e) => {
      if (!reduceMotion && e.target.closest('.shape')) e.preventDefault();
    }, { passive: false });
    window.addEventListener('pointermove', (e) => {
      for (const sh of shapes) if (sh.grab && sh.grab.id === e.pointerId) { sh.grab.x = e.clientX; sh.grab.y = e.clientY; }
    }, { passive: true });
    const release = (e) => {
      for (const sh of shapes) if (sh.grab && sh.grab.id === e.pointerId) { sh.grab = null; sh.vs += 0.05; }
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    layout();
    fontsReady.then(layout);
    new ResizeObserver(layout).observe(hero);

    if (reduceMotion) {
      const still = () => shapes.forEach((sh) => sh.shown && render(sh, 0));
      still();
      new ResizeObserver(still).observe(hero);
    } else {
      let acc = 0, prev = performance.now();
      tickers.push((now) => {
        acc = Math.min(acc + (now - prev), 100);
        prev = now;
        const t = now / 1000;
        while (acc >= 16.667) { step(t, now); acc -= 16.667; }
        for (const sh of shapes) if (sh.shown) render(sh, t);
      });
    }
  }

  // ------------------------------------------------------------ blog drawer
  // The "Blog" tab is a link to the Blog page; with JS it opens the drawer
  // instead. Esc, the Close button, clicking outside, or dragging the handle
  // down closes it. Arriving at #blog opens it (the "All posts" links).
  const drawer = document.getElementById('blog-drawer');
  const drawerTab = document.querySelector('[data-drawer-open]');
  if (drawer && drawerTab && typeof drawer.showModal === 'function') {
    let closing = 0;
    // Only keyboard users get focus handed back to the tab on close; for
    // mouse and touch that would just leave a highlight ring on it.
    let openedByKeyboard = false;

    const openDrawer = (byKeyboard = false) => {
      if (drawer.open) return;
      openedByKeyboard = byKeyboard;
      clearTimeout(closing);
      drawer.showModal();
      // Focus the sheet itself rather than its first button (the browser's
      // default), so nothing inside is highlighted until someone tabs in.
      drawer.focus({ preventScroll: true });
      // Two frames so the closed position is painted before sliding up.
      requestAnimationFrame(() => requestAnimationFrame(() => drawer.classList.add('is-open')));
      drawerTab.setAttribute('aria-expanded', 'true');
    };

    const closeDrawer = () => {
      if (!drawer.open || !drawer.classList.contains('is-open')) return;
      drawer.classList.remove('is-open');
      drawer.style.transform = '';
      drawerTab.setAttribute('aria-expanded', 'false');
      closing = setTimeout(() => {
        drawer.close();
        if (openedByKeyboard) {
          drawerTab.focus({ preventScroll: true });
        } else if (document.activeElement && document.activeElement !== document.body) {
          document.activeElement.blur();
        }
      }, reduceMotion ? 0 : 450);
      if (location.hash === '#blog') history.replaceState(null, '', location.pathname + location.search);
    };

    // It opens a dialog rather than navigating, so present it as a button.
    drawerTab.setAttribute('role', 'button');
    drawerTab.setAttribute('aria-haspopup', 'dialog');
    drawerTab.setAttribute('aria-controls', drawer.id);
    drawerTab.setAttribute('aria-expanded', 'false');
    drawerTab.addEventListener('click', (e) => { e.preventDefault(); openDrawer(e.detail === 0); });
    drawerTab.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); openDrawer(true); } });

    drawer.querySelector('[data-drawer-close]').addEventListener('click', closeDrawer);
    drawer.addEventListener('cancel', (e) => { e.preventDefault(); closeDrawer(); });
    drawer.addEventListener('click', (e) => {
      // Clicks on the backdrop land on the dialog itself, outside its box.
      if (e.target !== drawer) return;
      const r = drawer.getBoundingClientRect();
      if (e.clientY < r.top || e.clientX < r.left || e.clientX > r.right) closeDrawer();
    });

    // Drag the handle down to dismiss; a short drag springs back.
    const grab = drawer.querySelector('[data-drawer-grab]');
    let startY = null, dragged = 0;
    grab.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      startY = e.clientY;
      dragged = 0;
      try { grab.setPointerCapture(e.pointerId); } catch { /* keep dragging without capture */ }
      drawer.style.transition = 'none';
    });
    grab.addEventListener('pointermove', (e) => {
      if (startY === null) return;
      dragged = Math.max(0, e.clientY - startY);
      drawer.style.transform = `translateY(${dragged}px)`;
    });
    const endDrag = () => {
      if (startY === null) return;
      startY = null;
      drawer.style.transition = '';
      if (dragged > 90) closeDrawer();
      else drawer.style.transform = '';
    };
    grab.addEventListener('pointerup', endDrag);
    grab.addEventListener('pointercancel', endDrag);

    if (location.hash === '#blog') openDrawer();
  }

  // ---------------------------------------------------- magnetic elements
  if (finePointer && !reduceMotion) {
    document.querySelectorAll('.magnetic').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${dx * 0.28}px, ${dy * 0.38}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  // ---------------------------------------------------------------- email
  document.querySelectorAll('.pill--icon').forEach((pill) => {
    const reset = () => pill.classList.remove('is-tip-dismissed');
    pill.addEventListener('keydown', (e) => { if (e.key === 'Escape') pill.classList.add('is-tip-dismissed'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pill.matches(':hover')) pill.classList.add('is-tip-dismissed'); });
    pill.addEventListener('pointerleave', reset);
    pill.addEventListener('blur', reset);
  });
  document.querySelectorAll('[data-email]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = 'mailto:' + ['trey', 'moen.ai'].join('@');
    });
  });

  // ---------------------------------------------------------------- years
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  // ------------------------------------------------------------- lightbox
  const dialog = document.querySelector('.lightbox');
  if (dialog && typeof dialog.showModal === 'function') {
    const big = dialog.querySelector('img');
    const cap = dialog.querySelector('figcaption');
    document.querySelectorAll('.prose figure img').forEach((im) => {
      im.addEventListener('click', () => {
        big.src = im.currentSrc || im.src;
        big.alt = im.alt;
        const fc = im.closest('figure').querySelector('figcaption');
        cap.textContent = fc ? fc.textContent : '';
        dialog.showModal();
      });
    });
    dialog.addEventListener('click', () => dialog.close());
  }

  requestAnimationFrame(loop);
})();
