/* global console, process */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const srcDir = path.resolve(__dirname, '../lsp-engine/dist');
const destDir = path.resolve(__dirname, 'dist/server');
const keyPointerSchemaPkgDir = path.resolve(
  __dirname,
  '../packages/key-pointer-schema',
);

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName),
      );
    });
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

console.log(`Copying server files from ${srcDir} to ${destDir}...`);
if (fs.existsSync(srcDir)) {
  copyRecursiveSync(srcDir, destDir);

  const bundledSchemaDest = path.join(
    destDir,
    'node_modules',
    'key-pointer-schema',
  );
  const schemaDist = path.join(keyPointerSchemaPkgDir, 'dist');
  const schemaPkgJson = path.join(keyPointerSchemaPkgDir, 'package.json');

  if (fs.existsSync(schemaDist) && fs.existsSync(schemaPkgJson)) {
    console.log('Bundling key-pointer-schema into server output...');
    fs.mkdirSync(bundledSchemaDest, { recursive: true });
    fs.copyFileSync(
      schemaPkgJson,
      path.join(bundledSchemaDest, 'package.json'),
    );
    copyRecursiveSync(schemaDist, path.join(bundledSchemaDest, 'dist'));
  } else {
    console.warn(
      'Warning: key-pointer-schema is not built; server may fail to resolve schema package.',
    );
  }

  console.log('Server files copied successfully.');
} else {
  console.error(
    `Error: Source directory ${srcDir} does not exist. Make sure lsp-engine is built first.`,
  );
  process.exit(1);
}
