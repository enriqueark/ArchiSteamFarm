-- Add custom roulette bet types for the 15-slot wheel mode.
ALTER TYPE "RouletteBetType" ADD VALUE IF NOT EXISTS 'GREEN';
ALTER TYPE "RouletteBetType" ADD VALUE IF NOT EXISTS 'BAIT';
