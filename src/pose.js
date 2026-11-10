import { FilesetResolver, ImageSegmenter, PoseLandmarker } from '../vendor/vision_bundle.mjs';
import { clamp } from './utils.js';

export const LM = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftToe: 31,
  rightToe: 32,
};

const FOOT_POINTS = {
  L: [LM.leftAnkle, LM.leftHeel, LM.leftToe],
  R: [LM.rightAnkle, LM.rightHeel, LM.rightToe],
};

const HISTORY_MS = 140;
const MIN_VISIBILITY = 0.45;

export function createPoseState(overrides = {}) {
  return {
    history: { L: [], R: [] },
    smooth: { groundY: null, headY: null, bodyX: null, height: null },
    mask: null,
    maskSize: null,
    detectMs: 0,
    delegate: 'CPU',
    ...overrides,
  };
}

export class PoseTracker {
  constructor({
    wasmPath = 'vendor/wasm',
    modelPath = 'models/pose_landmarker_lite.task',
    segmenterPath = 'models/selfie_segmenter.tflite',
    onStatus = () => {},
  } = {}) {
    this.wasmPath = wasmPath;
    this.modelPath = modelPath;
    this.segmenterPath = segmenterPath;
    this.onStatus = onStatus;
    this.state = createPoseState();
    this.landmarker = null;
    this.segmenter = null;
    this.maskCanvas = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d');
    this.maskImage = null;
    this.lastVideoTime = -1;
    this.lastDetectAt = 0;
    this.lastSample = null;
    this.lastMaskAt = 0;
    this.costEma = 16;
    this.segEma = 8;
  }

  get detectMs() {
    return this.state.detectMs;
  }

  get delegate() {
    return this.state.delegate;
  }

  async init() {
    this.onStatus('正在加载姿态识别引擎…');
    const fileset = await FilesetResolver.forVisionTasks(this.wasmPath);
    this.landmarker = await this.createLandmarker(fileset);
    try {
      this.segmenter = await this.createSegmenter(fileset);
    } catch (err) {
      console.warn('自拍分割模型加载失败，将改用骨架显示', err);
    }
    this.onStatus('引擎就绪');
  }

  async createLandmarker(fileset) {
    for (const delegate of ['GPU', 'CPU']) {
      try {
        const landmarker = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: this.modelPath, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
        this.state.delegate = delegate;
        return landmarker;
      } catch (err) {
        console.warn(`Pose ${delegate} 初始化失败`, err);
      }
    }
    throw new Error('无法初始化姿态识别模型');
  }

  async createSegmenter(fileset) {
    for (const delegate of ['GPU', 'CPU']) {
      try {
        return await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: this.segmenterPath, delegate },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      } catch (err) {
        console.warn(`分割模型 ${delegate} 初始化失败`, err);
      }
    }
    return null;
  }

  detect(frame, nowMs, { mapping, segmentation = true } = {}) {
    if (!this.landmarker) return null;
    if (frame.readyState !== undefined && frame.readyState < 2) return null;

    const hasNewFrame = frame.currentTime !== this.lastVideoTime;
    const minInterval = this.costEma > 90 ? 150 : this.costEma > 45 ? 80 : 0;
    if (!hasNewFrame || nowMs - this.lastDetectAt < minInterval) return this.lastSample;
    this.lastVideoTime = frame.currentTime;

    const t0 = performance.now();
    let result = null;
    try {
      result = this.landmarker.detectForVideo(frame, nowMs);
    } catch (err) {
      console.warn('姿态推理失败', err);
    }
    this.state.detectMs = performance.now() - t0;
    this.costEma = this.costEma * 0.8 + this.state.detectMs * 0.2;
    this.lastDetectAt = nowMs;
    this.state.mapping = mapping;

    const segInterval = this.segEma > 40 ? 200 : 80;
    if (segmentation && this.segmenter && nowMs - this.lastMaskAt > segInterval) {
      this.lastMaskAt = nowMs;
      const s0 = performance.now();
      try {
        const seg = this.segmenter.segmentForVideo(frame, nowMs);
        this.applyMask(seg);
      } catch (err) {
        console.warn('分割推理失败', err);
      }
      this.segEma = this.segEma * 0.8 + (performance.now() - s0) * 0.2;
    }

    const landmarks = result?.landmarks?.[0] ?? null;
    const sample = buildPoseSample(landmarks, this.state, nowMs, {
      videoW: frame.videoWidth ?? frame.width,
      videoH: frame.videoHeight ?? frame.height,
    });
    this.lastSample = sample;
    return sample;
  }

  applyMask(result) {
    const masks = result?.confidenceMasks;
    if (!masks || masks.length === 0) return;
    const mask = masks.length > 1 ? masks[1] : masks[0];
    const data = mask.getAsFloat32Array();
    const w = mask.width;
    const h = mask.height;
    if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
      this.maskCanvas.width = w;
      this.maskCanvas.height = h;
      this.maskImage = null;
    }
    if (!this.maskImage) this.maskImage = this.maskCtx.createImageData(w, h);
    const px = this.maskImage.data;
    for (let i = 0; i < data.length; i++) {
      const a = clamp((data[i] - 0.35) / 0.35, 0, 1);
      const o = i * 4;
      px[o] = 255;
      px[o + 1] = 255;
      px[o + 2] = 255;
      px[o + 3] = a * 255;
    }
    this.maskCtx.putImageData(this.maskImage, 0, 0);
    this.state.mask = this.maskCanvas;
    this.state.maskSize = { width: w, height: h };
  }

  close() {
    this.landmarker?.close?.();
    this.segmenter?.close?.();
  }
}

export function buildPoseSample(landmarks, state, nowMs, { videoW = 1280, videoH = 720, mapping } = {}) {
  const map = mapping ?? state.mapping ?? { x: 0, y: 0, width: videoW, height: videoH, mirror: true };

  if (!landmarks) {
    state.history.L.length = 0;
    state.history.R.length = 0;
    return emptySample(state, nowMs, map);
  }

  const pts = landmarks.map((lm) => {
    const x = map.mirror ? 1 - lm.x : lm.x;
    const y = lm.mirror ? 1 - lm.y : lm.y;
    return {
      x: map.x + x * map.width,
      y: map.y + y * map.height,
      v: lm.visibility ?? 0.9,
    };
  });

  const visible = (p) => !!p && p.v > MIN_VISIBILITY;
  const ankleL = pts[LM.leftAnkle];
  const ankleR = pts[LM.rightAnkle];

  const lows = [];
  for (const side of ['L', 'R']) {
    for (const idx of FOOT_POINTS[side]) {
      if (visible(pts[idx])) lows.push(pts[idx]);
    }
  }
  let groundY = null;
  if (lows.length) {
    groundY = Math.max(...lows.map((p) => p.y));
  } else if (visible(ankleL) && visible(ankleR)) {
    groundY = Math.max(ankleL.y, ankleR.y);
  }

  const nose = visible(pts[LM.nose]) ? pts[LM.nose] : null;
  const hips = [pts[LM.leftHip], pts[LM.rightHip]].filter(visible);
  const shoulders = [pts[LM.leftShoulder], pts[LM.rightShoulder]].filter(visible);
  const bodyX = hips.length
    ? (hips[0].x + hips[1].x) / 2
    : shoulders.length
      ? (shoulders[0].x + shoulders[1].x) / 2
      : (ankleL.x + ankleR.x) / 2;

  const feet = [];
  for (const side of ['L', 'R']) {
    const points = FOOT_POINTS[side].map((idx) => pts[idx]).filter(visible);
    if (points.length === 0) continue;
    const weight = points.reduce((s, p) => s + p.v, 0);
    const cx = points.reduce((s, p) => s + p.x * p.v, 0) / weight;
    const cy = points.reduce((s, p) => s + p.y * p.v, 0) / weight;
    const hist = state.history[side];
    hist.push({ t: nowMs, x: cx, y: cy });
    while (hist.length > 2 && nowMs - hist[0].t > HISTORY_MS) hist.shift();
    const oldest = hist[0];
    const dt = Math.max(0.016, (nowMs - oldest.t) / 1000);
    const vx = (cx - oldest.x) / dt;
    const vy = (cy - oldest.y) / dt;
    feet.push({
      id: side,
      x: cx,
      y: cy,
      vx,
      vy,
      speed: Math.hypot(vx, vy),
    });
  }

  const s = state.smooth;
  const smoothTo = (key, value, a) => {
    if (value == null || !Number.isFinite(value)) return s[key];
    s[key] = s[key] == null ? value : s[key] + (value - s[key]) * a;
    return s[key];
  };
  const heightPx = nose && groundY != null ? (groundY - nose.y) * 1.1 : null;
  const smoothGround = smoothTo('groundY', groundY, 0.3);
  const smoothHeight = smoothTo('height', heightPx, 0.15);
  const smoothBodyX = smoothTo('bodyX', bodyX, 0.4);

  return {
    visible: !!(lows.length || hips.length) && smoothGround != null,
    landmarks,
    points: pts,
    feet,
    bodyX: smoothBodyX,
    groundY: smoothGround ?? groundY ?? videoH,
    personHeight: smoothHeight ?? 400,
    headY: nose?.y ?? null,
    mask: state.mask,
    maskSize: state.maskSize,
    mapping: map,
    videoW,
    videoH,
    detectMs: state.detectMs,
    delegate: state.delegate,
    at: nowMs,
  };
}

export function transformPose(pose, s) {
  if (!pose || !Number.isFinite(s) || s === 1) return pose;
  const ax = pose.bodyX;
  const ay = pose.groundY;
  const tx = (x) => ax + (x - ax) * s;
  const ty = (y) => ay + (y - ay) * s;
  return {
    ...pose,
    points: pose.points.map((p) => ({ ...p, x: tx(p.x), y: ty(p.y) })),
    feet: pose.feet.map((f) => ({
      ...f,
      x: tx(f.x),
      y: ty(f.y),
      vx: f.vx * s,
      vy: f.vy * s,
      speed: f.speed * s,
    })),
    personHeight: pose.personHeight * s,
    headY: pose.headY == null ? null : ty(pose.headY),
    transform: { s, ax, ay },
  };
}

function emptySample(state, nowMs, map) {
  return {
    visible: false,
    landmarks: null,
    points: [],
    feet: [],
    bodyX: state.smooth.bodyX ?? map.x + map.width / 2,
    groundY: state.smooth.groundY ?? map.y + map.height * 0.9,
    personHeight: state.smooth.height ?? 400,
    headY: null,
    mask: state.mask,
    maskSize: state.maskSize,
    mapping: map,
    detectMs: state.detectMs,
    delegate: state.delegate,
    at: nowMs,
  };
}
