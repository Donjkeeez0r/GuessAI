import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePackDto } from './dto/create-pack.dto';
import { UpdatePackDto } from './dto/update-pack.dto';
import { AiService } from '../ai/ai.service';
import { validateTopic } from '../ai/topic-filter.util';
import {
  isPackAnswersOwner,
  PublicPackWithQuestions,
  toPublicPack,
} from './pack.mapper';

const PACK_WITH_QUESTIONS = {
  include: { questions: true },
} as const;

@Injectable()
export class PackService {
  constructor(
    private prismaService: PrismaService,
    private aiService: AiService,
  ) {}

  /** Без `mine` отдаются только публичные паки, с `mine` — все паки автора. */
  async listPacks(
    userId: string,
    filter: { category?: string; mine?: boolean },
  ) {
    return this.prismaService.pack.findMany({
      where: {
        ...(filter.category ? { category: filter.category } : {}),
        ...(filter.mine ? { authorId: userId } : { isPublic: true }),
      },
      include: {
        _count: {
          select: { questions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPack(
    userId: string,
    packId: string,
  ): Promise<PublicPackWithQuestions> {
    const pack = await this.prismaService.pack.findUnique({
      where: { id: packId },
      ...PACK_WITH_QUESTIONS,
    });

    if (!pack) {
      throw new NotFoundException('Пак не найден');
    }

    if (!pack.isPublic && pack.authorId !== userId) {
      throw new ForbiddenException('Этот пак недоступен');
    }

    return toPublicPack(pack, isPackAnswersOwner(pack, userId));
  }

  async createPack(
    authorId: string,
    dto: CreatePackDto,
  ): Promise<PublicPackWithQuestions> {
    const pack = await this.prismaService.pack.create({
      data: {
        title: dto.title,
        description: dto.description,
        category: dto.category,
        // undefined — сработает `@default(true)` из схемы Prisma.
        isPublic: dto.isPublic,
        authorId,
        questions: {
          create: dto.questions.map((question) => ({
            text: question.text,
            options: question.options,
            correctOption: question.correctOption,
            explanation: question.explanation,
            audioUrl: this.aiService.generateAudioUrl(question.text),
          })),
        },
      },
      ...PACK_WITH_QUESTIONS,
    });

    return toPublicPack(pack, isPackAnswersOwner(pack, authorId));
  }

  async updatePack(
    userId: string,
    packId: string,
    dto: UpdatePackDto,
  ): Promise<PublicPackWithQuestions> {
    await this.assertAuthor(userId, packId);

    const pack = await this.prismaService.pack.update({
      where: { id: packId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
        // Вопросы заменяются целиком: частичное слияние по индексам неоднозначно.
        ...(dto.questions !== undefined
          ? {
              questions: {
                deleteMany: {},
                create: dto.questions.map((question) => ({
                  text: question.text,
                  options: question.options,
                  correctOption: question.correctOption,
                  explanation: question.explanation,
                  audioUrl: this.aiService.generateAudioUrl(question.text),
                })),
              },
            }
          : {}),
      },
      ...PACK_WITH_QUESTIONS,
    });

    return toPublicPack(pack, isPackAnswersOwner(pack, userId));
  }

  async deletePack(userId: string, packId: string): Promise<void> {
    await this.assertAuthor(userId, packId);

    await this.prismaService.pack.delete({ where: { id: packId } });
  }

  async generateAiPack(
    userId: string,
    topic: string,
  ): Promise<{ fromCache: boolean; pack: PublicPackWithQuestions }> {
    validateTopic(topic);

    const existingPack = await this.prismaService.pack.findFirst({
      where: {
        isAiGenerated: true,
        isPublic: true,
        title: { contains: topic, mode: 'insensitive' },
      },
      ...PACK_WITH_QUESTIONS,
    });

    if (existingPack) {
      return {
        fromCache: true,
        pack: toPublicPack(existingPack),
      };
    }

    const questions = await this.aiService.generateQuestionsByTopic(topic);

    const createdPack = await this.prismaService.pack.create({
      data: {
        title: `ИИ-пак: ${topic}`,
        description: `Автоматически сгенерированный пак на тему: ${topic}`,
        category: 'AI-generated',
        isAiGenerated: true,
        isPublic: true,
        authorId: userId,
        questions: {
          create: questions.map((question) => ({
            text: question.text,
            options: question.options,
            correctOption: question.correctOption,
            explanation: question.explanation,
            audioUrl: this.aiService.generateAudioUrl(question.text),
          })),
        },
      },
      ...PACK_WITH_QUESTIONS,
    });

    return {
      fromCache: false,
      pack: toPublicPack(createdPack),
    };
  }

  private async assertAuthor(userId: string, packId: string): Promise<void> {
    const pack = await this.prismaService.pack.findUnique({
      where: { id: packId },
      select: { authorId: true },
    });

    if (!pack) {
      throw new NotFoundException('Пак не найден');
    }

    if (pack.authorId !== userId) {
      throw new ForbiddenException('Изменять пак может только его автор');
    }
  }
}
