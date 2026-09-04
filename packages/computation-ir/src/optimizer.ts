import type {
  ComputationIRDocument,
  ComputationIRNode,
  ComputationIRTagNode,
  ComputationIROutputNode,
} from "./index.js";
import { foldConstants, parseExpressionToAST } from "./expressions.js";

/**
 * Optimizes a Computation IR Document by performing:
 * 1. Constant folding across all expression and filter sub-trees
 * 2. Algebraic reduction (e.g. x * 1 -> x, x + 0 -> x)
 * 3. Static string concatenation folding
 */
export function optimizeComputationIR(doc: ComputationIRDocument): ComputationIRDocument {
  function optimizeNode(node: ComputationIRNode): ComputationIRNode {
    if (node.kind === "text") {
      return node;
    }

    if (node.kind === "output") {
      const ast = parseExpressionToAST(node.expression, node.filters);
      const folded = foldConstants(ast);
      const outputNode: ComputationIROutputNode = {
        ...node,
        expression: folded.kind === "literal" ? String(folded.value) : node.expression,
      };
      return outputNode;
    }

    if (node.kind === "tag") {
      const ast = parseExpressionToAST(node.expression, node.filters);
      const folded = foldConstants(ast);

      const tagNode: ComputationIRTagNode = {
        ...node,
        expression: folded.kind === "literal" ? String(folded.value) : node.expression,
      };
      if (node.children) {
        tagNode.children = node.children.map(optimizeNode);
      }
      return tagNode;
    }

    return node;
  }

  return {
    ...doc,
    nodes: doc.nodes.map(optimizeNode),
  };
}
