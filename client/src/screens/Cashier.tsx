import { CASHIER_MAX, CASHIER_PRESETS } from '@casino/shared';
import { Button, Cell, Input, List, Section } from '@telegram-apps/telegram-ui';
import { useState } from 'react';
import { withdrawFromCashier } from '../api.ts';
import { formatChips } from '../format.ts';

interface Props {
  balance: number;
  onBalance: (balance: number) => void;
  onBack: () => void;
}

export function Cashier({ balance, onBalance, onBack }: Props) {
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customAmount = Number(custom);
  const customValid = /^\d+$/.test(custom) && customAmount >= 1 && customAmount <= CASHIER_MAX;

  async function take(amount: number) {
    setBusy(true);
    setError(null);
    try {
      onBalance((await withdrawFromCashier(amount)).balance);
      setCustom('');
    } catch {
      setError('Не удалось выдать фишки. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <List>
      <Section>
        <Cell onClick={onBack}>‹ В лобби</Cell>
      </Section>
      <Section header="Касса" footer={error ?? `За один раз — до ${formatChips(CASHIER_MAX)} фишек, сколько угодно раз.`}>
        <Cell subtitle="Ваш баланс">{formatChips(balance)} фишек</Cell>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '8px 16px' }}>
          {CASHIER_PRESETS.map((amount) => (
            <Button key={amount} mode="bezeled" disabled={busy} onClick={() => take(amount)}>
              +{formatChips(amount)}
            </Button>
          ))}
        </div>
        <Input
          header="Своя сумма"
          placeholder={`от 1 до ${formatChips(CASHIER_MAX)}`}
          inputMode="numeric"
          value={custom}
          status={custom !== '' && !customValid ? 'error' : 'default'}
          onChange={(event) => setCustom(event.target.value.trim())}
        />
        <div style={{ padding: '8px 16px 16px' }}>
          <Button stretched disabled={busy || !customValid} onClick={() => take(customAmount)}>
            Взять
          </Button>
        </div>
      </Section>
    </List>
  );
}
