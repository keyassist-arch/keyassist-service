import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedProduct } from './entities/saved-product.entity';

@Injectable()
export class SavesService {
  constructor(
    @InjectRepository(SavedProduct)
    private readonly savedProductRepo: Repository<SavedProduct>,
  ) {}

  async list(userId: string): Promise<SavedProduct[]> {
    return this.savedProductRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async save(userId: string, productId: string): Promise<SavedProduct> {
    const existing = await this.savedProductRepo.findOne({
      where: { userId, productId },
    });
    if (existing) throw new ConflictException('Product already saved');

    const entry = this.savedProductRepo.create({ userId, productId });
    return this.savedProductRepo.save(entry);
  }

  async remove(userId: string, productId: string): Promise<void> {
    const entry = await this.savedProductRepo.findOne({
      where: { userId, productId },
    });
    if (!entry) throw new NotFoundException('Saved product not found');
    await this.savedProductRepo.remove(entry);
  }

  async isSaved(userId: string, productId: string): Promise<boolean> {
    return this.savedProductRepo.existsBy({ userId, productId });
  }
}
