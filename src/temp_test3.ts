import { Liquid } from 'liquidjs';
const engine = new Liquid();

try {
  engine.parse('{% if x = 5 %}');
} catch (err: any) {
  console.log('if x = 5 Token:', err.token);
}

try {
  engine.parse('{% assign x = 1 + 2 %}');
} catch (err: any) {
  console.log('assign x = 1 + 2 Token:', err.token);
}
