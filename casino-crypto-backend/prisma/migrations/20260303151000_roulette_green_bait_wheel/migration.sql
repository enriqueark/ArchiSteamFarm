-- Roulette update: add GREEN and BAIT bet types.
ALTER TYPE "RouletteBetType" ADD VALUE IF NOT EXISTS 'GREEN';
ALTER TYPE "RouletteBetType" ADD VALUE IF NOT EXISTS 'BAIT';
