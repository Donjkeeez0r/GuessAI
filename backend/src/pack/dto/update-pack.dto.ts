import { PartialType } from '@nestjs/mapped-types';
import { CreatePackDto } from './create-pack.dto';

export class UpdatePackDto extends PartialType(CreatePackDto) {}
