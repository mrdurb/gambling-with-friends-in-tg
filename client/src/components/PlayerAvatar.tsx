import type { PlayerInfo } from '@casino/shared';
import { Avatar } from '@telegram-apps/telegram-ui';

function initials(player: PlayerInfo): string {
  return ([...player.firstName][0] ?? '') + ([...(player.lastName ?? '')][0] ?? '');
}

type Size = 20 | 24 | 28 | 40 | 48 | 96;

export function PlayerAvatar({ player, size = 40 }: { player: PlayerInfo; size?: Size }) {
  return <Avatar size={size} src={player.photoUrl ?? undefined} acronym={initials(player)} />;
}

export const playerName = (player: PlayerInfo) => [player.firstName, player.lastName].filter(Boolean).join(' ');
