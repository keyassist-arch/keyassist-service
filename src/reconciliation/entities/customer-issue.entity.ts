import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Order } from '../../orders/entities/order.entity';
import { User } from '../../users/entities/user.entity';
import { IssueStatus, IssuePriority, IssueType } from '../enums/issue-status.enum';

@Entity('customer_issues')
export class CustomerIssue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'order_id' })
  order: Order | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: IssueType,
    default: IssueType.OTHER,
  })
  type: IssueType;

  @Column({
    type: 'enum',
    enum: IssueStatus,
    default: IssueStatus.OPEN,
  })
  status: IssueStatus;

  @Column({
    type: 'enum',
    enum: IssuePriority,
    default: IssuePriority.MEDIUM,
  })
  priority: IssuePriority;

  @Column({ type: 'varchar', length: 256 })
  subject: string;

  @Column({ type: 'text' })
  description: string;

  /** Resolution note visible to the customer when the issue is closed. */
  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  /** Internal staff note — not shown to customers. */
  @Column({ name: 'internal_note', type: 'text', nullable: true })
  internalNote: string | null;

  /** ID of the Refund record if a refund was issued as part of resolution. */
  @Column({ name: 'refund_id', type: 'uuid', nullable: true })
  refundId: string | null;

  /** ID of the admin staff member handling the issue. */
  @Column({ name: 'assigned_to', type: 'uuid', nullable: true })
  assignedTo: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
