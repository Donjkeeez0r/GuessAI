import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getAudioUrl } from 'google-tts-api';
import { containsBlockedWords } from './topic-filter.util';

const DEFAULT_QUESTIONS_PER_PACK = 10;
const OPTIONS_PER_QUESTION = 4;
const GENERATION_ATTEMPTS = 2;

export interface IGeneratedQuestion {
  text: string;
  options: string[];
  correctOption: number;
  explanation: string | null;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly genAi: GoogleGenerativeAI;
  readonly questionsPerPack: number;

  constructor(private configService: ConfigService) {
    this.genAi = new GoogleGenerativeAI(
      this.configService.getOrThrow('GEMINI_API_KEY'),
    );
    this.questionsPerPack = Number(
      this.configService.get<string>('AI_QUESTIONS_PER_PACK') ??
        DEFAULT_QUESTIONS_PER_PACK,
    );
  }

  /**
   * Возвращает только валидные вопросы. Если после первой попытки их меньше
   * половины запрошенного — делается одна повторная генерация, и если снова
   * не хватило, отдаётся 422.
   */
  async generateQuestionsByTopic(
    topic: string,
    count = this.questionsPerPack,
  ): Promise<IGeneratedQuestion[]> {
    const minimum = Math.ceil(count / 2);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= GENERATION_ATTEMPTS; attempt++) {
      let raw: unknown[] = [];

      try {
        raw = await this.requestQuestions(topic, count);
        lastError = null;
      } catch (error) {
        lastError = error;
        this.logger.error(
          `Попытка ${attempt}: генерация вопросов не удалась`,
          error instanceof Error ? error.stack : String(error),
        );
      }

      const valid = raw
        .map((item) => toValidQuestion(item))
        .filter((item): item is IGeneratedQuestion => item !== null);

      if (valid.length >= minimum) {
        return valid.slice(0, count);
      }

      this.logger.warn(
        `Попытка ${attempt}: валидных вопросов ${valid.length} из ${count}`,
      );
    }

    if (lastError) {
      throw new InternalServerErrorException(
        'Не удалось сгенерировать вопросы!',
      );
    }

    throw new UnprocessableEntityException(
      'Модель не вернула достаточно корректных вопросов по этой теме',
    );
  }

  private async requestQuestions(
    topic: string,
    count: number,
  ): Promise<unknown[]> {
    const model = this.genAi.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const prompt = `
        Ты — ведущий увлекательной викторины "GuessAI".
        Сгенерируй ровно ${count} вопросов на тему: "${topic}".

        Верни СТРОГО JSON-массив из ${count} объектов с такой структурой:
        [
          {
            "text": "Текст вопроса или смешной отзыв/цитата",
            "options": ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"],
            "correctOption": 0, // Индекс правильного ответа, целое число от 0 до 3
            "explanation": "Короткий интересный факт или подколка после ответа"
          }
        ]

        Важно: в массиве ровно ${count} элементов, у каждого ровно ${OPTIONS_PER_QUESTION} непустых варианта ответа,
        "correctOption" — целое число от 0 до 3. Язык: русский. Текст должен быть ярким и юморным,
        но без мата, оскорблений и запрещённых тем.
      `;

    const result = await model.generateContent(prompt);
    const parsed: unknown = JSON.parse(result.response.text());

    return Array.isArray(parsed) ? (parsed as unknown[]) : [];
  }

  private sanitizeTextForTts(text: string): string {
    const cleanText = text
      .replace(/[*_#`~[\]<>|]/g, '')
      .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);

    return cleanText;
  }

  generateAudioUrl(text: string): string | null {
    try {
      const cleanText = this.sanitizeTextForTts(text);

      if (!cleanText) return null;

      // `|| null` — единственная защита от пустой строки в базе: фронт
      // считает наличие озвучки по `Boolean(audioUrl)`, но запись `""`
      // прошла бы в колонку и включила бы кнопку, которой нечего играть.
      return (
        getAudioUrl(cleanText, {
          lang: 'ru',
          slow: false,
          host: 'https://translate.google.com',
        }) || null
      );
    } catch (error) {
      this.logger.warn(
        `Не удалось собрать ссылку озвучки: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}

/**
 * Схема одного сгенерированного вопроса: непустой текст, ровно четыре непустых
 * варианта, целый `correctOption` в 0..3 и чистый по стоп-листу контент.
 * Всё, что не проходит, отбрасывается.
 */
function toValidQuestion(item: unknown): IGeneratedQuestion | null {
  if (typeof item !== 'object' || item === null) return null;

  const record = item as Record<string, unknown>;

  const text = typeof record.text === 'string' ? record.text.trim() : '';
  if (!text) return null;

  const rawOptions = record.options;
  if (
    !Array.isArray(rawOptions) ||
    rawOptions.length !== OPTIONS_PER_QUESTION
  ) {
    return null;
  }

  const options = rawOptions.map((option) =>
    typeof option === 'string' ? option.trim() : '',
  );
  if (options.some((option) => option.length === 0)) return null;

  const correctOption = record.correctOption;
  if (
    typeof correctOption !== 'number' ||
    !Number.isInteger(correctOption) ||
    correctOption < 0 ||
    correctOption >= OPTIONS_PER_QUESTION
  ) {
    return null;
  }

  const rawExplanation =
    typeof record.explanation === 'string' ? record.explanation.trim() : '';
  const explanation = rawExplanation.length > 0 ? rawExplanation : null;

  const moderated = [text, ...options, explanation ?? ''].join(' \n ');
  if (containsBlockedWords(moderated)) return null;

  return { text, options, correctOption, explanation };
}
