import type { ModelOption } from "./modelCatalog";

const GOETHE_MODELS_URL =
  "https://litellm.s.studiumdigitale.uni-frankfurt.de/v1/models";

let goetheModelsCache:
  | {
      apiKey: string;
      models: ModelOption[];
    }
  | undefined;

export async function fetchGoetheModels(apiKey: string): Promise<ModelOption[]> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    return [];
  }

  if (goetheModelsCache?.apiKey === trimmedApiKey) {
    return goetheModelsCache.models;
  }

  const response = await fetch(GOETHE_MODELS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${trimmedApiKey}`,
      "Content-Type": "application/json",
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
    data?: Array<{ id?: string }>;
  };

  const models = (data.data ?? [])
    .map((entry) => String(entry.id ?? "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .map((id) => ({ label: id, value: id }));

  goetheModelsCache = {
    apiKey: trimmedApiKey,
    models,
  };
  return models;
}

export function clearGoetheModelsCache() {
  goetheModelsCache = undefined;
}