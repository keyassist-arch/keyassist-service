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

@Entity('passkey_credentials')
@Index('idx_passkey_credentials_user', ['userId'])
export class PasskeyCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** base64url-encoded credential ID as returned by the authenticator */
  @Column({ name: 'credential_id', type: 'varchar', unique: true })
  credentialId: string;

  /** base64url-encoded COSE public key */
  @Column({ name: 'public_key', type: 'text' })
  publicKey: string;

  /** Signature counter — must increase on every authentication */
  @Column({ type: 'bigint', default: 0 })
  counter: number;

  /** 'singleDevice' | 'multiDevice' */
  @Column({ name: 'device_type', type: 'varchar', length: 32, default: 'singleDevice' })
  deviceType: string;

  @Column({ name: 'backed_up', type: 'boolean', default: false })
  backedUp: boolean;

  /** AuthenticatorTransport[] — 'ble' | 'hybrid' | 'internal' | 'nfc' | 'usb' */
  @Column({ type: 'jsonb', default: [] })
  transports: string[];

  /** Optional human-readable label set by the user (e.g. "My iPhone") */
  @Column({ name: 'friendly_name', type: 'varchar', length: 128, nullable: true })
  friendlyName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
