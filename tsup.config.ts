import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  clean: true,
  bundle: true,
  sourcemap: true,
  minify: true,
  splitting: false,
  dts: false,
  outExtension() {
    return { js: '.js' }
  },
})
