import { clamp, easeInOutCubic, lerp, rand, TAU } from './utils.js';
import { BALL_FLYING, BALL_READY } from './game.js';
import { AvatarRenderer } from './avatar.js';
import { PaperCutRenderer } from './papercut.js';
import { Soccer3DRenderer } from './scene3d.js';

const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif';

const COLORS = ['#ffd43b', '#ff922b', '#ff6b6b', '#4dabf7', '#51cf66', '#e599f7', '#ffffff'];

export class Renderer {
  constructor(canvas, canvas3d) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scene3d = new Soccer3DRenderer(canvas3d);
    this.W = 1280;
    this.H = 720;
    this.dpr = 1;
    this.personCanvas = document.createElement('canvas');
    this.pctx = this.personCanvas.getContext('2d');
    this.avatar = new AvatarRenderer();
    this.papercut = new PaperCutRenderer();
    this.goal = { cx: 640, baseY: 330, width: 340, height: 226 };
    this.fx = {
      particles: [],
      texts: [],
      ring: null,
      shake: 0,
      flash: 0,
      flashColor: '#ffffff',
    };
    this.time = 0;
    this.ball = { x: 0, y: 0, r: 34, spin: 0, ground: 0, scale: 1 };
  }

  resize(cssW, cssH, dpr = 1) {
    this.W = Math.max(320, Math.round(cssW));
    this.H = Math.max(240, Math.round(cssH));
    this.dpr = Math.min(dpr || 1, 2);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    const goalH = clamp(this.H * 0.3, 120, 560);
    const goalW = goalH * 1.55;
    this.baseGoal = {
      cx: this.W / 2,
      baseY: this.H * 0.4,
      width: Math.min(goalW, this.W * 0.56),
      height: goalH,
    };
    this.goal = { ...this.baseGoal };
    this.personCanvas.width = Math.round(this.W * 0.8);
    this.personCanvas.height = Math.round(this.H * 0.8);
    this.papercut.resize(this.W, this.H);
    this.scene3d.resize(this.W, this.H, this.dpr);
  }

  layoutFor(personHeight, sideView = false) {
    const ballR = clamp(personHeight * 0.072, 16, 54);
    const sideHeight = clamp(this.H * 0.29, 110, 360);
    const goal = sideView
      ? {
          cx: this.W * 0.82,
          baseY: this.H * 0.66,
          width: Math.min(sideHeight * 1.15, this.W * 0.24),
          height: sideHeight,
        }
      : { ...this.baseGoal };
    return {
      width: this.W,
      height: this.H,
      ballRadius: ballR,
      personHeight,
      bodyX: this.W * (sideView ? 0.23 : 0.5),
      groundY: this.H * 0.9,
      sideView,
      goal,
    };
  }

  cameraMapping(videoW, videoH, mode = 'cover') {
    const scale =
      mode === 'contain'
        ? Math.min(this.W / videoW, this.H / videoH)
        : Math.max(this.W / videoW, this.H / videoH);
    const w = videoW * scale;
    const h = videoH * scale;
    return {
      x: (this.W - w) / 2,
      y: (this.H - h) / 2,
      width: w,
      height: h,
      mirror: true,
    };
  }

  addEvent(ev, game) {
    const t = this.time;
    switch (ev.type) {
      case 'kick': {
        this.ringAt(ev.x, ev.y, ev.power);
        this.burst(ev.x, ev.y, 18, ['#ffffff', '#ffe066'], 380);
        this.fx.shake = Math.min(14, 6 + ev.power * 10);
        break;
      }
      case 'goal': {
        this.confetti(this.W / 2, this.H * 0.22, 120);
        this.text(ev.x, ev.y - this.goal.height * 0.35, ev.bonus > 0 ? `好球 +${1 + ev.bonus}` : '进球啦 +1', '#ffe066', 52);
        this.fx.flash = 0.55;
        this.fx.flashColor = '#fff3bf';
        this.fx.shake = 10;
        break;
      }
      case 'save':
        this.text(this.goal.cx, this.goal.baseY - this.goal.height * 0.55, '被扑住了', '#74c0fc', 42);
        this.burst(ev.x ?? this.goal.cx, ev.y ?? this.goal.baseY, 12, ['#74c0fc', '#ffffff'], 260);
        break;
      case 'post':
        this.text(this.goal.cx, this.goal.baseY - this.goal.height * 0.7, '打门柱！', '#ffd8a8', 46);
        this.burst(ev.x ?? this.goal.cx, ev.y ?? this.goal.baseY, 14, ['#ffffff', '#ffd8a8'], 320);
        break;
      case 'miss':
        this.text(this.goal.cx, this.goal.baseY - this.goal.height * 0.6, ev.overBar ? '飞过横梁' : '偏出啦', '#ffa8a8', 42);
        break;
      case 'ready':
        this.burst(game.ball.x, game.ball.y, 10, ['#69db7c', '#ffffff'], 200);
        break;
      case 'perfect':
        this.text(ev.x, ev.y - 60, '完美力度！', '#ffa94d', 40);
        break;
      default:
        break;
    }
    if (ev.type === 'timeup') this.confetti(this.W / 2, this.H * 0.3, 90);
    void t;
  }

  ringAt(x, y, power) {
    this.fx.ring = { x, y, power, t: 0 };
  }

  burst(x, y, n, colors, speed) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const v = rand(speed * 0.35, speed);
      this.fx.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 60,
        g: 900,
        life: rand(0.3, 0.7),
        age: 0,
        size: rand(2, 5),
        color: colors[(Math.random() * colors.length) | 0],
        kind: 'spark',
      });
    }
  }

  confetti(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * 0.85, -Math.PI * 0.15);
      const v = rand(240, 760);
      this.fx.particles.push({
        x: x + rand(-80, 80),
        y: y + rand(-40, 40),
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        g: 620,
        life: rand(1.4, 2.6),
        age: 0,
        size: rand(5, 11),
        color: COLORS[(Math.random() * COLORS.length) | 0],
        rot: rand(0, TAU),
        vrot: rand(-9, 9),
        kind: 'confetti',
      });
    }
  }

  text(x, y, str, color, size) {
    this.fx.texts.push({ x, y, str, color, size, age: 0, life: 1.4 });
  }

  update(dt) {
    this.time += dt;
    for (const p of this.fx.particles) {
      p.age += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot = (p.rot ?? 0) + (p.vrot ?? 0) * dt;
      if (p.kind === 'confetti') {
        p.vx *= 0.99;
        p.vy = Math.min(p.vy, 520);
      }
    }
    this.fx.particles = this.fx.particles.filter((p) => p.age < p.life);
    for (const t of this.fx.texts) t.age += dt;
    this.fx.texts = this.fx.texts.filter((t) => t.age < t.life);
    this.fx.shake *= Math.pow(0.002, dt);
    this.fx.flash = Math.max(0, this.fx.flash - dt * 2.2);
    if (this.fx.ring) {
      this.fx.ring.t += dt;
      if (this.fx.ring.t > 0.6) this.fx.ring = null;
    }
  }

  draw(scene) {
    const { game, pose, settings, debug, now, camera, demo } = scene;
    const ctx = this.ctx;
    const use3d = settings.avatar === '3d';
    this.goal = game.layout.goal;
    this.sideView = !!game.layout.sideView;
    this.scene3d.setVisible(use3d);
    if (use3d) this.scene3d.draw(scene);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);

    const shake = this.fx.shake;
    const sx = shake > 0.4 ? rand(-shake, shake) : 0;
    const sy = shake > 0.4 ? rand(-shake, shake) : 0;
    ctx.save();
    ctx.translate(sx, sy);

    this.updateBallState(game);
    if (!use3d) {
      this.drawBackdrop(ctx, camera, demo, settings);
      this.drawStands(ctx);
      this.drawPitch(ctx);
      this.drawGoal(ctx, game, settings);
      this.drawPerson(ctx, pose, camera, settings, demo);
      this.drawBall(ctx, game, now);
    }
    this.drawRing(ctx);
    this.drawParticles(ctx);
    this.drawTexts(ctx);
    this.drawHints(ctx, game, pose);
    if (debug) this.drawDebug(ctx, game, pose, camera);
    ctx.restore();

    if (this.fx.flash > 0.01) {
      ctx.globalAlpha = this.fx.flash * 0.55;
      ctx.fillStyle = this.fx.flashColor;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalAlpha = 1;
    }
    this.drawVignette(ctx);
  }

  drawBackdrop(ctx, camera, demo, settings) {
    const { W, H } = this;
    if (camera?.frame && !demo && settings?.avatar === 'real') {
      ctx.save();
      ctx.fillStyle = '#05070b';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 0.5;
      this.drawFrame(ctx, camera);
      ctx.globalAlpha = 1;
      ctx.restore();
      ctx.fillStyle = 'rgba(6, 12, 20, 0.55)';
      ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#12253f');
      g.addColorStop(0.5, '#1b3a5a');
      g.addColorStop(1, '#0d1b2a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawFrame(ctx, camera) {
    const { frame, mapping } = camera;
    const w = mapping?.width ?? this.W;
    const h = mapping?.height ?? this.H;
    const x = mapping?.x ?? 0;
    const y = mapping?.y ?? 0;
    if (mapping?.mirror) {
      ctx.save();
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(frame, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(frame, x, y, w, h);
    }
  }

  drawStands(ctx) {
    const { W, H } = this;
    const horizon = H * 0.335;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#0a1830');
    sky.addColorStop(0.62, '#12375c');
    sky.addColorStop(1, '#1d5480');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon);

    for (let i = 0; i < 4; i++) {
      const x = W * (0.14 + i * 0.24);
      const g = ctx.createRadialGradient(x, H * 0.02, 2, x, H * 0.02, H * 0.42);
      g.addColorStop(0, 'rgba(226, 245, 255, 0.30)');
      g.addColorStop(1, 'rgba(226, 245, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, -10);
      ctx.lineTo(x + H * 0.13, horizon);
      ctx.lineTo(x - H * 0.13, horizon);
      ctx.closePath();
      ctx.fill();
    }

    const standTop = horizon * 0.6;
    ctx.fillStyle = '#0f2740';
    ctx.fillRect(0, standTop, W, horizon - standTop);
    for (let row = 0; row < 5; row++) {
      const y = standTop + (row + 0.5) * ((horizon - standTop) / 5);
      for (let i = 0; i < 46; i++) {
        const x = ((i + (row % 2) * 0.5) / 46) * W + rand(-1, 1);
        const c = COLORS[(i * 7 + row * 3) % COLORS.length];
        ctx.globalAlpha = 0.35 + (row / 5) * 0.35;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, 2.2 + row * 0.5, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    const adY = standTop - H * 0.055;
    ctx.fillStyle = '#102b45';
    ctx.fillRect(0, adY, W, H * 0.055);
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0.5, adY, W - 1, H * 0.055);
    ctx.font = `700 ${Math.round(H * 0.024)}px ${FONT}`;
    ctx.fillStyle = 'rgba(190, 230, 255, 0.7)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = '★ 家庭足球场 · FAMILY CUP ★';
    for (let i = 0; i < 3; i++) {
      ctx.fillText(label, W * (0.17 + i * 0.33), adY + H * 0.028);
    }
  }

  drawPitch(ctx) {
    const { W, H } = this;
    const horizon = H * 0.335;
    const g = ctx.createLinearGradient(0, horizon, 0, H);
    g.addColorStop(0, '#2f7d4f');
    g.addColorStop(0.45, '#2f9e50');
    g.addColorStop(1, '#38b45c');
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon, W, H - horizon);

    const stripes = 9;
    for (let i = 0; i < stripes; i++) {
      if (i % 2 === 0) continue;
      const y0 = horizon + ((H - horizon) / stripes) * i;
      const y1 = horizon + ((H - horizon) / stripes) * (i + 1);
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fillRect(0, y0, W, y1 - y0);
    }

    const depth = H * 0.06;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(2, H * 0.004);
    const goal = this.goal;
    const boxW = goal.width * 1.75;
    ctx.beginPath();
    ctx.moveTo(goal.cx - boxW / 2, goal.baseY + depth * 2.4);
    ctx.lineTo(goal.cx + boxW / 2, goal.baseY + depth * 2.4);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(goal.cx - goal.width * 1.1, goal.baseY + depth * 5.2);
    ctx.lineTo(goal.cx - goal.width * 0.75, goal.baseY + depth * 1.1);
    ctx.moveTo(goal.cx + goal.width * 1.1, goal.baseY + depth * 5.2);
    ctx.lineTo(goal.cx + goal.width * 0.75, goal.baseY + depth * 1.1);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(goal.cx, goal.baseY + distanceToGround(this.H, goal.baseY), boxW * 0.9, H * 0.06, 0, Math.PI, TAU);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(goal.cx, goal.baseY + H * 0.2, W * 0.004, H * 0.006, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, H - H * 0.05, W, H * 0.05);
  }

  drawGoal(ctx, game, settings) {
    const { cx, baseY, width, height } = this.goal;
    const x0 = cx - width / 2;
    const x1 = cx + width / 2;
    const yTop = baseY - height;
    const inset = width * 0.09;
    const rise = height * 0.1;

    ctx.save();
    ctx.fillStyle = 'rgba(4, 18, 26, 0.72)';
    ctx.beginPath();
    ctx.moveTo(x0, yTop);
    ctx.lineTo(x1, yTop);
    ctx.lineTo(x1 - inset, yTop - rise);
    ctx.lineTo(x0 + inset, yTop - rise);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(220, 245, 255, 0.30)';
    ctx.lineWidth = 1;
    const cols = 12;
    for (let i = 1; i < cols; i++) {
      const t = i / cols;
      ctx.beginPath();
      ctx.moveTo(lerp(x0, x1, t), yTop);
      ctx.lineTo(lerp(x0 + inset, x1 - inset, t), yTop - rise);
      ctx.stroke();
    }
    const rows = 8;
    for (let i = 1; i < rows; i++) {
      const t = i / rows;
      ctx.beginPath();
      ctx.moveTo(x0, lerp(yTop, baseY, t));
      ctx.lineTo(x1, lerp(yTop, baseY, t));
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(220, 245, 255, 0.16)';
    for (let i = -rows; i < cols + rows; i++) {
      ctx.beginPath();
      ctx.moveTo(x0 + i * (width / cols), yTop);
      ctx.lineTo(x0 + (i + inset / (width / cols)) * (width / cols), baseY);
      ctx.stroke();
    }

    if (settings.keeper !== false) this.drawKeeper(ctx, game);

    const postW = Math.max(6, width * 0.028);
    ctx.strokeStyle = '#f8fbff';
    ctx.lineWidth = postW;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(180, 230, 255, 0.65)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(x0, baseY + postW);
    ctx.lineTo(x0, yTop);
    ctx.lineTo(x1, yTop);
    ctx.lineTo(x1, baseY + postW);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  drawKeeper(ctx, game) {
    const g = this.goal;
    if (!game.difficulty.keeper) return;
    const k = game.keeper;
    const cx = clamp(k.x, g.cx - g.width * 0.55, g.cx + g.width * 0.55);
    const scale = g.height / 2.4;
    const bodyH = g.height * 0.5;
    const baseY = g.baseY - g.height * 0.02;
    const dive = clamp(k.dive ?? 0, -1, 1);
    const lift = Math.abs(dive) * g.height * 0.16;

    ctx.save();
    ctx.translate(cx, baseY - lift);
    ctx.rotate(dive * 0.42);
    ctx.scale(scale, scale);

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 30, 7, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#ffd43b';
    ctx.beginPath();
    ctx.roundRect(-15, -58, 30, 48, 10);
    ctx.fill();

    ctx.fillStyle = '#ff922b';
    ctx.beginPath();
    ctx.roundRect(-15, -58, 30, 14, 7);
    ctx.fill();

    ctx.fillStyle = '#ffe3c2';
    ctx.beginPath();
    ctx.arc(0, -70, 13, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#495057';
    ctx.beginPath();
    ctx.arc(0, -74, 13, Math.PI, TAU);
    ctx.fill();

    ctx.strokeStyle = '#ffd43b';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-12, -50);
    ctx.lineTo(-26, -78 + dive * 8);
    ctx.moveTo(12, -50);
    ctx.lineTo(26, -78 - dive * 8);
    ctx.stroke();

    ctx.fillStyle = '#e9ecef';
    ctx.beginPath();
    ctx.arc(-28, -80 + dive * 8, 8, 0, TAU);
    ctx.arc(28, -80 - dive * 8, 8, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = '#343a40';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-7, -12);
    ctx.lineTo(-12, 4);
    ctx.moveTo(7, -12);
    ctx.lineTo(12, 4);
    ctx.stroke();
    ctx.restore();
  }

  drawPerson(ctx, pose, camera, settings, demo) {
    void demo;
    if (!pose?.visible) return;
    if (settings?.avatar === 'cartoon') {
      this.avatar.draw(ctx, pose, this.time);
      if (settings.showSkeleton) this.drawSkeleton(ctx, pose, 'rgba(120, 255, 220, 0.35)');
      return;
    }
    if (settings?.avatar === 'stylized') {
      const drawn = this.papercut.draw(ctx, pose, camera, this.W, this.H);
      if (!drawn) this.drawSkeleton(ctx, pose, 'rgba(247, 237, 215, 0.9)', true);
      else if (settings.showSkeleton) this.drawSkeleton(ctx, pose, 'rgba(247, 237, 215, 0.4)');
      return;
    }
    if (pose.mask && camera) {
      const off = this.personCanvas;
      const octx = this.pctx;
      const s = off.width / this.W;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, off.width, off.height);
      const mapping = camera.mapping;
      const w = mapping.width * s;
      const h = mapping.height * s;
      const x = mapping.x * s;
      const y = mapping.y * s;
      if (mapping.mirror) {
        octx.save();
        octx.translate(x + w, y);
        octx.scale(-1, 1);
        octx.drawImage(camera.frame, 0, 0, w, h);
        octx.restore();
      } else {
        octx.drawImage(camera.frame, x, y, w, h);
      }
      octx.globalCompositeOperation = 'destination-in';
      if (mapping.mirror) {
        octx.save();
        octx.translate(x + w, y);
        octx.scale(-1, 1);
        octx.drawImage(pose.mask, 0, 0, w, h);
        octx.restore();
      } else {
        octx.drawImage(pose.mask, x, y, w, h);
      }
      octx.globalCompositeOperation = 'source-over';

      const t = pose.transform;
      ctx.save();
      ctx.filter = 'drop-shadow(0 0 14px rgba(110, 240, 210, 0.55))';
      if (t && Math.abs(t.s - 1) > 0.002) {
        ctx.translate(t.ax, t.ay);
        ctx.scale(t.s, t.s);
        ctx.translate(-t.ax, -t.ay);
      }
      ctx.drawImage(off, 0, 0, this.W, this.H);
      ctx.filter = 'none';
      ctx.restore();
      if (settings.showSkeleton) this.drawSkeleton(ctx, pose, 'rgba(120, 255, 220, 0.55)');
    } else {
      this.drawSkeleton(ctx, pose, 'rgba(110, 240, 210, 0.95)', true);
    }
  }

  drawSkeleton(ctx, pose, color, glow = false) {
    const pts = pose.points;
    if (!pts || pts.length === 0) return;
    const links = [
      [11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
      [24, 26], [26, 28], [28, 30], [28, 32], [30, 32], [11, 13], [13, 15], [12, 14], [14, 16],
    ];
    const h = pose.personHeight || 400;
    ctx.save();
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 22;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(4, h * 0.022);
    ctx.lineCap = 'round';
    for (const [a, b] of links) {
      const p = pts[a];
      const q = pts[b];
      if (!p || !q || (p.v ?? 1) < 0.4 || (q.v ?? 1) < 0.4) continue;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  updateBallState(game) {
    const b = game.ball;
    if (b.state === BALL_FLYING) {
      this.ball.x = b.drawX;
      this.ball.y = b.drawY;
      this.ball.r = b.drawR;
      this.ball.spin = b.spin ?? 0;
      const p = clamp(b.z, 0, 1);
      this.ball.ground = lerp(b.startY, this.goal.baseY, easeInOutCubic(p));
      this.ball.shadowScale = lerp(1, 0.45, p);
    } else {
      this.ball.x = b.x;
      this.ball.y = b.y;
      this.ball.r = b.r;
      this.ball.spin = b.spin ?? 0;
      this.ball.ground = b.y + b.r * 0.8;
      this.ball.shadowScale = 1;
    }
  }

  drawBall(ctx, game, now) {
    const b = this.ball;
    const r = b.r;
    if (game.ball.state === 'dead' && game.ball.deadFor > 0.2) return;

    ctx.save();
    const shadowW = r * 1.15 * (b.shadowScale ?? 1);
    ctx.fillStyle = `rgba(0,0,0,${0.28 * (b.shadowScale ?? 1)})`;
    ctx.beginPath();
    ctx.ellipse(b.x, b.ground + r * 0.12, shadowW, shadowW * 0.3, 0, 0, TAU);
    ctx.fill();

    if (game.ball.state === BALL_READY) {
      const pulse = 1 + Math.sin((now ?? 0) / 260) * 0.05;
      ctx.strokeStyle = `rgba(255, 224, 102, ${0.5 + Math.sin((now ?? 0) / 260) * 0.25})`;
      ctx.lineWidth = Math.max(3, r * 0.09);
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * 1.55 * pulse, 0, TAU);
      ctx.stroke();
    }

    ctx.translate(b.x, b.y);
    ctx.rotate(b.spin * 0.35);

    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.1);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.75, '#f1f3f5');
    g.addColorStop(1, '#ced4da');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#212529';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + Math.PI / 5;
      const px = Math.cos(a) * r * 0.56;
      const py = Math.sin(a) * r * 0.56;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const aa = (k / 5) * TAU + a;
        const rr = r * 0.2;
        const x = px + Math.cos(aa) * rr;
        const y = py + Math.sin(aa) * rr;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.2, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = Math.max(1.5, r * 0.045);
    ctx.beginPath();
    ctx.arc(0, 0, r - 1, 0, TAU);
    ctx.stroke();

    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-r * 0.32, -r * 0.38, r * 0.22, r * 0.13, -0.6, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawRing(ctx) {
    const ring = this.fx.ring;
    if (!ring) return;
    const t = ring.t / 0.6;
    const r = 30 + t * 110;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.strokeStyle = ring.power > 0.82 ? '#ffa94d' : '#ffe066';
    ctx.lineWidth = 8 * (1 - t) + 2;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  drawParticles(ctx) {
    for (const p of this.fx.particles) {
      const a = clamp(1 - p.age / p.life, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawTexts(ctx) {
    for (const t of this.fx.texts) {
      const k = t.age / t.life;
      const pop = k < 0.18 ? 0.6 + (k / 0.18) * 0.55 : 1.15 - Math.min(0.15, (k - 0.18) * 0.4);
      ctx.save();
      ctx.globalAlpha = clamp(1 - Math.max(0, k - 0.65) / 0.35, 0, 1);
      ctx.translate(t.x, t.y - k * 34);
      ctx.scale(pop, pop);
      ctx.font = `900 ${t.size}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(6, t.size * 0.16);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(t.str, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, 0, 0);
      ctx.restore();
    }
  }

  drawHints(ctx, game, pose) {
    if (game.ball.state !== BALL_READY || game.finished) return;
    const now = this.time * 1000;
    const b = this.ball;
    const bob = Math.sin(now / 300) * 6;
    ctx.save();
    ctx.font = `900 ${Math.round(clamp(b.r * 0.95, 20, 40))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.fillStyle = '#fff9db';
    const label = pose?.visible ? '踢球！' : '站到画面里';
    ctx.strokeText(label, b.x, b.y - b.r * 2.1 + bob);
    ctx.fillText(label, b.x, b.y - b.r * 2.1 + bob);
    ctx.restore();
  }

  drawDebug(ctx, game, pose, camera) {
    const feet = pose?.feet ?? [];
    ctx.save();
    ctx.font = `600 14px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(12, this.H - 118, 360, 106);
    ctx.fillStyle = '#e9ecef';
    const minSpeed = game.difficulty.minFootSpeed * (pose?.personHeight ?? 400);
    const lines = [
      `detect ${pose?.detectMs?.toFixed(1) ?? '-'}ms  ${pose?.delegate ?? '-'}  fps ${Math.round(1 / Math.max(0.001, this.frameDt ?? 0.016))}`,
      `person ${Math.round(pose?.personHeight ?? 0)}px  ground ${Math.round(pose?.groundY ?? 0)}`,
      `min kick speed ${Math.round(minSpeed)}px/s  shots ${game.shots}`,
      `L ${Math.round(feet[0]?.speed ?? 0)}  R ${Math.round(feet[1]?.speed ?? 0)}`,
    ];
    lines.forEach((line, i) => ctx.fillText(line, 20, this.H - 94 + i * 22));
    for (const f of feet) {
      const hot = f.speed > minSpeed;
      ctx.fillStyle = hot ? '#ff6b6b' : '#74c0fc';
      ctx.beginPath();
      ctx.arc(f.x, f.y, 10, 0, TAU);
      ctx.fill();
    }
    if (game.ball.state === BALL_READY) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(this.ball.x, this.ball.y, this.ball.r * 1.95 + (pose?.personHeight ?? 400) * 0.06, 0, TAU);
      ctx.stroke();
    }
    void camera;
    ctx.restore();
  }

  drawVignette(ctx) {
    const { W, H } = this;
    const g = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  tick(dt) {
    this.frameDt = dt;
    this.update(dt);
  }
}

function distanceToGround(H, baseY) {
  return Math.max(6, H * 0.035);
}
