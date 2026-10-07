import './table.css';
import { CHAT_MAX_LENGTH, type ChatMessage, type GameId, type Me } from '@casino/shared';
import { useEffect, useRef, useState } from 'react';
import { playerName } from '../components/PlayerAvatar.tsx';
import { useTable } from '../realtime.ts';
import { shareInvite } from '../telegram.ts';
import { BlackjackTable } from './BlackjackTable.tsx';
import { RouletteTable } from './RouletteTable.tsx';

interface Props {
  code: string;
  me: Me;
  onOpenCashier: () => void;
  // game — игра стола, если он успел загрузиться: возвращаемся к списку столов этой игры.
  onBack: (game: GameId | null) => void;
}

// Общая рамка стола: подключение, шапка, чат и служебные экраны. Сама игра — в экране своей игры.
export function Table({ code, me, onOpenCashier, onBack }: Props) {
  const connection = useTable(code);
  const { status, snapshot, reclaim } = connection;
  const [notice, setNotice] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  // Сколько сообщений игрок уже видел (чат был открыт).
  const [seenCount, setSeenCount] = useState(0);
  const unread = chatOpen ? 0 : connection.messageCount - seenCount;
  useEffect(() => {
    if (chatOpen) setSeenCount(connection.messageCount);
  }, [chatOpen, connection.messageCount]);

  const head = (title: string, invite?: () => void) => (
    <div className="tbl-head">
      <button className="link" onClick={() => onBack(snapshot?.table.game ?? null)}>
        ‹ Столы
      </button>
      <span className="name">{title}</span>
      {invite && (
        <>
          <button className="link" onClick={() => setChatOpen(!chatOpen)}>
            Чат{unread > 0 ? ` (${unread})` : ''}
          </button>
          <button className="link" onClick={invite}>
            Пригласить
          </button>
        </>
      )}
    </div>
  );

  if (status === 'not_found') {
    return (
      <div className="tbl">
        {head('Стол не найден')}
        <div className="tbl-notice">Проверьте ссылку или создайте новый стол.</div>
      </div>
    );
  }
  if (status === 'expired') {
    return (
      <div className="tbl">
        {head('Сеанс устарел')}
        <div className="tbl-notice">Закройте приложение и откройте его заново из Telegram.</div>
      </div>
    );
  }
  if (status === 'kicked') {
    return (
      <div className="tbl">
        {head('Приложение открыто в другом месте')}
        <div className="tbl-notice">Играть можно только с одного устройства.</div>
        <div className="panel">
          <button className="primary" onClick={reclaim}>
            Играть здесь
          </button>
        </div>
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="tbl">
        {head('Подключение…')}
      </div>
    );
  }

  async function invite() {
    const link = snapshot!.table.inviteLink ?? `${window.location.origin}/?tgWebAppStartParam=t_${code}`;
    const outcome = await shareInvite(link);
    if (outcome === 'copied') setNotice('Ссылка-приглашение скопирована.');
    if (outcome === 'failed') setNotice(`Скопируйте ссылку вручную: ${link}`);
  }

  const chat = chatOpen && (
    <Chat messages={connection.messages} meId={me.id} onSend={connection.sendChat} onClose={() => setChatOpen(false)} />
  );

  return (
    <div className="tbl">
      {head(snapshot.table.name, invite)}
      {status === 'offline' && <div className="tbl-notice">Переподключение…</div>}
      {notice && <div className="tbl-notice">{notice}</div>}
      {snapshot.kind === 'blackjack' ? (
        <BlackjackTable snapshot={snapshot} me={me} connection={connection} onOpenCashier={onOpenCashier} chat={chat} />
      ) : (
        <RouletteTable snapshot={snapshot} me={me} connection={connection} onOpenCashier={onOpenCashier} chat={chat} />
      )}
    </div>
  );
}

interface ChatProps {
  messages: ChatMessage[];
  meId: number;
  onSend: (text: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onClose: () => void;
}

function Chat({ messages, meId, onSend, onClose }: ChatProps) {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    if ((await onSend(trimmed)).ok) setText('');
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <span>Чат стола</span>
        <button className="link" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <div className="chat-list" ref={list}>
        {messages.length === 0 && <span className="hint">Сообщений пока нет. История не сохраняется.</span>}
        {messages.map((message, index) => (
          <div key={index} className="chat-message">
            <span className="hint">{message.from.id === meId ? 'Вы' : playerName(message.from)}</span>
            <span>{message.text}</span>
          </div>
        ))}
      </div>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          placeholder="Сообщение"
          onChange={(event) => setText(event.target.value)}
        />
        <button className="primary" type="submit" disabled={!text.trim()}>
          Отправить
        </button>
      </form>
    </div>
  );
}
