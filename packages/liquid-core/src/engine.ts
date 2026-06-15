import { Liquid } from 'liquidjs';

export type {
  Liquid,
  Token,
  TagToken,
  Template as TagTemplate,
  Value as ValueTemplate,
} from 'liquidjs';

export {
  parseAssign,
  checkValidJSON,
  checkAtleastOneDynamicTableAssignPresent,
  Tag,
  IfTag,
  UnlessTag,
  ForTag,
  ComputeColumnTag,
} from 'liquidjs';

/** Creates the shared LiquidJS engine used across LSP features. */
export function createLiquidEngine(): Liquid {
  return new Liquid();
}
