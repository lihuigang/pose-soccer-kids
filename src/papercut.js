import { clamp } from './utils.js';

const CUT_SCALE = 0.8;
const INK = [27, 36, 49];
const PAPER = [247, 237, 215];
const INF = 60000;

const GRAIN = (() => {
  const a = new Int8Array(256);
  let seed = 20171;
  for (let i = 0; i < a.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    a[i] = ((seed >> 16) % 13) - 6;
  }
  return a;
})();

function stylize(data, w, h, ox, oy) {
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const a = data[i + 3];
      if (a < 64) {
        data[i + 3] = 0;
        continue;
      }
      data[i + 3] = a > 176 ? 255 : ((a - 64) * 2.27) | 0;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      let nr = l + (r - l) * 1.7;
      let ng = l + (g - l) * 1.7;
      let nb = l + (b - l) * 1.7;
      nr = (nr - 128) * 1.18 + 128;
      ng = (ng - 128) * 1.18 + 128;
      nb = (nb - 128) * 1.18 + 128;
      nr = Math.round(nr / 48) * 48;
      ng = Math.round(ng / 48) * 48;
      nb = Math.round(nb / 48) * 48;
      const tint = 0.12 * (0.3 + 0.7 * (l / 255));
      nr = nr * (1 - tint) + 246 * tint;
      ng = ng * (1 - tint) + 232 * tint;
      nb = nb * (1 - tint) + 205 * tint;
      if (l < 90) {
        nr *= 0.92;
        ng *= 0.96;
        nb *= 1.08;
      }
      const fiber =
        Math.sin((ox + x) * 0.35) * Math.cos((oy + y) * 0.27) * 7 +
        GRAIN[((ox + x) * 7 + (oy + y) * 13) & 255];
      data[i] = clamp(nr + fiber, 0, 255) | 0;
      data[i + 1] = clamp(ng + fiber, 0, 255) | 0;
      data[i + 2] = clamp(nb + fiber, 0, 255) | 0;
    }
  }
}

export class PaperCutRenderer {
  constructor() {
    this.cutout = document.createElement('canvas');
    this.cctx = this.cutout.getContext('2d', { willReadFrequently: true });
    this.outline = document.createElement('canvas');
    this.octx = this.outline.getContext('2d');
    this.solid = null;
    this.dist = null;
    this.outlineImg = null;
    this.rendered = 0;
  }

  resize(W, H) {
    const w = Math.round(W * CUT_SCALE);
    const h = Math.round(H * CUT_SCALE);
    if (this.cutout.width === w && this.cutout.height === h) return;
    this.cutout.width = w;
    this.cutout.height = h;
    this.outline.width = w;
    this.outline.height = h;
    this.solid = new Uint8Array(w * h);
    this.dist = new Uint16Array(w * h);
    this.outlineImg = this.octx.createImageData(w, h);
  }

  draw(ctx, pose, camera, W, H) {
    if (!pose?.mask || !camera?.frame) return false;
    const off = this.cutout;
    const w = off.width;
    const h = off.height;
    const octx = this.cctx;
    const s = w / W;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, w, h);

    const box = this.personBox(pose, w, h, W);
    const m = camera.mapping;
    const fw = m.width * s;
    const fh = m.height * s;
    const fx = m.x * s;
    const fy = m.y * s;
    const drawMasked = (src) => {
      if (m.mirror) {
        octx.save();
        octx.translate(fx + fw, fy);
        octx.scale(-1, 1);
        octx.drawImage(src, 0, 0, fw, fh);
        octx.restore();
      } else {
        octx.drawImage(src, fx, fy, fw, fh);
      }
    };
    octx.save();
    octx.beginPath();
    octx.rect(box.x0, box.y0, box.w, box.h);
    octx.clip();
    drawMasked(camera.frame);
    octx.globalCompositeOperation = 'destination-in';
    drawMasked(pose.mask);
    octx.globalCompositeOperation = 'source-over';
    octx.restore();

    const img = octx.getImageData(box.x0, box.y0, box.w, box.h);
    stylize(img.data, box.w, box.h, box.x0, box.y0);
    octx.putImageData(img, box.x0, box.y0);

    const ph = pose.personHeight || H * 0.4;
    this.buildOutline(img.data, box, ph, w, h);

    const t = pose.transform;
    ctx.save();
    if (t && Math.abs(t.s - 1) > 0.002) {
      ctx.translate(t.ax, t.ay);
      ctx.scale(t.s, t.s);
      ctx.translate(-t.ax, -t.ay);
    }
    ctx.drawImage(this.outline, 0, 0, W, H);
    ctx.drawImage(this.cutout, 0, 0, W, H);
    ctx.restore();
    this.rendered++;
    return true;
  }

  personBox(pose, w, h, W) {
    const t = pose.transform;
    const sc = t && Math.abs(t.s - 1) > 0.002 ? t.s : 1;
    const invX = (x) => (sc === 1 ? x : (x - t.ax) / sc + t.ax);
    const invY = (y) => (sc === 1 ? y : (y - t.ay) / sc + t.ay);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pose.points || []) {
      if ((p.v ?? 1) < 0.2) continue;
      const x = invX(p.x);
      const y = invY(p.y);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const ph = (pose.personHeight || W * 0.4) / sc;
    if (!Number.isFinite(x0)) {
      x0 = pose.bodyX - ph * 0.55;
      x1 = pose.bodyX + ph * 0.55;
      y0 = pose.groundY - ph * 1.15;
      y1 = pose.groundY + ph * 0.05;
    }
    const margin = ph * 0.04 + 8;
    const s = w / W;
    const bx0 = clamp(Math.floor((x0 - margin) * s), 0, w - 2);
    const by0 = clamp(Math.floor((y0 - margin) * s), 0, h - 2);
    const bx1 = clamp(Math.ceil((x1 + margin) * s), bx0 + 2, w);
    const by1 = clamp(Math.ceil((y1 + margin) * s), by0 + 2, h);
    return { x0: bx0, y0: by0, w: bx1 - bx0, h: by1 - by0 };
  }

  buildOutline(data, box, ph, w, h) {
    const bw = box.w;
    const bh = box.h;
    const n = bw * bh;
    const solid = this.solid;
    const dist = this.dist;
    for (let i = 0; i < n; i++) {
      const on = data[i * 4 + 3] > 96;
      solid[i] = on ? 1 : 0;
      dist[i] = on ? 0 : INF;
    }

    for (let y = 1; y < bh - 1; y++) {
      let i = y * bw + 1;
      for (let x = 1; x < bw - 1; x++, i++) {
        if (solid[i]) continue;
        let d = dist[i];
        const a = dist[i - 1] + 5;
        const b = dist[i - bw] + 5;
        if (a < d) d = a;
        if (b < d) d = b;
        const c = dist[i - bw - 1] + 7;
        const e = dist[i - bw + 1] + 7;
        if (c < d) d = c;
        if (e < d) d = e;
        dist[i] = d;
      }
    }
    for (let y = bh - 2; y > 0; y--) {
      let i = y * bw + bw - 2;
      for (let x = bw - 2; x > 0; x--, i--) {
        if (solid[i]) continue;
        let d = dist[i];
        const a = dist[i + 1] + 5;
        const b = dist[i + bw] + 5;
        if (a < d) d = a;
        if (b < d) d = b;
        const c = dist[i + bw + 1] + 7;
        const e = dist[i + bw - 1] + 7;
        if (c < d) d = c;
        if (e < d) d = e;
        dist[i] = d;
      }
    }

    const rPaper = Math.max(2, Math.round(ph * 0.014));
    const rInk = Math.max(1, Math.round(rPaper * 0.5));
    const out = this.outlineImg.data;
    for (let y = 0; y < bh; y++) {
      const row = (box.y0 + y) * w + box.x0;
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        const o = (row + x) * 4;
        if (solid[i]) {
          out[o + 3] = 0;
          continue;
        }
        const px = dist[i] / 5;
        if (px <= rInk + 1) {
          out[o] = INK[0];
          out[o + 1] = INK[1];
          out[o + 2] = INK[2];
          out[o + 3] = px <= rInk - 0.5 ? 255 : Math.round((255 * (rInk + 1 - px)) / 1.5);
        } else if (px <= rPaper + 1) {
          out[o] = PAPER[0];
          out[o + 1] = PAPER[1];
          out[o + 2] = PAPER[2];
          out[o + 3] = px <= rPaper - 0.5 ? 255 : Math.round((255 * (rPaper + 1 - px)) / 1.5);
        } else {
          out[o + 3] = 0;
        }
      }
    }
    this.octx.clearRect(0, 0, this.outline.width, this.outline.height);
    this.octx.putImageData(this.outlineImg, 0, 0, box.x0, box.y0, bw, bh);
  }
}
