import type {
  ComputationIRDocument,
  ComputationIRNode,
  ComputationIRTagNode,
} from './index.js';

// ─── LiquidJS Source Generator ───────────────────────────────────────────────

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
