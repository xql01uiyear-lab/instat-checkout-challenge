// Every amount from the API is in kopecks (RUB * 100). One formatter, one rule.
const rub = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatMoney(kopecks: number): string {
  return rub.format(Math.round(kopecks) / 100);
}
