import { defineConfig } from "@tarojs/cli";

export default defineConfig(async () => ({
  projectName: "touchx-miniapp-react",
  date: "2026-05-17",
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
  },
  sourceRoot: "src",
  outputRoot: "dist",
  framework: "react",
  compiler: {
    type: "vite",
    vitePlugins: [],
  },
  mini: {
    optimizeMainPackage: {
      enable: false,
    },
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: "module",
          generateScopedName: "[name]__[local]___[hash:base64:5]",
        },
      },
    },
  },
}));
