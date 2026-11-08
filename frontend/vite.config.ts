/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    // Fail the build, not the deployed page: without an API URL the app could never connect.
    const { VITE_API_BASE_URL: apiUrl } = loadEnv(mode, process.cwd(), "VITE_");
    if (!apiUrl) throw new Error("VITE_API_BASE_URL must be set for a production build");
    if (!apiUrl.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(apiUrl)) {
      throw new Error("VITE_API_BASE_URL must use https:// (the page itself is served over HTTPS)");
    }
  }
  return {
    plugins: [react()],
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  };
});
