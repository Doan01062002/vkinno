import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, LogIn, Warehouse } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { Button } from '../components/Button';
import { Field, inputClass } from '../components/Field';
import { errorMessage } from '../lib/api';
import { useLogin } from '../lib/auth';

const schema = z.object({
  email: z.string().trim().min(1, 'Vui lòng nhập email.').email('Email không hợp lệ.'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu.'),
});
type LoginInput = z.infer<typeof schema>;

/** Trang đăng nhập `/quan-tri/dang-nhap`; xong thì quay lại trang đang mở trước đó (hoặc Tổng quan). */
export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  const from = (location.state as { from?: string } | null)?.from;
  const next = from && from !== '/dang-nhap' ? from : '/tong-quan';

  const onSubmit = handleSubmit((input) =>
    login.mutate(input, { onSuccess: () => navigate(next, { replace: true }) }),
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-fg shadow-md">
            <Warehouse size={22} aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-bold text-fg">Đăng nhập quản trị</h1>
            <p className="mt-1 text-sm text-muted">VKINNO · Kho & bán hàng</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          noValidate
          className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm"
        >
          {login.isError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>{errorMessage(login.error)}</span>
            </div>
          )}
          <Field label="Email" htmlFor="login-email" error={errors.email?.message}>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              autoFocus
              aria-invalid={errors.email ? true : undefined}
              className={inputClass}
              {...register('email')}
            />
          </Field>
          <Field label="Mật khẩu" htmlFor="login-password" error={errors.password?.message}>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? true : undefined}
              className={inputClass}
              {...register('password')}
            />
          </Field>
          <Button type="submit" loading={login.isPending} className="w-full">
            {!login.isPending && <LogIn size={16} aria-hidden />}
            Đăng nhập
          </Button>
        </form>
      </div>
    </div>
  );
}
