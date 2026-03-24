import type { ChatMessage } from "./chatClient";
import type { ModelOption } from "./modelCatalog";

export interface OllamaChatParams {
  port: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "json_object" };
}

function normalizePort(port: string): string {
  const trimmed = port.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Invalid Ollama port. Enter a numeric port such as 11434.");
  }
  return trimmed;
}

export function getOllamaBaseUrl(port: string): string {
  return `http://127.0.0.1:${normalizePort(port)}`;
}

export async function fetchOllamaRunningModels(port: string): Promise<ModelOption[]> {
  const response = await fetch(`${getOllamaBaseUrl(port)}/api/ps`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Model fetch failed ${response.status} ${response.statusText}${
        errorText ? `: ${errorText}` : ""
      }`,
    );
  }

  const data = (await response.json()) as {
    models?: Array<{ name?: string; model?: string }>;
  };

  return (data.models ?? [])
    .map((entry) => String(entry.name ?? entry.model ?? "").trim())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ label: value, value }));
}

export async function sendOllamaChat(params: OllamaChatParams): Promise<string> {
  const { port, model, messages, temperature = 0.2, maxTokens, responseFormat } =
    params;

  if (!model.trim()) {
    throw new Error("Missing model for provider: ollama");
  }

  const response = await fetch(`${getOllamaBaseUrl(port)}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature,
        ...(typeof maxTokens === "number" ? { num_predict: maxTokens } : {}),
      },
      ...(responseFormat ? { format: "json" } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Chat completion failed (ollama) ${response.status} ${response.statusText} ${
        errorText ? `\n${errorText}` : ""
      }`,
    );
  }

  const data = (await response.json()) as {
    message?: { content?: string };
  };
  const content = data.message?.content;

  if (!content) {
    throw new Error("Invalid chat completion response from ollama");
  }

  return content;
}