import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SWAGGER_JWT_AUTH } from './common/constants/swagger-auth';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Unified Commerce API')
    .setDescription(
      'URL-to-checkout backend: auth, product import, catalog, cart, orders, Paystack & Stripe, admin. ' +
        'Socket.IO on `/realtime`: `order.updated` (JWT) and `import.updated` (product import status; subscribe via `import.subscribe`) are outside this OpenAPI spec.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
        description:
          'Paste the access token from POST /auth/login or /auth/register',
      },
      SWAGGER_JWT_AUTH,
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const uiOptions = {
    swaggerOptions: {
      persistAuthorization: true,
    },
    customSiteTitle: 'Unified Commerce API',
  } as const;

  SwaggerModule.setup('docs', app, document, uiOptions);
  /** Common alias (e.g. proxies, team habit) — same spec as `/docs` */
  SwaggerModule.setup('api-docs', app, document, uiOptions);
}
