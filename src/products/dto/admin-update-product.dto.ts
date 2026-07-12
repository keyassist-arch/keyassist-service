import { PartialType } from '@nestjs/swagger';
import { AdminCreateProductDto } from './admin-create-product.dto';

export class AdminUpdateProductDto extends PartialType(AdminCreateProductDto) {}
