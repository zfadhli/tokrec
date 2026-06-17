import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: "esm",
  clean: true,
  dts: true,
  sourcemap: true,
  target: "node20",
  unbundle: true,
})
