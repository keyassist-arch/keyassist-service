import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TotpService } from './totp.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [TotpService],
  exports: [TotpService],
})
export class TotpModule {}
