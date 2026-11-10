import { clamp, dist, lerp, TAU } from './utils.js';

const LM = {
  nose: 0,
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

const SKIN = '#f2c29b';
const SKIN_BACK = '#dfa87e';
const SHIRT = '#ff6b35';
const SHIRT_DARK = '#e8590c';
const SHORTS = '#1c7ed6';
const SHORTS_BACK = '#1864ab';
const SHOE = '#f8f9fa';
const SHOE_BACK = '#dee2e6';
const HAIR = '#3b2a20';
const OUTLINE = '#20293a';
const VIS = 0.3;

function ik(root, target, l1, l2, bend) {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const d = Math.hypot(dx, dy) || 1;
  const dc = clamp(d, Math.abs(l1 - l2) + 1, l1 + l2 - 1);
  const a = Math.acos(clamp((l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc), -1, 1));
  const dir = Math.atan2(dy, dx) + bend * a;
  return { x: root.x + Math.cos(dir) * l1, y: root.y + Math.sin(dir) * l1 };
}

// Mirrored landmarks swap left/right, which turns a near-zero tilt into a
// near-180 degree one; keep drawing angles inside +/- 90 degrees.
const upright = (a) => (Math.cos(a) < 0 ? a + Math.PI : a);

export function sideViewPose(pose, layout) {
  if (!pose?.visible) return pose;
  const ph = pose.personHeight || layout.personHeight;
  const sourceX = pose.bodyX;
  const sourceGround = pose.groundY;
  const targetX = layout.bodyX;
  const targetGround = layout.groundY;
  const lift = {
    L: clamp((sourceGround - (pose.points[LM.leftAnkle]?.y ?? sourceGround)) / ph, 0, 0.45) * ph * 0.8,
    R: clamp((sourceGround - (pose.points[LM.rightAnkle]?.y ?? sourceGround)) / ph, 0, 0.45) * ph * 0.8,
  };
  const legSide = new Map([
    [LM.leftKnee, 'L'], [LM.leftAnkle, 'L'], [LM.leftHeel, 'L'], [LM.leftToe, 'L'],
    [LM.rightKnee, 'R'], [LM.rightAnkle, 'R'], [LM.rightHeel, 'R'], [LM.rightToe, 'R'],
  ]);
  const points = pose.points.map((p, idx) => {
    const next = {
      ...p,
      x: targetX + (p.x - sourceX) * 0.1,
      y: targetGround + (p.y - sourceGround),
    };
    const side = legSide.get(idx);
    if (side) {
      const stance = side === 'L' ? -ph * 0.02 : ph * 0.06;
      next.x = targetX + (p.x - sourceX) * 0.06 + stance + lift[side];
      if (idx === LM.leftKnee || idx === LM.rightKnee) {
        next.x = targetX + (p.x - sourceX) * 0.06 + lift[side] * 0.5 + ph * 0.02;
      }
    }
    if (idx === LM.leftElbow || idx === LM.leftWrist) next.x -= lift.R * 0.28;
    if (idx === LM.rightElbow || idx === LM.rightWrist) next.x -= lift.L * 0.28;
    if (idx === LM.nose) next.x = targetX + ph * 0.055;
    if (idx === LM.leftEar) next.x = targetX - ph * 0.025;
    if (idx === LM.rightEar) next.x = targetX + ph * 0.025;
    return next;
  });

  for (const [ankle, heel, toe] of [
    [LM.leftAnkle, LM.leftHeel, LM.leftToe],
    [LM.rightAnkle, LM.rightHeel, LM.rightToe],
  ]) {
    points[heel] = { ...points[heel], x: points[ankle].x - ph * 0.035, y: points[ankle].y + ph * 0.03 };
    points[toe] = { ...points[toe], x: points[ankle].x + ph * 0.075, y: points[ankle].y + ph * 0.034 };
  }

  const feet = pose.feet.map((foot) => {
    const indices = foot.id === 'L'
      ? [LM.leftAnkle, LM.leftHeel, LM.leftToe]
      : [LM.rightAnkle, LM.rightHeel, LM.rightToe];
    const mapped = indices.map((idx) => points[idx]);
    return {
      ...foot,
      x: mapped.reduce((sum, p) => sum + p.x, 0) / mapped.length,
      y: mapped.reduce((sum, p) => sum + p.y, 0) / mapped.length,
    };
  });
  return {
    ...pose,
    points,
    feet,
    bodyX: targetX,
    groundY: targetGround,
    headY: pose.headY == null ? null : targetGround + (pose.headY - sourceGround),
    sideView: true,
    facing: 1,
  };
}

export class AvatarRenderer {
  constructor() {
    this.sm = new Map();
    this.lastAt = 0;
  }

  reset() {
    this.sm.clear();
  }

  sample(pose, idx, alpha) {
    const p = pose.points[idx];
    if (!p || (p.v ?? 1) < VIS) return null;
    const prev = this.sm.get(idx);
    const jump = prev ? Math.hypot(prev.x - p.x, prev.y - p.y) : Infinity;
    if (!prev || jump > (pose.personHeight || 300) * 0.5) {
      const v = { x: p.x, y: p.y };
      this.sm.set(idx, v);
      return v;
    }
    const next = { x: prev.x + (p.x - prev.x) * alpha, y: prev.y + (p.y - prev.y) * alpha };
    this.sm.set(idx, next);
    return next;
  }

  draw(ctx, pose, now = 0) {
    if (!pose?.visible || !pose.points?.length) return;
    const ph = clamp(pose.personHeight || 320, 120, 1600);
    const dt = clamp((pose.at - this.lastAt) / 1000, 0.008, 0.2);
    if (pose.at - this.lastAt > 600) this.sm.clear();
    this.lastAt = pose.at;
    const alpha = 1 - Math.exp(-dt * 26);

    const get = (i) => this.sample(pose, i, alpha);
    const bodyX = pose.bodyX;
    const groundY = pose.groundY;

    let shL = get(LM.leftShoulder);
    let shR = get(LM.rightShoulder);
    if (!shL && !shR) return;
    if (!shL) shL = { x: 2 * bodyX - shR.x, y: shR.y };
    if (!shR) shR = { x: 2 * bodyX - shL.x, y: shL.y };

    const shoulderW = Math.max(dist(shL.x, shL.y, shR.x, shR.y), ph * 0.16);
    const shMid = { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 };
    const shoulderAngle = upright(Math.atan2(shR.y - shL.y, shR.x - shL.x));
    const torsoAngle = pose.sideView ? clamp(shoulderAngle, -0.18, 0.18) : shoulderAngle;

    const upperArm = ph * 0.15;
    const foreArm = ph * 0.14;
    const thigh = ph * 0.235;
    const shin = ph * 0.225;

    let hipL = get(LM.leftHip);
    let hipR = get(LM.rightHip);
    if (!hipL && !hipR) {
      const hw = shoulderW * 0.78;
      const hy = clamp(groundY - ph * 0.47, shMid.y + ph * 0.2, groundY - ph * 0.25);
      hipL = { x: bodyX - hw / 2, y: hy };
      hipR = { x: bodyX + hw / 2, y: hy };
    } else if (!hipL) {
      hipL = { x: 2 * bodyX - hipR.x, y: hipR.y };
    } else if (!hipR) {
      hipR = { x: 2 * bodyX - hipL.x, y: hipL.y };
    }
    if (hipL.y < shMid.y + ph * 0.12) hipL.y = shMid.y + ph * 0.12;
    if (hipR.y < shMid.y + ph * 0.12) hipR.y = shMid.y + ph * 0.12;
    const hipMid = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
    const bodyW = shoulderW * 1.34;
    const waistW = bodyW * 0.9;
    const legHipL = { x: hipMid.x - waistW * 0.24, y: hipL.y };
    const legHipR = { x: hipMid.x + waistW * 0.24, y: hipR.y };

    const legs = ['L', 'R'].map((side) => {
      const isL = side === 'L';
      const hip = isL ? legHipL : legHipR;
      const outward = hip.x < bodyX ? -1 : 1;
      let knee = get(isL ? LM.leftKnee : LM.rightKnee);
      let ankle = get(isL ? LM.leftAnkle : LM.rightAnkle);
      if (!ankle) {
        ankle = {
          x: (knee ?? hip).x,
          y: clamp(groundY - ph * 0.03, (knee ?? hip).y + shin * 0.9, groundY + ph * 0.02),
        };
      }
      if (!knee) {
        const fallback = { x: hip.x + (ankle.x - hip.x) * 0.05, y: (hip.y + ankle.y) / 2 };
        knee = ik(hip, fallback.y > hip.y ? ankle : fallback, thigh, shin, outward);
      }
      const heel = get(isL ? LM.leftHeel : LM.rightHeel);
      const toe = get(isL ? LM.leftToe : LM.rightToe);
      return { side, isL, hip, knee, ankle, heel, toe, outward };
    });

    const arms = ['L', 'R'].map((side) => {
      const isL = side === 'L';
      const sh = isL ? shL : shR;
      const outward = sh.x < bodyX ? -1 : 1;
      let wrist = get(isL ? LM.leftWrist : LM.rightWrist);
      let elbow = get(isL ? LM.leftElbow : LM.rightElbow);
      if (!wrist) {
        wrist = elbow
          ? { x: elbow.x + outward * ph * 0.01, y: elbow.y + foreArm * 0.92 }
          : { x: sh.x + outward * ph * 0.02, y: sh.y + (upperArm + foreArm) * 0.96 };
      }
      if (!elbow) elbow = ik(sh, wrist, upperArm, foreArm, outward);
      return { side, isL, sh, elbow, wrist, outward };
    });

    const r = clamp(shoulderW * 0.58, ph * 0.062, ph * 0.12);
    const earL = get(LM.leftEar);
    const earR = get(LM.rightEar);
    const nose = get(LM.nose);
    let headC;
    let headAngle = pose.sideView ? 0 : torsoAngle;
    if (earL && earR) {
      headC = { x: (earL.x + earR.x) / 2, y: (earL.y + earR.y) / 2 };
      headAngle = pose.sideView ? 0 : upright(Math.atan2(earR.y - earL.y, earR.x - earL.x));
    } else if (nose) {
      headC = { x: nose.x, y: nose.y - r * 0.32 };
      headAngle = torsoAngle;
    } else {
      headC = { x: shMid.x, y: shMid.y - r * 1.15 };
    }
    headC.y = Math.min(headC.y, shMid.y - r * 0.25);

    const outlineW = Math.max(2, ph * 0.012);
    const limb = (a, b, width, color) => {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = width + outlineW * 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };

    ctx.save();

    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath();
    ctx.ellipse(bodyX, groundY + ph * 0.012, shoulderW * 0.78, ph * 0.026, 0, 0, TAU);
    ctx.fill();

    const backSide = (pose.points[LM.leftWrist]?.v ?? 0) <= (pose.points[LM.rightWrist]?.v ?? 0) ? 'L' : 'R';
    const order = (list) => [...list].sort((a, b) => Number(b.side === backSide) - Number(a.side === backSide));
    const legsOrdered = order(legs);
    const armsOrdered = order(arms);

    const drawLeg = (leg) => {
      const back = leg.side === backSide;
      const color = back ? SKIN_BACK : SKIN;
      limb(leg.hip, leg.knee, ph * 0.088, color);
      limb(leg.knee, leg.ankle, ph * 0.07, color);
      let heel = leg.heel;
      let toe = leg.toe;
      if (!heel || !toe || dist(heel.x, heel.y, toe.x, toe.y) < ph * 0.04) {
        heel = { x: leg.ankle.x - ph * 0.026, y: leg.ankle.y + ph * 0.03 };
        toe = { x: leg.ankle.x + ph * 0.052, y: leg.ankle.y + ph * 0.034 };
      }
      limb(heel, toe, ph * 0.05, back ? SHOE_BACK : SHOE);
    };

    const drawArm = (arm) => {
      const back = arm.side === backSide;
      limb(arm.sh, arm.elbow, ph * 0.062, back ? SKIN_BACK : SKIN);
      limb(arm.elbow, arm.wrist, ph * 0.052, back ? SKIN_BACK : SKIN);
      ctx.fillStyle = back ? SKIN_BACK : SKIN;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = outlineW;
      ctx.beginPath();
      ctx.arc(arm.wrist.x, arm.wrist.y, ph * 0.03, 0, TAU);
      ctx.fill();
      ctx.stroke();
    };

    drawLeg(legsOrdered[0]);
    drawLeg(legsOrdered[1]);
    drawArm(armsOrdered[0]);
    drawArm(armsOrdered[1]);

    const waistL = { x: hipMid.x - waistW / 2, y: hipMid.y };
    const waistR = { x: hipMid.x + waistW / 2, y: hipMid.y };
    const shortsH = ph * 0.14;
    const sBotY = hipMid.y + shortsH;
    const crotchY = hipMid.y + shortsH * 0.42;
    const hemOut = waistW * 0.07;
    const hemIn = waistW * 0.075;

    ctx.fillStyle = SHORTS;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = outlineW;
    ctx.beginPath();
    ctx.moveTo(waistL.x, waistL.y - ph * 0.004);
    ctx.lineTo(waistR.x, waistR.y - ph * 0.004);
    ctx.lineTo(waistR.x + hemOut, sBotY);
    ctx.quadraticCurveTo(hipMid.x + hemIn * 0.9, sBotY + shortsH * 0.08, hipMid.x + hemIn * 0.6, crotchY);
    ctx.lineTo(hipMid.x, crotchY + shortsH * 0.06);
    ctx.lineTo(hipMid.x - hemIn * 0.6, crotchY);
    ctx.quadraticCurveTo(hipMid.x - hemIn * 0.9, sBotY + shortsH * 0.08, waistL.x - hemOut, sBotY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const extra = (bodyW - shoulderW) / 2;
    let shEdgeL = { x: shL.x - extra, y: shL.y - ph * 0.012 };
    let shEdgeR = { x: shR.x + extra, y: shR.y - ph * 0.012 };
    if (shEdgeL.x > shEdgeR.x) [shEdgeL, shEdgeR] = [shEdgeR, shEdgeL];

    ctx.fillStyle = SHIRT;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = outlineW;
    ctx.beginPath();
    ctx.moveTo(shEdgeL.x, shEdgeL.y);
    ctx.lineTo(shEdgeR.x, shEdgeR.y);
    ctx.lineTo(waistR.x, waistR.y + ph * 0.012);
    ctx.lineTo(waistL.x, waistL.y + ph * 0.012);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = SHIRT_DARK;
    ctx.beginPath();
    ctx.moveTo(lerp(shEdgeL.x, waistL.x, 0.62), lerp(shEdgeL.y, waistL.y, 0.62));
    ctx.lineTo(lerp(shEdgeR.x, waistR.x, 0.62), lerp(shEdgeR.y, waistR.y, 0.62));
    ctx.lineTo(waistR.x, waistR.y + ph * 0.012);
    ctx.lineTo(waistL.x, waistL.y + ph * 0.012);
    ctx.closePath();
    ctx.fill();

    const midTorso = { x: (shMid.x + hipMid.x) / 2, y: (shMid.y + hipMid.y) / 2 };
    ctx.save();
    ctx.translate(midTorso.x, midTorso.y);
    ctx.rotate(torsoAngle);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.font = `900 ${Math.round(ph * 0.095)}px "PingFang SC",system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('10', 0, 0);
    ctx.restore();

    ctx.strokeStyle = SKIN;
    ctx.lineWidth = ph * 0.055;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shMid.x, shMid.y);
    ctx.lineTo(headC.x, headC.y + r * 0.75);
    ctx.stroke();

    ctx.save();
    ctx.translate(headC.x, headC.y);
    ctx.rotate(headAngle);
    ctx.fillStyle = SKIN;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = outlineW * 1.2;
    if (!pose.sideView && earL) {
      ctx.beginPath();
      ctx.arc(-r * 0.98, r * 0.05, r * 0.16, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    if (!pose.sideView && earR) {
      ctx.beginPath();
      ctx.arc(r * 0.98, r * 0.05, r * 0.16, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.stroke();

    if (pose.sideView) {
      ctx.fillStyle = HAIR;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.02, Math.PI, TAU);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.95, -r * 0.45);
      ctx.quadraticCurveTo(-r * 1.05, r * 0.15, -r * 0.62, r * 0.5);
      ctx.lineTo(-r * 0.35, -r * 0.25);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = SKIN;
      ctx.strokeStyle = OUTLINE;
      ctx.beginPath();
      ctx.moveTo(r * 0.72, -r * 0.08);
      ctx.lineTo(r * 1.14, r * 0.12);
      ctx.lineTo(r * 0.72, r * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-r * 0.55, r * 0.08, r * 0.17, 0, TAU);
      ctx.fill();
      ctx.stroke();

      const blink = (now % 3.6) < 0.12;
      ctx.strokeStyle = '#2b221c';
      ctx.fillStyle = '#2b221c';
      ctx.lineWidth = Math.max(1.5, r * 0.06);
      ctx.lineCap = 'round';
      if (blink) {
        ctx.beginPath();
        ctx.moveTo(r * 0.28, -r * 0.12);
        ctx.lineTo(r * 0.48, -r * 0.12);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(r * 0.38, -r * 0.12, r * 0.075, 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(r * 0.42, r * 0.18, r * 0.28, Math.PI * 0.15, Math.PI * 0.75);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 120, 110, 0.35)';
      ctx.beginPath();
      ctx.arc(r * 0.55, r * 0.3, r * 0.14, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.restore();
      return;
    }

    ctx.fillStyle = HAIR;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.02, Math.PI, TAU);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.86, -r * 0.48);
    ctx.quadraticCurveTo(-r * 0.3, -r * 0.92, r * 0.55, -r * 0.7);
    ctx.quadraticCurveTo(r * 0.05, -r * 0.52, -r * 0.28, -r * 0.4);
    ctx.closePath();
    ctx.fill();

    const blink = (now % 3.6) < 0.12;
    ctx.fillStyle = '#2b221c';
    ctx.strokeStyle = '#2b221c';
    ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.lineCap = 'round';
    for (const sx of [-1, 1]) {
      if (blink) {
        ctx.beginPath();
        ctx.moveTo(sx * r * 0.3 - r * 0.09, -r * 0.04);
        ctx.lineTo(sx * r * 0.3 + r * 0.09, -r * 0.04);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(sx * r * 0.3, -r * 0.04, r * 0.075, 0, TAU);
        ctx.fill();
      }
    }
    ctx.beginPath();
    ctx.arc(0, r * 0.18, r * 0.3, Math.PI * 0.18, Math.PI * 0.82);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 120, 110, 0.35)';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * r * 0.52, r * 0.2, r * 0.16, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }
}