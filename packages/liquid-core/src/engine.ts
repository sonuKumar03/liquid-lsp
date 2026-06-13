import liquidjs from 'liquidjs';

const { Liquid } = liquidjs;

export type { Liquid, Token, TagToken } from 'liquidjs';

/** Creates the shared LiquidJS v3 computation engine used across LSP features. */
export function createLiquidEngine(): InstanceType<typeof Liquid> {
  return new Liquid();
}
