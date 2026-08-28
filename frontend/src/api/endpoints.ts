/** Все REST-вызовы контракта в одном месте. */
import { request } from './client';
import type {
  AuthResponse,
  CreatePackDto,
  GameHistoryItem,
  GeneratedPackResponse,
  Leaderboard,
  PackSummary,
  PackWithQuestions,
  UpdatePackDto,
  UserProfile,
} from '../types/api';

export function loginWithTelegram(initData: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/telegram', {
    method: 'POST',
    body: { initData },
    anonymous: true,
  });
}

export function fetchProfile(): Promise<UserProfile> {
  return request<UserProfile>('/users/me');
}

export function fetchHistory(limit = 20): Promise<GameHistoryItem[]> {
  return request<GameHistoryItem[]>(`/users/me/history?limit=${limit}`);
}

export function fetchLeaderboard(limit = 50): Promise<Leaderboard> {
  return request<Leaderboard>(`/users/leaderboard?limit=${limit}`);
}

export function fetchPacks(filter: {
  category?: string;
  mine?: boolean;
}): Promise<PackSummary[]> {
  const query = new URLSearchParams();

  if (filter.category) query.set('category', filter.category);
  if (filter.mine) query.set('mine', 'true');

  const suffix = query.size > 0 ? `?${query.toString()}` : '';

  return request<PackSummary[]>(`/pack${suffix}`);
}

export function fetchPack(packId: string): Promise<PackWithQuestions> {
  return request<PackWithQuestions>(`/pack/${packId}`);
}

export function createPack(dto: CreatePackDto): Promise<PackWithQuestions> {
  return request<PackWithQuestions>('/pack', { method: 'POST', body: dto });
}

export function updatePack(
  packId: string,
  dto: UpdatePackDto,
): Promise<PackWithQuestions> {
  return request<PackWithQuestions>(`/pack/${packId}`, {
    method: 'PATCH',
    body: dto,
  });
}

export function deletePack(packId: string): Promise<void> {
  return request<void>(`/pack/${packId}`, { method: 'DELETE' });
}

export function generateAiPack(topic: string): Promise<GeneratedPackResponse> {
  return request<GeneratedPackResponse>('/pack/generate-ai', {
    method: 'POST',
    body: { topic },
  });
}
