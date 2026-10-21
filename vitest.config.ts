import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["src/lib/**/*.ts", "src/integrations/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/integrations/supabase/types.ts"],
    },
  },
});
