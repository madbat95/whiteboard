import { Module } from '@nestjs/common';
import { RoomModule } from '../room/room.module';
import { BoardGateway } from './board.gateway';

@Module({
  imports: [RoomModule],
  providers: [BoardGateway],
})
export class GatewayModule {}
