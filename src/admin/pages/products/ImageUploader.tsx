import { ImagePlus, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { apiFetch } from '../../lib/api';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface ImageUploaderProps {
  /** Đường dẫn ảnh hiện tại (`/files/products/…` hoặc URL ngoài). */
  value: string;
  onChange: (url: string) => void;
}

/** Chọn ảnh → xem trước ngay (object URL) → tải lên POST /uploads/image → dùng URL /files. */
export function ImageUploader({ value, onChange }: ImageUploaderProps) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const objectUrl = useRef<string | null>(null);

  const release = () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  };
  useEffect(() => release, []);

  const upload = async (file: File) => {
    if (!TYPES.includes(file.type)) return toast.error('Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.');
    if (file.size > MAX_BYTES) return toast.error('Ảnh vượt quá 5 MB.');
    release();
    if (typeof URL.createObjectURL === 'function') {
      objectUrl.current = URL.createObjectURL(file);
      setPreview(objectUrl.current);
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch<{ key: string; url: string }>('/uploads/image', { method: 'POST', body: form });
      onChange(res.url);
      setPreview(null);
      release();
      toast.success('Đã tải ảnh lên.');
    } catch (e) {
      setPreview(null);
      release();
      toast.error(e, { action: { label: 'Thử lại', onClick: () => void upload(file) } });
    } finally {
      setUploading(false);
    }
  };

  const shown = preview ?? value;
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-subtle">
        {shown ? (
          <img src={shown} alt="Ảnh sản phẩm" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus size={24} className="text-muted" aria-hidden />
        )}
      </div>
      <div className="space-y-1">
        <input
          ref={inputRef}
          type="file"
          accept={TYPES.join(',')}
          aria-label="Chọn ảnh sản phẩm"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
        <Button variant="secondary" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ImagePlus size={14} aria-hidden />}
          {uploading ? 'Đang tải lên…' : value ? 'Đổi ảnh' : 'Tải ảnh lên'}
        </Button>
        <p className="text-xs text-muted">JPEG, PNG hoặc WebP, tối đa 5 MB.</p>
      </div>
    </div>
  );
}
