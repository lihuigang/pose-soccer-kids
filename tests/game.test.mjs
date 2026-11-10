import test from 'node:test';
import assert from 'node:assert/strict';
import { SoccerGame, BALL_READY, BALL_DEAD, BALL_FLYING } from '../src/game.js';

const LAYOUT = {
  width: 1280,
  height: 720,
  feetX: 640,
  groundY: 640,
  bodyX: 640,
  personHeight: 460,
  ballRadius: 34,
  goal: { cx: 640, baseY: 300, width: 420, height: 220 },
};
const STEP = 1 / 60;

function makeGame(overrides = {}) {
  const game = new SoccerGame({ difficulty: 'easy', ...overrides });
  game.setLayout(LAYOUT);
  return game;
}

function stand(game, y = 640) {
  game.setInput({
    visible: true,
    personHeight: 460,
    bodyX: 650,
    groundY: y,
    feet: [
      { id: 'L', x: 600, y, vx: 0, vy: 0, speed: 0 },
      { id: 'R', x: 700, y, vx: 0, vy: 0, speed: 0 },
    ],
  });
}

function swing(game, speed, { x = 660, y = 640, groundY = 640, vx = 0 } = {}) {
  game.setInput({
    visible: true,
    personHeight: 460,
    bodyX: x,
    groundY,
    feet: [{ id: 'R', x, y, vx, vy: -speed, speed }],
  });
}

function run(game, seconds, { input = null, stopOn = null } = {}) {
  const events = [];
  const frames = Math.ceil(seconds / STEP);
  for (let i = 0; i < frames; i++) {
    if (input) input(game);
    const batch = game.update(STEP);
    events.push(...batch);
    if (stopOn && batch.some((e) => stopOn.includes(e.type))) break;
  }
  return events;
}

function shoot(game, speed, opts = {}) {
  swing(game, speed, opts);
  return run(game, opts.seconds ?? 6, {
    stopOn: ['goal', 'miss', 'save', 'post', 'timeup'],
  });
}

const findEvent = (events, type) => events.find((e) => e.type === type);

test('slow foot near the ball does not kick', () => {
  const game = makeGame();
  swing(game, 300);
  const events = run(game, 1);
  assert.equal(game.shots, 0);
  assert.equal(game.ball.state, BALL_READY);
  assert.ok(!findEvent(events, 'kick'));
});

test('foot swinging through the ball kicks it', () => {
  const game = makeGame();
  swing(game, 1200);
  const events = game.update(STEP);
  assert.ok(findEvent(events, 'kick'), 'kick event emitted');
  assert.equal(game.shots, 1);
  assert.equal(game.ball.state, BALL_FLYING);
});

test('a kick that lands far from the ball does nothing', () => {
  const game = makeGame();
  swing(game, 2500, { x: 650, y: 300, groundY: 640 });
  run(game, 0.5);
  assert.equal(game.shots, 0);
});

test('cooldown prevents double kicks in the same swing', () => {
  const game = makeGame();
  swing(game, 1200);
  game.update(STEP);
  swing(game, 1200);
  game.update(STEP);
  assert.equal(game.shots, 1);
});

test('easy difficulty: a normal kick scores and increments the streak', () => {
  const game = makeGame();
  const events = shoot(game, 1000);
  assert.ok(findEvent(events, 'goal'), 'goal should be scored');
  assert.equal(game.goals, 1);
  assert.equal(game.score, 1);
  assert.equal(game.streak, 1);
});

test('ball respawns at the feet after a goal', () => {
  const game = makeGame();
  shoot(game, 1000);
  assert.equal(game.goals, 1);
  const events = run(game, 3, { input: stand });
  assert.equal(game.ball.state, BALL_READY);
  assert.ok(findEvent(events, 'ready'));
});

test('max power on normal flies over the bar', () => {
  const game = makeGame({ difficulty: 'normal' });
  const events = shoot(game, 2600);
  assert.equal(game.goals, 0);
  const miss = findEvent(events, 'miss');
  assert.ok(miss, 'miss event');
  assert.equal(miss.overBar, true);
});

test('pro keeper saves a central shot', (t) => {
  const original = Math.random;
  Math.random = () => 0.999999999;
  t.after(() => {
    Math.random = original;
  });
  const game = makeGame({ difficulty: 'pro' });
  const events = shoot(game, 1900);
  assert.ok(findEvent(events, 'save'), 'keeper should save a central shot');
  assert.equal(game.goals, 0);
  assert.equal(game.saves, 1);
});

test('weak shot still resolves instead of hanging', () => {
  const game = makeGame();
  const events = shoot(game, 540, { seconds: 8 });
  const resolved = events.some((e) => ['goal', 'miss', 'save', 'post'].includes(e.type));
  assert.ok(resolved, 'shot must resolve');
});

test('timed mode ends and reports stats', () => {
  const game = makeGame({ mode: 'timed', timeLimit: 1 });
  swing(game, 1000);
  const events = run(game, 1.6);
  assert.ok(findEvent(events, 'timeup'));
  assert.equal(game.finished, true);
});

test('no visible person means no kick', () => {
  const game = makeGame();
  game.setInput({ visible: false, feet: [], personHeight: 460, bodyX: 640, groundY: 640 });
  run(game, 1);
  assert.equal(game.shots, 0);
});

test('streak bonus awards extra points after three goals', () => {
  const game = makeGame();
  for (let i = 0; i < 4; i++) {
    shoot(game, 1000);
    assert.equal(game.ball.outcome, 'goal', `shot ${i + 1} should score`);
    run(game, 2, { input: stand, stopOn: ['ready'] });
  }
  assert.equal(game.goals, 4);
  assert.ok(game.score > game.goals, 'streak bonus should add points');
  assert.ok(game.bestStreak >= 4);
});

test('goal state ends in dead with a goal outcome inside the posts', () => {
  const game = makeGame();
  shoot(game, 1000);
  assert.equal(game.ball.state, BALL_DEAD);
  assert.equal(game.ball.outcome, 'goal');
});

test('side view places the ready ball between the person and goal', () => {
  const game = makeGame();
  game.setLayout({
    ...LAYOUT,
    sideView: true,
    bodyX: 294,
    groundY: 648,
    goal: { cx: 1050, baseY: 475, width: 248, height: 209 },
  });
  game.setInput({ visible: true, feet: [], bodyX: 294, groundY: 648, personHeight: 403 });
  const anchor = game.ballAnchor();
  assert.ok(anchor.x > 294);
  assert.ok(anchor.x < game.layout.goal.cx - game.layout.goal.width / 2);
});

test('side view shot travels from the person toward the goal', () => {
  const game = makeGame();
  game.setLayout({
    ...LAYOUT,
    sideView: true,
    bodyX: 294,
    groundY: 648,
    goal: { cx: 1050, baseY: 475, width: 248, height: 209 },
  });
  game.setInput({ visible: true, feet: [], bodyX: 294, groundY: 648, personHeight: 403 });
  game.ball.x = game.ballAnchor().x;
  game.ball.y = game.ballAnchor().y;
  const events = shoot(game, 1000, { x: 415, y: 640, groundY: 648 });
  const goal = findEvent(events, 'goal');
  assert.ok(goal);
  assert.ok(goal.x > 294);
  assert.ok(goal.x <= game.layout.goal.cx + game.layout.goal.width / 2);
});
