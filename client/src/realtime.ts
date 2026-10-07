import {
  CHAT_HISTORY,
  REACTION_MS,
  type Ack,
  type BjAction,
  type Card,
  type ChatMessage,
  type ClientToServerEvents,
  type PokerActionKind,
  type ReactionEvent,
  type RouletteField,
  type ServerToClientEvents,
  type TableSnapshot,
} from '@casino/shared';
import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAuthHeader } from './telegram.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: Client | null = null;
let balanceListener: (balance: number) => void = () => {};

// Сервер сообщает новый баланс после расчёта раздачи — в том числе когда игрок уже ушёл с экрана стола.
export function onBalanceChange(listener: (balance: number) => void): void {
  balanceListener = listener;
}

// Одно подключение на всё приложение; создаётся при первом открытии стола.
function getSocket(): Client {
  if (!socket) {
    socket = io({ auth: { token: getAuthHeader() } });
    socket.on('balance', (balance) => balanceListener(balance));
  }
  return socket;
}

// Браузер может держать ушедшую страницу в памяти вместе с открытым соединением,
// и тогда стол не узнаёт, что игрок ушёл. Закрываем соединение сами и открываем при возврате.
window.addEventListener('pagehide', () => socket?.disconnect());
window.addEventListener('pageshow', (event) => {
  if (event.persisted) socket?.connect();
});

// expired — сервер отказал в подключении: данные запуска устарели, приложение нужно открыть заново.
export type TableStatus = 'connecting' | 'ready' | 'offline' | 'not_found' | 'kicked' | 'expired';

export interface TableConnection {
  status: TableStatus;
  snapshot: TableSnapshot | null;
  sit: (seat: number, force?: boolean) => Promise<Ack>;
  stand: () => void;
  bet: (amount: number) => Promise<Ack>;
  act: (action: BjAction) => Promise<Ack>;
  // Последние сообщения, пришедшие, пока открыт этот экран стола.
  messages: ChatMessage[];
  // Сколько сообщений пришло всего, включая уже вытесненные из списка.
  messageCount: number;
  // Реакции, которые сейчас видны: игрок → эмодзи.
  reactions: Record<number, string>;
  sendChat: (text: string) => Promise<Ack>;
  sendReaction: (value: string) => void;
  // Кто отправил реакцию последним, пока открыт этот экран стола.
  lastReactor: number | null;
  rouletteBet: (field: RouletteField, amount: number) => Promise<Ack>;
  rouletteClear: () => Promise<Ack>;
  rouletteReady: () => Promise<Ack>;
  // Свои закрытые карты в покере; пусто, когда их нет.
  myCards: Card[];
  pokerSit: (seat: number, buyIn: number) => Promise<Ack>;
  pokerLeave: () => void;
  pokerRebuy: (amount: number) => Promise<Ack>;
  pokerAct: (kind: PokerActionKind, amount?: number) => Promise<Ack>;
  pokerDiscard: (index: number) => Promise<Ack>;
  pokerShow: () => Promise<Ack>;
  // Вернуть управление этому устройству после вытеснения.
  reclaim: () => void;
}

export function useTable(code: string): TableConnection {
  const [status, setStatus] = useState<TableStatus>('connecting');
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageCount, setMessageCount] = useState(0);
  const [reactions, setReactions] = useState<Record<number, string>>({});
  const [lastReactor, setLastReactor] = useState<number | null>(null);
  const [myCards, setMyCards] = useState<Card[]>([]);

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
    // После отказа в авторизации клиент сам не переподключается: ждать нечего.
    const onConnectError = (error: Error) => {
      if (error.message === 'unauthorized') setStatus('expired');
    };
    client.on('connect_error', onConnectError);

    const onMessage = (message: ChatMessage) => {
      setMessages((list) => [...list, message].slice(-CHAT_HISTORY));
      setMessageCount((count) => count + 1);
    };
    const fading = new Map<number, ReturnType<typeof setTimeout>>();
    const onReaction = ({ userId, reaction }: ReactionEvent) => {
      setReactions((current) => ({ ...current, [userId]: reaction.value }));
      setLastReactor(userId);
      clearTimeout(fading.get(userId));
      fading.set(
        userId,
        setTimeout(() => setReactions(({ [userId]: _gone, ...rest }) => rest), REACTION_MS),
      );
    };
    setMessages([]);
    setMessageCount(0);
    setReactions({});
    setLastReactor(null);
    setMyCards([]);

    client.on('table:snapshot', setSnapshot);
    client.on('chat:message', onMessage);
    client.on('reaction', onReaction);
    client.on('poker:cards', setMyCards);
    if (client.connected) join();
    else client.connect();

    return () => {
      client.off('connect', join);
      client.off('disconnect', onDisconnect);
      client.off('kicked', onKicked);
      client.off('connect_error', onConnectError);
      client.off('table:snapshot', setSnapshot);
      client.off('chat:message', onMessage);
      client.off('reaction', onReaction);
      client.off('poker:cards', setMyCards);
      for (const timer of fading.values()) clearTimeout(timer);
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
  const sendChat = useCallback((text: string) => new Promise<Ack>((resolve) => getSocket().emit('chat:send', text, resolve)), []);
  const sendReaction = useCallback(
    (value: string) => void getSocket().emit('reaction:send', { kind: 'emoji', value }, () => {}),
    [],
  );
  const rouletteBet = useCallback(
    (field: RouletteField, amount: number) =>
      new Promise<Ack>((resolve) => getSocket().emit('roulette:bet', field, amount, resolve)),
    [],
  );
  const rouletteClear = useCallback(() => new Promise<Ack>((resolve) => getSocket().emit('roulette:clear', resolve)), []);
  const rouletteReady = useCallback(() => new Promise<Ack>((resolve) => getSocket().emit('roulette:ready', resolve)), []);
  const pokerSit = useCallback(
    (seat: number, buyIn: number) => new Promise<Ack>((resolve) => getSocket().emit('poker:sit', seat, buyIn, resolve)),
    [],
  );
  const pokerLeave = useCallback(() => void getSocket().emit('poker:leave'), []);
  const pokerRebuy = useCallback((amount: number) => new Promise<Ack>((resolve) => getSocket().emit('poker:rebuy', amount, resolve)), []);
  const pokerAct = useCallback(
    (kind: PokerActionKind, amount?: number) =>
      new Promise<Ack>((resolve) => getSocket().emit('poker:action', kind, amount ?? null, resolve)),
    [],
  );
  const pokerDiscard = useCallback((index: number) => new Promise<Ack>((resolve) => getSocket().emit('poker:discard', index, resolve)), []);
  const pokerShow = useCallback(() => new Promise<Ack>((resolve) => getSocket().emit('poker:show', resolve)), []);
  const reclaim = useCallback(() => {
    setStatus('connecting');
    getSocket().connect();
  }, []);

  return {
    status,
    snapshot,
    sit,
    stand,
    bet,
    act,
    messages,
    messageCount,
    reactions,
    lastReactor,
    sendChat,
    sendReaction,
    rouletteBet,
    rouletteClear,
    rouletteReady,
    myCards,
    pokerSit,
    pokerLeave,
    pokerRebuy,
    pokerAct,
    pokerDiscard,
    pokerShow,
    reclaim,
  };
}
