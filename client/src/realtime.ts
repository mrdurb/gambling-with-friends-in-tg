import type { Ack, BjAction, ClientToServerEvents, ServerToClientEvents, TableSnapshot } from '@casino/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAuthHeader } from './telegram.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: Client | null = null;

// Одно подключение на всё приложение; создаётся при первом открытии стола.
function getSocket(): Client {
  socket ??= io({ auth: { token: getAuthHeader() } });
  return socket;
}

// Браузер может держать ушедшую страницу в памяти вместе с открытым соединением,
// и тогда стол не узнаёт, что игрок ушёл. Закрываем соединение сами и открываем при возврате.
window.addEventListener('pagehide', () => socket?.disconnect());
window.addEventListener('pageshow', (event) => {
  if (event.persisted) socket?.connect();
});

export type TableStatus = 'connecting' | 'ready' | 'offline' | 'not_found' | 'kicked';

export interface TableConnection {
  status: TableStatus;
  snapshot: TableSnapshot | null;
  sit: (seat: number, force?: boolean) => Promise<Ack>;
  stand: () => void;
  bet: (amount: number) => Promise<Ack>;
  act: (action: BjAction) => Promise<Ack>;
  // Вернуть управление этому устройству после вытеснения.
  reclaim: () => void;
}

// onBalance вызывается, когда сервер сообщает новый баланс игрока (после расчёта раздачи).
export function useTable(code: string, onBalance: (balance: number) => void): TableConnection {
  const [status, setStatus] = useState<TableStatus>('connecting');
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  const balanceHandler = useRef(onBalance);
  balanceHandler.current = onBalance;

  useEffect(() => {
    const client = getSocket();
    let kicked = false;

    const join = () => {
      kicked = false;
      client.emit('table:join', code, (result) => {
        if (result.ok) {
          setSnapshot(result.snapshot);
          setStatus('ready');
        } else {
          setStatus('not_found');
        }
      });
    };
    const onDisconnect = () => setStatus(kicked ? 'kicked' : 'offline');
    const onKicked = () => {
      kicked = true;
      setStatus('kicked');
    };

    client.on('connect', join);
    client.on('disconnect', onDisconnect);
    client.on('kicked', onKicked);
    const onBalanceEvent = (balance: number) => balanceHandler.current(balance);

    client.on('table:snapshot', setSnapshot);
    client.on('balance', onBalanceEvent);
    if (client.connected) join();
    else client.connect();

    return () => {
      client.off('connect', join);
      client.off('disconnect', onDisconnect);
      client.off('kicked', onKicked);
      client.off('table:snapshot', setSnapshot);
      client.off('balance', onBalanceEvent);
      client.emit('table:leave');
    };
  }, [code]);

  const sit = useCallback(
    (seat: number, force = false) => new Promise<Ack>((resolve) => getSocket().emit('seat:take', seat, force, resolve)),
    [],
  );
  const stand = useCallback(() => void getSocket().emit('seat:leave'), []);
  const bet = useCallback((amount: number) => new Promise<Ack>((resolve) => getSocket().emit('game:bet', amount, resolve)), []);
  const act = useCallback((action: BjAction) => new Promise<Ack>((resolve) => getSocket().emit('game:action', action, resolve)), []);
  const reclaim = useCallback(() => {
    setStatus('connecting');
    getSocket().connect();
  }, []);

  return { status, snapshot, sit, stand, bet, act, reclaim };
}
