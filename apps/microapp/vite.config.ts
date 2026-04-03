import path from "node:path";
import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

const lib0WebcryptoPolyfillPath = path.resolve(__dirname, "src/polyfills/lib0-webcrypto.ts");
const runtimeCryptoShimIntro = `
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = {
    getRandomValues(array) {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
      return array;
    },
  };
}
`;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni()],
  build: {
    rollupOptions: {
      output: {
        // Ensure runtime has a global `crypto` even if third-party libs access it directly.
        intro: runtimeCryptoShimIntro,
      },
    },
  },
  resolve: {
    alias: [
      {
        find: "lib0/webcrypto",
        replacement: lib0WebcryptoPolyfillPath,
      },
      {
        find: "lib0/webcrypto.js",
        replacement: lib0WebcryptoPolyfillPath,
      },
      {
        find: /^lib0\/webcrypto(?:\.js)?$/,
        replacement: lib0WebcryptoPolyfillPath,
      },
    ],
  },
});
