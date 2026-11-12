export async function timingSafeCompare(input: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(input)),
    crypto.subtle.digest("SHA-256", enc.encode(secret)),
  ]);
  const subtleAny = crypto.subtle as unknown as {
    timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean;
  };
  if (typeof subtleAny.timingSafeEqual === "function") {
    return subtleAny.timingSafeEqual(hashA, hashB);
  }
  const viewA = new Uint8Array(hashA);
  const viewB = new Uint8Array(hashB);
  let diff = viewA.length ^ viewB.length;
  for (let i = 0; i < viewA.length; i++) {
    diff |= viewA[i] ^ (viewB[i] ?? 0);
  }
  return diff === 0;
}

export function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacSign(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toHex(sig);
}
