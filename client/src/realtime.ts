import type { Ack, ClientToServerEvents, ServerToClientEvents, TableSnapshot } from '@casino/shared';
import { useCallback, useEffect, useState } from 'react';
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
  // Вернуть управление этому устройству после вытеснения.
  reclaim: () => void;
}

export function useTable(code: string): TableConnection {
  const [status, setStatus] = useState<TableStatus>('connecting');
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);

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
    client.on('table:snapshot', setSnapshot);
    if (client.connected) join();
    else client.connect();

    return () => {
      client.off('connect', join);
      client.off('disconnect', onDisconnect);
      client.off('kicked', onKicked);
      client.off('table:snapshot', setSnapshot);
      client.emit('table:leave');
    };
  }, [code]);

  const sit = useCallback(
    (seat: number, force = false) => new Promise<Ack>((resolve) => getSocket().emit('seat:take', seat, force, resolve)),
    [],
  );
  const stand = useCallback(() => void getSocket().emit('seat:leave'), []);
  const reclaim = useCallback(() => {
    setStatus('connecting');
    getSocket().connect();
  }, []);

  return { status, snapshot, sit, stand, reclaim };
}
