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
  // bowl, a starburst, a ring, and soft pebbles and a kidney that wobble like
  // liquid. Each floats gently, leans away from
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
        { kind: 'burst', fx: 0.74, fy: 0.3, r: 0.2, color: C.s },
        { kind: 'pebble', fx: 0.86, fy: 0.6, r: 0.24, color: C.t },
        { kind: 'ring', fx: 0.985, fy: 0.12, r: 0.28, color: C.k },
      ],
      narrow: [
        { kind: 'sun', fx: 0.02, fy: 0.55, r: 0.36, color: C.t },
        { kind: 'half', fx: 0.82, fy: -0.1, r: 0.4, color: C.m, rot: 180 },
        { kind: 'pebble', fx: 0.55, fy: 0.45, r: 0.16, color: C.g },
        { kind: 'burst', fx: 0.9, fy: 0.74, r: 0.14, color: C.s },
      ],
    };

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
        case 'burst': {
          let d = '';
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2, r0 = R * 0.28, r1 = i % 2 ? R * 0.72 : R;
            d += `M${(Math.cos(a) * r0).toFixed(1)},${(Math.sin(a) * r0).toFixed(1)}L${(Math.cos(a) * r1).toFixed(1)},${(Math.sin(a) * r1).toFixed(1)}`;
          }
          add(setStyle(el('path', { d }), { fill: 'none', stroke: spec.color, strokeWidth: Math.max(2, R * 0.05), strokeLinecap: 'round' }));
          add(setStyle(el('circle', { r: R * 0.14 }), { fill: spec.color }));
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
        scale: 1, vs: 0, dent: 0, dentAt: 0, grab: null, shown: false };
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

    function render(sh, t) {
      const spec = sh.spec;
      // Gentle sway, except for shapes with a flat edge, which stay level.
      const sway = spec.kind === 'half' ? 0 : 4;
      let angle = (spec.rot || 0) + Math.sin(t * 0.4 + sh.seed) * sway;
      if (spec.kind === 'burst') angle = (t * 6 + sh.seed * 40) % 360; // slow spin
      if (sh.live) sh.live.setAttribute('d', organic(sh, t));
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
          tx = mx - sh.grab.dx;
          ty = my - sh.grab.dy;
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
      }
    };

    // Grab to drag (and boing); release to spring home.
    svg.addEventListener('pointerdown', (e) => {
      const group = e.target.closest('.shape');
      const sh = shapes.find((x) => x.group === group);
      if (!sh || reduceMotion) return;
      e.preventDefault();
      sh.vs += 0.09;
      sh.grab = { dx: e.clientX - box.left - sh.px, dy: e.clientY - box.top - sh.py, id: e.pointerId };
      try { group.setPointerCapture(e.pointerId); } catch { /* drag without capture */ }
    });
    const release = (e) => {
      for (const sh of shapes) if (sh.grab && sh.grab.id === e.pointerId) { sh.grab = null; sh.vs += 0.05; }
    };
    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointercancel', release);
    // Touch drags update the shared pointer position too.
    svg.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });

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
