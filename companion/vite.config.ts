import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: { proxy: { "/api": "http://localhost:4799" } },
  test: { environment: "jsdom", setupFiles: ["./vitest.setup.ts"], globals: true },
} as any)
