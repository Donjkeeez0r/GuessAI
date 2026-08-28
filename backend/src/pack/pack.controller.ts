import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PackService } from './pack.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import type { AuthenticatedRequest } from '../auth/jwt-payload.interface';
import { CreatePackDto } from './dto/create-pack.dto';
import { UpdatePackDto } from './dto/update-pack.dto';
import { GeneratePackDto } from './dto/generate-pack.dto';

@UseGuards(JwtAuthGuard)
@Controller('pack')
export class PackController {
  constructor(private readonly packService: PackService) {}

  @Get()
  listPacks(
    @Req() req: AuthenticatedRequest,
    @Query('category') category?: string,
    @Query('mine') mine?: string,
  ) {
    return this.packService.listPacks(req.user.userId, {
      category,
      mine: mine === 'true',
    });
  }

  @Post()
  createPack(@Req() req: AuthenticatedRequest, @Body() dto: CreatePackDto) {
    return this.packService.createPack(req.user.userId, dto);
  }

  @Post('generate-ai')
  generateAiPack(
    @Req() req: AuthenticatedRequest,
    @Body() dto: GeneratePackDto,
  ) {
    return this.packService.generateAiPack(req.user.userId, dto.topic);
  }

  @Get(':id')
  getPack(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.packService.getPack(req.user.userId, id);
  }

  @Patch(':id')
  updatePack(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdatePackDto,
  ) {
    return this.packService.updatePack(req.user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePack(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.packService.deletePack(req.user.userId, id);
  }
}
