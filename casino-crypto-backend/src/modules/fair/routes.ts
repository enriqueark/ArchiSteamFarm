import { FastifyPluginAsync } from "fastify";

import { requireAuth } from "../../core/auth";
import { isAppError } from "../../core/errors";
import { getRouletteFairPublicState, rotateRouletteFairSeed } from "../fairness/roulette";
import { getOrCreateProvablyFairState, rotateProvablyFairServerSeed } from "../mines/service";

const FAIRNESS_HASH_FORMULA = "sha256(serverSeed + ':' + clientSeed + ':' + nonce)";

export const fairRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/fair", { preHandler: requireAuth }, async (request, reply) => {
    const [roulette, mines] = await Promise.all([
      getRouletteFairPublicState(),
      getOrCreateProvablyFairState(request.user.sub)
    ]);

    return reply.send({
      formula: FAIRNESS_HASH_FORMULA,
      roulette,
      mines: {
        clientSeed: mines.clientSeed,
        nonce: mines.nonce,
        activeServerSeedHash: mines.activeServerSeedHash,
        revealedSeeds: mines.revealedSeeds
      }
    });
  });

  fastify.post("/fair/rotate-seed", { preHandler: requireAuth }, async (request, reply) => {
    const roulette = await rotateRouletteFairSeed();

    let mines: Awaited<ReturnType<typeof rotateProvablyFairServerSeed>> | null = null;
    let minesWarning: string | null = null;

    try {
      mines = await rotateProvablyFairServerSeed(request.user.sub);
    } catch (error) {
      if (isAppError(error) && error.code === "ACTIVE_MINES_GAMES_BLOCK_SEED_ROTATION") {
        minesWarning = "Mines seed rotation skipped because user has active mines games.";
      } else {
        throw error;
      }
    }

    return reply.send({
      formula: FAIRNESS_HASH_FORMULA,
      roulette,
      mines,
      minesWarning
    });
  });
};
