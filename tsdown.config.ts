import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/lib.ts', 'src/index.ts'],
  format: 'esm',
  clean: true,
  dts: true,
  sourcemap: true,
  target: 'node20',
  bundle: false,
})
