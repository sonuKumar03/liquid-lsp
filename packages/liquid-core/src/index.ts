export {
  createLiquidEngine,
  type Liquid,
  type Token,
  type TopLevelToken,
  type TagToken,
  type TagTemplate,
  type ValueTemplate,
  parseAssign,
  checkValidJSON,
  checkAtleastOneDynamicTableAssignPresent,
  Tag,
  IfTag,
  UnlessTag,
  ForTag,
  ComputeColumnTag,
} from './engine.js';

export { lexical } from './lexical.js';

export {
  ASSIGN_KEY_VALUE_PATTERN,
  CAPTURE_VARIABLE_PATTERN,
  FOR_LOOP_VARIABLE_PATTERN,
  parseAssignKeyValue,
  parseCaptureVariable,
  parseForLoopVariable,
  type AssignKeyValue,
} from './tag-parsing.js';

export {
  parseAssignKeyValueWithOffsets,
  parseCaptureVariableWithOffsets,
  parseForLoopVariableWithOffsets,
  type ParsedAssignWithOffsets,
  type ParsedCaptureWithOffsets,
  type ParsedForWithOffsets,
} from './chevrotain-parser.js';

export { parseOutputValue } from './value-parsing.js';

export {
  Tokenizer,
  TokenKind,
  TagTokenClass,
  tokenizeTopLevel,
  tokenizeTopLevelSafe,
} from './tokenize.js';

export {
  CONDITIONAL_TAG_NAMES,
  INLINE_MATH_OPERATOR_REGEX,
  SINGLE_EQUALS_ASSIGNMENT_REGEX,
  AUTO_CLOSE_BLOCK_TAG_NAMES,
  BLOCK_OPEN_TAG_NAMES,
  BLOCK_CLOSE_TAG_NAMES,
  BLOCK_MIDDLE_TAG_NAMES,
  EXPECTED_FILTER_NAME_MESSAGE,
  CONDITIONAL_ASSIGNMENT_MESSAGE,
  INLINE_MATH_OPERATOR_MESSAGE,
  hasSingleEqualsAssignment,
  hasInlineMathOperators,
  isConditionalTagLine,
} from './liquid-syntax.js';

export {
  LIQUID_TAG_NAMES,
  LIQUID_FILTER_METAS,
  LIQUID_FILTER_NAMES,
  isKnownLiquidTag,
  isKnownLiquidFilter,
  getTagDocumentation,
  getFilterDocumentation,
  type LiquidFilterMeta,
  type LiquidTagName,
} from './metadata.js';

export {
  cleanErrorMessage,
  getWordAtPosition,
  getEnhancedErrorMessage,
  getClosestFilter,
  getClosestTag,
  convertToLiquidMath,
} from './utils.js';

export {
  extractComputationIR,
  type ComputationIRClosingTag,
  type ComputationIRDocument,
  type ComputationIRError,
  type ComputationIRExpressionToken,
  type ComputationIRFilter,
  type ComputationIRNode,
  type ComputationIROriginal,
  type ComputationIROutputNode,
  type ComputationIRPosition,
  type ComputationIRSource,
  type ComputationIRTagNode,
  type ComputationIRTextNode,
} from './computation-ir.js';
