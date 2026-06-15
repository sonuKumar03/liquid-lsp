import { createLiquidEngine, tokenizeTopLevel } from './dist/index.js';

const code = `{% if sd_effective_date and sd_term_length and sd_term_length.value and sd_term_length.type %} {% parseAssign one_day = '{"value": 1, "type": "DAYS", "days": 1}' %} {% assign temp_expiration = sd_effective_date | plus: sd_term_length %} {% assign sd_expiration_date = temp_expiration | minus: one_day %} {% else %} {% assign sd_expiration_date = nil %} {% endif %} {% if sd_effective_date %} {% assign parse_sd_effective_date = sd_effective_date | date: "%Y-%m-%d" %} {% assign current_date = "now" | date: "%Y-%m-%d" %} {% if parse_sd_effective_date < current_date %} {% assign sd_dummy = true %} {% endif %} {% if parse_sd_effective_date >= current_date %} {% assign sd_dummy = false %} {% endif %} {% endif %} {% if sd_date_of_request %} {% assign check_start = sd_date_of_request | date: "%Y-%m-%d" %} {% assign current_date = "now" | date: "%Y-%m-%d" %} {% if check_start <= current_date %} {% assign sd_date_of_request = current_date %} {% endif %} {% endif %}`;

console.log("=== 1. Tokenizing Code ===");
const tokens = tokenizeTopLevel(code);
console.log(`Total Top-Level Tokens found: ${tokens.length}`);
tokens.forEach((t, i) => {
  console.log(`[Token ${i}] Kind: ${t.kind}, Text: "${t.getText()}"`);
});

console.log("\n=== 2. Parsing Code to AST ===");
const engine = createLiquidEngine();
try {
  const templates = engine.parse(code);
  console.log(`Total AST Root Templates found: ${templates.length}`);
  
  function printTemplate(tpl, depth = 0) {
    const indent = "  ".repeat(depth);
    const type = tpl.constructor.name;
    const name = tpl.token?.name || tpl.token?.getText() || "";
    console.log(`${indent}- ${type} (Name/Text: "${name}")`);
    
    // Recurse down children if present (for tags like if/for/etc.)
    if (tpl.templates) {
      tpl.templates.forEach(child => printTemplate(child, depth + 1));
    }
    if (tpl.elseTemplates) {
      console.log(`${indent}  [Else Branch]:`);
      tpl.elseTemplates.forEach(child => printTemplate(child, depth + 1));
    }
  }

  templates.forEach((tpl, i) => {
    printTemplate(tpl);
  });
} catch (err) {
  console.error("Parser Error:", err);
}
