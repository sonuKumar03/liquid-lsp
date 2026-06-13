import liquidjs from 'liquidjs';

const { Liquid } = liquidjs;

export type { Liquid, Token, TagToken } from 'liquidjs';

export function createLiquidEngine(): InstanceType<typeof Liquid> {
  return new Liquid();
}
