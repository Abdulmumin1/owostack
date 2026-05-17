export const BASE_CHAT_CREDIT_COST = 5;

export const chatModels = [
  {
    id: "gemini",
    name: "Gemini 3.1 Flash-Lite",
    multiplier: 1,
    premium: false,
  },
  {
    id: "flash",
    name: "Gemini 3 Flash",
    multiplier: 3,
    premium: true,
  },
  {
    id: "pro",
    name: "Gemini 3.1 Pro",
    multiplier: 10,
    premium: true,
  },
] as const;

export type ChatModel = (typeof chatModels)[number];
export type ChatModelId = ChatModel["id"];

export const defaultChatModel = chatModels[0];

export function isChatModelId(value: string): value is ChatModelId {
  return chatModels.some((model) => model.id === value);
}

export function getChatModelById(modelId: string): ChatModel | undefined {
  return chatModels.find((model) => model.id === modelId);
}

export function calculateChatCost(modelId: ChatModelId): number {
  const model = getChatModelById(modelId);

  if (!model) {
    throw new Error(`Unknown chat model: ${modelId}`);
  }

  return BASE_CHAT_CREDIT_COST * model.multiplier;
}
