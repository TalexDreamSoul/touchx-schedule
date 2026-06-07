import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { bundleTsModule, repoRoot } from "../../test-utils/bundle-ts-module.mjs";

const tokens = await bundleTsModule(join(repoRoot, "packages/ui-tokens/src/index.ts"), {
  outFileName: "ui-tokens.mjs",
  tmpPrefix: "touchx-ui-tokens-test",
});
const hexColor = /^#[0-9a-f]{6}$/i;
const rgbaColor = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(?:0|1|0?\.\d+)\s*\)$/;
const colorToken = /^#[0-9a-f]{6}$|^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(?:0|1|0?\.\d+)\s*\)$/i;

const assertAscendingPositiveNumbers = (values, label) => {
  let previous = 0;
  for (const value of values) {
    assert.equal(typeof value, "number", `${label} value must be numeric`);
    assert.ok(value > 0, `${label} value must be positive`);
    assert.ok(value >= previous, `${label} values must be sorted ascending`);
    previous = value;
  }
};

test("light and dark themes expose the same valid color token keys", () => {
  const lightKeys = Object.keys(tokens.touchxColors.light);
  const darkKeys = Object.keys(tokens.touchxColors.dark);
  assert.deepEqual(darkKeys, lightKeys);
  for (const mode of ["light", "dark"]) {
    for (const [key, value] of Object.entries(tokens.touchxColors[mode])) {
      assert.match(value, hexColor, `${mode}.${key} must be a hex color`);
    }
  }
});

test("spacing, radius and typography scales stay ordered and usable", () => {
  assertAscendingPositiveNumbers(Object.values(tokens.touchxRadius), "radius");
  assertAscendingPositiveNumbers(Object.values(tokens.touchxSpacing), "spacing");
  for (const value of Object.values(tokens.touchxSpacing)) {
    assert.equal(value % 4, 0, "spacing must stay on the 4px grid");
  }

  assertAscendingPositiveNumbers(Object.values(tokens.touchxTypography.size), "font size");
  assert.ok(tokens.touchxTypography.fontFamily.sans.includes("system-ui"));
  assert.ok(tokens.touchxTypography.fontFamily.mono.includes("monospace"));
  assert.deepEqual(Object.keys(tokens.touchxTypography.weight), ["regular", "medium", "semibold", "bold"]);
});

test("calendar event colors cover every V1 event type with valid swatches", () => {
  assert.deepEqual(Object.keys(tokens.calendarEventColors), [
    "course",
    "exam",
    "todo",
    "activity",
    "holiday",
    "deadline",
    "custom",
  ]);
  for (const [eventType, value] of Object.entries(tokens.calendarEventColors)) {
    assert.match(value, hexColor, `${eventType} must use a hex swatch`);
  }
});

test("miniapp page themes and event tones stay aligned with shared color tokens", () => {
  const themeKeys = [
    "bg",
    "cardBg",
    "textMain",
    "textSub",
    "line",
    "lineStrong",
    "accent",
    "mutedBg",
    "timeColBg",
    "todayColBg",
    "todayHeadBg",
    "maskBg",
    "glowPrimary",
    "glowSecondary",
  ];

  assert.deepEqual(Object.keys(tokens.miniappPageThemes), ["default", "green", "purple"]);
  for (const [themeName, theme] of Object.entries(tokens.miniappPageThemes)) {
    assert.deepEqual(Object.keys(theme), themeKeys, `${themeName} must keep stable miniapp CSS variable keys`);
    for (const [key, value] of Object.entries(theme)) {
      assert.match(value, colorToken, `${themeName}.${key} must be a supported color token`);
    }
  }

  assert.equal(tokens.miniappPageThemes.default.bg, tokens.touchxColors.light.background);
  assert.equal(tokens.miniappPageThemes.default.cardBg, tokens.touchxColors.light.card);
  assert.equal(tokens.miniappPageThemes.default.textMain, tokens.touchxColors.light.foreground);

  assert.deepEqual(Object.keys(tokens.miniappEventTones), Object.keys(tokens.calendarEventColors));
  for (const [eventType, tone] of Object.entries(tokens.miniappEventTones)) {
    assert.equal(tone.color, tokens.calendarEventColors[eventType], `${eventType} tone color must reuse calendarEventColors`);
    assert.match(tone.soft, hexColor, `${eventType} soft color must use a hex swatch`);
  }
});

test("native platform tokens stay in safe numeric ranges", () => {
  assert.match(tokens.iosLiquidGlassTokens.materialBackground, rgbaColor);
  assert.match(tokens.iosLiquidGlassTokens.materialBackgroundDark, rgbaColor);
  assert.match(tokens.iosLiquidGlassTokens.materialStroke, rgbaColor);
  assert.match(tokens.iosLiquidGlassTokens.materialStrokeDark, rgbaColor);
  assert.ok(tokens.iosLiquidGlassTokens.blurRadius > 0);
  assert.ok(tokens.iosLiquidGlassTokens.saturation >= 1);
  assert.ok(tokens.iosLiquidGlassTokens.shadow.includes("rgba("));

  assert.ok(tokens.androidNativeTokens.rippleOpacity > 0 && tokens.androidNativeTokens.rippleOpacity < 1);
  assert.ok(tokens.androidNativeTokens.stateLayerOpacity > 0 && tokens.androidNativeTokens.stateLayerOpacity < 1);
  assert.ok(tokens.androidNativeTokens.elevation1 <= tokens.androidNativeTokens.elevation2);
  assert.ok(tokens.androidNativeTokens.elevation2 <= tokens.androidNativeTokens.elevation3);
});
