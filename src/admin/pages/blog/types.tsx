// Kiểu dữ liệu API cẩm nang (worker/blog/admin.ts).

export type PostStatus = 'draft' | 'review' | 'published' | 'archived';

export interface PostListRow {
  id: number;
  slug: string;
  title: string;
  status: PostStatus;
  origin: 'manual' | 'ai';
  word_count: number;
  primary_keyword: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  quality_notes: string;
  topic_id: number | null;
}

export interface Quality {
  wordCount: number;
  blocking: string[];
  warnings: string[];
}

export interface PostDetail extends PostListRow {
  seo_title: string;
  meta_description: string;
  summary: string;
  content_html: string;
  faq_json: string;
  image_url: string;
  image_alt: string;
  related_skus_json: string;
  ai_model: string | null;
  quality: Quality;
}

export interface TopicRow {
  id: number;
  primary_keyword: string;
  angle: string;
  cluster: string;
  related_skus_json: string;
  priority: number;
  status: 'pending' | 'used' | 'failed' | 'skipped';
  post_id: number | null;
  post_title: string | null;
  attempts: number;
  last_error: string | null;
}

export interface RunRow {
  id: number;
  run_date: string;
  trigger: 'cron' | 'manual';
  status: 'ok' | 'rejected' | 'error' | 'skipped';
  model: string;
  prompt_tokens: number;
  output_tokens: number;
  thoughts_tokens: number;
  message: string;
  post_id: number | null;
  created_at: string;
}

export interface BlogStatus {
  enabled: boolean;
  auto_publish: boolean;
  model: string;
  author: string;
  has_api_key: boolean;
  pending_topics: number;
  manual_runs_today: number;
  manual_runs_limit: number;
  runs: RunRow[];
}

export const STATUS_META: Record<PostStatus, { label: string; className: string }> = {
  draft: { label: 'Nháp', className: 'bg-muted/10 text-muted' },
  review: { label: 'Chờ duyệt', className: 'bg-warning/10 text-warning' },
  published: { label: 'Đã đăng', className: 'bg-success/10 text-success' },
  archived: { label: 'Đã gỡ', className: 'bg-muted/10 text-muted' },
};

export function PostStatusBadge({ status }: { status: PostStatus }) {
  const m = STATUS_META[status];
  return <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${m.className}`}>{m.label}</span>;
}

/** Sản phẩm có thể gắn vào bài (khớp SKU trong src/data/products.ts). */
export const BLOG_SKUS: { sku: string; label: string }[] = [
  { sku: 'VK-SOLAR-SHIELD-5L', label: 'Solar Shield 5L' },
  { sku: 'VK-BOSSMAN-DESCALER-500ML', label: 'Bossman tẩy cặn canxi 500ml' },
  { sku: 'VK-DEGREASER-500ML', label: 'Tẩy dầu mỡ VKINNO 500ml' },
  { sku: 'VK-COMBO-BOSSMAN-VKINNO-500ML', label: 'Combo Bossman + tẩy dầu mỡ' },
  { sku: 'VK-CLEARWAY-GLASSPRO-500ML', label: 'ClearWay GlassPro 500ml' },
  { sku: 'VK-CLEARWAY-GLASSPRO-5L', label: 'ClearWay GlassPro 5L' },
  { sku: 'VK-VISIONX-CLEAN-500ML', label: 'VisionX Clean 500ml' },
  { sku: 'VK-CLEARWAY-AUTO-5L', label: 'ClearWay rửa kính ô tô 5L' },
  { sku: 'VK-BOTTLE-SPRAY-500ML', label: 'Bình xịt 500ml' },
];

export function parseList<T>(raw: string | null | undefined): T[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
