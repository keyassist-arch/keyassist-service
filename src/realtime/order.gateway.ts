import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { OrderRealtimeService } from './order-realtime.service';
import { ImportRealtimeService } from './import-realtime.service';
import { ProductImportService } from '../product-import/product-import.service';
import { ImportStatus } from '../common/enums/import-status.enum';

const IMPORT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
})
export class OrderGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(OrderGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly orderRealtime: OrderRealtimeService,
    private readonly importRealtime: ImportRealtimeService,
    @Inject(forwardRef(() => ProductImportService))
    private readonly productImport: ProductImportService,
  ) {}

  afterInit() {
    this.orderRealtime.attach(this.server);
    this.importRealtime.attach(this.server);
  }

  /**
   * JWT is optional: without a token the client can still subscribe to product imports
   * (`import.subscribe`). With a valid token, the socket also joins `user:<sub>` for orders.
   */
  handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string) ||
      (client.handshake.query?.token as string);
    if (token && typeof token === 'string') {
      try {
        const payload = this.jwt.verify<JwtPayload>(token, {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        });
        void client.join(`user:${payload.sub}`);
        client.data.userId = payload.sub;
        this.logger.debug(`Client ${client.id} joined user:${payload.sub}`);
      } catch {
        this.logger.debug(
          `Client ${client.id} invalid JWT — import subscriptions only`,
        );
      }
    }
  }

  handleDisconnect(client: Socket) {
    const uid = client.data.userId as string | undefined;
    if (uid) {
      void client.leave(`user:${uid}`);
    }
  }

  /**
   * Subscribe to import status pushes (`import.updated`). Body: `{ "importId": "<uuid>" }`.
   * If the import is already `COMPLETED` or `FAILED`, the server sends one `import.updated`
   * immediately with the same shape as `GET /products/import/:importId`.
   */
  @SubscribeMessage('import.subscribe')
  async onImportSubscribe(
    @MessageBody() body: { importId?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<
    | { ok: true; importId: string }
    | { ok: false; error: 'invalid_import_id' | 'import_not_found' }
  > {
    const importId = body?.importId?.trim();
    if (!importId || !IMPORT_ID_RE.test(importId)) {
      return { ok: false, error: 'invalid_import_id' };
    }
    await client.join(`import:${importId}`);
    try {
      const snapshot = await this.productImport.getImportStatus(importId);
      if (
        snapshot.status === ImportStatus.COMPLETED ||
        snapshot.status === ImportStatus.FAILED
      ) {
        client.emit('import.updated', snapshot);
      }
    } catch {
      await client.leave(`import:${importId}`);
      return { ok: false, error: 'import_not_found' };
    }
    return { ok: true, importId };
  }
}
