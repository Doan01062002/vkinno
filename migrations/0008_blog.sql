-- 0008: Cẩm nang (blog) trong D1 + hàng đợi chủ đề + nhật ký tự viết bài (Dự án 1c).
-- Spec: docs/superpowers/specs/2026-11-16-cam-nang-seo-tu-dong-design.md
-- Hoàn tác: DROP TABLE blog_runs; DROP TABLE blog_topics; DROP TABLE blog_posts;
--           DELETE FROM app_settings WHERE key LIKE 'blog.%';
CREATE TABLE IF NOT EXISTS blog_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  seo_title TEXT NOT NULL DEFAULT '',
  meta_description TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  content_html TEXT NOT NULL DEFAULT '',
  faq_json TEXT NOT NULL DEFAULT '[]',
  image_url TEXT NOT NULL DEFAULT '',
  image_alt TEXT NOT NULL DEFAULT '',
  primary_keyword TEXT NOT NULL DEFAULT '',
  secondary_keywords_json TEXT NOT NULL DEFAULT '[]',
  related_skus_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'archived')),
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'ai')),
  ai_model TEXT,
  topic_id INTEGER,
  word_count INTEGER NOT NULL DEFAULT 0,
  quality_notes TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status_pub ON blog_posts(status, published_at);

CREATE TABLE IF NOT EXISTS blog_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_keyword TEXT NOT NULL UNIQUE,
  angle TEXT NOT NULL DEFAULT '',
  cluster TEXT NOT NULL DEFAULT '',
  related_skus_json TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'failed', 'skipped')),
  post_id INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_blog_topics_queue ON blog_topics(status, priority, id);

CREATE TABLE IF NOT EXISTS blog_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  topic_id INTEGER,
  post_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ok', 'rejected', 'error', 'skipped')),
  model TEXT NOT NULL DEFAULT '',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  thoughts_tokens INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_blog_runs_date ON blog_runs(run_date, trigger, status);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('blog.enabled', '1'),
  ('blog.auto_publish', '0'),
  ('blog.model', 'gemini-3.8-flash'),
  ('blog.author', 'Phòng Kỹ thuật VKINNO');
