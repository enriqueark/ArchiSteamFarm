export const RATE_LIMIT_POLICY = {
  general: {
    max: 60,
    timeWindow: "1 minute"
  },
  authLogin: {
    max: 5,
    timeWindow: "1 minute"
  },
  rouletteBet: {
    max: 10,
    timeWindow: "1 second"
  },
  minesBet: {
    max: 5,
    timeWindow: "1 second"
  }
} as const;
