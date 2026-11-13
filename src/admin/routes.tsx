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
import { Inventory } from './pages/Inventory';
import { Ledger } from './pages/Ledger';
import { Placeholder } from './pages/Placeholder';
import { ProductEdit } from './pages/ProductEdit';
import { Products } from './pages/Products';
import { StockDocEdit } from './pages/StockDocEdit';
import { StockDocs } from './pages/StockDocs';
import { StockMovement } from './pages/StockMovement';

/** Mục menu trái (spec mục 10). `slug` là đoạn đầu đường dẫn dưới /quan-tri. */
export interface MenuItem {
  slug: string;
  label: string;
  icon: LucideIcon;
  /** Chỉ ADMIN thấy và vào được (STAFF bị chuyển về Tổng quan). */
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
  'san-pham': <Products />,
  kho: <Inventory />,
};

export const ROUTES: ScreenRoute[] = [
  ...MENU.map((m) => ({ ...placeholder(m.slug, m.label), element: SCREENS[m.slug] ?? <Placeholder title={m.label} /> })),
  { path: 'san-pham/moi', title: 'Thêm sản phẩm', section: 'san-pham', element: <ProductEdit /> },
  { path: 'san-pham/:sku', title: 'Sửa sản phẩm', section: 'san-pham', element: <ProductEdit /> },
  { path: 'kho/so-kho/:sku', title: 'Sổ kho', section: 'kho', element: <Ledger /> },
  { path: 'kho/phieu', title: 'Phiếu kho', section: 'kho', element: <StockDocs /> },
  { path: 'kho/phieu/moi', title: 'Phiếu mới', section: 'kho', element: <StockDocEdit /> },
  { path: 'kho/phieu/:id', title: 'Chi tiết phiếu', section: 'kho', element: <StockDocEdit /> },
  { path: 'kho/nhap-xuat-ton', title: 'Nhập-xuất-tồn', section: 'kho', element: <StockMovement /> },
];

export function menuItem(section: string): MenuItem | undefined {
  return MENU.find((m) => m.slug === section);
}

/** Mục được hiển thị cho vai trò hiện tại. */
export function visibleMenu(isAdmin: boolean): MenuItem[] {
  return MENU.filter((m) => isAdmin || !m.adminOnly);
}
