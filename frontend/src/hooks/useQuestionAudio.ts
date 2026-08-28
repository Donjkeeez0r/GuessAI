/**
 * Озвучка вопроса. `audioUrl` — внешняя ссылка на Google TTS, поэтому играем
 * её через `new Audio(url)`, а не через fetch: запрос ломается о CORS.
 *
 * Обязательное условие — `<meta name="referrer" content="no-referrer">`
 * в `index.html`: с заголовком Referer Google отдаёт 404, и озвучка не играет
 * вообще нигде. Поштучно у медиаэлемента этот заголовок не отключается.
 *
 * Ссылка может отвалиться по рейтлимиту — это известное ограничение бэкенда.
 * Ошибку гасим тихо: кнопка озвучки просто становится неактивной.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface QuestionAudio {
  available: boolean;
  playing: boolean;
  play: () => void;
}

export function useQuestionAudio(audioUrl: string | null): QuestionAudio {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Состояние привязано к конкретной ссылке, поэтому смена вопроса сбрасывает
  // его сама собой — без setState в теле эффекта.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!audioUrl) {
      audioRef.current = null;
      return;
    }

    const audio = new Audio(audioUrl);
    audio.preload = 'none';
    audioRef.current = audio;

    const onEnded = (): void => setPlayingUrl(null);
    const onError = (): void => {
      setFailedUrl(audioUrl);
      setPlayingUrl(null);
    };

    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, [audioUrl]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    audio.currentTime = 0;
    setPlayingUrl(audioUrl);

    audio.play().catch(() => {
      setFailedUrl(audioUrl);
      setPlayingUrl(null);
    });
  }, [audioUrl]);

  return {
    // Boolean, а не !== null: исторические записи с audioUrl = '' включали
    // кнопку, которой нечего играть.
    available: Boolean(audioUrl) && failedUrl !== audioUrl,
    playing: Boolean(audioUrl) && playingUrl === audioUrl,
    play,
  };
}
