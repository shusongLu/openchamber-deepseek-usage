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
  entryPoints: ['service/main.ts'],
  outfile: 'service/main.js',
  format: 'cjs',
  platform: 'node',
  target: 'node22',
});

console.log('build ok: panel/main.js, service/main.js');
