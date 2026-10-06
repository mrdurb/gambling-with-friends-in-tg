import type { PlayerInfo } from '@casino/shared';
import { useState } from 'react';

function initials(player: PlayerInfo): string {
  return ([...player.firstName][0] ?? '') + ([...(player.lastName ?? '')][0] ?? '');
}

// Кружок с инициалами, поверх которого ложится фотография, когда (и если) она загрузилась.
export function PlayerAvatar({ player, size = 40 }: { player: PlayerInfo; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initials(player)}
      {player.photoUrl && !failed && <img src={player.photoUrl} alt="" onError={() => setFailed(true)} />}
    </span>
  );
}

export const playerName = (player: PlayerInfo) => [player.firstName, player.lastName].filter(Boolean).join(' ');
