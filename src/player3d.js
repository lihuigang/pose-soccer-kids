import * as THREE from 'three';
import { BALL_FLYING } from './game.js';

const UP = new THREE.Vector3(0, 1, 0);
const RING_AXIS = new THREE.Vector3(0, 0, 1);

export function setSegment(mesh, a, b) {
  const direction = b.clone().sub(a);
  const length = Math.max(direction.length(), 0.001);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
}

function placeRing(mesh, center, direction) {
  mesh.position.copy(center);
  mesh.quaternion.setFromUnitVectors(RING_AXIS, direction.normalize());
}

export function createPlayer(scene, kit) {
  const root = new THREE.Group();
  scene.add(root);

  const mat = (color, roughness, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const skin = mat('#ce9067', 0.58);
  const skinDeep = mat('#c0865f', 0.66);
  const shirt = mat(kit.shirt, 0.68);
  const trim = mat(kit.trim || '#f6f2e6', 0.64);
  const shorts = mat(kit.shorts, 0.74);
  const socks = mat(kit.socks, 0.7);
  const bootMat = mat('#f8f8f3', 0.4);
  const soleMat = mat('#22282c', 0.78);
  const accent = mat(kit.accent || '#f0a01f', 0.48);
  const hair = mat('#2e211a', 0.82, { side: THREE.DoubleSide });
  const hairLite = mat('#3b2b22', 0.8);
  const eyeWhite = mat('#f8f5ed', 0.32);
  const iris = mat('#22262b', 0.28);
  const mouth = mat('#8d4a3b', 0.62);

  const mesh = (parent, geometry, material, position, scale, rotation, shadow = true) => {
    const m = new THREE.Mesh(geometry, material);
    if (position) m.position.set(...position);
    if (scale) m.scale.set(...scale);
    if (rotation) m.rotation.set(...rotation);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    parent.add(m);
    return m;
  };
  const sphere = (parent, r, material, position, scale, seg = 20) =>
    mesh(parent, new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.7))), material, position, scale);
  const segment = (radius, material, taper = 0.9) =>
    mesh(root, new THREE.CylinderGeometry(radius * taper, radius, 1, 14), material);

  // jersey: tapered shirt silhouette with hoop stripe, hem and collar
  const torsoProfile = [
    [0.155, 0], [0.178, 0.1], [0.198, 0.25], [0.21, 0.42],
    [0.198, 0.5], [0.155, 0.58], [0.1, 0.62],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = mesh(root, new THREE.LatheGeometry(torsoProfile, 32), shirt, [0, 0.86, 0], [0.76, 1, 1.08]);
  mesh(torso, new THREE.TorusGeometry(0.156, 0.009, 8, 28), trim, [0, 0.018, 0], null, [Math.PI / 2, 0, 0]);
  mesh(torso, new THREE.TorusGeometry(0.096, 0.012, 8, 24), trim, [0, 0.608, 0], null, [Math.PI / 2, 0, 0]);
  mesh(torso, new THREE.CircleGeometry(0.1, 24), shirt, [0, 0.614, 0], null, [-Math.PI / 2, 0, 0]);
  mesh(
    torso,
    new THREE.PlaneGeometry(0.15, 0.17),
    new THREE.MeshStandardMaterial({ map: makeNumberTexture(), transparent: true, roughness: 0.6, depthWrite: false }),
    [0.079, 0.3, 0.193],
    null,
    [0, 0.35, 0],
    false,
  );

  // shorts and neck
  const hips = mesh(root, new THREE.SphereGeometry(0.185, 24, 18), shorts, [0, 0.9, 0], [0.98, 0.72, 1.06]);
  const waist = mesh(root, new THREE.CylinderGeometry(0.18, 0.185, 0.04, 24), trim, [0, 0.985, 0]);
  mesh(root, new THREE.CylinderGeometry(0.055, 0.062, 0.13, 16), skin, [0, 1.51, 0]);

  // rounded head, turned a little toward the camera for a 3/4 view
  const head = new THREE.Group();
  head.position.set(0, 1.65, 0);
  head.rotation.y = -0.42;
  head.scale.setScalar(1.08);
  root.add(head);
  mesh(head, new THREE.SphereGeometry(0.148, 32, 24), skin, null, [0.93, 1.04, 0.98]);
  mesh(head, new THREE.SphereGeometry(0.11, 24, 18), skin, [0.03, -0.062, 0], [0.95, 0.72, 0.88]);
  for (const s of [-1, 1]) {
    mesh(head, new THREE.SphereGeometry(0.018, 14, 10), eyeWhite, [0.13, 0.018, 0.052 * s], [0.55, 1, 0.9], null, false);
    mesh(head, new THREE.SphereGeometry(0.01, 12, 10), iris, [0.141, 0.018, 0.052 * s], [0.55, 1, 0.85], null, false);
    mesh(head, new THREE.BoxGeometry(0.018, 0.012, 0.048), hair, [0.135, 0.057, 0.05 * s], null, [s * 0.1, 0, s * -0.08], false);
    sphere(head, 0.031, skinDeep, [0, -0.004, 0.142 * s], [0.45, 0.85, 0.55], 12);
  }
  sphere(head, 0.023, skin, [0.146, -0.012, 0], [1.25, 0.75, 0.85], 16);
  const smile = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.136, -0.054, 0.022),
    new THREE.Vector3(0.15, -0.066, 0),
    new THREE.Vector3(0.136, -0.054, -0.022),
  ]);
  mesh(head, new THREE.TubeGeometry(smile, 12, 0.005, 6, false), mouth, null, null, null, false);

  // hair: cap, swept fringe, sideburns
  mesh(head, new THREE.SphereGeometry(0.156, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.56), hair, [-0.018, 0.016, 0], [0.97, 1.02, 1]);
  sphere(head, 0.07, hairLite, [0.082, 0.128, 0.004], [1.12, 0.5, 1.06], 18).rotation.z = -0.38;
  sphere(head, 0.058, hair, [0.108, 0.078, -0.052], [0.92, 0.44, 0.82], 16).rotation.z = -0.5;
  sphere(head, 0.06, hair, [0.108, 0.098, 0.002], [1, 0.42, 0.9], 16).rotation.z = -0.45;
  sphere(head, 0.05, hair, [-0.01, 0.152, 0.035], [1.1, 0.55, 0.95], 14);
  sphere(head, 0.046, hair, [-0.055, 0.138, -0.03], [1.05, 0.5, 0.9], 14);
  sphere(head, 0.04, hairLite, [-0.02, 0.158, -0.055], [1, 0.45, 0.85], 12);
  sphere(head, 0.058, hair, [0.107, 0.078, 0.058], [0.92, 0.44, 0.82], 16).rotation.z = -0.5;
  for (const s of [-1, 1]) {
    mesh(head, new THREE.BoxGeometry(0.03, 0.07, 0.02), hair, [0.012, -0.012, 0.134 * s], null, [0, 0, 0.06], false);
  }

  const limbs = {};
  for (const side of ['L', 'R']) {
    const z = side === 'L' ? 0.155 : -0.155;
    const hand = new THREE.Group();
    root.add(hand);
    sphere(hand, 0.05, skin, null, [0.78, 1.08, 0.88]);
    sphere(hand, 0.022, skin, [0.024, 0.012, 0.034], [1, 1.25, 0.9], 12);
    for (const fz of [-0.02, 0, 0.02]) {
      mesh(hand, new THREE.CapsuleGeometry(0.011, 0.032, 4, 8), skin, [0.004, -0.055, fz]);
    }

    const shoe = new THREE.Group();
    root.add(shoe);
    const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.15, 6, 16), bootMat);
    boot.rotation.z = Math.PI / 2;
    boot.position.set(0.055, -0.012, 0);
    boot.castShadow = true;
    shoe.add(boot);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12), bootMat);
    toe.position.set(0.135, -0.018, 0);
    toe.scale.set(1.05, 0.72, 0.95);
    toe.castShadow = true;
    shoe.add(toe);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.255, 0.022, 0.108), soleMat);
    sole.position.set(0.06, -0.058, 0);
    sole.castShadow = true;
    shoe.add(sole);
    const heel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.052, 0.095), accent);
    heel.position.set(-0.042, -0.026, 0);
    shoe.add(heel);
    for (let i = 0; i < 3; i++) {
      const lace = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.062), soleMat);
      lace.position.set(0.03 + i * 0.032, 0.033, 0);
      shoe.add(lace);
    }

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.9, 0.016), trim);
    stripe.position.set(0, 0, 0.097 * (side === 'L' ? 1 : -1));
    stripe.castShadow = false;
    root.add(stripe);

    limbs[side] = {
      stripe,
      z,
      thigh: segment(0.078, skin),
      shortLeg: segment(0.096, shorts, 0.94),
      shin: segment(0.06, skin),
      sock: segment(0.062, socks, 0.92),
      knee: sphere(root, 0.069, skin, null, null, 16),
      upperArm: segment(0.055, skin),
      sleeve: segment(0.073, shirt, 0.95),
      foreArm: segment(0.047, skin),
      elbow: sphere(root, 0.05, skin, null, null, 14),
      hand,
      shortHem: mesh(root, new THREE.TorusGeometry(0.098, 0.0075, 6, 18), trim),
      sockBand: mesh(root, new THREE.TorusGeometry(0.064, 0.011, 6, 18), accent),
      sleeveCuff: mesh(root, new THREE.TorusGeometry(0.075, 0.01, 6, 18), trim),
      shoe,
    };
  }

  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const update = (pose, game, now, dive = 0) => {
    const ph = pose?.personHeight || 400;
    const groundY = pose?.groundY || 650;
    const ankleL = pose?.points?.[27];
    const ankleR = pose?.points?.[28];
    let liftL = clamp((groundY - (ankleL?.y ?? groundY)) / ph, 0, 0.4);
    let liftR = clamp((groundY - (ankleR?.y ?? groundY)) / ph, 0, 0.4);
    if (game.ball.state === BALL_FLYING && game.ball.flightTime < 0.42) {
      const kick = Math.sin((game.ball.flightTime / 0.42) * Math.PI) * 0.24;
      if (game.ball.lastKickFoot !== 'L') liftR = Math.max(liftR, kick);
      else liftL = Math.max(liftL, kick);
    }
    const active = Math.max(liftL, liftR);
    const lean = 0.1 + active * 0.85;
    const bob = Math.sin(now / 420) * 0.006;
    const sway = Math.sin(now / 900) * 0.01;
    torso.position.set(lean * 0.06, 0.86 + bob, 0);
    torso.rotation.z = -lean * 0.13;
    hips.position.y = 0.9 + bob;
    waist.position.y = 0.985 + bob;
    head.position.set(lean * 0.22, 1.65 + bob, 0);
    head.rotation.z = -lean * 0.08;
    root.rotation.z = dive * 0.65;

    for (const side of ['L', 'R']) {
      const part = limbs[side];
      const lift = side === 'L' ? liftL : liftR;
      const z = part.z;
      const hip = v(0, 0.9 + bob, z);
      const knee = v(0.035 + lift * 1.05, 0.5 + lift * 0.35 + bob, z);
      const ankle = v(0.025 + lift * 2.15, 0.1 + lift * 1.15 + bob, z);
      const shortEnd = hip.clone().lerp(knee, 0.6);
      setSegment(part.shortLeg, hip, shortEnd);
      setSegment(part.stripe, hip, shortEnd);
      setSegment(part.thigh, shortEnd, knee);
      part.knee.position.copy(knee);
      placeRing(part.shortHem, shortEnd, knee.clone().sub(hip));
      const sockStart = knee.clone().lerp(ankle, 0.46);
      setSegment(part.shin, knee, sockStart);
      setSegment(part.sock, sockStart, ankle);
      placeRing(part.sockBand, sockStart, ankle.clone().sub(knee));
      part.shoe.position.set(ankle.x + 0.03, ankle.y - 0.028, z);

      const sideSign = side === 'L' ? 1 : -1;
      const shoulder = v(lean * 0.1, 1.34 + bob, z * 1.55);
      const elbow = v(0.04 - active * 0.3 * sideSign, 1.09 + active * 0.22 + bob, z * 1.62);
      const wrist = v(0.14 + sway - active * 0.5 * sideSign, 0.91 + active * 0.42 + bob, z * 1.55);
      const sleeveEnd = shoulder.clone().lerp(elbow, 0.42);
      setSegment(part.sleeve, shoulder, sleeveEnd);
      setSegment(part.upperArm, sleeveEnd, elbow);
      setSegment(part.foreArm, elbow, wrist);
      placeRing(part.sleeveCuff, sleeveEnd, elbow.clone().sub(shoulder));
      part.elbow.position.copy(elbow);
      part.hand.position.copy(wrist);
    }
  };
  return { root, update };
}

function makeNumberTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(250, 247, 238, 0.92)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(64, 64, 55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#faf7ee';
  ctx.font = '800 62px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('10', 64, 67);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
