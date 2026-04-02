import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from '../../orders/entities/order.entity';

@Entity('order_tracking')
export class OrderTracking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (o) => o.trackingEvents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column()
  carrier: string;

  @Column({ name: 'tracking_number' })
  trackingNumber: string;

  @Column()
  status: string;

  @CreateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
