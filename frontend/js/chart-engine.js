class LineChart {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.opts   = {
      padding:            { top: 28, right: 18, bottom: 52, left: 72 },
      gridColor:          'rgba(255,255,255,0.04)',
      axisColor:          'rgba(255,255,255,0.10)',
      textColor:          '#5a5a72',
      tooltipBg:          '#15151f',
      tooltipBorder:      '#3a3a55',
      zeroLine:           true,
      zeroLineColor:      'rgba(255,255,255,0.28)',
      zeroLabelColor:     '#5a5a72',
      animate:            true,
      animDuration:       700,
      sparkline:          false,       // minimal mode — no axes, no labels
      splitFill:          true,        // green above 0, red below 0
      formatValue:        v => _fmtAxisVal(v),
      formatTooltipValue: v => _fmtTooltipVal(v),
      formatDate:         (t, r) => _fmtAxisDate(t, r),
      formatTooltipDate:  (t, r) => _fmtTooltipDate(t, r),
      rangeKey:           '1m',
      ...opts,
    };

    this._series       = [];
    this._animProgress = 1;
    this._animFrame    = null;
    this._hoverX       = null;

    const mv  = this._onMouseMove.bind(this);
    const ml  = this._onMouseLeave.bind(this);
    const tch = this._onTouch.bind(this);
    const te  = this._onMouseLeave.bind(this);

    canvas.addEventListener('mousemove',  mv);
    canvas.addEventListener('mouseleave', ml);
    canvas.addEventListener('touchmove',  tch, { passive: true });
    canvas.addEventListener('touchend',   te);

    this._cleanup = () => {
      canvas.removeEventListener('mousemove',  mv);
      canvas.removeEventListener('mouseleave', ml);
      canvas.removeEventListener('touchmove',  tch);
      canvas.removeEventListener('touchend',   te);
    };

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement || canvas);
    this._resize();
  }

  setData(series, rangeKey) {
    this._series = series || [];
    if (rangeKey) this.opts.rangeKey = rangeKey;
    if (this.opts.animate) {
      this._animProgress = 0;
      this._startAnim();
    } else {
      this._animProgress = 1;
      this.draw();
    }
  }

  destroy() {
    cancelAnimationFrame(this._animFrame);
    this._cleanup();
    this._ro.disconnect();
  }

  _resize() {
    const parent = this.canvas.parentElement || document.body;
    const w   = parent.clientWidth  || 300;
    const h   = this.canvas.dataset.height ? parseInt(this.canvas.dataset.height) : 220;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width  = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.scale(dpr, dpr);
    this._w = w;
    this._h = h;
    this.draw();
  }

  _startAnim() {
    const start = performance.now();
    const dur   = this.opts.animDuration;
    const tick  = now => {
      this._animProgress = Math.min((now - start) / dur, 1);
      // ease out cubic
      const t = this._animProgress;
      this._easedProgress = 1 - Math.pow(1 - t, 3);
      this.draw();
      if (this._animProgress < 1) this._animFrame = requestAnimationFrame(tick);
    };
    this._animFrame = requestAnimationFrame(tick);
  }

  draw() {
    const { ctx, _w: W, _h: H, opts } = this;
    const spark = opts.sparkline;
    const P = spark ? { top: 4, right: 4, bottom: 4, left: 4 } : opts.padding;
    const chartW = W - P.left - P.right;
    const chartH = H - P.top  - P.bottom;

    ctx.clearRect(0, 0, W, H);

    const allPts = this._series.flatMap(s => s.points || []);
    if (!allPts.length) {
      if (!spark) {
        ctx.fillStyle = opts.textColor;
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('No data for this range', W / 2, H / 2);
      }
      return;
    }

    // ── Compute bounds with smart fitting ─────────────────────────────────────
    const vals   = allPts.map(p => p.v);
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const range  = rawMax - rawMin;

    let minV, maxV;

    if (range === 0) {
      // Completely flat — show ±10% of value or ±1 if near zero
      const spread = Math.abs(rawMax) * 0.1 || 1;
      minV = rawMax - spread;
      maxV = rawMax + spread;
    } else {
      // Pad 12% top and bottom so line doesn't touch edges
      const pad = range * 0.12;
      minV = rawMin - pad;
      maxV = rawMax + pad;
    }

    // If all values are positive, anchor to 0 only if values are close to it
    // Otherwise don't force 0 — let the chart fit the data
    const hasNeg = vals.some(v => v < 0);
    const hasPos = vals.some(v => v >= 0);

    if (hasNeg && hasPos) {
      // Values cross zero — always show zero line prominently, keep natural bounds
      // Ensure zero has visual breathing room
      if (minV > -range * 0.05) minV = -range * 0.05;
      if (maxV < range * 0.05)  maxV = range * 0.05;
    } else if (hasNeg && !hasPos) {
      // All negative — show how far below zero, anchor top near zero
      maxV = Math.max(maxV, 0);
    } else {
      // All positive — don't force zero, just fit the data
      // But if values are very close to zero (within 20% of range), show zero
      if (minV > 0 && minV < range * 0.2) minV = 0;
    }

    const vRange = maxV - minV || 1;
    const times  = allPts.map(p => _toMs(p.t));
    const minT   = Math.min(...times);
    const maxT   = Math.max(...times);
    const tRange = maxT - minT || 1;

    const toX = t  => P.left + (_toMs(t) - minT) / tRange * chartW;
    const toY = v  => P.top  + (1 - (v - minV) / vRange) * chartH;
    const y0  = toY(0);

    // ── Smart grid lines ───────────────────────────────────────────────────────
    if (!spark) {
      // Compute nice round tick values instead of evenly-spaced
      const gridN    = 5;
      const rawStep  = vRange / gridN;
      const magnitude= Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep))));
      const niceSteps= [1, 2, 2.5, 5, 10];
      const niceStep = niceSteps.map(s => s * magnitude)
                                .find(s => s >= rawStep) || rawStep;
      const gridStart= Math.ceil(minV / niceStep) * niceStep;

      ctx.strokeStyle = opts.gridColor;
      ctx.lineWidth   = 1;

      let tickV = gridStart;
      while (tickV <= maxV + niceStep * 0.01) {
        const y = toY(tickV);
        if (y >= P.top - 1 && y <= P.top + chartH + 1) {
          ctx.beginPath();
          ctx.moveTo(P.left, y);
          ctx.lineTo(P.left + chartW, y);
          ctx.stroke();

          ctx.fillStyle  = Math.abs(tickV) < niceStep * 0.01
            ? 'rgba(255,255,255,0.35)'  // zero label slightly brighter
            : opts.textColor;
          ctx.font       = '10px JetBrains Mono, monospace';
          ctx.textAlign  = 'right';
          ctx.fillText(opts.formatValue(tickV), P.left - 6, y + 3.5);
        }
        tickV = Math.round((tickV + niceStep) * 1e10) / 1e10; // float safety
      }

      // ── X-axis ticks ─────────────────────────────────────────────────────────
      const ticks = _pickXTicks(allPts, opts.rangeKey, 6);
      ctx.fillStyle = opts.textColor;
      ctx.font      = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      for (const tick of ticks) {
        ctx.fillText(opts.formatDate(tick.t, opts.rangeKey), toX(tick.t), H - P.bottom + 16);
      }
    }

    // ── Zero line ──────────────────────────────────────────────────────────────
    if (opts.zeroLine && !spark && hasNeg && hasPos) {
      ctx.save();
      ctx.strokeStyle = opts.zeroLineColor;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(P.left, y0);
      ctx.lineTo(P.left + chartW, y0);
      ctx.stroke();
      ctx.setLineDash([]);
      // $0 label — draw it on the RIGHT side so it doesn't clash with y-axis labels
      ctx.fillStyle  = 'rgba(255,255,255,0.45)';
      ctx.font       = '9px JetBrains Mono, monospace';
      ctx.textAlign  = 'left';
      ctx.fillText('$0', P.left + chartW + 4, y0 + 3.5);
      ctx.restore();
    }

    // ── Draw series ────────────────────────────────────────────────────────────
    const progress = this._easedProgress ?? 1;
    for (const series of this._series) {
      if (!series.points?.length) continue;
      const pts       = series.points;
      const cutoffIdx = Math.max(1, Math.floor((pts.length - 1) * progress));
      const vis       = pts.slice(0, cutoffIdx + 1);
      if (vis.length < 2) continue;
      const coords    = vis.map(p => ({ x: toX(p.t), y: toY(p.v), v: p.v, t: p.t, ...p }));

      if (opts.splitFill) {
        _drawSplitFill(ctx, coords, y0, P, chartW, chartH);
      } else {
        const lastV   = vis[vis.length - 1].v;
        const fillClr = series.color ? series.color + '18'
          : lastV >= 0 ? 'rgba(0,230,118,0.07)' : 'rgba(255,71,87,0.07)';
        ctx.beginPath();
        ctx.moveTo(coords[0].x, y0);
        coords.forEach(c => ctx.lineTo(c.x, c.y));
        ctx.lineTo(coords[coords.length - 1].x, y0);
        ctx.closePath();
        ctx.fillStyle = fillClr;
        ctx.fill();
      }

      const lastV   = vis[vis.length - 1].v;
      const lineClr = series.color || (lastV >= 0 ? '#00e676' : '#ff4757');
      ctx.beginPath();
      ctx.moveTo(coords[0].x, coords[0].y);
      for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1];
        const curr = coords[i];
        const cpx  = (prev.x + curr.x) / 2;
        ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
      }
      ctx.strokeStyle = lineClr;
      ctx.lineWidth   = spark ? 1.5 : 2.2;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.stroke();

      if (!spark && progress >= 0.99) {
        const last = coords[coords.length - 1];
        ctx.beginPath();
        ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
        ctx.fillStyle   = lineClr;
        ctx.fill();
        ctx.strokeStyle = '#0e0e14';
        ctx.lineWidth   = 2;
        ctx.stroke();
      }
    }

    // ── Axis border ────────────────────────────────────────────────────────────
    if (!spark) {
      ctx.strokeStyle = opts.axisColor;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(P.left, P.top);
      ctx.lineTo(P.left, P.top + chartH);
      ctx.lineTo(P.left + chartW, P.top + chartH);
      ctx.stroke();
    }

    // ── Hover tooltip ──────────────────────────────────────────────────────────
    if (this._hoverX !== null && (this._easedProgress ?? 1) >= 0.99) {
      this._drawTooltip(ctx, W, H, P, chartW, chartH, toX, toY, allPts);
    }
  }

  _drawTooltip(ctx, W, H, P, chartW, chartH, toX, toY, allPts) {
    if (!allPts.length) return;

    // Find closest point across all series
    let closest = null, closestDist = Infinity;
    for (const s of this._series) {
      for (const p of (s.points || [])) {
        const dist = Math.abs(toX(p.t) - this._hoverX);
        if (dist < closestDist) { closestDist = dist; closest = { ...p, _series: s }; }
      }
    }
    if (!closest || closestDist > 80) return;

    const cx = toX(closest.t);
    const cy = toY(closest.v);

    // Crosshair
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, P.top);
    ctx.lineTo(cx, P.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Dot
    const dotClr = closest.v >= 0 ? '#00e676' : '#ff4757';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle   = dotClr;
    ctx.fill();
    ctx.strokeStyle = '#0e0e14';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Build tooltip lines
    const dateStr  = this.opts.formatTooltipDate(closest.t, this.opts.rangeKey);
    const valStr   = this.opts.formatTooltipValue(closest.v);
    const extra    = closest.coin || closest.game || closest.ticker
      || closest._series?.label || '';
    const lines    = extra ? [dateStr, valStr, extra] : [dateStr, valStr];

    ctx.font = '11px JetBrains Mono, monospace';
    const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
    const tw   = maxW + 22;
    const th   = lines.length * 17 + 14;

    let tx = cx + 14;
    let ty = cy - th / 2;
    if (tx + tw > W - 8)    tx = cx - tw - 14;
    if (ty < P.top)          ty = P.top + 4;
    if (ty + th > H - P.bottom) ty = H - P.bottom - th - 4;

    _roundRect(ctx, tx, ty, tw, th, 6);
    ctx.fillStyle   = this.opts.tooltipBg;
    ctx.fill();
    ctx.strokeStyle = this.opts.tooltipBorder;
    ctx.lineWidth   = 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    lines.forEach((line, i) => {
      ctx.fillStyle = i === 1
        ? (closest.v >= 0 ? '#00e676' : '#ff4757')
        : i === 2 ? '#9898b0' : '#7070a0';
      ctx.fillText(line, tx + 11, ty + 16 + i * 17);
    });
  }

  _onMouseMove(e) {
    const rect    = this.canvas.getBoundingClientRect();
    this._hoverX  = e.clientX - rect.left;
    if ((this._easedProgress ?? 1) >= 0.99) this.draw();
  }
  _onMouseLeave() {
    this._hoverX = null;
    if ((this._easedProgress ?? 1) >= 0.99) this.draw();
  }
  _onTouch(e) {
    if (!e.touches.length) return;
    const rect   = this.canvas.getBoundingClientRect();
    this._hoverX = e.touches[0].clientX - rect.left;
    if ((this._easedProgress ?? 1) >= 0.99) this.draw();
  }
}

// ─────────────────────────────────────────
//  SPLIT FILL  (green above 0, red below)
// ─────────────────────────────────────────

function _drawSplitFill(ctx, coords, y0, P, chartW, chartH) {
  if (!coords.length) return;

  const top    = P.top;
  const bottom = P.top + chartH;

  // Clamp y0 to chart bounds
  const yz = Math.max(top, Math.min(bottom, y0));

  // Green fill — above zero (clip to top half)
  ctx.save();
  ctx.beginPath();
  ctx.rect(P.left - 2, top, chartW + 4, yz - top);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(coords[0].x, yz);
  coords.forEach((c, i) => {
    if (i === 0) return;
    const p = coords[i - 1];
    const mx = (p.x + c.x) / 2;
    ctx.bezierCurveTo(mx, p.y, mx, c.y, c.x, c.y);
  });
  ctx.lineTo(coords[coords.length - 1].x, yz);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,230,118,0.10)';
  ctx.fill();
  ctx.restore();

  // Red fill — below zero (clip to bottom half)
  ctx.save();
  ctx.beginPath();
  ctx.rect(P.left - 2, yz, chartW + 4, bottom - yz);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(coords[0].x, yz);
  coords.forEach((c, i) => {
    if (i === 0) return;
    const p = coords[i - 1];
    const mx = (p.x + c.x) / 2;
    ctx.bezierCurveTo(mx, p.y, mx, c.y, c.x, c.y);
  });
  ctx.lineTo(coords[coords.length - 1].x, yz);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,71,87,0.12)';
  ctx.fill();
  ctx.restore();
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────

function _toMs(t) {
  if (typeof t === 'number') return t;
  return new Date(t.includes('T') ? t : t + 'T00:00:00').getTime();
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function _pickXTicks(points, rangeKey, maxTicks) {
  if (!points.length) return [];
  const step = Math.max(1, Math.floor(points.length / maxTicks));
  const out  = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  return out;
}

function _fmtAxisVal(v) {
  const n = parseFloat(v);
  if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
  return '$' + n.toFixed(0);
}

function _fmtTooltipVal(v) {
  const n = parseFloat(v);
  return (n >= 0 ? '+' : '') + '$' + Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 4
  });
}

function _fmtAxisDate(t, rangeKey) {
  const d = new Date(_toMs(t));
  if (rangeKey === '6h' || rangeKey === '1d')
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  if (rangeKey === '1w' || rangeKey === '1m' || rangeKey === '3m')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function _fmtTooltipDate(t, rangeKey) {
  const d = new Date(_toMs(t));
  if (rangeKey === '6h' || rangeKey === '1d')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

class BarChart {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.opts   = {
      padding:            { top: 24, right: 16, bottom: 52, left: 68 },
      textColor:          '#5a5a72',
      tooltipBg:          '#15151f',
      tooltipBorder:      '#3a3a55',
      barRadius:          4,
      formatValue:        v => _fmtAxisVal(v),
      formatTooltipValue: v => _fmtTooltipVal(v),
      formatLabel:        l => l,
      ...opts,
    };
    this._data   = [];
    this._hoverI = null;
    const mv  = this._onMove.bind(this);
    const ml  = this._onLeave.bind(this);
    const tch = this._onTouch.bind(this);
    canvas.addEventListener('mousemove',  mv);
    canvas.addEventListener('mouseleave', ml);
    canvas.addEventListener('touchmove',  tch, { passive: true });
    canvas.addEventListener('touchend',   ml);
    this._cleanup = () => {
      canvas.removeEventListener('mousemove',  mv);
      canvas.removeEventListener('mouseleave', ml);
      canvas.removeEventListener('touchmove',  tch);
      canvas.removeEventListener('touchend',   ml);
    };
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement || canvas);
    this._resize();
  }

  // data: [{label, value, color?}]
  setData(data) {
    this._data = data || [];
    this.draw();
  }

  destroy() {
    this._cleanup();
    this._ro.disconnect();
  }

  _resize() {
    const parent = this.canvas.parentElement || document.body;
    const w   = parent.clientWidth  || 300;
    const h   = this.canvas.dataset.height ? parseInt(this.canvas.dataset.height) : 220;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width  = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.scale(dpr, dpr);
    this._w = w;
    this._h = h;
    this.draw();
  }

  draw() {
    const { ctx, _w: W, _h: H, opts, _data: data } = this;
    const P = opts.padding;
    const chartW = W - P.left - P.right;
    const chartH = H - P.top  - P.bottom;
    ctx.clearRect(0, 0, W, H);

    if (!data.length) {
      ctx.fillStyle = opts.textColor;
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No data', W/2, H/2);
      return;
    }

    const vals   = data.map(d => d.value);
    let maxV     = Math.max(...vals.map(Math.abs)) * 1.15 || 1;
    const hasNeg = vals.some(v => v < 0);
    const y0     = hasNeg ? P.top + chartH * (maxV / (maxV * 2)) : P.top + chartH;
    const toY    = v => hasNeg
      ? y0 - (v / maxV) * (chartH / 2)
      : P.top + chartH - (v / maxV) * chartH;

    // Grid
    const gridN = 4;
    for (let i = 0; i <= gridN; i++) {
      const v = hasNeg
        ? -maxV + (maxV * 2 * i / gridN)
        : maxV * i / gridN;
      const y = toY(v);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(P.left, y);
      ctx.lineTo(P.left + chartW, y);
      ctx.stroke();
      ctx.fillStyle  = opts.textColor;
      ctx.font       = '10px JetBrains Mono, monospace';
      ctx.textAlign  = 'right';
      ctx.fillText(opts.formatValue(v), P.left - 6, y + 3.5);
    }

    // Zero line
    if (hasNeg) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(P.left, y0);
      ctx.lineTo(P.left + chartW, y0);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Bars
    const barW    = Math.max(4, (chartW / data.length) * 0.62);
    const spacing = chartW / data.length;
    this._barRects = [];

    data.forEach((d, i) => {
      const cx  = P.left + spacing * i + spacing / 2;
      const yV  = toY(d.value);
      const barH= Math.abs(yV - y0);
      const y   = d.value >= 0 ? yV : y0;
      const clr = d.color || (d.value >= 0 ? '#00e676' : '#ff4757');
      const hov = this._hoverI === i;

      ctx.fillStyle = hov ? clr : clr + 'cc';
      _roundRectBar(ctx, cx - barW/2, y, barW, Math.max(2, barH), opts.barRadius, d.value >= 0);
      ctx.fill();

      // Label
      ctx.fillStyle  = hov ? '#e8e8f0' : opts.textColor;
      ctx.font       = `${Math.min(11, Math.max(8, spacing * 0.3))}px JetBrains Mono, monospace`;
      ctx.textAlign  = 'center';
      const lbl = opts.formatLabel(d.label);
      ctx.fillText(lbl.length > 8 ? lbl.substring(0, 7) + '…' : lbl, cx, H - P.bottom + 16);

      this._barRects.push({ x: cx - barW/2 - 4, w: barW + 8, i });
    });

    // Tooltip
    if (this._hoverI !== null && this._hoverI < data.length) {
      const d   = data[this._hoverI];
      const cx  = P.left + spacing * this._hoverI + spacing / 2;
      const tip = opts.formatTooltipValue(d.value);
      const lbl = d.label;
      ctx.font  = '11px JetBrains Mono, monospace';
      const tw  = Math.max(ctx.measureText(tip).width, ctx.measureText(lbl).width) + 22;
      const th  = 46;
      let tx    = cx - tw / 2;
      let ty    = P.top + 4;
      if (tx < 4) tx = 4;
      if (tx + tw > W - 4) tx = W - tw - 4;
      _roundRect(ctx, tx, ty, tw, th, 6);
      ctx.fillStyle   = opts.tooltipBg;
      ctx.fill();
      ctx.strokeStyle = opts.tooltipBorder;
      ctx.lineWidth   = 1;
      ctx.stroke();
      ctx.textAlign   = 'left';
      ctx.fillStyle   = '#7070a0';
      ctx.fillText(lbl, tx + 11, ty + 16);
      ctx.fillStyle   = d.value >= 0 ? '#00e676' : '#ff4757';
      ctx.fillText(tip, tx + 11, ty + 32);
    }
  }

  _onMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    this._hoverI = null;
    for (const r of (this._barRects || [])) {
      if (mx >= r.x && mx <= r.x + r.w) { this._hoverI = r.i; break; }
    }
    this.draw();
  }
  _onLeave()  { this._hoverI = null; this.draw(); }
  _onTouch(e) {
    if (!e.touches.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx   = e.touches[0].clientX - rect.left;
    this._hoverI = null;
    for (const r of (this._barRects || [])) {
      if (mx >= r.x && mx <= r.x + r.w) { this._hoverI = r.i; break; }
    }
    this.draw();
  }
}

function _roundRectBar(ctx, x, y, w, h, r, isUp) {
  // Only round the top corners for upward bars, bottom for downward
  const r2 = Math.min(r, h/2, w/2);
  ctx.beginPath();
  if (isUp) {
    ctx.moveTo(x + r2, y);
    ctx.lineTo(x + w - r2, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r2);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r2);
    ctx.quadraticCurveTo(x, y, x + r2, y);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - r2);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r2, y + h);
    ctx.lineTo(x + r2, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r2);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}