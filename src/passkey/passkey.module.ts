import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PasskeyCredential } from './entities/passkey-credential.entity';
import { PasskeyService } from './passkey.service';
import { PasskeyController } from './passkey.controller';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PasskeyCredential]),
    UsersModule,
    AuthModule,
  ],
  providers: [PasskeyService],
  controllers: [PasskeyController],
})
export class PasskeyModule {}
