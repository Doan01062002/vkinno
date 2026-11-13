import {
  BarChart3,
  Building2,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { CustomerDetail } from './pages/CustomerDetail';
import { Customers } from './pages/Customers';
import { Dashboard } from './pages/Dashboard';
import { DebtDetail } from './pages/DebtDetail';
import { Debts } from './pages/Debts';
import { Inventory } from './pages/Inventory';
import { Ledger } from './pages/Ledger';
import { OrderCreate } from './pages/OrderCreate';
import { OrderDetail } from './pages/OrderDetail';
import { OrderImport } from './pages/OrderImport';
import { Orders } from './pages/Orders';
import { Placeholder } from './pages/Placeholder';
import { ProductEdit } from './pages/ProductEdit';
import { Products } from './pages/Products';
import { Reports } from './pages/Reports';
import { QuoteEdit } from './pages/QuoteEdit';
import { Quotes } from './pages/Quotes';
import { Settings as SettingsPage } from './pages/Settings';
import { StockDocEdit } from './pages/StockDocEdit';
import { StockDocs } from './pages/StockDocs';
import { StockMovement } from './pages/StockMovement';
import { SupplierDetail } from './pages/SupplierDetail';
import { Suppliers } from './pages/Suppliers';

/** Mục menu trái (spec mục 10). `slug` là đoạn đầu đường dẫn dưới /quan-tri. */
export interface MenuItem {
  slug: string;
  label: string;
  icon: LucideIcon;
  /** Chỉ ADMIN thấy và vào được (STAFF mở thẳng URL thì thấy trang "Không có quyền"). */
  adminOnly?: boolean;
}

export const MENU: MenuItem[] = [
  { slug: 'tong-quan', label: 'Tổng quan', icon: LayoutDashboard },
  { slug: 'don-hang', label: 'Đơn hàng', icon: ShoppingCart },
  { slug: 'bao-gia', label: 'Báo giá', icon: FileText },
  { slug: 'khach-hang', label: 'Khách hàng', icon: Users },
  { slug: 'cong-no', label: 'Công nợ', icon: Wallet },
  { slug: 'san-pham', label: 'Sản phẩm', icon: Package },
  { slug: 'kho', label: 'Kho', icon: Warehouse },
  { slug: 'nha-cung-cap', label: 'Nhà cung cấp', icon: Building2 },
  { slug: 'bao-cao', label: 'Báo cáo', icon: BarChart3, adminOnly: true },
  { slug: 'cai-dat', label: 'Cài đặt', icon: Settings, adminOnly: true },
];

/** Màn hình trong vỏ ứng dụng (sau đăng nhập). */
export interface ScreenRoute {
  /** Đường dẫn dưới /quan-tri, có thể có tham số: `'don-hang/:id'`. */
  path: string;
  /** Tiêu đề trên breadcrumb (vd. "Chi tiết đơn"). */
  title: string;
  /** Mục menu cha để tô sáng menu, dựng breadcrumb và áp quyền `adminOnly`. */
  section: string;
  element: ReactNode;
}

const placeholder = (slug: string, label: string): ScreenRoute => ({
  path: slug,
  title: label,
  section: slug,
  element: <Placeholder title={label} />,
});

/**
 * Bảng route duy nhất. Task 16–19 thay `placeholder(...)` bằng màn hình thật và thêm route con,
 * vd. `{ path: 'don-hang/:id', title: 'Chi tiết đơn', section: 'don-hang', element: <OrderDetail /> }`.
 * Route của mục `adminOnly` tự được bọc RequireAdmin.
 */
const SCREENS: Record<string, ReactNode> = {
  'tong-quan': <Dashboard />,
  'bao-cao': <Reports />,
  'cai-dat': <SettingsPage tab="company" />,
  'don-hang': <Orders />,
  'san-pham': <Products />,
  kho: <Inventory />,
  'khach-hang': <Customers />,
  'nha-cung-cap': <Suppliers />,
  'bao-gia': <Quotes />,
  'cong-no': <Debts />,
};

export const ROUTES: ScreenRoute[] = [
  ...MENU.map((m) => ({ ...placeholder(m.slug, m.label), element: SCREENS[m.slug] ?? <Placeholder title={m.label} /> })),
  { path: 'don-hang/moi', title: 'Tạo đơn', section: 'don-hang', element: <OrderCreate /> },
  { path: 'don-hang/nhap-file', title: 'Nhập file sàn', section: 'don-hang', element: <OrderImport /> },
  { path: 'don-hang/:id', title: 'Chi tiết đơn', section: 'don-hang', element: <OrderDetail /> },
  { path: 'san-pham/moi', title: 'Thêm sản phẩm', section: 'san-pham', element: <ProductEdit /> },
  { path: 'san-pham/:sku', title: 'Sửa sản phẩm', section: 'san-pham', element: <ProductEdit /> },
  { path: 'kho/so-kho/:sku', title: 'Sổ kho', section: 'kho', element: <Ledger /> },
  { path: 'kho/phieu', title: 'Phiếu kho', section: 'kho', element: <StockDocs /> },
  { path: 'kho/phieu/moi', title: 'Phiếu mới', section: 'kho', element: <StockDocEdit /> },
  { path: 'kho/phieu/:id', title: 'Chi tiết phiếu', section: 'kho', element: <StockDocEdit /> },
  { path: 'khach-hang/:id', title: 'Chi tiết khách', section: 'khach-hang', element: <CustomerDetail /> },
  { path: 'nha-cung-cap/:id', title: 'Chi tiết nhà cung cấp', section: 'nha-cung-cap', element: <SupplierDetail /> },
  { path: 'bao-gia/moi', title: 'Tạo báo giá', section: 'bao-gia', element: <QuoteEdit /> },
  { path: 'bao-gia/:id', title: 'Chi tiết báo giá', section: 'bao-gia', element: <QuoteEdit /> },
  { path: 'cong-no/:customerId', title: 'Chi tiết công nợ', section: 'cong-no', element: <DebtDetail /> },
  { path: 'cai-dat/telegram', title: 'Telegram', section: 'cai-dat', element: <SettingsPage tab="telegram" /> },
  { path: 'cai-dat/file-san', title: 'File sàn', section: 'cai-dat', element: <SettingsPage tab="columns" /> },
  { path: 'cai-dat/tai-khoan', title: 'Tài khoản', section: 'cai-dat', element: <SettingsPage tab="users" /> },
  { path: 'cai-dat/nhat-ky', title: 'Nhật ký', section: 'cai-dat', element: <SettingsPage tab="audit" /> },
  { path: 'cai-dat/sao-luu', title: 'Sao lưu', section: 'cai-dat', element: <SettingsPage tab="backup" /> },
  { path: 'kho/nhap-xuat-ton', title: 'Nhập-xuất-tồn', section: 'kho', element: <StockMovement /> },
];

export function menuItem(section: string): MenuItem | undefined {
  return MENU.find((m) => m.slug === section);
}

/** Mục được hiển thị cho vai trò hiện tại. */
export function visibleMenu(isAdmin: boolean): MenuItem[] {
  return MENU.filter((m) => isAdmin || !m.adminOnly);
}
