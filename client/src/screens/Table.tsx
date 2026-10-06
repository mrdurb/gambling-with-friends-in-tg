import type { Me } from '@casino/shared';
import { Button, Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import { useState } from 'react';
import { PlayerAvatar, playerName } from '../components/PlayerAvatar.tsx';
import { useTable } from '../realtime.ts';
import { shareInvite } from '../telegram.ts';

interface Props {
  code: string;
  me: Me;
  onBack: () => void;
}

export function Table({ code, me, onBack }: Props) {
  const { status, snapshot, sit, stand, reclaim } = useTable(code);
  // Место, на которое игрок хочет пересесть с другого стола; ждёт подтверждения.
  const [moveTo, setMoveTo] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const back = (
    <Section>
      <Cell onClick={onBack}>‹ К столам</Cell>
    </Section>
  );

  if (status === 'not_found') {
    return (
      <List>
        {back}
        <Placeholder header="Стол не найден" description="Проверьте ссылку или создайте новый стол." />
      </List>
    );
  }
  if (status === 'kicked') {
    return (
      <List>
        {back}
        <Placeholder header="Приложение открыто в другом месте" description="Играть можно только с одного устройства.">
          <Button onClick={reclaim}>Играть здесь</Button>
        </Placeholder>
      </List>
    );
  }
  if (!snapshot) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    );
  }

  const seated = snapshot.seats.some((seat) => seat?.player.id === me.id);

  async function take(seat: number, force = false) {
    setNotice(null);
    const result = await sit(seat, force);
    setMoveTo(null);
    if (result.ok) return;
    if (result.error === 'seated_elsewhere') setMoveTo(seat);
    else if (result.error === 'seat_taken') setNotice('Это место уже заняли.');
    else setNotice('Не получилось сесть. Попробуйте ещё раз.');
  }

  async function invite() {
    const link = snapshot!.table.inviteLink ?? `${window.location.origin}/?tgWebAppStartParam=t_${code}`;
    const outcome = await shareInvite(link);
    if (outcome === 'copied') setNotice('Ссылка-приглашение скопирована.');
    if (outcome === 'failed') setNotice(`Скопируйте ссылку вручную: ${link}`);
  }

  return (
    <List>
      {back}
      {status === 'offline' && (
        <Section>
          <Cell before={<Spinner size="s" />}>Переподключение…</Cell>
        </Section>
      )}
      <Section
        header={snapshot.table.name}
        footer={notice ?? (snapshot.spectators > 0 ? `Зрителей: ${snapshot.spectators}` : undefined)}
      >
        {snapshot.seats.map((seat, index) => {
          if (!seat) {
            return (
              <Cell
                key={index}
                subtitle="Свободно"
                after={
                  !seated && (
                    <Button size="s" mode="bezeled" onClick={() => take(index)}>
                      Сесть
                    </Button>
                  )
                }
              >
                Место {index + 1}
              </Cell>
            );
          }
          const mine = seat.player.id === me.id;
          return (
            <Cell
              key={index}
              before={<PlayerAvatar player={seat.player} />}
              subtitle={seat.connected ? `Место ${index + 1}` : `Место ${index + 1} · нет связи`}
              after={
                mine && (
                  <Button size="s" mode="plain" onClick={stand}>
                    Встать
                  </Button>
                )
              }
            >
              {playerName(seat.player)}
              {mine ? ' (вы)' : ''}
            </Cell>
          );
        })}
      </Section>
      {moveTo !== null && (
        <Section header="Вы сидите за другим столом" footer="Если пересесть, место за тем столом освободится.">
          <div style={{ display: 'flex', gap: 8, padding: 16 }}>
            <Button stretched onClick={() => take(moveTo, true)}>
              Пересесть сюда
            </Button>
            <Button stretched mode="bezeled" onClick={() => setMoveTo(null)}>
              Отмена
            </Button>
          </div>
        </Section>
      )}
      <Section>
        <div style={{ padding: 16 }}>
          <Button stretched mode="bezeled" onClick={invite}>
            Пригласить друзей
          </Button>
        </div>
      </Section>
    </List>
  );
}
