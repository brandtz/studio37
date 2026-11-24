import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src');
const destination = path.join(root, 'dist');
const marker = path.join(destination, '.studio37-generated');

try {
  const contents = await readFile(marker, 'utf8');
  if (contents !== 'studio37 publish output\n') throw new Error('Unrecognized publish output marker');
  await rm(destination, { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  try {
    await mkdir(destination);
  } catch (mkdirError) {
    if (mkdirError.code === 'EEXIST') throw new Error('Refusing to overwrite an unrecognized dist directory');
    throw mkdirError;
  }
}

await mkdir(destination, { recursive: true });
await writeFile(marker, 'studio37 publish output\n');
await cp(source, destination, {
  recursive: true,
  filter: (entry) => path.relative(source, entry).split(path.sep)[0] !== 'netlify',
});
