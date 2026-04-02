import { ImportStatus } from '../../common/enums/import-status.enum';
import { ProductSource } from '../../common/enums/product-source.enum';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from './product.entity';

@Entity('imported_products')
export class ImportedProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Normalized URL; same string is stored on Product.sourceUrl when linked. */
  @Column({ name: 'source_url', unique: true })
  sourceUrl: string;

  @Column({
    type: 'enum',
    enum: ProductSource,
  })
  source: ProductSource;

  @Column({
    type: 'enum',
    enum: ImportStatus,
    default: ImportStatus.QUEUED,
  })
  status: ImportStatus;

  @OneToOne(() => Product, { nullable: true })
  @JoinColumn({ name: 'product_id' })
  product: Product | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
