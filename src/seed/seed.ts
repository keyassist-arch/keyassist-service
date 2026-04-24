/**
 * Run after DB is up: pnpm run seed
 * Creates admin (ADMIN_SUPER) and test user with known passwords.
 */
import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../common/enums/role.enum';
import { Product } from '../products/entities/product.entity';
import { ImportedProduct } from '../products/entities/imported-product.entity';
import { ImportStatus } from '../common/enums/import-status.enum';
import { ProductSource } from '../common/enums/product-source.enum';

async function main() {
  const url =
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@127.0.0.1:5432/unified_commerce';
  const ds = new DataSource({
    type: 'postgres',
    url,
    entities: [User, Product, ImportedProduct],
    synchronize: (process.env.NODE_ENV ?? '') === 'development',
  });
  await ds.initialize();
  const users = ds.getRepository(User);

  const adminEmail = 'admin@example.com';
  let admin = await users.findOne({ where: { email: adminEmail } });
  if (!admin) {
    admin = users.create({
      firstName: 'Admin',
      lastName: 'User',
      email: adminEmail,
      passwordHash: await bcrypt.hash('Admin123!seed', 10),
      role: UserRole.ADMIN_SUPER,
      phone: '+10000000001',
      emailVerifiedAt: new Date(),
    });
    await users.save(admin);
    console.log('Created admin:', adminEmail, 'password: Admin123!seed');
  }

  const userEmail = 'user@example.com';
  let user = await users.findOne({ where: { email: userEmail } });
  if (!user) {
    user = users.create({
      firstName: 'Test',
      lastName: 'Customer',
      email: userEmail,
      passwordHash: await bcrypt.hash('User123!seed', 10),
      role: UserRole.USER,
      phone: '+10000000002',
      emailVerifiedAt: new Date(),
      defaultShippingAddress: {
        fullName: 'Test User',
        line1: '1 Test St',
        city: 'Lagos',
        country: 'NG',
        postalCode: '100001',
      },
    });
    await users.save(user);
    console.log('Created user:', userEmail, 'password: User123!seed');
  }

  const products = ds.getRepository(Product);
  const imports = ds.getRepository(ImportedProduct);
  const demoUrl = 'https://example.com/seed-demo-product';
  let product = await products.findOne({ where: { sourceUrl: demoUrl } });
  if (!product) {
    product = products.create({
      sourceUrl: demoUrl,
      source: ProductSource.GENERIC,
      slug: 'seed-demo-product',
      title: 'Seed Demo Product',
      description: 'Sample catalog row for API testing',
      brand: 'Demo',
      originalPrice: '100.00',
      currency: 'USD',
      markupPercent: '10.00',
      salePrice: '110.00',
      images: ['https://via.placeholder.com/400'],
      variants: [{ name: 'Size', options: ['S', 'M', 'L'] }],
      availability: 'in_stock',
      lastScrapedAt: new Date(),
      lastVerifiedAt: new Date(),
      rescrapeEnabled: true,
    });
    await products.save(product);
    const imp = imports.create({
      sourceUrl: demoUrl,
      source: ProductSource.GENERIC,
      status: ImportStatus.COMPLETED,
      product,
    });
    await imports.save(imp);
    console.log('Created demo product id:', product.id);
  }

  await ds.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
