import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class OrderRealtimeService {
  private readonly logger = new Logger(OrderRealtimeService.name);
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  emitOrderUpdate(
    userId: string,
    payload: { orderId: string; status: string },
  ): void {
    if (!this.server) {
      this.logger.warn(
        `[realtime] emitOrderUpdate called before gateway init — orderId=${payload.orderId} userId=${userId}`,
      );
      return;
    }
    this.server.to(`user:${userId}`).emit('order.updated', payload);
  }

  emitWannaBuyUpdate(
    userId: string,
    payload: { itemId: string; status: string },
  ): void {
    if (!this.server) {
      this.logger.warn(
        `[realtime] emitWannaBuyUpdate called before gateway init — itemId=${payload.itemId} userId=${userId}`,
      );
      return;
    }
    this.server.to(`user:${userId}`).emit('wannaBuyItem.updated', payload);
  }
}
