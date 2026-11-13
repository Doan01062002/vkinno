// Dùng: node scripts/create-admin.mjs <email> <name> <password>
// In câu lệnh INSERT (mật khẩu đã băm PBKDF2-SHA256, 100000 vòng, muối 16 byte)
// — cùng định dạng với hashPassword trong worker/admin/auth.ts.
import { webcrypto } from 'node:crypto';

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error('Dùng: node scripts/create-admin.mjs <email> <name> <password>');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Mật khẩu tối thiểu 10 ký tự.');
  process.exit(1);
}

const ITERATIONS = 100000;
const salt = webcrypto.getRandomValues(new Uint8Array(16));
const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
  'deriveBits',
]);
const bits = await webcrypto.subtle.deriveBits(
  { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
  key,
  256,
);
const b64 = (u8) => Buffer.from(u8).toString('base64');
const hash = `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
const q = (s) => `'${s.replaceAll("'", "''")}'`;

console.log(
  `INSERT INTO users (email, name, role, password_hash) VALUES (${q(email.toLowerCase())}, ${q(name)}, 'ADMIN', ${q(hash)});`,
);
