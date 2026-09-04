import { describe, expect, it } from "vitest";
import { extractComputationIR } from "liquid-core";
import {
  lowerToSpecter,
  programFromIR,
  joinIfAssigns,
  inlineLocals,
  resultExpr,
  emitSpecter,
} from "./specter-pipeline.js";

describe("Specter Lowering Pipeline (Requirements in summary.txt)", () => {
  it("1. Resolves single result variable and inlines locals into one expression", () => {
    const source = `
      {% assign t = price | plus: 10 %}
      {% assign $$answer = t | times: 2 %}
    `;
    const doc = extractComputationIR(source);
    const specter = lowerToSpecter(doc, { price: "NUMBER" });

    // "t" must be substituted away; result must be Multiply(Add(price, 10), 2)
    expect(specter).toBe("Multiply(Add(price, 10), 2)");
  });

  it("2. Handles IfExpr with both branches joined and inlined", () => {
    const source = `
      {% if is_vip %}
        {% assign discount = 20 %}
      {% else %}
        {% assign discount = 5 %}
      {% endif %}
      {% assign $$answer = subtotal | minus: discount %}
    `;
    const doc = extractComputationIR(source);
    const specter = lowerToSpecter(doc, { is_vip: "CHECKBOX", subtotal: "NUMBER" });

    expect(specter).toBe("Subtract(subtotal, If(is_vip, 20, 5))");
  });

  it("3. Distinguishes free vs local names (eliminates __left and sd_cb_literal)", () => {
    const source = `
      {% assign __left = base_rate | plus: fee %}
      {% assign sd_cb_literal_1 = 100 %}
      {% assign $$answer = __left | minus: sd_cb_literal_1 %}
    `;
    const doc = extractComputationIR(source);
    const specter = lowerToSpecter(doc);

    expect(specter).not.toContain("__left");
    expect(specter).not.toContain("sd_cb_literal_1");
    expect(specter).toBe("Subtract(Add(base_rate, fee), 100)");
  });

  it("4. Lowers structured domain literals for Currency and Duration", () => {
    const source = `
      {% parseAssign min_charge = "{\"value\": 500, \"currency\": \"USD\"}" %}
      {% parseAssign term = "{\"value\": 12, \"unit\": \"MONTHS\"}" %}
      {% assign $$answer = min_charge %}
    `;
    const doc = extractComputationIR(source);
    const specter = lowerToSpecter(doc);

    expect(specter).toBe("Currency(500, \"USD\")");
  });

  it("5. Maps table columns and sumArray aggregations to GetColumn and Sum", () => {
    const source = `
      {% assign $$answer = line_items | sumArray: "total" %}
    `;
    const doc = extractComputationIR(source);
    const specter = lowerToSpecter(doc);

    expect(specter).toBe("Sum(GetColumn(line_items, \"total\"))");
  });

  it("6. Fails closed with Unsupported for unknown filters (no pass-through guessing)", () => {
    const source = `
      {% assign $$answer = name | unknownFilter: 123 %}
    `;
    const doc = extractComputationIR(source);
    const p = programFromIR(doc);
    const root = resultExpr(inlineLocals(joinIfAssigns(p)));

    expect(root.kind).toBe("unsupported");
    if (root.kind === "unsupported") {
      expect(root.reason).toContain("Unknown filter: unknownFilter");
    }
  });

  it("7. Fails closed with Unsupported for forbidden template constructs (for loops, capture, raw text)", () => {
    const source = `
      {% for item in items %}
        {% assign $$answer = item.price %}
      {% endfor %}
    `;
    const doc = extractComputationIR(source);
    const specter = lowerToSpecter(doc);

    expect(specter).toContain("Unsupported");
  });

  it("8. Inlines nested conditionals and multi-stage intermediate assignments", () => {
    const source = `
      {% assign net = gross | minus: discount %}
      {% if is_taxable %}
        {% assign tax = net | times: tax_rate %}
      {% else %}
        {% assign tax = 0 %}
      {% endif %}
      {% assign $$answer = net | plus: tax %}
    `;
    const doc = extractComputationIR(source);
    const specter = lowerToSpecter(doc);

    expect(specter).toBe(
      "Add(Subtract(gross, discount), If(is_taxable, Multiply(Subtract(gross, discount), tax_rate), 0))"
    );
  });
});
