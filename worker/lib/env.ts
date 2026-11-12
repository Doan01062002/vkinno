/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  FILES: R2Bucket;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  SEPAY_WEBHOOK_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  GOOGLE_SCRIPT_WEBHOOK_URL?: string;
  GOOGLE_SCRIPT_SECRET?: string;
  GOOGLE_SHEET_ID?: string;
  APPSHEET_APP_URL?: string;
}
