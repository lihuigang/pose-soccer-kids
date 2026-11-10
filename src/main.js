import { SoccerGame } from './game.js';
import { Renderer } from './render.js';
import { PoseTracker, transformPose } from './pose.js';
import { SyntheticCamera } from './synthetic.js';
import { Sfx } from './audio.js';
import { sideViewPose } from './avatar.js';
import { DEFAULT_SETTINGS, DIFFICULTY } from './config.js';
import { clamp } from './utils.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const STORAGE_KEY = 'kid-soccer-settings-v4';

const settings = { ...DEFAULT_SETTINGS, ...readSettings() };
if (params.get('debug') === '1') settings.debug = true;

const state = {
  mode: 'home',
  source: 'demo',
  tracker: null,
  stream: null,
  video: $('video'),
  demo: new SyntheticCamera(),
  photo: null,
  photoSample: null,
  photoAt: 0,
  lastTs: 0,
  paused: false,
  hint: '',
  personScale: 1,
};

const game = new SoccerGame({
  difficulty: settings.difficulty,
  mode: settings.mode,
  timeLimit: settings.mode === 'timed' ? 60 : 90,
});
const renderer = new Renderer($('stage'), $('stage3d'));
const sfx = new Sfx();
const hud = {
  root: $('hud'),
  score: $('score'),
  scorePill: document.querySelector('.score-pill'),
  streak: $('streak'),
  streakValue: $('streak-value'),
  timer: $('timer'),
  timerValue: $('timer-value'),
  hint: $('hint'),
  badge: $('demo-badge'),
};

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage may be blocked in private mode */
  }
}

function resize() {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  if (state.source === 'photo' && state.photo) {
    state.photoSample = null;
  }
}

window.addEventListener('resize', resize);

function show(id) {
  $(id).classList.remove('hidden');
}

function hide(id) {
  $(id).classList.add('hidden');
}

function setLoading(text) {
  $('loading-text').textContent = text;
}

function showError(err) {
  hide('loading');
  hide('start');
  const map = {
    NotAllowedError: '浏览器没有获得摄像头权限。请点击地址栏左侧的相机图标允许访问，然后重试。',
    NotFoundError: '没有找到摄像头。可以先用演示模式体验游戏。',
    NotReadableError: '摄像头正被其他软件占用（例如视频会议），关闭后再试。',
    SecurityError: '需要通过 https 或 localhost 打开页面才能使用摄像头。',
  };
  $('error-text').textContent = map[err?.name] || `打开摄像头失败：${err?.message || err}`;
  show('error');
  state.mode = 'error';
}

function mappingFor(width, height, mode = 'cover') {
  const m = renderer.cameraMapping(width || 1280, height || 720, mode);
  m.mirror = settings.mirror;
  return m;
}

function buildScene(now) {
  let pose = null;
  let camera = null;

  if (state.source === 'demo') {
    const mapping = mappingFor(state.demo.width, state.demo.height);
    pose = state.demo.sample(now, mapping);
    camera = { frame: state.demo.frame, mapping };
  } else if (state.source === 'photo' && state.photo) {
    const mapping = mappingFor(state.photo.naturalWidth, state.photo.naturalHeight, 'contain');
    if (!state.photoSample || now - state.photoAt > 500) {
      state.photoAt = now;
      state.photoSample = detectOnFrame(state.photo, now, mapping);
    }
    pose = state.photoSample
      ? { ...state.photoSample, mapping, mask: state.tracker?.state.mask, maskSize: state.tracker?.state.maskSize }
      : null;
    camera = { frame: state.photo, mapping };
  } else if (state.source === 'camera') {
    const video = state.video;
    if (video.videoWidth) {
      const mapping = mappingFor(video.videoWidth, video.videoHeight);
      pose = state.tracker?.detect(video, now, { mapping }) ?? null;
      camera = { frame: video, mapping };
    }
  }

  return { pose, camera };
}

function detectOnFrame(frame, now, mapping) {
  if (!state.tracker) return null;
  return state.tracker.detect(frame, now, { mapping });
}

function applyGameSettings() {
  game.setDifficulty(settings.difficulty);
  game.difficulty.keeper = settings.keeper && game.difficulty.keeper;
  game.setMode(settings.mode, settings.mode === 'timed' ? 60 : 90);
}

const PERSON_HEIGHT_RATIO = 0.56;

function fitPose(pose, dt) {
  if (!pose?.visible || !pose.personHeight) return pose;
  const target = clamp((renderer.H * PERSON_HEIGHT_RATIO) / pose.personHeight, 0.5, 1);
  const k = 1 - Math.pow(0.02, dt);
  state.personScale += (target - state.personScale) * k;
  return transformPose(pose, state.personScale);
}

function update(dt, now) {
  const scene = buildScene(now);
  const fittedPose = fitPose(scene.pose, dt);
  const sideView = settings.avatar === '3d' || settings.avatar === 'cartoon';
  const personHeight = fittedPose?.visible ? fittedPose.personHeight : renderer.H * 0.55;
  const layout = renderer.layoutFor(personHeight, sideView);
  const pose = sideView ? sideViewPose(fittedPose, layout) : fittedPose;

  game.setLayout(layout);
  game.setInput({
    visible: !!pose?.visible,
    feet: pose?.feet ?? [],
    bodyX: pose?.bodyX ?? layout.bodyX,
    groundY: pose?.groundY ?? layout.groundY,
    personHeight,
  });

  if (state.mode === 'playing' && !state.paused) {
    const events = game.update(dt);
    for (const ev of events) {
      renderer.addEvent(ev, game);
      playEvent(ev);
      if (ev.type === 'goal') {
        hud.scorePill.classList.remove('pop');
        void hud.scorePill.offsetWidth;
        hud.scorePill.classList.add('pop');
      }
      if (ev.type === 'timeup') endRound();
    }
  } else {
    game.ball.r = game.layout.ballRadius;
    const anchor = game.ballAnchor();
    const k = 1 - Math.pow(0.02, dt);
    game.ball.x += (anchor.x - game.ball.x) * k;
    game.ball.y += (anchor.y - game.ball.y) * k;
  }

  renderer.draw({
    game,
    pose,
    camera: scene.camera,
    settings,
    debug: !!settings.debug,
    now,
    demo: state.source === 'demo',
  });

  updateHud(pose);
}

function playEvent(ev) {
  switch (ev.type) {
    case 'kick':
      sfx.kick(ev.power ?? 0.5);
      break;
    case 'goal':
      sfx.goal();
      if (ev.streak >= 10) sfx.speak('不可思议！你是足球明星！');
      else if (ev.streak >= 5) sfx.speak('帽子戏法！太厉害了！');
      else if (ev.streak >= 3) sfx.speak('连续进球，好棒！');
      else sfx.speak('进球啦');
      break;
    case 'save':
      sfx.save();
      break;
    case 'post':
      sfx.post();
      break;
    case 'miss':
      sfx.miss();
      sfx.speak('差一点点');
      break;
    case 'ready':
      sfx.ready();
      break;
    case 'timeup':
      sfx.timeup();
      break;
    default:
      break;
  }
}

let lastScore = -1;
let lastStreak = -1;
let lastTimer = -1;

function updateHud(pose) {
  if (state.mode === 'home' || state.mode === 'loading' || state.mode === 'error') {
    hud.root.classList.add('hidden');
    hud.hint.classList.add('hidden');
    hud.badge.classList.toggle('hidden', state.source !== 'demo');
    return;
  }
  hud.root.classList.remove('hidden');
  hud.badge.classList.toggle('hidden', state.source !== 'demo');

  if (game.score !== lastScore) {
    hud.score.textContent = String(game.score);
    lastScore = game.score;
  }
  if (game.streak >= 2) {
    hud.streak.classList.remove('hidden');
    if (game.streak !== lastStreak) hud.streakValue.textContent = String(game.streak);
  } else {
    hud.streak.classList.add('hidden');
  }
  lastStreak = game.streak;

  if (settings.mode === 'timed') {
    hud.timer.classList.remove('hidden');
    const t = Math.ceil(game.timeLeft);
    if (t !== lastTimer) {
      hud.timerValue.textContent = String(t);
      hud.timer.classList.toggle('low', t <= 10);
      lastTimer = t;
    }
  } else {
    hud.timer.classList.add('hidden');
  }

  let hint = '';
  if (state.mode === 'playing' && !state.paused && pose) {
    if (!pose.visible) hint = '请站到画面中间，让全身出现在画面里';
    else if (pose.personHeight < renderer.H * 0.22) hint = '再走近一点，效果会更好哦';
  }
  if (hint !== state.hint) {
    state.hint = hint;
    hud.hint.textContent = hint;
    hud.hint.classList.toggle('hidden', !hint);
  }
}

function frame(ts) {
  requestAnimationFrame(frame);
  const prev = state.lastTs || ts;
  const dt = clamp((ts - prev) / 1000, 0.001, 0.05);
  state.lastTs = ts;
  renderer.tick(dt);
  update(dt, ts);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCountdown() {
  state.mode = 'countdown';
  hide('start');
  hide('settings');
  hide('results');
  show('countdown');
  const num = $('countdown-num');
  for (const label of ['3', '2', '1', '开始！']) {
    num.textContent = label;
    num.style.animation = 'none';
    void num.offsetWidth;
    num.style.animation = '';
    sfx.tick();
    await wait(label === '开始！' ? 520 : 760);
  }
  hide('countdown');
}

async function beginRound() {
  applyGameSettings();
  game.reset();
  lastScore = -1;
  lastStreak = -1;
  lastTimer = -1;
  state.paused = false;
  await runCountdown();
  state.mode = 'playing';
  sfx.resume();
  if (settings.mode === 'timed') sfx.speak('六十秒挑战，开始');
}

function endRound() {
  state.mode = 'over';
  const acc = game.shots ? Math.round((game.goals / game.shots) * 100) : 0;
  $('results-title').textContent = game.mode === 'timed' ? '时间到！' : '本轮结束';
  $('results-score').textContent = String(game.score);
  $('results-goals').textContent = String(game.goals);
  $('results-shots').textContent = String(game.shots);
  $('results-acc').textContent = `${acc}%`;
  $('results-streak').textContent = String(game.bestStreak);
  $('results-note').textContent = noteFor(game);
  show('results');
}

function noteFor(g) {
  if (g.goals >= 10) return '哇！你是今天的金靴射手 🏆';
  if (g.goals >= 5) return '太厉害了，再来一轮吧！';
  if (g.goals >= 1) return '进球啦，继续保持！';
  return '别着急，多试几次一定能进球 ⚽';
}

async function startCamera() {
  state.mode = 'loading';
  hide('start');
  hide('error');
  show('loading');
  setLoading('正在打开摄像头…');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
    state.stream = stream;
    state.video.srcObject = stream;
    await state.video.play();

    setLoading('正在加载姿态识别模型…');
    const tracker = new PoseTracker({ onStatus: (t) => setLoading(t) });
    await tracker.init();
    state.tracker = tracker;
    state.source = 'camera';
    hide('loading');
    await beginRound();
  } catch (err) {
    console.error(err);
    state.mode = 'error';
    showError(err);
  }
}

async function startDemo() {
  state.mode = 'loading';
  hide('start');
  show('loading');
  setLoading('正在准备演示…');
  stopCamera();
  state.source = 'demo';
  await wait(320);
  hide('loading');
  await beginRound();
}

async function startPhoto(url) {
  state.mode = 'loading';
  hide('start');
  show('loading');
  setLoading('正在分析图片…');
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    state.photo = img;
    if (!state.tracker) {
      const tracker = new PoseTracker({ onStatus: (t) => setLoading(t) });
      await tracker.init();
      state.tracker = tracker;
    }
    state.source = 'photo';
    state.mode = 'playing';
    hide('loading');
    hide('start');
    show('hud');
    applyGameSettings();
    game.reset();
  } catch (err) {
    console.error(err);
    state.mode = 'error';
    showError(err);
  }
}

function stopCamera() {
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
    state.stream = null;
  }
}

function goHome() {
  state.mode = 'home';
  state.paused = false;
  hide('results');
  hide('settings');
  hide('countdown');
  hide('error');
  hide('loading');
  show('start');
  game.reset();
}

function bindSettingsUi() {
  const diffButtons = [...$('seg-difficulty').querySelectorAll('button')];
  const modeButtons = [...$('seg-mode').querySelectorAll('button')];
  const avatarButtons = [...$('seg-avatar').querySelectorAll('button')];
  const switches = {
    keeper: $('toggle-keeper'),
    sound: $('toggle-sound'),
    speech: $('toggle-speech'),
    mirror: $('toggle-mirror'),
    showSkeleton: $('toggle-skeleton'),
  };

  const refresh = () => {
    for (const b of diffButtons) b.classList.toggle('active', b.dataset.value === settings.difficulty);
    for (const b of modeButtons) b.classList.toggle('active', b.dataset.value === settings.mode);
    for (const b of avatarButtons) b.classList.toggle('active', b.dataset.value === settings.avatar);
    $('difficulty-note').textContent = DIFFICULTY[settings.difficulty]?.hint ?? '';
    for (const [key, el] of Object.entries(switches)) {
      el.setAttribute('aria-checked', String(!!settings[key]));
    }
    $('btn-sound').textContent = settings.sound ? '🔊' : '🔇';
    $('btn-sound').classList.toggle('muted', !settings.sound);
  };

  for (const b of diffButtons) {
    b.addEventListener('click', () => {
      settings.difficulty = b.dataset.value;
      saveSettings();
      applyGameSettings();
      refresh();
    });
  }
  for (const b of modeButtons) {
    b.addEventListener('click', () => {
      settings.mode = b.dataset.value;
      saveSettings();
      applyGameSettings();
      refresh();
    });
  }
  for (const b of avatarButtons) {
    b.addEventListener('click', () => {
      settings.avatar = b.dataset.value;
      renderer.avatar.reset();
      saveSettings();
      refresh();
    });
  }
  for (const [key, el] of Object.entries(switches)) {
    el.addEventListener('click', () => {
      settings[key] = !settings[key];
      saveSettings();
      refresh();
    });
  }

  $('btn-sound').addEventListener('click', () => {
    settings.sound = !settings.sound;
    sfx.enabled = settings.sound;
    saveSettings();
    refresh();
  });

  $('btn-settings').addEventListener('click', () => {
    if (state.mode === 'playing') state.paused = true;
    refresh();
    show('settings');
    hide('hud');
  });

  $('btn-close-settings').addEventListener('click', () => {
    hide('settings');
    show('hud');
    if (state.mode === 'playing') state.paused = false;
  });

  refresh();
}

function bindUi() {
  $('btn-start').addEventListener('click', () => {
    sfx.resume();
    startCamera();
  });
  $('btn-demo').addEventListener('click', () => {
    sfx.resume();
    startDemo();
  });
  $('btn-retry').addEventListener('click', () => startCamera());
  $('btn-error-demo').addEventListener('click', () => startDemo());
  $('btn-replay').addEventListener('click', () => {
    hide('results');
    beginRound();
  });
  $('btn-home').addEventListener('click', () => goHome());
  $('btn-fullscreen').addEventListener('click', toggleFullscreen);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    if (e.key === 'm' || e.key === 'M') {
      settings.sound = !settings.sound;
      sfx.enabled = settings.sound;
      saveSettings();
      $('btn-sound').textContent = settings.sound ? '🔊' : '🔇';
    }
    if (e.key === 'Escape') {
      if ($('settings').classList.contains('hidden')) {
        $('btn-settings').click();
      } else {
        $('btn-close-settings').click();
      }
    }
    if (e.key === 'd' || e.key === 'D') {
      if (state.source === 'demo') startCamera();
      else startDemo();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (state.mode !== 'playing') return;
    state.paused = document.hidden || !$('settings').classList.contains('hidden');
  });

  bindSettingsUi();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

function configureFromUrl() {
  if (params.get('difficulty')) settings.difficulty = params.get('difficulty');
  if (params.get('mode')) settings.mode = params.get('mode');
  sfx.enabled = settings.sound;
  sfx.speechEnabled = settings.speech;
}

function exposeTestApi() {
  window.__app = {
    game,
    renderer,
    settings,
    state,
    sfx,
    startDemo,
    startCamera,
    startPhoto,
    beginRound,
    forceKick(power = 0.6) {
      const h = game.layout.personHeight || renderer.H * 0.6;
      const minSpeed = game.difficulty.minFootSpeed * h;
      const speed = minSpeed * (0.85 + 1.9 * clamp(power, 0, 1));
      const anchor = game.ballAnchor();
      game.ball.x = anchor.x;
      game.ball.y = anchor.y;
      const events = [];
      game.fireKick(
        { id: 'R', x: game.layout.bodyX, y: game.layout.groundY, vx: 0, vy: -speed, speed },
        h,
        events,
      );
      for (const ev of events) {
        renderer.addEvent(ev, game);
        playEvent(ev);
      }
    },
    snapshot() {
      return {
        mode: state.mode,
        source: state.source,
        score: game.score,
        goals: game.goals,
        shots: game.shots,
        bestStreak: game.bestStreak,
        ballState: game.ball.state,
        visible: game.input.visible,
        personHeight: Math.round(game.layout.personHeight),
      };
    },
  };
}

async function boot() {
  configureFromUrl();
  resize();
  bindUi();
  exposeTestApi();
  document.body.addEventListener('pointerdown', () => sfx.resume(), { once: true });
  requestAnimationFrame(frame);

  const photo = params.get('photo');
  if (photo) {
    await startPhoto(photo);
  } else if (params.get('demo') === '1' || params.get('autostart') === 'demo') {
    await startDemo();
  } else if (params.get('autostart') === '1') {
    await startCamera();
  }
}

boot();
