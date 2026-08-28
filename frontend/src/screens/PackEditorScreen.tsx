import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useGoTo } from '../hooks/useGoTo';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { ApiError } from '../api/client';
import {
  createPack,
  fetchPack,
  generateAiPack,
  updatePack,
} from '../api/endpoints';
import { useUiStore } from '../store/uiStore';
import type { CreatePackDto, CreateQuestionDto } from '../types/api';
import styles from './PackEditorScreen.module.css';

/** Черновик вопроса: -1 в correctOption означает «правильный ещё не выбран». */
interface QuestionDraft {
  text: string;
  options: [string, string, string, string];
  correctOption: number;
  explanation: string;
}

const MAX_TOPIC_LENGTH = 200;

function emptyQuestion(): QuestionDraft {
  return { text: '', options: ['', '', '', ''], correctOption: -1, explanation: '' };
}

export function PackEditorScreen() {
  const goTo = useGoTo();
  const { packId } = useParams<{ packId: string }>();
  const isEditing = Boolean(packId);
  const showToast = useUiStore((state) => state.showToast);

  const [mode, setMode] = useState<'ai' | 'manual'>(
    isEditing ? 'manual' : 'ai',
  );

  // ── ИИ-генерация ──
  const [topic, setTopic] = useState('');
  const [generating, setGenerating] = useState(false);

  // ── Ручная форма ──
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [questions, setQuestions] = useState<QuestionDraft[]>([emptyQuestion()]);
  /**
   * Автору своего пака сервер отдаёт `correctOption`; у ИИ-пака — нет,
   * и там правильные варианты придётся отметить заново.
   */
  const [answersKnown, setAnswersKnown] = useState(true);
  /**
   * Вопросы уходят в PATCH только если их трогали: массив заменяет вопросы
   * целиком, и лишняя пересылка зря пересоздаёт их вместе с `audioUrl`.
   */
  const [questionsTouched, setQuestionsTouched] = useState(false);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!packId) return;

    const controller = new AbortController();

    fetchPack(packId)
      .then((pack) => {
        if (controller.signal.aborted) return;

        setTitle(pack.title);
        setDescription(pack.description ?? '');
        setCategory(pack.category);
        setIsPublic(pack.isPublic);
        setAnswersKnown(
          pack.questions.every((question) => question.correctOption !== undefined),
        );
        setQuestions(
          pack.questions.map((question) => ({
            text: question.text,
            options: [
              question.options[0] ?? '',
              question.options[1] ?? '',
              question.options[2] ?? '',
              question.options[3] ?? '',
            ],
            // Приходит только автору своего пака; иначе отмечать заново.
            correctOption: question.correctOption ?? -1,
            explanation: question.explanation ?? '',
          })),
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;

        showToast(
          error instanceof Error ? error.message : 'Не удалось загрузить пак',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [packId, showToast]);

  const patchQuestion = (index: number, patch: Partial<QuestionDraft>): void => {
    setQuestionsTouched(true);
    setQuestions((current) =>
      current.map((question, i) =>
        i === index ? { ...question, ...patch } : question,
      ),
    );
  };

  const setOption = (index: number, optionIndex: number, value: string): void => {
    setQuestionsTouched(true);
    setQuestions((current) =>
      current.map((question, i) => {
        if (i !== index) return question;

        const options = [...question.options] as QuestionDraft['options'];
        options[optionIndex] = value;

        return { ...question, options };
      }),
    );
  };

  /** Валидация ровно по CreatePackDto из контракта. */
  const validate = (): string[] => {
    const found: string[] = [];

    if (title.trim().length === 0) found.push('Укажи название пака');
    if (category.trim().length === 0) found.push('Укажи категорию');
    if (questions.length === 0) found.push('Добавь хотя бы один вопрос');

    questions.forEach((question, index) => {
      const label = `Вопрос ${index + 1}`;

      if (question.text.trim().length === 0) found.push(`${label}: пустой текст`);
      if (question.options.some((option) => option.trim().length === 0)) {
        found.push(`${label}: нужно ровно 4 непустых варианта`);
      }
      if (question.correctOption < 0 || question.correctOption > 3) {
        found.push(`${label}: не отмечен правильный вариант`);
      }
    });

    return found;
  };

  const toDto = (): CreatePackDto => ({
    title: title.trim(),
    ...(description.trim().length > 0
      ? { description: description.trim() }
      : {}),
    category: category.trim(),
    isPublic,
    questions: questions.map<CreateQuestionDto>((question) => ({
      text: question.text.trim(),
      options: question.options.map((option) => option.trim()),
      correctOption: question.correctOption,
      ...(question.explanation.trim().length > 0
        ? { explanation: question.explanation.trim() }
        : {}),
    })),
  });

  const save = (): void => {
    // При правке метаданных вопросы не отправляем — они остаются как есть.
    const metadataOnly = isEditing && !questionsTouched;
    const found = metadataOnly
      ? [
          ...(title.trim().length === 0 ? ['Укажи название пака'] : []),
          ...(category.trim().length === 0 ? ['Укажи категорию'] : []),
        ]
      : validate();

    setErrors(found);

    if (found.length > 0) return;

    setSaving(true);

    const dto = toDto();
    const request = isEditing
      ? updatePack(packId!, metadataOnly ? { ...dto, questions: undefined } : dto)
      : createPack(dto);

    request
      .then(() => {
        showToast(isEditing ? 'Пак обновлён' : 'Пак создан', 'success');
        goTo('/packs');
      })
      .catch((error: unknown) => {
        showToast(
          error instanceof Error ? error.message : 'Не удалось сохранить пак',
        );
      })
      .finally(() => setSaving(false));
  };

  const generate = (): void => {
    const trimmed = topic.trim();

    if (trimmed.length === 0) {
      setErrors(['Укажи тему пака']);
      return;
    }

    if (trimmed.length > MAX_TOPIC_LENGTH) {
      setErrors([`Тема длиннее ${MAX_TOPIC_LENGTH} символов`]);
      return;
    }

    setErrors([]);
    setGenerating(true);

    generateAiPack(trimmed)
      .then(({ fromCache, pack }) => {
        showToast(
          fromCache
            ? `Нашли готовый пак «${pack.title}»`
            : `Пак «${pack.title}» готов: ${pack.questions.length} вопросов`,
          'success',
        );
        goTo('/packs');
      })
      .catch((error: unknown) => {
        // 400 и 422 — разные ситуации, общей ошибкой их закрывать нельзя.
        if (error instanceof ApiError && error.status === 400) {
          setErrors([
            error.message ||
              'Эта тема запрещена для генерации пака — попробуй другую',
          ]);
          return;
        }

        if (error instanceof ApiError && error.status === 422) {
          setErrors([
            'Модель не смогла собрать достаточно вопросов по этой теме. Сформулируй её конкретнее и попробуй ещё раз.',
          ]);
          return;
        }

        setErrors([
          error instanceof Error ? error.message : 'Не удалось сгенерировать пак',
        ]);
      })
      .finally(() => setGenerating(false));
  };

  if (loading) {
    return (
      <Screen title="Пак" onBack={() => goTo('/packs')}>
        <Spinner label="Загружаем пак…" />
      </Screen>
    );
  }

  return (
    <Screen
      title={isEditing ? 'Редактирование' : 'Новый пак'}
      onBack={() => goTo(isEditing ? '/packs' : '/')}
    >
      {!isEditing && (
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${mode === 'ai' ? styles.tabActive : ''}`}
            onClick={() => {
              setMode('ai');
              setErrors([]);
            }}
          >
            Сгенерировать ИИ
          </button>
          <button
            type="button"
            className={`${styles.tab} ${
              mode === 'manual' ? styles.tabActive : ''
            }`}
            onClick={() => {
              setMode('manual');
              setErrors([]);
            }}
          >
            Вручную
          </button>
        </div>
      )}

      {errors.length > 0 && (
        <div className={styles.errors}>
          {errors.map((error) => (
            <span key={error}>{error}</span>
          ))}
        </div>
      )}

      {mode === 'ai' ? (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="topic">
              Тема пака
            </label>
            <input
              id="topic"
              className={styles.input}
              value={topic}
              maxLength={MAX_TOPIC_LENGTH}
              placeholder="Например: космос и планеты"
              disabled={generating}
              onChange={(event) => setTopic(event.target.value)}
            />
            <span className={styles.hint}>
              Нейросеть соберёт вопросы сама. Это занимает несколько секунд.
            </span>
          </div>

          {generating ? (
            <Spinner label="Генерируем пак — это займёт несколько секунд…" />
          ) : (
            <Button size="lg" block onClick={generate}>
              Сгенерировать
            </Button>
          )}
        </>
      ) : (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="title">
              Название
            </label>
            <input
              id="title"
              className={styles.input}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="description">
              Описание
            </label>
            <textarea
              id="description"
              className={styles.textarea}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="category">
              Категория
            </label>
            <input
              id="category"
              className={styles.input}
              value={category}
              placeholder="История, кино, спорт…"
              onChange={(event) => setCategory(event.target.value)}
            />
          </div>

          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={!isPublic}
              onChange={(event) => setIsPublic(!event.target.checked)}
            />
            <span>
              Приватный пак
              <span className={styles.hint}>
                Не появится в общем списке — играть по нему можно только по
                ссылке на комнату.
              </span>
            </span>
          </label>

          {isEditing && !answersKnown && (
            <p className={styles.notice}>
              Это ИИ-пак: правильные ответы сервер не раскрывает. Если менять
              вопросы, правильные варианты придётся отметить заново. Пока
              вопросы не тронуты, сохранятся только название, описание,
              категория и видимость.
            </p>
          )}

          {questions.map((question, index) => (
            <div className={styles.question} key={index}>
              <div className={styles.questionHead}>
                <span className={styles.questionTitle}>Вопрос {index + 1}</span>
                {questions.length > 1 && (
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() => {
                      setQuestionsTouched(true);
                      setQuestions((current) =>
                        current.filter((_, i) => i !== index),
                      );
                    }}
                  >
                    Удалить
                  </button>
                )}
              </div>

              <textarea
                className={styles.textarea}
                value={question.text}
                placeholder="Текст вопроса"
                onChange={(event) =>
                  patchQuestion(index, { text: event.target.value })
                }
              />

              {question.options.map((option, optionIndex) => (
                <div className={styles.option} key={optionIndex}>
                  <button
                    type="button"
                    className={`${styles.optionMark} ${
                      question.correctOption === optionIndex
                        ? styles.optionMarkActive
                        : ''
                    }`}
                    aria-label={`Отметить вариант ${optionIndex + 1} правильным`}
                    aria-pressed={question.correctOption === optionIndex}
                    onClick={() =>
                      patchQuestion(index, { correctOption: optionIndex })
                    }
                  >
                    {question.correctOption === optionIndex ? '✓' : optionIndex + 1}
                  </button>
                  <input
                    className={styles.input}
                    value={option}
                    placeholder={`Вариант ${optionIndex + 1}`}
                    onChange={(event) =>
                      setOption(index, optionIndex, event.target.value)
                    }
                  />
                </div>
              ))}

              <input
                className={styles.input}
                value={question.explanation}
                placeholder="Пояснение (необязательно)"
                onChange={(event) =>
                  patchQuestion(index, { explanation: event.target.value })
                }
              />
            </div>
          ))}

          <div className={styles.footer}>
            <Button
              variant="secondary"
              block
              onClick={() => {
                setQuestionsTouched(true);
                setQuestions((current) => [...current, emptyQuestion()]);
              }}
            >
              + Ещё вопрос
            </Button>
            <Button size="lg" block disabled={saving} onClick={save}>
              {saving ? 'Сохраняем…' : isEditing ? 'Сохранить' : 'Создать пак'}
            </Button>
          </div>
        </>
      )}
    </Screen>
  );
}
