import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const loadAiProviderModule = async () => {
  const sourcePath = join(import.meta.dirname, "ai-provider.ts");
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-ai-provider-")), "ai-provider.mjs");
  writeFileSync(tmpFile, transpiled, "utf8");
  return import(pathToFileURL(tmpFile).href);
};

test("reports missing AI provider configuration explicitly", async () => {
  const provider = await loadAiProviderModule();

  const config = provider.resolveAiProviderConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.reason, "AI_PROVIDER_NOT_CONFIGURED");
  assert.equal(config.chatModel, "gpt-4.1-mini");
  assert.equal(config.visionModel, "gpt-4.1-mini");
});

test("normalizes OpenAI-compatible AI provider configuration", async () => {
  const provider = await loadAiProviderModule();

  const config = provider.resolveAiProviderConfig({
    TOUCHX_AI_BASE_URL: "https://ai.example.com/v1/",
    TOUCHX_AI_API_KEY: "sk-test",
    TOUCHX_AI_CHAT_MODEL: "chat-model",
    TOUCHX_AI_VISION_MODEL: "vision-model",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.baseUrl, "https://ai.example.com/v1");
  assert.equal(config.apiKey, "sk-test");
  assert.equal(config.chatModel, "chat-model");
  assert.equal(config.visionModel, "vision-model");
});
