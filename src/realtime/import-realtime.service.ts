import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

/** Payload mirrors `GET /products/import/:importId` (same keys as the REST JSON). */
export type ImportStatusSocketPayload = Record<string, unknown>;

@Injectable()
export class ImportRealtimeService {
  private readonly logger = new Logger(ImportRealtimeService.name);
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  /**
   * Notify subscribers in room `import:<importId>` (see `import.subscribe` on `/realtime`).
   */
  emitImportUpdated(
    importId: string,
    payload: ImportStatusSocketPayload,
  ): void {
    if (!this.server) {
      this.logger.warn(
        `[realtime] emitImportUpdated called before gateway init — importId=${importId}`,
      );
      return;
    }
    this.server.to(`import:${importId}`).emit('import.updated', payload);
  }
}
