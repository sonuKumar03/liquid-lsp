import type {
  ComputationIRDocument,
  ComputationIRNode,
  ComputationIRTagNode,
} from './index.js';
import {
  parseExpressionToAST,
  type ExpressionNode,
} from './expressions.js';

// ─── 1. LiquidJS Source Generator ─────────────────────────────────────────────

/**
 * Transpiles a Computation IR Document back into clean, canonical LiquidJS source template.
 *
 * @param doc - Computation IR Document.
 * @returns Valid LiquidJS template code.
 */
export function generateLiquidFromIR(doc: ComputationIRDocument): string {
  function nodeToLiquid(node: ComputationIRNode, indent = 0): string {
    const pad = '  '.repeat(indent);
    if (node.kind === 'text') {
      return node.text;
    }

    if (node.kind === 'output') {
      if (node.expression.includes('|')) {
        return `${pad}{{ ${node.expression} }}`;
      }
      const filtersStr =
        node.filters.length > 0
          ? ' | ' + node.filters.map((f) => f.raw).join(' | ')
          : '';
      return `${pad}{{ ${node.expression}${filtersStr} }}`;
    }

    if (node.kind === 'tag') {
      if (
        node.name === 'assign' ||
        node.name === 'assignVar' ||
        node.name === 'parseAssign'
      ) {
        if (node.expression.includes('|')) {
          const target = node.target || 'result';
          return `${pad}{% ${node.name} ${target} = ${node.expression} %}`;
        }
        const filtersStr =
          node.filters.length > 0
            ? ' | ' + node.filters.map((f) => f.raw).join(' | ')
            : '';
        const target = node.target || 'result';
        return `${pad}{% ${node.name} ${target} = ${node.expression}${filtersStr} %}`;
      }

      if (node.name === 'computeColumn') {
        const inner = (node.children || [])
          .map((c) => nodeToLiquid(c, indent + 1))
          .join('\n');
        return `${pad}{% computeColumn ${node.args} %}\n${inner}\n${pad}{% endcomputeColumn %}`;
      }

      if (node.name === 'for') {
        const inner = (node.children || [])
          .map((c) => nodeToLiquid(c, indent + 1))
          .join('\n');
        return `${pad}{% for ${node.target || 'item'} in ${node.expression} %}\n${inner}\n${pad}{% endfor %}`;
      }

      if (node.name === 'if' || node.name === 'unless') {
        const children = node.children || [];
        const branchIdx = children.findIndex(
          (c) => c.kind === 'tag' && (c.name === 'else' || c.name === 'elsif'),
        );

        if (branchIdx < 0) {
          const inner = children
            .map((c) => nodeToLiquid(c, indent + 1))
            .join('\n');
          return `${pad}{% ${node.name} ${node.expression} %}\n${inner}\n${pad}{% end${node.name} %}`;
        } else {
          const thenChildren = children.slice(0, branchIdx);
          const thenStr = thenChildren
            .map((c) => nodeToLiquid(c, indent + 1))
            .join('\n');
          const branchTag = children[branchIdx] as ComputationIRTagNode;
          const otherwiseChildren = children.slice(branchIdx + 1);
          const otherwiseStr = otherwiseChildren
            .map((c) => nodeToLiquid(c, indent + 1))
            .join('\n');

          const branchExpr = branchTag.expression ? ` ${branchTag.expression}` : '';
          return `${pad}{% ${node.name} ${node.expression} %}\n${thenStr}\n${pad}{% ${branchTag.name}${branchExpr} %}\n${otherwiseStr}\n${pad}{% end${node.name} %}`;
        }
      }

      if (node.name === 'case') {
        const inner = (node.children || [])
          .map((c) => {
            if (c.kind === 'tag' && (c.name === 'when' || c.name === 'else')) {
              const body = (c.children || [])
                .map((sub) => nodeToLiquid(sub, indent + 2))
                .join('\n');
              const arg = c.expression || c.args;
              return `${pad}  {% ${c.name}${arg ? ' ' + arg : ''} %}\n${body}`;
            }
            return nodeToLiquid(c, indent + 1);
          })
          .join('\n');
        return `${pad}{% case ${node.expression || node.args} %}\n${inner}\n${pad}{% endcase %}`;
      }

      return `${pad}{% ${node.name} ${node.args} %}`;
    }

    return '';
  }

  return doc.nodes.map((n) => nodeToLiquid(n)).join('\n').trim();
}

// ─── 2. JavaScript / TypeScript Transpiler ────────────────────────────────────

/**
 * Transpiles an expression AST into executable JavaScript code.
 */
export function transpileExpressionToJS(ast: ExpressionNode): string {
  switch (ast.kind) {
    case 'literal':
      if (ast.value === null) return 'null';
      if (typeof ast.value === 'string') return JSON.stringify(ast.value);
      return String(ast.value);

    case 'identifier': {
      const parts = ast.name.split('.');
      if (parts.length > 1) {
        const root = parts[0]!;
        const rest = parts
          .slice(1)
          .map((p) => `?.[${JSON.stringify(p)}]`)
          .join('');
        return `((scope[${JSON.stringify(root)}] ?? context[${JSON.stringify(root)}])${rest} ?? null)`;
      }
      return `(scope[${JSON.stringify(ast.name)}] !== undefined ? scope[${JSON.stringify(ast.name)}] : (context[${JSON.stringify(ast.name)}] !== undefined ? context[${JSON.stringify(ast.name)}] : null))`;
    }

    case 'column_ref':
      return `(scope.self?.[${JSON.stringify(ast.column)}] ?? (scope[${JSON.stringify(ast.table)}]?.[${JSON.stringify(ast.column)}]) ?? null)`;

    case 'unary_op':
      if (ast.operator === 'NOT') {
        return `(!${transpileExpressionToJS(ast.operand)})`;
      }
      return `(-${transpileExpressionToJS(ast.operand)})`;

    case 'binary_op': {
      const left = transpileExpressionToJS(ast.left);
      const right = transpileExpressionToJS(ast.right);
      switch (ast.operator) {
        case 'ADD':
        case 'CONCAT':
          return `(Number(${left}) + Number(${right}))`;
        case 'SUBTRACT':
          return `(Number(${left}) - Number(${right}))`;
        case 'MULTIPLY':
          return `(Number(${left}) * Number(${right}))`;
        case 'DIVIDE':
          return `(Number(${right}) !== 0 ? (Number(${left}) / Number(${right})) : 0)`;
        case 'MODULO':
          return `(Number(${left}) % Number(${right}))`;
        case 'EQ':
          return `(${left} === ${right})`;
        case 'NEQ':
          return `(${left} !== ${right})`;
        case 'LT':
          return `(${left} < ${right})`;
        case 'GT':
          return `(${left} > ${right})`;
        case 'LTE':
          return `(${left} <= ${right})`;
        case 'GTE':
          return `(${left} >= ${right})`;
        case 'AND':
          return `(Boolean(${left}) && Boolean(${right}))`;
        case 'OR':
          return `(Boolean(${left}) || Boolean(${right}))`;
        case 'CONTAINS':
          return `(String(${left}).includes(String(${right})))`;
      }
      break;
    }

    case 'filter_call': {
      const target = transpileExpressionToJS(ast.target);
      const args = ast.args.map(transpileExpressionToJS);
      return `helpers.filter(${JSON.stringify(ast.filterName)}, ${target}, [${args.join(', ')}], scope, context)`;
    }
  }
}

export interface JSTranspileOptions {
  functionName?: string;
  exportDefault?: boolean;
}

/**
 * Transpiles a Computation IR Document into a standalone executable JavaScript module.
 *
 * @param doc - Computation IR Document.
 * @param options - Transpilation options.
 * @returns Executable JavaScript source code.
 */
export function transpileIRToJS(
  doc: ComputationIRDocument,
  options: JSTranspileOptions = {},
): string {
  const fnName = options.functionName || 'evaluateComputation';

  function transpileNode(node: ComputationIRNode, indent = 2): string {
    const pad = '  '.repeat(indent);

    if (node.kind === 'output') {
      const ast = parseExpressionToAST(node.expression, node.filters);
      const exprCode = transpileExpressionToJS(ast);
      return `${pad}outputs.push(${exprCode});`;
    }

    if (node.kind === 'tag') {
      if (
        node.name === 'assign' ||
        node.name === 'assignVar' ||
        node.name === 'parseAssign'
      ) {
        const ast = parseExpressionToAST(node.expression, node.filters);
        const exprCode = transpileExpressionToJS(ast);
        const target = node.target || 'result';
        return `${pad}scope[${JSON.stringify(target)}] = ${exprCode};`;
      }

      if (node.name === 'computeColumn') {
        const parts = node.args.trim().split(/\s+/);
        const tableVar = parts[0] || 'table';
        const colName = parts[1] || 'column';
        const inner = (node.children || [])
          .map((c) => transpileNode(c, indent + 2))
          .join('\n');

        return [
          `${pad}const __table_${tableVar} = scope[${JSON.stringify(tableVar)}] || context[${JSON.stringify(tableVar)}] || [];`,
          `${pad}if (Array.isArray(__table_${tableVar})) {`,
          `${pad}  for (const __row of __table_${tableVar}) {`,
          `${pad}    const __saveSelf = scope.self;`,
          `${pad}    scope.self = __row;`,
          `${inner}`,
          `${pad}    __row[${JSON.stringify(colName)}] = scope.$$answer !== undefined ? scope.$$answer : scope[${JSON.stringify(colName)}];`,
          `${pad}    scope.self = __saveSelf;`,
          `${pad}  }`,
          `${pad}}`,
        ].join('\n');
      }

      if (node.name === 'for') {
        const itemVar = node.target || 'item';
        const collectionAst = parseExpressionToAST(
          node.expression,
          node.filters,
        );
        const colExpr = transpileExpressionToJS(collectionAst);
        const inner = (node.children || [])
          .map((c) => transpileNode(c, indent + 2))
          .join('\n');

        return [
          `${pad}const __col_${itemVar} = ${colExpr} || [];`,
          `${pad}if (Array.isArray(__col_${itemVar})) {`,
          `${pad}  for (const __item of __col_${itemVar}) {`,
          `${pad}    scope[${JSON.stringify(itemVar)}] = __item;`,
          `${inner}`,
          `${pad}  }`,
          `${pad}}`,
        ].join('\n');
      }

      if (node.name === 'if' || node.name === 'unless') {
        const conditionAst = parseExpressionToAST(
          node.expression,
          node.filters,
        );
        const condCode = transpileExpressionToJS(conditionAst);
        const finalCond =
          node.name === 'unless' ? `!(${condCode})` : condCode;

        const children = node.children || [];
        const branchIdx = children.findIndex(
          (c) => c.kind === 'tag' && (c.name === 'else' || c.name === 'elsif'),
        );

        if (branchIdx < 0) {
          const inner = children
            .map((c) => transpileNode(c, indent + 1))
            .join('\n');
          return `${pad}if (${finalCond}) {\n${inner}\n${pad}}`;
        } else {
          const thenChildren = children.slice(0, branchIdx);
          const thenStr = thenChildren
            .map((c) => transpileNode(c, indent + 1))
            .join('\n');
          const branchTag = children[branchIdx] as ComputationIRTagNode;
          const otherwiseChildren = children.slice(branchIdx + 1);
          const otherwiseStr = otherwiseChildren
            .map((c) => transpileNode(c, indent + 1))
            .join('\n');

          if (branchTag.name === 'else') {
            return `${pad}if (${finalCond}) {\n${thenStr}\n${pad}} else {\n${otherwiseStr}\n${pad}}`;
          } else {
            // elsif
            const elsifAst = parseExpressionToAST(
              branchTag.expression,
              branchTag.filters,
            );
            const elsifCond = transpileExpressionToJS(elsifAst);
            return `${pad}if (${finalCond}) {\n${thenStr}\n${pad}} else if (${elsifCond}) {\n${otherwiseStr}\n${pad}}`;
          }
        }
      }

      if (node.name === 'case') {
        const discAst = parseExpressionToAST(
          node.expression || node.args,
          node.filters,
        );
        const discCode = transpileExpressionToJS(discAst);
        const branches: string[] = [];

        if (node.children) {
          for (const c of node.children) {
            if (c.kind === 'tag' && c.name === 'when') {
              const whenAst = parseExpressionToAST(
                c.expression || c.args,
                c.filters,
              );
              const whenCode = transpileExpressionToJS(whenAst);
              const body = (c.children || [])
                .map((sub) => transpileNode(sub, indent + 1))
                .join('\n');
              branches.push(
                `${pad}if (${discCode} === ${whenCode}) {\n${body}\n${pad}}`,
              );
            } else if (c.kind === 'tag' && c.name === 'else') {
              const body = (c.children || [])
                .map((sub) => transpileNode(sub, indent + 1))
                .join('\n');
              branches.push(`${pad}else {\n${body}\n${pad}}`);
            }
          }
        }
        return branches.join(' else ');
      }
    }

    return '';
  }

  const bodyCode = doc.nodes.map((n) => transpileNode(n, 1)).join('\n');

  const helpersCode = `const helpers = {
  filter(name, val, args, scope, context) {
    if (name === 'plus' || name === 'add') return Number(val) + Number(args[0] || 0);
    if (name === 'minus' || name === 'subtract') return Number(val) - Number(args[0] || 0);
    if (name === 'times') return Number(val) * Number(args[0] || 1);
    if (name === 'divided_by') return Number(args[0]) !== 0 ? Number(val) / Number(args[0]) : 0;
    if (name === 'sumArray') {
      if (!Array.isArray(val)) return 0;
      const col = args[0];
      return val.reduce((acc, row) => acc + Number((col && row && typeof row === 'object') ? row[col] : row || 0), 0);
    }
    if (name === 'toCurrency') {
      const curr = args[0] || 'USD';
      return { value: val, currency: curr, formatted: typeof val === 'number' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: curr }).format(val) : String(val) };
    }
    if (name === 'concat') return Array.isArray(val) ? val.concat(args[0]) : String(val) + String(args[0] || '');
    if (name === 'uniq') return Array.isArray(val) ? Array.from(new Set(val)) : val;
    if (name === 'strip') return typeof val === 'string' ? val.trim() : val;
    if (name === 'strip_html') return typeof val === 'string' ? val.replace(/<[^>]*>/g, '') : val;
    return val;
  }
};`;

  const exportPrefix = options.exportDefault ? 'export default ' : '';

  return `${helpersCode}

${exportPrefix}function ${fnName}(context = {}) {
  const scope = { ...context };
  const outputs = [];

${bodyCode}

  return { outputs, scope };
}`;
}

// ─── 3. SQL Expression Transpiler ─────────────────────────────────────────────

/**
 * Transpiles an expression AST into ANSI SQL expression syntax.
 *
 * @param ast - Binary/Relational/Arithmetic Expression AST.
 * @returns Valid SQL scalar expression string.
 */
export function transpileExpressionToSQL(ast: ExpressionNode): string {
  switch (ast.kind) {
    case 'literal':
      if (ast.value === null) return 'NULL';
      if (typeof ast.value === 'string') return `'${ast.value.replace(/'/g, "''")}'`;
      if (typeof ast.value === 'boolean') return ast.value ? 'TRUE' : 'FALSE';
      return String(ast.value);

    case 'identifier':
      return `"${ast.name}"`;

    case 'column_ref':
      return `"${ast.table}"."${ast.column}"`;

    case 'unary_op':
      if (ast.operator === 'NOT') {
        return `(NOT ${transpileExpressionToSQL(ast.operand)})`;
      }
      return `(-${transpileExpressionToSQL(ast.operand)})`;

    case 'binary_op': {
      const left = transpileExpressionToSQL(ast.left);
      const right = transpileExpressionToSQL(ast.right);
      switch (ast.operator) {
        case 'ADD':
        case 'CONCAT':
          return `(${left} + ${right})`;
        case 'SUBTRACT':
          return `(${left} - ${right})`;
        case 'MULTIPLY':
          return `(${left} * ${right})`;
        case 'DIVIDE':
          return `(${left} / NULLIF(${right}, 0))`;
        case 'MODULO':
          return `(${left} % ${right})`;
        case 'EQ':
          return `(${left} = ${right})`;
        case 'NEQ':
          return `(${left} <> ${right})`;
        case 'LT':
          return `(${left} < ${right})`;
        case 'GT':
          return `(${left} > ${right})`;
        case 'LTE':
          return `(${left} <= ${right})`;
        case 'GTE':
          return `(${left} >= ${right})`;
        case 'AND':
          return `(${left} AND ${right})`;
        case 'OR':
          return `(${left} OR ${right})`;
        case 'CONTAINS':
          return `(${left} LIKE CONCAT('%', ${right}, '%'))`;
      }
      break;
    }

    case 'filter_call': {
      const target = transpileExpressionToSQL(ast.target);
      const args = ast.args.map(transpileExpressionToSQL);
      if (ast.filterName === 'plus' || ast.filterName === 'add') {
        return `(${target} + ${args[0] || '0'})`;
      }
      if (ast.filterName === 'minus' || ast.filterName === 'subtract') {
        return `(${target} - ${args[0] || '0'})`;
      }
      if (ast.filterName === 'times') {
        return `(${target} * ${args[0] || '1'})`;
      }
      if (ast.filterName === 'divided_by') {
        return `(${target} / NULLIF(${args[0] || '1'}, 0))`;
      }
      if (ast.filterName === 'sumArray') {
        return `SUM(${target})`;
      }
      if (ast.filterName === 'concat') {
        return `CONCAT(${target}, ${args.join(', ')})`;
      }
      return `${ast.filterName.toUpperCase()}(${target}${args.length > 0 ? ', ' + args.join(', ') : ''})`;
    }
  }
}
