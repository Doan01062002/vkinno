// Nạp các module đăng ký route quản trị (side effect). Import từ worker/index.ts, KHÔNG từ
// router.ts, để tránh vòng phụ thuộc (module route import `route` từ router.ts).
import './stock-docs';
import './products';
import './uploads';
