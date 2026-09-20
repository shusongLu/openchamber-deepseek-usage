import { build } from 'esbuild';

const shared = {
  bundle: true,
  logLevel: 'info',
  minify: false,
  sourcemap: false,
};

await build({
  ...shared,
  entryPoints: ['panel/main.ts'],
  outfile: 'panel/main.js',
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
});

await build({
  ...shared,
  entryPoints: ['background/main.ts'],
  outfile: 'background/main.js',
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
});

await build({
  ...shared,
  entryPoints: ['page/main.ts'],
  outfile: 'page/main.js',
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
});

await build({
  ...shared,
  entryPoints: ['service/main.ts'],
  outfile: 'service/main.js',
  format: 'cjs',
  platform: 'node',
  target: 'node22',
});

console.log('build ok: panel/main.js, background/main.js, page/main.js, service/main.js');
