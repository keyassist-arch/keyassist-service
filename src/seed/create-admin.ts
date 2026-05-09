import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env') });

import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../common/enums/role.enum';

async function main() {
  const url =
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@127.0.0.1:5432/unified_commerce';
  const ds = new DataSource({
    type: 'postgres',
    url,
    entities: [User],
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
  } else {
    console.log('Admin user already exists:', adminEmail);
  }

  await ds.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
