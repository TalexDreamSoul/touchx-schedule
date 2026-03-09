import { joinRelativeURL } from "ufo";

const DEFAULT_BASE_URL = "/";
const DEFAULT_BUILD_ASSETS_DIR = "/_nuxt/";

function normalizeBaseURL(value) {
  if (!value) {
    return DEFAULT_BASE_URL;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return DEFAULT_BASE_URL;
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function normalizeAssetsDir(value) {
  if (!value) {
    return DEFAULT_BUILD_ASSETS_DIR;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return DEFAULT_BUILD_ASSETS_DIR;
  }
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export function baseURL() {
  return normalizeBaseURL(process.env.NUXT_APP_BASE_URL ?? process.env.NITRO_APP_BASE_URL);
}

export function buildAssetsDir() {
  return normalizeAssetsDir(process.env.NUXT_APP_BUILD_ASSETS_DIR);
}

export function publicAssetsURL(...path) {
  const publicBase = process.env.NUXT_APP_CDN_URL || baseURL();
  return path.length ? joinRelativeURL(publicBase, ...path) : publicBase;
}

export function buildAssetsURL(...path) {
  return joinRelativeURL(publicAssetsURL(), buildAssetsDir(), ...path);
}
