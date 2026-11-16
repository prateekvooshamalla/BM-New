import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'functions');
const destination = path.join(root, '.firebase/functions');
const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
const bundle = await readFile(path.join(source, 'lib/index.js'), 'utf8');
if (/require\(["']@bharat-makaan\//.test(bundle)) {
  throw new Error('Build Functions with bundled workspace packages before preparing deployment.');
}

await mkdir(destination, { recursive: true });
await rm(path.join(destination, 'lib'), { recursive: true, force: true });
await cp(path.join(source, 'lib'), path.join(destination, 'lib'), { recursive: true });
const dependencies = Object.fromEntries(
  Object.entries(manifest.dependencies).filter(([name, version]) => {
    if (name.startsWith('@bharat-makaan/')) return false;
    if (version.startsWith('workspace:')) throw new Error(`Unbundled dependency: ${name}`);
    return true;
  })
);
await writeFile(path.join(destination, 'package.json'), JSON.stringify({
  name: manifest.name,
  version: manifest.version,
  private: true,
  engines: manifest.engines,
  main: manifest.main,
  dependencies,
}, null, 2) + '\n');

// Copy only Functions environment files, never the mixed frontend/backend root .env.
for (const filename of ['.env', `.env.${process.env.GCLOUD_PROJECT || 'bharathmakaan'}`]) {
  await rm(path.join(destination, filename), { force: true });
  try {
    await cp(path.join(source, filename), path.join(destination, filename));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
console.log('Prepared .firebase/functions with bundled workspace code and runtime dependencies.');
