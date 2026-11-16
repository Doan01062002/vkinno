// Gọi Gemini API (Google AI Studio) bằng fetch thuần: generateContent, đầu ra JSON.
// Tài liệu tra 16/11/2026: https://aistudio.google.com/api-reference/generate-content

export class GeminiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export interface GeminiResult {
  text: string;
  finishReason: string;
  usage: { prompt: number; output: number; thoughts: number };
  modelVersion: string;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
  error?: { message?: string; status?: string };
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL_RE = /^[a-z0-9][a-z0-9.\-]{1,63}$/;

async function post(apiKey: string, model: string, body: unknown, timeoutMs: number): Promise<Response> {
  return fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Thông điệp lỗi gọn từ phản hồi lỗi của Gemini (không lộ khoá). */
async function errorText(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as GeminiResponse;
    return j.error?.message?.slice(0, 300) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Sinh nội dung JSON. Nếu API từ chối `thinkingConfig` (HTTP 400 nhắc tới thinking) thì gửi lại một lần
 * không có trường này. Ném GeminiError khi HTTP lỗi, bị chặn, hoặc dừng không phải `STOP`.
 */
export async function generateJson(opts: {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<GeminiResult> {
  if (!MODEL_RE.test(opts.model)) throw new GeminiError(`Tên model không hợp lệ: ${opts.model}`, 400);
  const base = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: opts.maxOutputTokens ?? 32768,
    } as Record<string, unknown>,
  };
  const withThinking = {
    ...base,
    generationConfig: { ...base.generationConfig, thinkingConfig: { thinkingLevel: 'LOW' } },
  };
  const timeout = opts.timeoutMs ?? 180_000;
  let res = await post(opts.apiKey, opts.model, withThinking, timeout);
  if (res.status === 400) {
    const msg = await errorText(res);
    if (!/thinking/i.test(msg)) throw new GeminiError(`Gemini từ chối yêu cầu: ${msg}`, 400);
    res = await post(opts.apiKey, opts.model, base, timeout);
  }
  if (!res.ok) throw new GeminiError(`Gemini lỗi ${res.status}: ${await errorText(res)}`, res.status);
  const data = (await res.json()) as GeminiResponse;
  if (data.promptFeedback?.blockReason) {
    throw new GeminiError(`Gemini chặn yêu cầu: ${data.promptFeedback.blockReason}`, 422);
  }
  const cand = data.candidates?.[0];
  const finishReason = cand?.finishReason ?? 'UNKNOWN';
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (finishReason !== 'STOP') {
    throw new GeminiError(`Gemini dừng bất thường (${finishReason})${finishReason === 'MAX_TOKENS' ? ': bài bị cắt cụt' : ''}`, 502);
  }
  if (!text.trim()) throw new GeminiError('Gemini trả về nội dung rỗng', 502);
  return {
    text,
    finishReason,
    modelVersion: data.modelVersion ?? opts.model,
    usage: {
      prompt: data.usageMetadata?.promptTokenCount ?? 0,
      output: data.usageMetadata?.candidatesTokenCount ?? 0,
      thoughts: data.usageMetadata?.thoughtsTokenCount ?? 0,
    },
  };
}

/** Lấy JSON từ chuỗi trả về (bỏ rào ```json nếu có). */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a !== -1 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('Không đọc được JSON từ Gemini');
  }
}
