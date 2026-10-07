import type { Me, RouletteSnapshot } from '@casino/shared';
import type { ReactNode } from 'react';
import type { TableConnection } from '../realtime.ts';

interface Props {
  snapshot: RouletteSnapshot;
  me: Me;
  connection: TableConnection;
  onOpenCashier: () => void;
  chat: ReactNode;
}

export function RouletteTable({ chat }: Props) {
  return <div className="bottom">{chat}</div>;
}
