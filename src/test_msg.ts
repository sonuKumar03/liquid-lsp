import { Liquid } from 'liquidjs';
const engine = new Liquid();
try {
  engine.parse('{% if true %}\nHello');
} catch (e: any) {
  console.log('Error Message:', e.message);
}
