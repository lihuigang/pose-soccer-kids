export const GRAVITY = 9.8;
export const CHILD_HEIGHT_M = 1.15;
export const GOAL_HEIGHT_M = 2.44;
export const GOAL_WIDTH_M = 3.66;
export const BALL_RADIUS_M = 0.11;

export const DIFFICULTY = {
  easy: {
    key: 'easy',
    name: '萌新',
    hint: '随便踢都能进球',
    minFootSpeed: 1.15,
    maxLaunchVh: 6.4,
    aimSpread: 0.16,
    cooldown: 0.45,
    keeper: false,
    keeperReach: 0,
    keeperSpeed: 0,
    keeperGuesses: 0.45,
  },
  normal: {
    key: 'normal',
    name: '小将',
    hint: '守门员会扑救，注意力度',
    minFootSpeed: 1.7,
    maxLaunchVh: 8.2,
    aimSpread: 0.24,
    cooldown: 0.4,
    keeper: true,
    keeperReach: 0.1,
    keeperSpeed: 0.2,
    keeperGuesses: 0.32,
  },
  pro: {
    key: 'pro',
    name: '球星',
    hint: '守门员很灵活，用角度和力度破门',
    minFootSpeed: 2.2,
    maxLaunchVh: 9.2,
    aimSpread: 0.3,
    cooldown: 0.36,
    keeper: true,
    keeperReach: 0.15,
    keeperSpeed: 0.32,
    keeperGuesses: 0.16,
  },
};

export const DEFAULT_SETTINGS = {
  difficulty: 'easy',
  keeper: true,
  sound: true,
  speech: true,
  mirror: true,
  avatar: '3d',
  mode: 'free',
  timeLimit: 90,
  showSkeleton: false,
};
