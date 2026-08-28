import { Module } from '@nestjs/common';
import { RoomService } from './room.service';

@Module({
  exports: [RoomService],
  providers: [RoomService],
})
export class RoomModule {}
