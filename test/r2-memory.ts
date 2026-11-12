/// <reference types="@cloudflare/workers-types" />
// R2 giả trong bộ nhớ: đủ cho test tải ảnh và sao lưu.

interface Stored {
  bytes: Uint8Array;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

async function toBytes(value: unknown): Promise<Uint8Array> {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
  }
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer());
  if (value == null) return new Uint8Array();
  throw new Error('Kiểu dữ liệu R2 không được hỗ trợ trong bộ giả');
}

function meta(key: string, s: Stored) {
  return {
    key,
    size: s.bytes.byteLength,
    uploaded: s.uploaded,
    httpMetadata: s.httpMetadata ?? {},
    customMetadata: s.customMetadata ?? {},
    etag: String(s.bytes.byteLength),
  };
}

function withBody(key: string, s: Stored) {
  const buf = () => s.bytes.slice().buffer as ArrayBuffer;
  return {
    ...meta(key, s),
    body: new Blob([buf()]).stream(),
    arrayBuffer: async () => buf(),
    text: async () => new TextDecoder().decode(s.bytes),
    json: async () => JSON.parse(new TextDecoder().decode(s.bytes)),
    blob: async () => new Blob([buf()]),
  };
}

export function createMemoryR2(): R2Bucket {
  const store = new Map<string, Stored>();
  const bucket = {
    async put(key: string, value: unknown, options?: R2PutOptions) {
      const s: Stored = {
        bytes: await toBytes(value),
        uploaded: new Date(),
        httpMetadata: options?.httpMetadata as R2HTTPMetadata | undefined,
        customMetadata: options?.customMetadata,
      };
      store.set(key, s);
      return meta(key, s);
    },
    async get(key: string) {
      const s = store.get(key);
      return s ? withBody(key, s) : null;
    },
    async head(key: string) {
      const s = store.get(key);
      return s ? meta(key, s) : null;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
    async list(options?: R2ListOptions) {
      const prefix = options?.prefix ?? '';
      const limit = options?.limit ?? 1000;
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const objects = all.slice(0, limit).map((k) => meta(k, store.get(k)!));
      return { objects, truncated: all.length > limit, delimitedPrefixes: [] as string[] };
    },
  };
  return bucket as unknown as R2Bucket;
}
