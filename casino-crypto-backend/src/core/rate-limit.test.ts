import { describe, expect, it } from "vitest";

import { RATE_LIMIT_POLICY } from "./rate-limit";

describe("rate limit policy", () => {
  it("matches required production limits", () => {
    expect(RATE_LIMIT_POLICY.general).toEqual({ max: 60, timeWindow: "1 minute" });
    expect(RATE_LIMIT_POLICY.authLogin).toEqual({ max: 5, timeWindow: "1 minute" });
    expect(RATE_LIMIT_POLICY.rouletteBet).toEqual({ max: 10, timeWindow: "1 second" });
    expect(RATE_LIMIT_POLICY.minesBet).toEqual({ max: 5, timeWindow: "1 second" });
  });
});
