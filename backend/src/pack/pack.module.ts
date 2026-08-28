import { Module } from '@nestjs/common';
import { PackService } from './pack.service';
import { PackController } from './pack.controller';
import { AiModule } from '../ai/ai.module';

@Module({
  controllers: [PackController],
  imports: [AiModule],
  providers: [PackService],
})
export class PackModule {}
