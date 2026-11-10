import { CHILD_HEIGHT_M, DIFFICULTY, GOAL_HEIGHT_M, GRAVITY } from './config.js';
import { clamp, dist, easeInOutCubic, gauss, lerp, moveTowards } from './utils.js';

export const BALL_READY = 'ready';
export const BALL_FLYING = 'flying';
export const BALL_DEAD = 'dead';

const BALL_RESPAWN_DELAY = 1.4;

export class SoccerGame {
  constructor({ difficulty = 'easy', mode = 'free', timeLimit = 90 } = {}) {
    this.mode = mode;
    this.timeLimit = timeLimit;
    this.setDifficulty(difficulty);
    this.layout = {
      width: 1280,
      height: 720,
      feetX: 640,
      groundY: 640,
      bodyX: 640,
      personHeight: 460,
      ballRadius: 34,
      goal: { cx: 640, baseY: 300, width: 420, height: 220 },
    };
    this.person = {
      visible: false,
      lostFor: 0,
      heightPx: 460,
      feet: [],
      bodyX: 640,
      groundY: 640,
    };
    this.timeLeft = mode === 'timed' ? timeLimit : Infinity;
    this.finished = false;
    this.ball = makeBall();
    this.keeper = { x: this.layout.goal.cx, targetX: this.layout.goal.cx, active: false, dive: 0 };
    this.footArmed = { L: -10, R: -10 };
    this.reset();
  }

  setDifficulty(key) {
    const preset = typeof key === 'string' ? (DIFFICULTY[key] ?? DIFFICULTY.easy) : key;
    this.difficulty = { ...preset };
  }

  setMode(mode, timeLimit = this.timeLimit) {
    const changed = this.mode !== mode || this.timeLimit !== timeLimit;
    this.mode = mode;
    this.timeLimit = timeLimit;
    if (changed) this.reset();
  }

  setLayout(layout) {
    Object.assign(this.layout, layout);
    this.layout.goal = { ...this.layout.goal, ...(layout.goal ?? {}) };
    this.ball.r = this.layout.ballRadius;
  }

  reset() {
    this.score = 0;
    this.goals = 0;
    this.shots = 0;
    this.saves = 0;
    this.misses = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.finished = false;
    this.timeLeft = this.mode === 'timed' ? this.timeLimit : Infinity;
    this.input = {
      visible: false,
      feet: [],
      bodyX: this.layout.bodyX,
      groundY: this.layout.groundY,
      personHeight: this.layout.personHeight,
    };
    this.ball = makeBall();
    const anchor = this.ballAnchor();
    this.ball.x = anchor.x;
    this.ball.y = anchor.y;
    this.footArmed = { L: -10, R: -10 };
    this.keeper = { x: this.layout.goal.cx, targetX: this.layout.goal.cx, active: false, dive: 0 };
  }

  setInput(input) {
    this.input = {
      visible: !!input.visible,
      feet: input.feet ?? [],
      bodyX: input.bodyX ?? this.input.bodyX,
      groundY: input.groundY ?? this.input.groundY,
      personHeight: input.personHeight ?? this.input.personHeight,
    };
    this.person.visible = this.input.visible;
    this.person.heightPx = clamp(
      this.input.personHeight || this.layout.personHeight,
      120,
      this.layout.height,
    );
    this.person.bodyX = this.input.bodyX;
    this.person.groundY = this.input.groundY;
    this.person.feet = this.input.feet;
    this.person.lostFor = this.input.visible ? 0 : this.person.lostFor + 1;
  }

  get feet() {
    return this.input.feet;
  }

  get ballScreen() {
    const b = this.ball;
    if (b.state === BALL_FLYING) return { x: b.drawX, y: b.drawY, r: b.drawR };
    return { x: b.x, y: b.y, r: b.r };
  }

  update(dt) {
    const events = [];
    dt = Math.min(dt, 0.05);
    this.clock = (this.clock ?? 0) + dt;

    if (this.finished) return events;

    if (this.mode === 'timed') {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) {
        this.finished = true;
        events.push({ type: 'timeup', score: this.score, goals: this.goals, shots: this.shots });
        return events;
      }
    }

    if (this.ball.state === BALL_READY) {
      this.updateReadyBall(dt, events);
    } else if (this.ball.state === BALL_FLYING) {
      this.updateFlight(dt, events);
    } else if (this.ball.state === BALL_DEAD) {
      this.ball.deadFor += dt;
      this.updateKeeper(dt);
      if (this.ball.deadFor >= BALL_RESPAWN_DELAY) {
        this.respawnBall(events);
      }
    }

    return events;
  }

  updateReadyBall(dt, events) {
    const b = this.ball;
    b.bob = (b.bob ?? 0) + dt;
    const feet = this.input.feet;
    const anchor = this.ballAnchor();
    b.x = lerp(b.x, anchor.x, 1 - Math.pow(0.001, dt));
    b.y = anchor.y + Math.sin(b.bob * 2.2) * (b.r * 0.04);
    b.spin += dt * 0.6;

    if (!this.input.visible || feet.length === 0) return;

    const personHeight = clamp(this.input.personHeight, 160, this.layout.height);
    const reach = b.r * 1.95 + personHeight * 0.06;
    const minSpeed = this.difficulty.minFootSpeed * personHeight;
    const now = this.clock ?? 0;
    const cooldown = this.difficulty.cooldown;

    for (const foot of feet) {
      const d = dist(foot.x, foot.y, b.x, b.y + b.r * 0.15);
      if (d <= reach * 1.3) this.footArmed[foot.id] = now;
    }

    let best = null;
    for (const foot of feet) {
      if (foot.speed < minSpeed) continue;
      const d = dist(foot.x, foot.y, b.x, b.y + b.r * 0.15);
      const armed = now - (this.footArmed[foot.id] ?? -10) < 0.3;
      if (d > reach && !armed) continue;
      if (best === null || foot.speed > best.speed) best = { ...foot, d };
    }
    if (!best) return;
    if (now - (b.lastKickAt ?? -10) < cooldown) return;

    b.lastKickAt = now;
    this.footArmed = { L: -10, R: -10 };
    this.fireKick(best, personHeight, events);
  }

  ballAnchor() {
    const groundY = this.input.groundY ?? this.layout.groundY;
    const bodyX = this.input.bodyX ?? this.layout.bodyX;
    const r = this.ball.r;
    const offset = this.layout.sideView ? (this.input.personHeight ?? this.layout.personHeight) * 0.3 : 0;
    const maxX = this.layout.sideView
      ? this.layout.goal.cx - this.layout.goal.width * 0.7 - r
      : this.layout.width - r * 1.4;
    return {
      x: clamp(bodyX + offset, r * 1.4, maxX),
      y: Math.min(groundY + r * 0.18, this.layout.height - r * 1.15),
    };
  }

  fireKick(foot, personHeight, events) {
    const b = this.ball;
    const goal = this.layout.goal;
    b.lastKickFoot = foot.id;
    const minSpeed = this.difficulty.minFootSpeed * personHeight;
    const power = clamp((foot.speed / minSpeed - 0.85) / 1.9, 0, 1);

    const lateral = clamp((foot.vx ?? 0) / (personHeight * 3.2), -1, 1);
    const spread = this.difficulty.aimSpread;
    const aimX = clamp(
      goal.cx + lateral * goal.width * 0.34 * spread * 2.6 + gauss() * goal.width * spread * 0.55,
      goal.cx - goal.width * 0.7,
      goal.cx + goal.width * 0.7,
    );

    b.state = BALL_FLYING;
    b.startX = b.x;
    b.startY = b.y;
    b.startR = b.r;
    b.aimX = aimX;
    b.z = 0;
    b.h = b.r / pxPerMeterAt(this.layout, 0) * 0.12;
    b.vz = lerp(0.62, 1.06, power);
    b.vh = lerp(2.4, this.difficulty.maxLaunchVh, power);
    b.power = power;
    b.bounces = 0;
    b.flightTime = 0;
    b.drawX = b.x;
    b.drawY = b.y;
    b.drawR = b.r;
    b.rollingSince = null;

    this.shots += 1;
    this.keeper.active = this.difficulty.keeper;
    this.keeper.x = goal.cx;
    this.keeper.targetX = goal.cx;
    this.keeper.dive = 0;
    if (this.keeper.active) {
      const guess = this.difficulty.keeperGuesses * goal.width;
      this.keeper.targetX = goal.cx + gauss() * guess;
    }

    events.push({
      type: 'kick',
      power,
      speed: foot.speed,
      foot: foot.id,
      x: b.x,
      y: b.y,
      aimX,
    });
    if (power > 0.82) events.push({ type: 'perfect', x: b.x, y: b.y });
  }

  updateKeeper(dt) {
    const goal = this.layout.goal;
    if (!this.difficulty.keeper) return;
    const speed = this.difficulty.keeperSpeed * goal.width;
    this.keeper.x = moveTowards(this.keeper.x, this.keeper.targetX, speed * dt);
    const offset = (this.keeper.x - goal.cx) / (goal.width / 2);
    this.keeper.dive = clamp(offset, -1, 1);
  }

  updateFlight(dt, events) {
    const b = this.ball;
    const goal = this.layout.goal;
    b.flightTime += dt;
    this.updateKeeper(dt);

    b.z += b.vz * dt;
    b.vh -= GRAVITY * dt;
    b.h += b.vh * dt;

    if (b.h <= 0) {
      b.h = 0;
      if (b.vh < -0.8) {
        b.vh = -b.vh * 0.42;
        b.vz *= 0.93;
        b.bounces += 1;
        events.push({ type: 'bounce', x: b.drawX, y: b.drawY, r: b.drawR });
      } else {
        b.vh = 0;
        b.rollingSince = b.rollingSince ?? b.flightTime;
      }
    }

    const pm0 = this.layout.personHeight / CHILD_HEIGHT_M;
    const pmGoal = goal.height / GOAL_HEIGHT_M;
    const p = clamp(b.z, 0, 1.2);
    const pm = lerp(pm0, pmGoal, Math.min(p, 1));
    const groundY = lerp(b.startY, goal.baseY, easeInOutCubic(p));
    b.drawX = lerp(b.startX, goal.cx + (b.aimX - goal.cx) * (1 - Math.pow(1 - p, 1.5)), Math.min(p, 1));
    b.drawY = groundY - b.h * pm;
    b.drawR = lerp(b.startR, b.startR * 0.55, Math.min(p, 1));

    if (b.z >= 0.55) {
      const needed = 0.55 * (1 / Math.max(0.08, b.vz));
      if (b.rollingSince !== null && b.flightTime - b.rollingSince > needed) b.vz = Math.max(b.vz, 0.42);
    }

    if (b.z >= 1) {
      this.resolveShot(events);
    } else if (b.flightTime > 6.5) {
      this.finishShot('miss', events, { reason: 'timeout' });
    }
  }

  resolveShot(events) {
    const b = this.ball;
    const goal = this.layout.goal;
    const halfW = goal.width / 2;
    const dx = b.aimX - goal.cx;
    const sidePostBand = b.drawR * 0.9;
    const barBand = 0.16;
    const underBar = b.h <= GOAL_HEIGHT_M;
    const insideWidth = Math.abs(dx) <= halfW;
    const onTarget = insideWidth && underBar;

    if (Math.abs(Math.abs(dx) - halfW) < sidePostBand && underBar) {
      this.finishShot('post', events, {
        x: goal.cx + Math.sign(dx) * halfW,
        y: goal.baseY - b.h * (goal.height / GOAL_HEIGHT_M),
      });
      return;
    }
    if (Math.abs(b.h - GOAL_HEIGHT_M) < barBand && insideWidth) {
      this.finishShot('post', events, { x: b.aimX, y: goal.baseY - goal.height, crossbar: true });
      return;
    }
    if (!onTarget) {
      this.finishShot('miss', events, {
        x: b.aimX,
        y: b.h > GOAL_HEIGHT_M ? goal.baseY - goal.height : goal.baseY,
        overBar: b.h > GOAL_HEIGHT_M,
      });
      return;
    }

    const keeperDist = Math.abs(this.keeper.x - b.aimX);
    const saved =
      this.difficulty.keeper &&
      b.h < 1.95 &&
      keeperDist < this.difficulty.keeperReach * goal.width + b.drawR * 0.9;
    if (saved) {
      this.finishShot('save', events, { x: this.keeper.x, y: goal.baseY });
      return;
    }
    this.finishShot('goal', events, {
      x: b.aimX,
      y: goal.baseY - Math.min(b.h, GOAL_HEIGHT_M) * (goal.height / GOAL_HEIGHT_M),
    });
  }

  finishShot(outcome, events, info = {}) {
    const b = this.ball;
    b.state = BALL_DEAD;
    b.deadFor = 0;
    b.outcome = outcome;

    if (outcome === 'goal') {
      this.goals += 1;
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      const bonus = this.streak >= 3 ? Math.min(3, Math.floor(this.streak / 3)) : 0;
      this.score += 1 + bonus;
      events.push({
        type: 'goal',
        x: info.x ?? b.drawX,
        y: info.y ?? b.drawY,
        streak: this.streak,
        bonus,
        score: this.score,
        power: b.power,
      });
    } else if (outcome === 'save') {
      this.saves += 1;
      this.streak = 0;
      events.push({ type: 'save', x: info.x, y: info.y });
    } else if (outcome === 'post') {
      this.streak = 0;
      events.push({ type: 'post', x: info.x, y: info.y, crossbar: !!info.crossbar });
    } else {
      this.misses += 1;
      this.streak = 0;
      events.push({
        type: 'miss',
        x: info.x ?? b.drawX,
        y: info.y ?? b.drawY,
        reason: info.reason ?? 'wide',
        overBar: !!info.overBar,
      });
    }
  }

  respawnBall(events) {
    const b = this.ball;
    Object.assign(b, makeBall());
    const anchor = this.ballAnchor();
    b.x = anchor.x;
    b.y = anchor.y;
    b.lastKickAt = this.clock;
    events.push({ type: 'ready', x: b.x, y: b.y });
  }
}

function makeBall() {
  return {
    state: BALL_READY,
    x: 0,
    y: 0,
    r: 34,
    z: 0,
    h: 0,
    vh: 0,
    vz: 0,
    spin: 0,
    bob: 0,
    power: 0,
    aimX: 0,
    startX: 0,
    startY: 0,
    startR: 34,
    drawX: 0,
    drawY: 0,
    drawR: 34,
    bounces: 0,
    bounceAge: 0,
    flightTime: 0,
    rollingSince: null,
    deadFor: 0,
    lastKickAt: -10,
    outcome: null,
  };
}

function pxPerMeterAt(layout, p) {
  return lerp(layout.personHeight / CHILD_HEIGHT_M, layout.goal.height / GOAL_HEIGHT_M, p);
}

