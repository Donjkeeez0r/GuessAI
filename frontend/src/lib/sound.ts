/**
 * Звуковые эффекты игры. Синтезируются через Web Audio — бинарных ассетов нет,
 * поэтому ничего не грузится по сети и нечему отвалиться.
 *
 * Мобильные браузеры блокируют автовоспроизведение: AudioContext создаётся
 * лениво, из `unlockAudio()`, который вызывается на первом тапе пользователя.
 */

const STORAGE_KEY = 'guessai.sound';

let context: AudioContext | null = null;
let enabled = readStoredPreference();

function readStoredPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;

  try {
    window.localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    // Приватный режим может запрещать localStorage — настройка просто не переживёт перезагрузку.
  }

  if (value) unlockAudio();
}

/** Создаёт и «размораживает» AudioContext. Безопасно вызывать многократно. */
export function unlockAudio(): void {
  try {
    context ??= new AudioContext();

    if (context.state === 'suspended') void context.resume();
  } catch {
    context = null;
  }
}

interface ToneOptions {
  /** Частота в герцах; массив — последовательность нот. */
  freq: number | number[];
  /** Длительность одной ноты в секундах. */
  duration?: number;
  type?: OscillatorType;
  gain?: number;
}

function playTone({
  freq,
  duration = 0.12,
  type = 'sine',
  gain = 0.12,
}: ToneOptions): void {
  if (!enabled || !context || context.state !== 'running') return;

  const notes = Array.isArray(freq) ? freq : [freq];
  const startAt = context.currentTime;

  notes.forEach((note, index) => {
    const at = startAt + index * duration;
    const oscillator = context!.createOscillator();
    const envelope = context!.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(note, at);

    // Короткая атака и плавное затухание — иначе слышны щелчки на краях ноты.
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    oscillator.connect(envelope).connect(context!.destination);
    oscillator.start(at);
    oscillator.stop(at + duration);
  });
}

/** Тик таймера на последних секундах раунда. */
export function playTick(): void {
  playTone({ freq: 880, duration: 0.05, type: 'square', gain: 0.05 });
}

export function playCorrect(): void {
  playTone({ freq: [660, 880, 1320], duration: 0.11, type: 'triangle' });
}

export function playWrong(): void {
  playTone({ freq: [320, 200], duration: 0.16, type: 'sawtooth', gain: 0.09 });
}

/** Финал игры. */
export function playFanfare(): void {
  playTone({ freq: [523, 659, 784, 1047], duration: 0.14, type: 'triangle' });
}

export function playClick(): void {
  playTone({ freq: 520, duration: 0.04, type: 'sine', gain: 0.06 });
}
