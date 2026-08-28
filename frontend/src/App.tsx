import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ToastHost } from './components/ToastHost';
import { useAuthStore } from './store/authStore';
import { bindGameSocket, useGameStore } from './store/gameStore';
import { connectSocket, disconnectSocket } from './socket/socket';
import { getStartParam } from './lib/telegram';
import { useGameNavigation } from './hooks/useGameNavigation';
import { SplashScreen } from './screens/SplashScreen';
import { HomeScreen } from './screens/HomeScreen';
import { PacksScreen } from './screens/PacksScreen';
import { PackEditorScreen } from './screens/PackEditorScreen';
import { JoinScreen } from './screens/JoinScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { GameScreen } from './screens/GameScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';

export function App() {
  const status = useAuthStore((state) => state.status);
  const token = useAuthStore((state) => state.token);
  const authorize = useAuthStore((state) => state.authorize);
  const authorizeStarted = useRef(false);

  useEffect(() => {
    // StrictMode в dev монтирует эффекты дважды — авторизуемся ровно один раз.
    if (authorizeStarted.current) return;

    authorizeStarted.current = true;
    void authorize();
  }, [authorize]);

  useEffect(() => {
    if (!token) return;

    const socket = connectSocket(token);
    bindGameSocket(socket);

    return () => {
      disconnectSocket();
    };
  }, [token]);

  if (status !== 'authorized') {
    return (
      <>
        <SplashScreen />
        <ToastHost />
      </>
    );
  }

  return (
    <>
      <AuthorizedRoutes />
      <ToastHost />
    </>
  );
}

function AuthorizedRoutes() {
  useGameNavigation();
  useDeepLinkJoin();

  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/packs" element={<PacksScreen />} />
      <Route path="/packs/new" element={<PackEditorScreen />} />
      <Route path="/packs/:packId/edit" element={<PackEditorScreen />} />
      <Route path="/join" element={<JoinScreen />} />
      <Route path="/lobby" element={<LobbyScreen />} />
      <Route path="/game" element={<GameScreen />} />
      <Route path="/results" element={<ResultsScreen />} />
      <Route path="/history" element={<HistoryScreen />} />
      <Route path="/leaderboard" element={<LeaderboardScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Открытие по ссылке `t.me/<bot>?startapp=<roomId>`: сразу после авторизации
 * шлём JOIN_ROOM с этим кодом, дальше пользователя уводит useGameNavigation.
 */
function useDeepLinkJoin() {
  const connected = useGameStore((state) => state.connected);
  const joinRoom = useGameStore((state) => state.joinRoom);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || !connected) return;

    const startParam = getStartParam();

    handled.current = true;

    if (startParam) joinRoom(startParam);
  }, [connected, joinRoom]);
}
