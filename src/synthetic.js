import { buildPoseSample, createPoseState, LM } from './pose.js';
import { easeInOutCubic, easeOutCubic, TAU } from './utils.js';

const W = 960;
const H = 540;

const IDLE = {
  head: [480, 188],
  nose: [480, 196],
  neck: [480, 232],
  shoulderL: [452, 242],
  shoulderR: [508, 242],
  elbowL: [428, 296],
  elbowR: [532, 296],
  wristL: [418, 350],
  wristR: [542, 350],
  hipL: [462, 342],
  hipR: [498, 342],
  kneeL: [452, 424],
  kneeR: [512, 424],
  ankleL: [446, 496],
  ankleR: [520, 496],
  heelL: [438, 508],
  heelR: [512, 508],
  toeL: [430, 512],
  toeR: [536, 512],
};

export class SyntheticCamera {
  constructor() {
    this.width = W;
    this.height = H;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = W;
    this.maskCanvas.height = H;
    this.mctx = this.maskCanvas.getContext('2d');
    this.state = createPoseState({ mask: this.maskCanvas, maskSize: { width: W, height: H } });
    this.t0 = performance.now();
    this.landmarks = null;
    this.cycle = 3.4;
    this.kickWindow = [2.45, 2.95];
    this.readyState = 4;
    this.currentTime = 0;
    this.kickedAt = -1;
  }

  get videoWidth() {
    return W;
  }

  get videoHeight() {
    return H;
  }

  get frame() {
    return this.canvas;
  }

  update(now) {
    const t = (now - this.t0) / 1000;
    this.currentTime = t;
    const phase = t % this.cycle;
    const sway = Math.sin(t * 0.9) * 5;
    const bob = Math.sin(t * 1.8) * 2;

    const j = {};
    for (const [k, v] of Object.entries(IDLE)) j[k] = [v[0], v[1]];
    for (const k of Object.keys(j)) {
      j[k][0] += sway;
      j[k][1] += bob;
    }
    j.head[1] -= 1;
    j.nose[1] -= 1;

    const [k0, k1] = this.kickWindow;
    if (phase >= k0 && phase <= k1) {
      const k = (phase - k0) / (k1 - k0);
      const lift = k < 0.42 ? easeOutCubic(k / 0.42) : 1 - easeInOutCubic((k - 0.42) / 0.58);
      j.ankleR[1] -= 122 * lift;
      j.ankleR[0] += 24 * lift;
      j.kneeR[1] -= 46 * lift;
      j.kneeR[0] += 10 * lift;
      j.heelR[1] -= 120 * lift;
      j.heelR[0] += 22 * lift;
      j.toeR[1] -= 112 * lift;
      j.toeR[0] += 30 * lift;
    }
    void H;

    this.drawFrame(j, t);
    this.drawMask(j);
    this.landmarks = toLandmarks(j);
    this.state.mapping = null;
  }

  drawFrame(j, t) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#e8eef5');
    g.addColorStop(0.72, '#dfe6ee');
    g.addColorStop(0.72, '#cbb79a');
    g.addColorStop(1, '#b8a184');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.beginPath();
    ctx.ellipse(480, 512, 150, 14, 0, 0, TAU);
    ctx.fill();
    void t;

    this.drawFigure(ctx, j, false);
  }

  drawMask(j) {
    const m = this.mctx;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, W, H);
    this.drawFigure(m, j, true);
  }

  drawFigure(ctx, j, silhouette) {
    const skin = silhouette ? '#fff' : '#f2c29b';
    const shirt = silhouette ? '#fff' : '#ff6b35';
    const shirtDark = silhouette ? '#fff' : '#e8590c';
    const shorts = silhouette ? '#fff' : '#1c7ed6';
    const shoe = silhouette ? '#fff' : '#f8f9fa';
    const hair = silhouette ? '#fff' : '#3b2a20';

    const line = (a, b, width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    };

    line(j.hipL, j.kneeL, 26, skin);
    line(j.kneeL, j.ankleL, 22, skin);
    line(j.hipR, j.kneeR, 26, skin);
    line(j.kneeR, j.ankleR, 22, skin);

    const shoeDraw = (ankle, toe) => {
      ctx.save();
      ctx.translate(ankle[0], ankle[1]);
      ctx.rotate(Math.atan2(toe[1] - ankle[1], toe[0] - ankle[0]));
      ctx.fillStyle = shoe;
      ctx.beginPath();
      ctx.roundRect(-12, -11, 34, 22, 9);
      ctx.fill();
      ctx.restore();
    };
    shoeDraw(j.ankleL, j.toeL);
    shoeDraw(j.ankleR, j.toeR);

    ctx.fillStyle = shorts;
    ctx.beginPath();
    ctx.roundRect(j.hipL[0] - 22, j.hipL[1] - 16, j.hipR[0] - j.hipL[0] + 44, 58, 12);
    ctx.fill();

    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.roundRect(j.shoulderL[0] - 24, j.shoulderL[1] - 6, j.shoulderR[0] - j.shoulderL[0] + 48, 100, 22);
    ctx.fill();
    if (!silhouette) {
      ctx.fillStyle = shirtDark;
      ctx.fillRect(j.shoulderL[0] - 24, j.shoulderL[1] + 58, j.shoulderR[0] - j.shoulderL[0] + 48, 36);
      ctx.fillStyle = '#fff';
      ctx.font = '900 34px "PingFang SC",system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.save();
      ctx.translate(480, j.shoulderL[1] + 52);
      if (this.mirror) ctx.scale(-1, 1);
      ctx.fillText('10', 0, 0);
      ctx.restore();
    }

    line(j.shoulderL, j.elbowL, 18, skin);
    line(j.elbowL, j.wristL, 15, skin);
    line(j.shoulderR, j.elbowR, 18, skin);
    line(j.elbowR, j.wristR, 15, skin);
    if (!silhouette) {
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(j.wristL[0], j.wristL[1], 8, 0, TAU);
      ctx.arc(j.wristR[0], j.wristR[1], 8, 0, TAU);
      ctx.fill();
    }

    if (!silhouette) {
      line(j.shoulderL, [j.shoulderL[0] + 6, j.neck[1]], 14, skin);
      line(j.shoulderR, [j.shoulderR[0] - 6, j.neck[1]], 14, skin);
    }

    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(j.head[0], j.head[1], 36, 0, TAU);
    ctx.fill();

    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(j.head[0], j.head[1] - 2, 36, Math.PI * 1.03, TAU * 0.99);
    ctx.fill();
    if (!silhouette) {
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath();
      ctx.arc(j.head[0] - 12, j.head[1] + 2, 3.6, 0, TAU);
      ctx.arc(j.head[0] + 12, j.head[1] + 2, 3.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#2b2b2b';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(j.head[0], j.head[1] + 6, 12, 0.25 * Math.PI, 0.75 * Math.PI);
      ctx.stroke();
    }
  }

  sample(now, mapping) {
    this.mirror = !!mapping?.mirror;
    this.update(now);
    return buildPoseSample(this.landmarks, this.state, now, {
      videoW: W,
      videoH: H,
      mapping,
    });
  }
}

function toLandmarks(j) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
  const set = (idx, p, visibility = 0.95) => {
    lm[idx] = { x: p[0] / W, y: p[1] / H, z: 0, visibility };
  };
  set(LM.nose, j.nose);
  set(LM.leftEye, [j.nose[0] - 12, j.nose[1] - 6]);
  set(LM.rightEye, [j.nose[0] + 12, j.nose[1] - 6]);
  set(LM.leftEar, [j.head[0] - 32, j.head[1] + 4]);
  set(LM.rightEar, [j.head[0] + 32, j.head[1] + 4]);
  set(LM.leftShoulder, j.shoulderL);
  set(LM.rightShoulder, j.shoulderR);
  set(LM.leftElbow, j.elbowL);
  set(LM.rightElbow, j.elbowR);
  set(LM.leftWrist, j.wristL);
  set(LM.rightWrist, j.wristR);
  set(LM.leftHip, j.hipL);
  set(LM.rightHip, j.hipR);
  set(LM.leftKnee, j.kneeL);
  set(LM.rightKnee, j.kneeR);
  set(LM.leftAnkle, j.ankleL);
  set(LM.rightAnkle, j.ankleR);
  set(LM.leftHeel, j.heelL);
  set(LM.rightHeel, j.heelR);
  set(LM.leftToe, j.toeL);
  set(LM.rightToe, j.toeR);
  return lm;
}
