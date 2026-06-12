/* global console, process */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const srcDir = path.resolve(__dirname, '../lsp-engine/dist');
const destDir = path.resolve(__dirname, 'dist/server');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

console.log(`Copying server files from ${srcDir} to ${destDir}...`);
if (fs.existsSync(srcDir)) {
  copyRecursiveSync(srcDir, destDir);
  console.log('Server files copied successfully.');
} else {
  console.error(`Error: Source directory ${srcDir} does not exist. Make sure lsp-engine is built first.`);
  process.exit(1);
}
