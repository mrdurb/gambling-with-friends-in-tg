export const formatChips = (amount: number) => amount.toLocaleString('ru-RU');

// Число со знаком: «+1 200», «−350», «0».
export const formatSigned = (amount: number) =>
  amount > 0 ? `+${formatChips(amount)}` : amount < 0 ? `−${formatChips(-amount)}` : '0';

// Доля от 0 до 1 как целый процент.
export const formatPercent = (share: number) => `${Math.round(share * 100)}%`;
