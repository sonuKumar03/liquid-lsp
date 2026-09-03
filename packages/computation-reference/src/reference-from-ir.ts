import type {
  ComputationIRDocument,
  ComputationIRNode,
  ComputationIRTagNode,
} from 'computation-ir';
import {
  parseReferenceProgram,
  type ReferenceProgram,
} from './reference-language.js';

function referenceExpression(expression: string): string {
  const trimmed = expression.trim();
  const filter = trimmed.match(
    /^(.+?)\s*\|\s*(plus|minus|add|subtract|times|divided_by|toCurrency|toDuration|sumArray|updateAttribute|updateTypeAttribute|concat|uniq|strip_html|strip)(?:\s*:\s*(.+))?$/,
  );
  if (!filter) return trimmed;
  const [, leftRaw, operator, rightRaw] = filter;
  const left = referenceExpression(leftRaw!.trim());
  const right = rightRaw ? referenceExpression(rightRaw.trim()) : undefined;
  if (
    operator === 'concat' ||
    operator === 'uniq' ||
    operator === 'strip_html' ||
    operator === 'strip'
  ) {
    return right !== undefined
      ? `${operator}(${left}, ${right})`
      : `${operator}(${left})`;
  }
  if (operator === 'sumArray') {
    if (!right) return `Sum(${left})`;
    const parts = rightRaw!.split(',').map((part) => part.trim());
    if (parts.length === 1) {
      return `Sum(GetColumn(${left}, ${parts[0]}))`;
    }
    const [column, ...defaults] = parts;
    if (
      column === '""' ||
      column === "''" ||
      column === 'undefined' ||
      column === 'null'
    ) {
      return `Sum(${left}, ${defaults.join(', ')})`;
    }
    return `Sum(GetColumn(${left}, ${column}), ${defaults.join(', ')})`;
  }
  if (operator === 'updateTypeAttribute')
    return `${operator}(${left}, ${right})`;
  if (operator === 'updateAttribute') return `${operator}(${left}, ${right})`;
  if (operator === 'toCurrency' || operator === 'toDuration')
    return `${operator}(${left}, ${right})`;
  if (operator === 'plus' || operator === 'add')
    return `Add(${left}, ${right})`;
  if (operator === 'minus' || operator === 'subtract')
    return `Subtract(${left}, ${right})`;
  if (operator === 'times') return `Multiply(${left}, ${right})`;
  if (operator === 'divided_by') return `Divide(${left}, ${right})`;
  return `${left} ${operator} ${right}`;
}

function parseAssignLiteral(expression: string): string {
  const trimmed = expression.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const unquoted = trimmed.slice(1, -1);
    try {
      const parsed = JSON.parse(unquoted);
      return JSON.stringify(parsed);
    } catch {
      // ignore
    }
  }
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed);
  } catch {
    return referenceExpression(trimmed);
  }
}

function assignmentSource(node: ComputationIRTagNode): string | undefined {
  if (
    node.name !== 'assign' &&
    node.name !== 'assignVar' &&
    node.name !== 'parseAssign'
  ) {
    return undefined;
  }
  const target =
    node.target ??
    (node.args.indexOf('=') >= 0
      ? node.args.slice(0, node.args.indexOf('=')).trim()
      : undefined);
  if (!target) return undefined;
  if (node.name === 'parseAssign') {
    return `${target} = ${parseAssignLiteral(node.expression)};`;
  }
  return `${target} = ${referenceExpression(node.expression)};`;
}

function simpleConditionalAssignmentSource(
  condition: string,
  children: ComputationIRNode[],
): string | undefined {
  const meaningful = children.filter((child) => child.kind !== 'text');
  const [thenNode, branch, otherwiseNode] = meaningful;
  if (
    !thenNode ||
    thenNode.kind !== 'tag' ||
    !branch ||
    branch.kind !== 'tag' ||
    branch.name !== 'else' ||
    !otherwiseNode ||
    otherwiseNode.kind !== 'tag'
  )
    return undefined;
  const assignmentNames = new Set(['assign', 'assignVar', 'parseAssign']);
  if (
    !assignmentNames.has(thenNode.name) ||
    !assignmentNames.has(otherwiseNode.name)
  )
    return undefined;
  if (!thenNode.target || thenNode.target !== otherwiseNode.target)
    return undefined;
  const pathCondition =
    /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[[^\]]+\])*$/;
  const conditionSource = pathCondition.test(condition.trim())
    ? `Exists(${condition.trim()})`
    : referenceExpression(condition);
  return `${thenNode.target} = If(${conditionSource}, ${referenceExpression(thenNode.expression)}, ${referenceExpression(otherwiseNode.expression)});`;
}

function conditionalSource(
  condition: string,
  children: ComputationIRNode[],
): string {
  const simple = simpleConditionalAssignmentSource(condition, children);
  if (simple) return simple;
  const middle = children.findIndex(
    (child) =>
      child.kind === 'tag' && (child.name === 'elsif' || child.name === 'else'),
  );
  const thenChildren = middle < 0 ? children : children.slice(0, middle);
  const branch = middle < 0 ? undefined : children[middle];
  const otherwiseChildren = middle < 0 ? [] : children.slice(middle + 1);
  const thenSource = thenChildren.map(nodeSource).join(' ');
  const otherwiseSource = otherwiseChildren.map(nodeSource).join(' ');
  const branchSource =
    branch?.kind === 'tag' && branch.name === 'elsif'
      ? conditionalSource(branch.expression, otherwiseChildren)
      : otherwiseSource;
  return `if ${referenceExpression(condition)} { ${thenSource} }${middle < 0 ? '' : ` else { ${branchSource} }`}`;
}

function nodeSource(node: ComputationIRNode): string {
  if (node.kind === 'output')
    return `output ${referenceExpression(node.expression)};`;
  if (node.kind !== 'tag') return '';
  const assignment = assignmentSource(node);
  if (assignment) return assignment;
  if (node.name === 'computeColumn') {
    const [table, column] = node.args.trim().split(/\s+/, 2);
    const body = (node.children ?? []).map(nodeSource).join(' ');
    return `computeColumn ${table} ${column} { ${body} }`;
  }
  if (node.name === 'for') {
    const itemVar = node.target ?? 'item';
    const body = (node.children ?? []).map(nodeSource).join(' ');
    return `for ${itemVar} in ${referenceExpression(node.expression)} { ${body} }`;
  }
  if (node.name !== 'if') return '';
  return conditionalSource(node.expression, node.children ?? []);
}

/**
 * Transpiles a portable Computation IR document into reference language source code.
 *
 * @param document - Extracted computation IR document.
 * @returns Executable reference language text.
 */
export function referenceSourceFromIR(document: ComputationIRDocument): string {
  return document.nodes.map(nodeSource).join(' ');
}

/**
 * Compiles a portable Computation IR document into an executable `ReferenceProgram` AST.
 *
 * @param document - Extracted computation IR document.
 * @returns Parsed `ReferenceProgram` AST ready for evaluation.
 */
export function referenceProgramFromIR(
  document: ComputationIRDocument,
): ReferenceProgram {
  return parseReferenceProgram(referenceSourceFromIR(document));
}
