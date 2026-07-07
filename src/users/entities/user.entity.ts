import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../../common/enums/role.enum';
import { AdminPermission } from '../../common/enums/admin-permission.enum';
import { Cart } from '../../cart/entities/cart.entity';
import { Order } from '../../orders/entities/order.entity';

export type ShippingAddress = {
  fullName?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  country: string;
  postalCode?: string;
  phone?: string;
};

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'first_name', type: 'varchar', length: 100, nullable: true })
  firstName: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 100, nullable: true })
  lastName: string | null;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'jsonb', name: 'default_shipping_address', nullable: true })
  defaultShippingAddress: ShippingAddress | null;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({ name: 'refresh_token_hash', type: 'varchar', nullable: true })
  refreshTokenHash: string | null;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ name: 'phone_verified_at', type: 'timestamptz', nullable: true })
  phoneVerifiedAt: Date | null;

  /** bcrypt hash of the current pending WhatsApp OTP code. */
  @Column({ name: 'phone_otp_code_hash', type: 'varchar', nullable: true })
  phoneOtpCodeHash: string | null;

  @Column({ name: 'phone_otp_expires_at', type: 'timestamptz', nullable: true })
  phoneOtpExpiresAt: Date | null;

  @Column({ name: 'phone_otp_attempts', type: 'int', default: 0 })
  phoneOtpAttempts: number;

  /** Used to rate-limit resends independently of the throttler (survives restarts). */
  @Column({ name: 'phone_otp_sent_at', type: 'timestamptz', nullable: true })
  phoneOtpSentAt: Date | null;

  @Column({ name: 'totp_enabled', type: 'boolean', default: false })
  totpEnabled: boolean;

  /** Set when 2FA is active (authenticator secret, base32). */
  @Column({ name: 'totp_secret', type: 'varchar', length: 64, nullable: true })
  totpSecret: string | null;

  /** Pending secret during setup; cleared after enable or cancel. */
  @Column({
    name: 'totp_setup_secret',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  totpSetupSecret: string | null;

  @Column({ name: 'stripe_customer_id', type: 'varchar', nullable: true })
  stripeCustomerId: string | null;

  /** Screens an ADMIN_STAFF user may access. Ignored for ADMIN_SUPER (implicit all-access). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  permissions: AdminPermission[];

  /** Set to soft-disable an admin account (blocks login) without deleting the row. */
  @Column({ name: 'admin_disabled_at', type: 'timestamptz', nullable: true })
  adminDisabledAt: Date | null;

  @OneToOne(() => Cart, (c) => c.user)
  cart: Cart | null;

  @OneToMany(() => Order, (o) => o.user)
  orders: Order[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
