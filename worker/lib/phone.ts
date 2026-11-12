export function normalizeVnPhone(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+84")) digits = "0" + digits.slice(3);
  else if (digits.startsWith("84") && digits.length === 11) digits = "0" + digits.slice(2);
  return digits.replace(/\D/g, "");
}

export function isValidVnPhone(phone: string): boolean {
  return /^0[235789]\d{8,9}$/.test(phone);
}
