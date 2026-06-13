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

function bundleWorkspacePackage(packageName, packageDir) {
  const bundledDest = path.join(destDir, 'node_modules', packageName);
  const packageDist = path.join(packageDir, 'dist');
  const packageJson = path.join(packageDir, 'package.json');

  if (!fs.existsSync(packageDist) || !fs.existsSync(packageJson)) {
    console.warn(
      `Warning: ${packageName} is not built; server may fail to resolve it.`,
    );
    return;
  }

  console.log(`Bundling ${packageName} into server output...`);
  fs.mkdirSync(bundledDest, { recursive: true });
  fs.copyFileSync(packageJson, path.join(bundledDest, 'package.json'));
  copyRecursiveSync(packageDist, path.join(bundledDest, 'dist'));
}

console.log(`Copying server files from ${srcDir} to ${destDir}...`);
if (fs.existsSync(srcDir)) {
  copyRecursiveSync(srcDir, destDir);

  bundleWorkspacePackage(
    'key-pointer-schema',
    path.resolve(__dirname, '../packages/key-pointer-schema'),
  );
  bundleWorkspacePackage(
    'liquid-core',
    path.resolve(__dirname, '../packages/liquid-core'),
  );

  console.log('Server files copied successfully.');
} else {
  console.error(
    `Error: Source directory ${srcDir} does not exist. Make sure lsp-engine is built first.`,
  );
  process.exit(1);
}
