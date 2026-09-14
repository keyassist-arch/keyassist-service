/**
 * Backend script to create or update an Admin user (ADMIN_SUPER or ADMIN_STAFF).
 * Automatically generates a secure random password (or accepts a custom one)
 * and assigns the appropriate role and permissions.
 *
 * Usage:
 *   pnpm run create:admin -- --email=admin@example.com --name="Super Admin"
 *   pnpm run create:admin -- --email=staff@example.com --role=ADMIN_STAFF --permissions=ORDERS,PRODUCTS
 *   pnpm run create:admin -- --email=admin@example.com --password="CustomPassword123!" --force
 *
 * Flags:
 *   --email        Admin email (default: admin@example.com or ADMIN_EMAIL env)
 *   --firstName    Admin first name (default: Admin or ADMIN_FIRST_NAME env)
 *   --lastName     Admin last name (default: User or ADMIN_LAST_NAME env)
 *   --role         ADMIN_SUPER | ADMIN_STAFF (default: ADMIN_SUPER)
 *   --password     Custom password (if omitted, a secure 18-character password is automatically generated)
 *   --permissions  Comma-separated list of permissions for ADMIN_STAFF (ORDERS,PRODUCTS,REFUNDS,ISSUES,SHIPPING_RATES)
 *   --force        Update existing user if email is already taken
 */
import 'reflect-metadata';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { resolve } from 'path';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../common/enums/role.enum';
import { AdminPermission } from '../common/enums/admin-permission.enum';
import { Cart } from '../cart/entities/cart.entity';
import { Product } from '../products/entities/product.entity';
import { ImportedProduct } from '../products/entities/imported-product.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderTracking } from '../tracking/entities/order-tracking.entity';
import { Refund } from '../reconciliation/entities/refund.entity';
import { CustomerIssue } from '../reconciliation/entities/customer-issue.entity';
import { ShippingRates } from '../shipping/entities/shipping-rates.entity';
import { SavedPaymentMethod } from '../payment/entities/saved-payment-method.entity';

config({ path: resolve(process.cwd(), '.env') });

function parseArgs() {
  const args: Record<string, string | boolean> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const parts = arg.substring(2).split('=');
      const key = parts[0];
      const value = parts.length > 1 ? parts.slice(1).join('=') : true;
      args[key] = value;
    }
  }
  return args;
}

/**
 * Generates a strong, random 18-character password containing uppercase,
 * lowercase, numbers, and symbols.
 */
function generateSecurePassword(length = 18): string {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()_+~|}{[]:;?><,.-=';
  const allChars = lowercase + uppercase + numbers + symbols;

  // Ensure at least one character from each set
  const required = [
    lowercase[crypto.randomInt(0, lowercase.length)],
    uppercase[crypto.randomInt(0, uppercase.length)],
    numbers[crypto.randomInt(0, numbers.length)],
    symbols[crypto.randomInt(0, symbols.length)],
  ];

  const remainingLength = length - required.length;
  const randomChars: string[] = [];
  for (let i = 0; i < remainingLength; i++) {
    randomChars.push(allChars[crypto.randomInt(0, allChars.length)]);
  }

  // Shuffle array using Fisher-Yates with crypto
  const fullArray = [...required, ...randomChars];
  for (let i = fullArray.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [fullArray[i], fullArray[j]] = [fullArray[j], fullArray[i]];
  }

  return fullArray.join('');
}

function parsePermissions(
  permissionsArg: string | boolean | undefined,
  role: UserRole,
): AdminPermission[] {
  if (role === UserRole.ADMIN_SUPER) {
    return Object.values(AdminPermission);
  }

  if (typeof permissionsArg === 'string' && permissionsArg.trim().length > 0) {
    const validPerms = new Set(Object.values(AdminPermission));
    const requested = permissionsArg
      .split(',')
      .map((p) => p.trim().toUpperCase());
    const valid: AdminPermission[] = [];
    for (const p of requested) {
      if (validPerms.has(p as AdminPermission)) {
        valid.push(p as AdminPermission);
      } else {
        console.warn(`[Warning] Unknown permission '${p}' ignored.`);
      }
    }
    return valid;
  }

  // Default staff permissions: all permissions
  return Object.values(AdminPermission);
}

async function main() {
  const args = parseArgs();

  const email = (
    (args.email as string) ||
    process.env.ADMIN_EMAIL ||
    'admin@example.com'
  )
    .trim()
    .toLowerCase();

  const firstName = (
    (args.firstName as string) ||
    process.env.ADMIN_FIRST_NAME ||
    'Admin'
  ).trim();

  const lastName = (
    (args.lastName as string) ||
    process.env.ADMIN_LAST_NAME ||
    'User'
  ).trim();

  const roleArg = (
    (args.role as string) ||
    process.env.ADMIN_ROLE ||
    'ADMIN_SUPER'
  )
    .trim()
    .toUpperCase();

  const role =
    roleArg === 'ADMIN_STAFF' ? UserRole.ADMIN_STAFF : UserRole.ADMIN_SUPER;

  const permissions = parsePermissions(args.permissions, role);

  const plainPassword =
    typeof args.password === 'string' && args.password.length > 0
      ? args.password
      : generateSecurePassword(18);

  const isForceUpdate = Boolean(args.force || args.update);

  const url =
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@127.0.0.1:5432/unified_commerce';

  const ds = new DataSource({
    type: 'postgres',
    url,
    entities: [
      User,
      Cart,
      Product,
      ImportedProduct,
      Order,
      OrderItem,
      OrderTracking,
      Refund,
      CustomerIssue,
      ShippingRates,
      SavedPaymentMethod,
    ],
    synchronize: false,
  });

  console.log('\nConnecting to database...');
  await ds.initialize();
  const usersRepo = ds.getRepository(User);

  try {
    let user = await usersRepo.findOne({ where: { email } });

    if (user && !isForceUpdate) {
      console.error(
        `\n[Error] User with email '${email}' already exists (ID: ${user.id}, Role: ${user.role}).`,
      );
      console.log(
        'To overwrite password and update admin role/permissions, run again with the --force flag:\n',
      );
      console.log(
        `  pnpm run create:admin -- --email="${email}" --force\n`,
      );
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(plainPassword, 10);

    if (user) {
      console.log(`\nUpdating existing user '${email}' to ${role}...`);
      user.firstName = firstName;
      user.lastName = lastName;
      user.role = role;
      user.permissions = permissions;
      user.passwordHash = passwordHash;
      user.emailVerifiedAt = user.emailVerifiedAt || new Date();
      user.adminDisabledAt = null;
      user.refreshTokenHash = null;
      user = await usersRepo.save(user);
      console.log('User successfully updated!');
    } else {
      console.log(`\nCreating new admin user '${email}' with role ${role}...`);
      user = usersRepo.create({
        email,
        firstName,
        lastName,
        role,
        permissions,
        passwordHash,
        emailVerifiedAt: new Date(),
        adminDisabledAt: null,
      });
      user = await usersRepo.save(user);
      console.log('Admin user successfully created!');
    }

    console.log('\n========================================================');
    console.log('                 ADMIN CREDENTIALS                      ');
    console.log('========================================================');
    console.log(`  User ID:     ${user.id}`);
    console.log(`  Email:       ${user.email}`);
    console.log(`  Name:        ${user.firstName} ${user.lastName}`);
    console.log(`  Role:        ${user.role}`);
    console.log(`  Permissions: ${JSON.stringify(user.permissions)}`);
    console.log(`  Password:    ${plainPassword}`);
    console.log('========================================================');
    console.log(
      'IMPORTANT: Copy and store the password in a secure password manager.\n',
    );
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('\nFatal error executing create-admin script:', err);
  process.exit(1);
});
