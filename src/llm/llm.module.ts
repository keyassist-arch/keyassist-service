import { Global, Module } from '@nestjs/common';
import { LlmGatewayService } from './llm-gateway.service';

@Global()
@Module({
  providers: [LlmGatewayService],
  exports: [LlmGatewayService],
})
export class LlmModule {}
