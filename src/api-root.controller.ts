import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@ApiTags('Health')
@Controller()
export class ApiRootController {
  @Public()
  @Get('api')
  @ApiOperation({
    summary: 'API discovery',
    description:
      'Lists documentation URLs. REST routes live at the root (e.g. `/auth/login`), not under `/api/*`.',
  })
  discovery() {
    return {
      service: 'unified-commerce',
      version: '1.0',
      documentation: {
        swaggerUi: '/docs',
        swaggerUiAlt: '/api-docs',
        openApiJson: '/docs-json',
        openApiJsonAlt: '/api-docs-json',
      },
      health: '/health',
    };
  }
}
