import type { Env } from './env';

export async function sendTelegramAlert(env: Env, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
    });
  } catch {
    // Non-blocking alert hook: never fail customer/webhook flow if Telegram is unreachable
  }
}

export async function syncToGoogleSheetsRealtime(
  env: Env,
  payload: Record<string, unknown>
): Promise<{
  ok: boolean;
  mode: "GOOGLE_SHEETS_APPS_SCRIPT_LIVE" | "LOCAL_DEV_REALTIME_MIRROR";
  latency_ms: number;
  picking_guide_text?: string;
}> {
  const t0 = Date.now();
  const webhookUrl = (env.GOOGLE_SCRIPT_WEBHOOK_URL || "").trim();
  if (!webhookUrl || !webhookUrl.startsWith("https://script.google.com/")) {
    return {
      ok: true,
      mode: "LOCAL_DEV_REALTIME_MIRROR",
      latency_ms: Math.max(1, Date.now() - t0),
      picking_guide_text:
        typeof payload.picking_guide_text === "string" ? payload.picking_guide_text : undefined,
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3200);
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        secret: env.GOOGLE_SCRIPT_SECRET || "",
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return {
      ok: res.ok,
      mode: "GOOGLE_SHEETS_APPS_SCRIPT_LIVE",
      latency_ms: Math.max(1, Date.now() - t0),
      picking_guide_text:
        typeof payload.picking_guide_text === "string" ? payload.picking_guide_text : undefined,
    };
  } catch {
    return {
      ok: false,
      mode: "GOOGLE_SHEETS_APPS_SCRIPT_LIVE",
      latency_ms: Math.max(1, Date.now() - t0),
      picking_guide_text:
        typeof payload.picking_guide_text === "string" ? payload.picking_guide_text : undefined,
    };
  }
}

/** Phản chiếu sự kiện sang Google Sheets ở nền; không bao giờ làm hỏng luồng chính. */
export function mirrorEvent(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  event: string,
  payload: object,
): void {
  ctx.waitUntil(
    syncToGoogleSheetsRealtime(env, { event, ...payload }).then(
      () => undefined,
      () => undefined,
    ),
  );
}
