/**
 * Вопрос в том виде, в каком он уходит клиенту. `correctOption` и
 * `explanation` присутствуют только у автора собственного пака — см.
 * `toPublicPack`.
 */
export interface PublicQuestion {
  id: string;
  text: string;
  options: string[];
  audioUrl: string | null;
  correctOption?: number;
  explanation?: string | null;
}

export interface PublicPackWithQuestions {
  id: string;
  title: string;
  description: string | null;
  category: string;
  isAiGenerated: boolean;
  isPublic: boolean;
  authorId: string | null;
  createdAt: Date;
  questions: PublicQuestion[];
}

interface QuestionRow {
  id: string;
  text: string;
  options: string[];
  audioUrl: string | null;
  correctOption: number;
  explanation: string | null;
}

interface PackRow extends Omit<PublicPackWithQuestions, 'questions'> {
  questions: QuestionRow[];
}

/**
 * Автор собственного пака вправе видеть правильные ответы: без них
 * `PATCH /pack/:id` заставлял бы переотмечать их во всех вопросах ради
 * правки одного. Исключение — паки, сгенерированные ИИ: их «автор» ответов
 * не писал, и отдать их значило бы дать ему сыграть по своему паку с
 * подсказками.
 */
export function isPackAnswersOwner(
  pack: Pick<PackRow, 'authorId' | 'isAiGenerated'>,
  userId: string,
): boolean {
  return pack.authorId === userId && !pack.isAiGenerated;
}

/**
 * Единственный сериализатор пака наружу. Правильные ответы не покидают
 * сервер до `ROUND_END`, поэтому `correctOption` и `explanation` срезаются
 * здесь всем, кроме автора (`withAnswers`).
 */
export function toPublicPack(
  pack: PackRow,
  withAnswers = false,
): PublicPackWithQuestions {
  return {
    id: pack.id,
    title: pack.title,
    description: pack.description,
    category: pack.category,
    isAiGenerated: pack.isAiGenerated,
    isPublic: pack.isPublic,
    authorId: pack.authorId,
    createdAt: pack.createdAt,
    questions: pack.questions.map((question) => ({
      id: question.id,
      text: question.text,
      options: question.options,
      audioUrl: question.audioUrl,
      ...(withAnswers
        ? {
            correctOption: question.correctOption,
            explanation: question.explanation,
          }
        : {}),
    })),
  };
}
