import { defineConfig, transformWithOxc } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    {
      name: "treat-js-files-as-jsx",
      enforce: "pre",
      async transform(code, id) {
        if (!id.match(/src\/.*\.js$/)) return null;

        const result = await transformWithOxc(code, id, {
          lang: "jsx",
        });

        return {
          code: result.code,
          map: result.map,
          moduleType: "js",
        };
      },
    },
    react(),
  ],

  optimizeDeps: {
    rolldownOptions: {
      moduleTypes: {
        ".js": "jsx",
      },
    },
  },

  base: "./",

  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: { '/api/chat': 'http://127.0.0.1:8787' },
  },
});
