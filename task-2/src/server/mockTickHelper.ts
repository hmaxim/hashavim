import { mulberry32, type Rng } from "./mockUpdater";

/** Fresh RNG for manual tick endpoint (not tied to the background loop). */
export function mulberry32LikeTick(): Rng {
  return mulberry32(Date.now() % 1_000_000);
}
