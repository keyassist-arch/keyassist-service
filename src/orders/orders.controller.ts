import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

@ApiTags('Orders')
@ApiBearerAuth(SWAGGER_JWT_AUTH)
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateOrderDto) {
    return this.ordersService.createFromCart(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.ordersService.listForUser(user.sub);
  }

  @Get(':id')
  one(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findForUser(user.sub, id);
  }
}
