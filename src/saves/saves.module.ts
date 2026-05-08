import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedProduct } from './entities/saved-product.entity';
import { SavesService } from './saves.service';
import { SavesController } from './saves.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SavedProduct])],
  providers: [SavesService],
  controllers: [SavesController],
  exports: [SavesService],
})
export class SavesModule {}
