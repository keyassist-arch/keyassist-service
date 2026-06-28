import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BatchStatus } from '../../common/enums/batch-status.enum';
import { WannaBuyItem } from './wanna-buy-item.entity';

@Entity('batches')
export class Batch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: BatchStatus, default: BatchStatus.COLLECTING })
  status: BatchStatus;

  @Column({ type: 'varchar', length: 128, nullable: true })
  label: string | null;

  @Column({ name: 'processing_started_at', type: 'timestamptz', nullable: true })
  processingStartedAt: Date | null;

  @Column({ name: 'placing_orders_at', type: 'timestamptz', nullable: true })
  placingOrdersAt: Date | null;

  @Column({ name: 'in_transit_at', type: 'timestamptz', nullable: true })
  inTransitAt: Date | null;

  @Column({ name: 'at_warehouse_at', type: 'timestamptz', nullable: true })
  atWarehouseAt: Date | null;

  @Column({ name: 'shipped_at', type: 'timestamptz', nullable: true })
  shippedAt: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @OneToMany(() => WannaBuyItem, (i) => i.batch)
  items: WannaBuyItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
