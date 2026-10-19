import "dotenv/config";

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const API_TOKEN = process.env.CF_API_TOKEN!;

if (!ACCOUNT_ID || !API_TOKEN) {
  throw new Error("CF_ACCOUNT_ID と CF_API_TOKEN を .env に設定してください");
}

const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run`;

export async function runModel<T = any>(model: string, input: unknown): Promise<T> {
  const res = await fetch(`${BASE}/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Workers AI ${model} failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { success: boolean; result: T; errors?: unknown[] };
  if (!json.success) {
    throw new Error(`Workers AI ${model} returned success=false: ${JSON.stringify(json.errors)}`);
  }
  return json.result;
}

export async function embed(texts: string[]): Promise<number[][]> {
  const result = await runModel<{ data: number[][] }>("@cf/baai/bge-m3", { text: texts });
  return result.data;
}

export async function chat(
  system: string,
  user: string,
  opts: { model?: string; max_tokens?: number; temperature?: number } = {}
): Promise<string> {
  const model = opts.model ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const result = await runModel<{ response: string }>(model, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: opts.max_tokens ?? 1024,
    temperature: opts.temperature ?? 0.3,
  });
  return result.response;
}
