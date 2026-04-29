export interface AiProviderConfig {
  enabled: boolean;
  reason: "" | "AI_PROVIDER_NOT_CONFIGURED";
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  visionModel: string;
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}

export interface AiChatCompletionInput {
  messages: AiChatMessage[];
  useVision?: boolean;
  temperature?: number;
}

const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_AI_MODEL = "gpt-4.1-mini";

const asString = (value: unknown) => String(value || "").trim();

export const resolveAiProviderConfig = (env: Record<string, unknown> = {}): AiProviderConfig => {
  const baseUrl = asString(env.TOUCHX_AI_BASE_URL) || DEFAULT_AI_BASE_URL;
  const apiKey = asString(env.TOUCHX_AI_API_KEY);
  const chatModel = asString(env.TOUCHX_AI_CHAT_MODEL) || DEFAULT_AI_MODEL;
  const visionModel = asString(env.TOUCHX_AI_VISION_MODEL) || chatModel;
  return {
    enabled: Boolean(apiKey),
    reason: apiKey ? "" : "AI_PROVIDER_NOT_CONFIGURED",
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    chatModel,
    visionModel,
  };
};

export const requestAiChatCompletion = async (
  config: AiProviderConfig,
  input: AiChatCompletionInput,
  fetcher: typeof fetch = fetch,
) => {
  if (!config.enabled) {
    throw new Error(config.reason || "AI_PROVIDER_NOT_CONFIGURED");
  }
  const response = await fetcher(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.useVision ? config.visionModel : config.chatModel,
      messages: input.messages,
      temperature: Number.isFinite(input.temperature) ? input.temperature : 0.2,
    }),
  });
  if (!response.ok) {
    throw new Error(`AI_PROVIDER_REQUEST_FAILED_${response.status}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
  return asString(payload.choices?.[0]?.message?.content);
};
