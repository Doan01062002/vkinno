/** Câu lệnh ghi nhật ký thao tác; gộp vào cùng `DB.batch` với thao tác chính. */
export function auditStmt(
  db: D1Database,
  userId: number | null,
  action: string,
  entity: string,
  entityId: string | number,
  detail: object = {},
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, detail_json) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(userId, action, entity, String(entityId), JSON.stringify(detail));
}
