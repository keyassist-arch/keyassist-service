import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('saved_payment_methods')
@Index('idx_saved_payment_methods_user', ['userId'])
export class SavedPaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 32 })
  provider: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  type: string | null;

  @Column({ type: 'varchar', length: 128 })
  label: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  brand: string | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  last4: string | null;

  @Column({ name: 'expiry_month', type: 'smallint', nullable: true })
  expiryMonth: number | null;

  @Column({ name: 'expiry_year', type: 'smallint', nullable: true })
  expiryYear: number | null;

  @Column({ name: 'stripe_payment_method_id', type: 'varchar', nullable: true })
  stripePaymentMethodId: string | null;

  @Column({ name: 'stripe_customer_id', type: 'varchar', nullable: true })
  stripeCustomerId: string | null;

  @Column({ name: 'paypal_payment_token_id', type: 'varchar', nullable: true })
  paypalPaymentTokenId: string | null;

  @Column({ name: 'paypal_email', type: 'varchar', nullable: true })
  paypalEmail: string | null;

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
