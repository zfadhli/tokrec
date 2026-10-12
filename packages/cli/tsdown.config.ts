import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/bin.ts"],
  format: "esm",
  clean: true,
  dts: false,
  sourcemap: true,
  target: "node20",
  unbundle: true,
})
