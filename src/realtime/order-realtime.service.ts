import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class OrderRealtimeService {
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  emitOrderUpdate(
    userId: string,
    payload: { orderId: string; status: string },
  ): void {
    this.server?.to(`user:${userId}`).emit('order.updated', payload);
  }
}
