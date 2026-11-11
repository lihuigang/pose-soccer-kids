import * as THREE from 'three';
import { BALL_FLYING, BALL_READY } from './game.js';
import { clamp, easeInOutCubic, lerp } from './utils.js';
import { createPlayer, setSegment } from './player3d.js';

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
    this.scene.background = makeSkyTexture();
    this.scene.fog = new THREE.Fog('#c3d9de', 16, 36);
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

    const crowdGeo = new THREE.BoxGeometry(0.13, 0.23, 0.13);
    const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.88 });
    const headGeo = new THREE.SphereGeometry(0.052, 10, 8);
    const headMat = new THREE.MeshStandardMaterial({ roughness: 0.78 });
    const count = 480;
    const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, count);
    const heads = new THREE.InstancedMesh(headGeo, headMat, count);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const palette = ['#d7dce2', '#d66b55', '#537fa7', '#d4b85c', '#597d65', '#8c6c91', '#e8e3d5'];
    const skinTones = ['#e8b892', '#d9a074', '#c98a5f', '#f0c9a5', '#a9714d'];
    let seed = 41;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < count; i++) {
      const row = i % 4;
      const x = -8.4 + (i % 120) * 0.142 + (random() - 0.5) * 0.04;
      const baseY = 0.475 + row * 0.5;
      const bodyH = 0.5 + random() * 0.16;
      const bodyY = baseY + 0.115 * bodyH;
      const z = -5.45 - row * 0.8;
      matrix.makeScale(1, bodyH, 1);
      matrix.setPosition(x, bodyY, z);
      crowd.setMatrixAt(i, matrix);
      color.set(palette[Math.floor(random() * palette.length)]);
      crowd.setColorAt(i, color);
      const headY = baseY + 0.23 * bodyH + 0.04;
      matrix.makeTranslation(x, headY, z);
      heads.setMatrixAt(i, matrix);
      color.set(skinTones[Math.floor(random() * skinTones.length)]);
      heads.setColorAt(i, color);
    }
    this.scene.add(crowd, heads);

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
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#12354b');
  grad.addColorStop(1, '#0b2534');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 64);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  for (let x = -64; x < 1024; x += 96) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 46, 0);
    ctx.lineTo(x + 66, 0);
    ctx.lineTo(x + 20, 64);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#ffd34d';
  ctx.fillRect(0, 0, 1024, 3);
  ctx.fillRect(0, 61, 1024, 3);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f2f6f5';
  ctx.font = '800 26px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('家 庭 足 球 场', 300, 33);
  ctx.fillStyle = '#9fd4e4';
  ctx.font = '700 19px "SF Pro Display", "Helvetica Neue", sans-serif';
  ctx.fillText('F A M I L Y   C U P', 470, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5f9bc4');
  grad.addColorStop(0.45, '#8cb8d2');
  grad.addColorStop(0.78, '#c6dde3');
  grad.addColorStop(1, '#e2ecec');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 8, 256);
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
