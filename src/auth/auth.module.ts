import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { CartModule } from '../cart/cart.module';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';

@Module({
  imports: [
    CartModule,
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    ConfigModule,
  ],
  providers: [AuthService, JwtStrategy, JwtRefreshStrategy],
  controllers: [AuthController],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
