import * as THREE from 'three';
import { BALL_FLYING, BALL_READY } from './game.js';
import { clamp, easeInOutCubic, lerp } from './utils.js';

const UP = new THREE.Vector3(0, 1, 0);
const WORLD_WIDTH = 7.4;
const PLAYER_Z = 1.4;
const GOAL_Z = -1.35;
const GOAL_ANGLE = -0.52;
const BALL_RADIUS = 0.14;

export class Soccer3DRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#91adbc');
    this.scene.fog = new THREE.Fog('#91adbc', 15, 35);
    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 60);
    this.camera.position.set(0, 3.05, 8.2);
    this.camera.lookAt(0, 1.02, -0.35);
    this.lastFrameAt = 0;
    this.frameMs = 0;
    this.buildWorld();
    this.player = createPlayer(this.scene, { shirt: '#e84b23', shorts: '#174f91', socks: '#f2f3f0' });
    this.keeper = createPlayer(this.scene, { shirt: '#e6b93d', shorts: '#202c3c', socks: '#202c3c' });
    this.keeper.root.rotation.y = GOAL_ANGLE - Math.PI / 2;
    this.buildBall();
  }

  resize(w, h, dpr = 1) {
    this.renderer.setPixelRatio(Math.min(dpr || 1, 1.5));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1.25 ? 42 : 34;
    this.camera.updateProjectionMatrix();
  }

  setVisible(visible) {
    this.canvas.classList.toggle('hidden', !visible);
  }

  buildWorld() {
    const hemi = new THREE.HemisphereLight('#e9f4ff', '#345332', 2.0);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff4dc', 3.1);
    sun.position.set(-3.5, 8, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -7;
    sun.shadow.camera.right = 7;
    sun.shadow.camera.top = 7;
    sun.shadow.camera.bottom = -7;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 22;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const grassMap = makeGrassTexture();
    const grass = new THREE.MeshStandardMaterial({ map: grassMap, roughness: 0.96, color: '#77a765' });
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(28, 28), grass);
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.set(0, -0.012, -3);
    pitch.receiveShadow = true;
    this.scene.add(pitch);

    const stripeMat = new THREE.MeshStandardMaterial({ color: '#8ab779', roughness: 1, transparent: true, opacity: 0.3 });
    for (let i = -6; i <= 6; i += 2) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 22), stripeMat);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(i * 1.45, -0.006, -2.5);
      this.scene.add(stripe);
    }

    const lineMat = new THREE.MeshStandardMaterial({ color: '#f0f3e9', roughness: 0.85 });
    const line = (x, z, w, d) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), lineMat);
      m.position.set(x, 0.004, z);
      this.scene.add(m);
      return m;
    };
    const goalMarkings = new THREE.Group();
    goalMarkings.position.set(worldX(0.82), 0, GOAL_Z);
    goalMarkings.rotation.y = GOAL_ANGLE;
    this.scene.add(goalMarkings);
    const goalLine = (x, z, w, d) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), lineMat);
      m.position.set(x, 0.004, z);
      goalMarkings.add(m);
    };
    goalLine(0, 0.05, 4.25, 0.035);
    goalLine(-2.1, 1.15, 0.035, 2.25);
    goalLine(2.1, 1.15, 0.035, 2.25);
    goalLine(0, 2.25, 4.25, 0.035);
    line(-0.35, 2.25, 0.035, 5.2);
    line(5.1, 2.25, 0.035, 5.2);

    this.buildGoal(lineMat);
    this.buildStands();
  }

  buildGoal(lineMat) {
    const group = new THREE.Group();
    group.position.set(worldX(0.82), 0, GOAL_Z);
    group.rotation.y = GOAL_ANGLE;
    this.scene.add(group);
    this.goal = group;
    const postMat = new THREE.MeshStandardMaterial({ color: '#fafcf8', roughness: 0.32, metalness: 0.08 });
    const radius = 0.045;
    const width = 3.0;
    const height = 2.0;
    const depth = 0.72;
    const post = (a, b) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 16), postMat);
      setSegment(m, new THREE.Vector3(...a), new THREE.Vector3(...b));
      m.castShadow = true;
      group.add(m);
    };
    post([-width / 2, 0, 0], [-width / 2, height, 0]);
    post([width / 2, 0, 0], [width / 2, height, 0]);
    post([-width / 2, height, 0], [width / 2, height, 0]);
    post([-width / 2, 0, -depth], [-width / 2, height * 0.83, -depth]);
    post([width / 2, 0, -depth], [width / 2, height * 0.83, -depth]);
    post([-width / 2, height, 0], [-width / 2, height * 0.83, -depth]);
    post([width / 2, height, 0], [width / 2, height * 0.83, -depth]);

    const points = [];
    const addLine = (a, b) => points.push(...a, ...b);
    for (let i = 0; i <= 18; i++) {
      const x = lerp(-width / 2, width / 2, i / 18);
      addLine([x, 0, -depth], [x, height * 0.83, -depth]);
      addLine([x, height, 0], [x, height * 0.83, -depth]);
    }
    for (let i = 0; i <= 12; i++) {
      const y = lerp(0, height * 0.83, i / 12);
      addLine([-width / 2, y, -depth], [width / 2, y, -depth]);
      addLine([-width / 2, y, 0], [-width / 2, y * 1.2, -depth]);
      addLine([width / 2, y, 0], [width / 2, y * 1.2, -depth]);
    }
    const netGeo = new THREE.BufferGeometry();
    netGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const net = new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({ color: '#d6e0dc', transparent: true, opacity: 0.52 }));
    group.add(net);

    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 24), lineMat);
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(-1.0, 0.009, 2.4);
    this.scene.add(spot);
  }

  buildStands() {
    const concrete = new THREE.MeshStandardMaterial({ color: '#36444c', roughness: 0.94 });
    for (let row = 0; row < 4; row++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(18, 0.55 + row * 0.5, 1.15), concrete);
      step.position.set(0, 0.2 + row * 0.25, -5.6 - row * 0.8);
      this.scene.add(step);
    }

    const crowdGeo = new THREE.BoxGeometry(0.12, 0.24, 0.12);
    const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const count = 480;
    const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, count);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const palette = ['#d7dce2', '#d66b55', '#537fa7', '#d4b85c', '#597d65', '#8c6c91'];
    let seed = 41;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < count; i++) {
      const row = i % 4;
      const x = -8.4 + (i % 120) * 0.142 + (random() - 0.5) * 0.04;
      const y = 0.7 + row * 0.52 + random() * 0.12;
      const z = -5.45 - row * 0.8;
      matrix.makeTranslation(x, y, z);
      crowd.setMatrixAt(i, matrix);
      color.set(palette[Math.floor(random() * palette.length)]);
      crowd.setColorAt(i, color);
    }
    this.scene.add(crowd);

    const boardMap = makeBoardTexture();
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(10.5, 0.65),
      new THREE.MeshStandardMaterial({ map: boardMap, roughness: 0.7, emissive: '#0b2535', emissiveIntensity: 0.22 }),
    );
    board.position.set(0, 0.52, -4.96);
    this.scene.add(board);

    const poleMat = new THREE.MeshStandardMaterial({ color: '#53636b', metalness: 0.65, roughness: 0.4 });
    const lampMat = new THREE.MeshStandardMaterial({ color: '#f5f2db', emissive: '#fff4cf', emissiveIntensity: 1.2 });
    for (const x of [-6.8, 6.8]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 5.4, 10), poleMat);
      pole.position.set(x, 2.7, -5.1);
      this.scene.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.35, 0.18), lampMat);
      lamp.position.set(x, 5.25, -5.0);
      this.scene.add(lamp);
    }
  }

  buildBall() {
    const map = makeBallTexture();
    const material = new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 0.008, roughness: 0.54 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 32, 20), material);
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.ballRing = new THREE.Mesh(
      new THREE.TorusGeometry(BALL_RADIUS * 1.55, 0.012, 8, 48),
      new THREE.MeshBasicMaterial({ color: '#ffe276', transparent: true, opacity: 0.75 }),
    );
    this.ballRing.rotation.x = Math.PI / 2;
    this.scene.add(this.ballRing);
  }

  draw({ game, pose, settings, now }) {
    const started = performance.now();
    this.player.root.visible = !!pose?.visible;
    if (pose?.visible) {
      this.player.root.position.set(worldX(game.layout.bodyX / game.layout.width), 0, PLAYER_Z);
      this.player.update(pose, game, now);
    }

    this.keeper.root.visible = !!settings.keeper && !!game.difficulty.keeper;
    if (this.keeper.root.visible) {
      const offset = (game.keeper.x - game.layout.goal.cx) / game.layout.goal.width;
      const position = goalWorldPoint(offset * 2.4, 0.18);
      this.keeper.root.position.set(position.x, 0, position.z);
      this.keeper.update(null, game, now, game.keeper.dive);
    }

    const b = game.ball;
    const sx = b.state === BALL_FLYING ? b.drawX : b.x;
    const p = b.state === BALL_FLYING ? clamp(b.z, 0, 1) : 0;
    const targetZ = b.state === BALL_FLYING
      ? goalPlaneZ(worldX(b.aimX / game.layout.width))
      : GOAL_Z;
    this.ball.position.set(worldX(sx / game.layout.width), BALL_RADIUS + (b.h || 0), lerp(PLAYER_Z, targetZ, easeInOutCubic(p)));
    this.ball.rotation.x += 0.04 + (b.vz || 0) * 0.025;
    this.ball.rotation.z -= 0.025 + (b.vz || 0) * 0.02;
    this.ball.visible = !(b.state === 'dead' && b.deadFor > 0.2);
    this.ballRing.visible = b.state === BALL_READY;
    if (this.ballRing.visible) {
      const pulse = 1 + Math.sin(now / 260) * 0.08;
      this.ballRing.position.set(this.ball.position.x, 0.018, this.ball.position.z);
      this.ballRing.scale.setScalar(pulse);
      this.ballRing.material.opacity = 0.58 + Math.sin(now / 260) * 0.2;
    }

    this.renderer.render(this.scene, this.camera);
    const elapsed = performance.now() - started;
    this.frameMs = this.frameMs ? lerp(this.frameMs, elapsed, 0.08) : elapsed;
    this.stats = {
      frameMs: this.frameMs,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
    };
  }
}

function createPlayer(scene, kit) {
  const root = new THREE.Group();
  scene.add(root);
  const skin = new THREE.MeshStandardMaterial({ color: '#c98f6b', roughness: 0.72 });
  const shirt = new THREE.MeshStandardMaterial({ color: kit.shirt, roughness: 0.78 });
  const shorts = new THREE.MeshStandardMaterial({ color: kit.shorts, roughness: 0.82 });
  const socks = new THREE.MeshStandardMaterial({ color: kit.socks, roughness: 0.76 });
  const shoe = new THREE.MeshStandardMaterial({ color: '#e6e8e8', roughness: 0.48 });
  const sole = new THREE.MeshStandardMaterial({ color: '#20262b', roughness: 0.72 });
  const hair = new THREE.MeshStandardMaterial({ color: '#251d1a', roughness: 0.9 });
  const eye = new THREE.MeshStandardMaterial({ color: '#171719', roughness: 0.45 });

  const add = (geometry, material, position, scale) => {
    const m = new THREE.Mesh(geometry, material);
    if (position) m.position.set(...position);
    if (scale) m.scale.set(...scale);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const ball = (r, material, position, scale) => add(new THREE.SphereGeometry(r, 18, 12), material, position, scale);
  const segment = (radius, material) => add(new THREE.CylinderGeometry(radius * 0.88, radius, 1, 12), material);

  const torso = add(new THREE.CapsuleGeometry(0.19, 0.28, 6, 16), shirt, [0, 1.17, 0], [0.9, 1, 1.22]);
  const hips = add(new THREE.CapsuleGeometry(0.17, 0.12, 5, 14), shorts, [0, 0.88, 0], [0.95, 0.9, 1.2]);
  add(new THREE.CylinderGeometry(0.065, 0.075, 0.13, 14), skin, [0, 1.46, 0]);
  const head = new THREE.Group();
  head.position.set(0, 1.62, 0);
  root.add(head);
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.135, 24, 18), skin);
  headMesh.scale.set(0.9, 1.12, 0.96);
  headMesh.castShadow = true;
  head.add(headMesh);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.137, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.48), hair);
  hairCap.scale.set(0.91, 1.12, 0.97);
  hairCap.position.y = 0.006;
  head.add(hairCap);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.027, 0.075, 12), skin);
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(0.132, 0.008, 0.015);
  head.add(nose);
  const eyeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), eye);
  eyeMesh.position.set(0.088, 0.042, 0.111);
  head.add(eyeMesh);
  const ear = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), skin);
  ear.scale.set(0.7, 1.1, 0.55);
  ear.position.set(-0.012, 0, 0.13);
  head.add(ear);

  const limbs = {};
  for (const side of ['L', 'R']) {
    const z = side === 'L' ? 0.13 : -0.13;
    limbs[side] = {
      z,
      thigh: segment(0.074, skin),
      shortLeg: segment(0.091, shorts),
      shin: segment(0.057, skin),
      sock: segment(0.06, socks),
      knee: ball(0.065, skin),
      upperArm: segment(0.047, skin),
      sleeve: segment(0.068, shirt),
      foreArm: segment(0.042, skin),
      elbow: ball(0.045, skin),
      hand: ball(0.052, skin, null, [0.8, 1.15, 0.75]),
      shoe: add(new THREE.CapsuleGeometry(0.055, 0.15, 5, 12), shoe),
      sole: add(new THREE.BoxGeometry(0.23, 0.025, 0.12), sole),
    };
    limbs[side].shoe.rotation.z = Math.PI / 2;
  }

  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const placeSegment = (mesh, a, b) => setSegment(mesh, a, b);
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
    const lean = 0.12 + active * 0.9;
    const bob = Math.sin(now / 420) * 0.006;
    torso.position.set(lean * 0.12, 1.17 + bob, 0);
    torso.rotation.z = -lean * 0.13;
    hips.position.y = 0.88 + bob;
    head.position.set(lean * 0.22, 1.62 + bob, 0);
    root.rotation.z = dive * 0.65;

    for (const side of ['L', 'R']) {
      const part = limbs[side];
      const lift = side === 'L' ? liftL : liftR;
      const z = part.z;
      const hip = v(0, 0.9 + bob, z);
      const knee = v(lift * 1.05, 0.5 + lift * 0.35 + bob, z);
      const ankle = v(lift * 2.15, 0.11 + lift * 1.15 + bob, z);
      const shortEnd = hip.clone().lerp(knee, 0.52);
      placeSegment(part.shortLeg, hip, shortEnd);
      placeSegment(part.thigh, shortEnd, knee);
      part.knee.position.copy(knee);
      const sockStart = knee.clone().lerp(ankle, 0.46);
      placeSegment(part.shin, knee, sockStart);
      placeSegment(part.sock, sockStart, ankle);
      part.shoe.position.set(ankle.x + 0.08, ankle.y - 0.045, z);
      part.sole.position.set(ankle.x + 0.08, ankle.y - 0.092, z);

      const sideSign = side === 'L' ? 1 : -1;
      const shoulder = v(lean * 0.1, 1.36 + bob, z * 1.65);
      const elbow = v(-active * 0.45 * sideSign + 0.025, 1.07 + active * 0.25 + bob, z * 1.72);
      const wrist = v(-active * 0.65 * sideSign + 0.07, 0.82 + active * 0.45 + bob, z * 1.65);
      const sleeveEnd = shoulder.clone().lerp(elbow, 0.42);
      placeSegment(part.sleeve, shoulder, sleeveEnd);
      placeSegment(part.upperArm, sleeveEnd, elbow);
      placeSegment(part.foreArm, elbow, wrist);
      part.elbow.position.copy(elbow);
      part.hand.position.copy(wrist);
    }
  };
  return { root, update };
}

function setSegment(mesh, a, b) {
  const direction = b.clone().sub(a);
  const length = Math.max(direction.length(), 0.001);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
}

function worldX(normalized) {
  return (normalized - 0.5) * WORLD_WIDTH;
}

function goalWorldPoint(x, z) {
  return {
    x: worldX(0.82) + x * Math.cos(GOAL_ANGLE) + z * Math.sin(GOAL_ANGLE),
    z: GOAL_Z - x * Math.sin(GOAL_ANGLE) + z * Math.cos(GOAL_ANGLE),
  };
}

function goalPlaneZ(x) {
  return GOAL_Z - Math.tan(GOAL_ANGLE) * (x - worldX(0.82));
}

function makeGrassTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#789d68';
  ctx.fillRect(0, 0, 256, 256);
  let seed = 19;
  for (let i = 0; i < 9000; i++) {
    seed = (seed * 16807) % 2147483647;
    const x = seed % 256;
    seed = (seed * 16807) % 2147483647;
    const y = seed % 256;
    const light = 70 + (seed % 40);
    ctx.fillStyle = `rgba(${light},${light + 45},${light - 10},0.22)`;
    ctx.fillRect(x, y, 1, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(18, 18);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeBallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eeeede';
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#202426';
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 9; col++) {
      const x = col * 64 + (row % 2) * 32;
      const y = 28 + row * 66;
      polygon(ctx, x, y, 14, 5, -Math.PI / 2);
      ctx.fill();
      ctx.strokeStyle = '#8c918e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 14, y);
      ctx.lineTo(x + 31, y + 12);
      ctx.moveTo(x - 14, y);
      ctx.lineTo(x - 31, y - 12);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeBoardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#102f42';
  ctx.fillRect(0, 0, 1024, 96);
  ctx.fillStyle = '#e4edf0';
  ctx.font = '700 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FAMILY CUP  ·  家庭足球场  ·  FAMILY CUP', 512, 50);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function polygon(ctx, x, y, r, sides, rotation) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
