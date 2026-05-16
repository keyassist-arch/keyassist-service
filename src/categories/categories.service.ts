import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { Product } from '../products/entities/product.entity';
import { ProductsService } from '../products/products.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { slugifyTitle } from '../common/utils/slugify.util';

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly productsService: ProductsService,
  ) {}

  private toResponse(cat: Category, productCount?: number) {
    return {
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      imageUrl: cat.imageUrl,
      position: cat.position,
      productCount,
      createdAt: cat.createdAt,
      updatedAt: cat.updatedAt,
    };
  }

  async findAll() {
    const cats = await this.categories.find({
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    const counts = await this.products
      .createQueryBuilder('p')
      .select('p.category_id', 'categoryId')
      .addSelect('COUNT(*)', 'count')
      .where('p.category_id IS NOT NULL')
      .groupBy('p.category_id')
      .getRawMany<{ categoryId: string; count: string }>();

    const countMap = new Map(counts.map((r) => [r.categoryId, parseInt(r.count, 10)]));
    return cats.map((c) => this.toResponse(c, countMap.get(c.id) ?? 0));
  }

  async findByIdOrSlug(param: string): Promise<{ category: Category; productCount: number }> {
    const where = isUuid(param) ? { id: param } : { slug: param };
    const cat = await this.categories.findOne({ where });
    if (!cat) throw new NotFoundException('Category not found');
    const productCount = await this.products.count({ where: { categoryId: cat.id } });
    return { category: cat, productCount };
  }

  async findOneResponse(param: string) {
    const { category, productCount } = await this.findByIdOrSlug(param);
    return this.toResponse(category, productCount);
  }

  async findProductsInCategory(
    param: string,
    limit: number,
    page: number,
  ): Promise<{ total: number; page: number; limit: number; results: ReturnType<ProductsService['toResponse']>[] }> {
    const { category } = await this.findByIdOrSlug(param);

    const [rows, total] = await this.products.findAndCount({
      where: { categoryId: category.id },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });

    return {
      total,
      page,
      limit,
      results: rows.map((p) => this.productsService.toResponse(p)),
    };
  }

  async create(dto: CreateCategoryDto): Promise<ReturnType<CategoriesService['toResponse']>> {
    const slug = slugifyTitle(dto.name);
    const existing = await this.categories.findOne({ where: [{ name: dto.name }, { slug }] });
    if (existing) throw new ConflictException('A category with that name already exists');

    const cat = this.categories.create({
      name: dto.name,
      slug,
      description: dto.description ?? null,
      imageUrl: dto.imageUrl ?? null,
      position: dto.position ?? 0,
    });
    const saved = await this.categories.save(cat);
    return this.toResponse(saved, 0);
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const cat = await this.categories.findOne({ where: { id } });
    if (!cat) throw new NotFoundException('Category not found');

    if (dto.name && dto.name !== cat.name) {
      const newSlug = slugifyTitle(dto.name);
      const clash = await this.categories.findOne({ where: { slug: newSlug } });
      if (clash && clash.id !== id) {
        throw new ConflictException('A category with that name already exists');
      }
      cat.name = dto.name;
      cat.slug = newSlug;
    }
    if (dto.description !== undefined) cat.description = dto.description ?? null;
    if (dto.imageUrl !== undefined) cat.imageUrl = dto.imageUrl ?? null;
    if (dto.position !== undefined) cat.position = dto.position;

    const saved = await this.categories.save(cat);
    const productCount = await this.products.count({ where: { categoryId: saved.id } });
    return this.toResponse(saved, productCount);
  }

  async remove(id: string): Promise<void> {
    const cat = await this.categories.findOne({ where: { id } });
    if (!cat) throw new NotFoundException('Category not found');
    await this.products.update({ categoryId: id }, { categoryId: null });
    await this.categories.remove(cat);
  }

  async assignProductCategory(productId: string, categoryId: string | null): Promise<void> {
    if (categoryId) {
      const cat = await this.categories.findOne({ where: { id: categoryId } });
      if (!cat) throw new NotFoundException('Category not found');
    }
    await this.products.update({ id: productId }, { categoryId: categoryId ?? null });
  }
}
