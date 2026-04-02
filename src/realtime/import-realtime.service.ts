import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

/** Payload mirrors `GET /products/import/:importId` (same keys as the REST JSON). */
export type ImportStatusSocketPayload = Record<string, unknown>;

@Injectable()
export class ImportRealtimeService {
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
    this.server?.to(`import:${importId}`).emit('import.updated', payload);
  }
}
