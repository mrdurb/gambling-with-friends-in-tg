import { RED_NUMBERS, SPIN_MS, WHEEL_ORDER } from '@casino/shared';
import { useEffect, useState } from 'react';

const STEP = 360 / WHEEL_ORDER.length;
const FULL_TURNS = 4;

export const numberColor = (number: number) => (number === 0 ? 'green' : RED_NUMBERS.has(number) ? 'red' : 'black');

// Точка на окружности радиуса r; угол в градусах, ноль сверху, по часовой стрелке.
function point(r: number, degrees: number): string {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return `${(r * Math.cos(radians)).toFixed(2)} ${(r * Math.sin(radians)).toFixed(2)}`;
}

const SECTORS = WHEEL_ORDER.map((number, index) => {
  const from = (index - 0.5) * STEP;
  const to = (index + 0.5) * STEP;
  return { number, index, path: `M0 0 L${point(96, from)} A96 96 0 0 1 ${point(96, to)} Z` };
});

interface Props {
  // Выпавшее число; null, пока колесо не запущено.
  number: number | null;
  // Сколько миллисекунд осталось вращаться; null, если колесо стоит.
  spinMs: number | null;
  // Число, которое показать в центре, когда колесо остановилось.
  shown: number | null;
}

// Колесо рулетки: указатель неподвижен, колесо доворачивается так, чтобы выпавший сектор встал под него.
export function Wheel({ number, spinMs, shown }: Props) {
  const [rotation, setRotation] = useState(0);
  const [duration, setDuration] = useState(0);
  const spinning = spinMs !== null;

  // Запускается один раз на число: новые снимки посреди вращения анимацию не перезапускают.
  useEffect(() => {
    if (number === null) return;
    const rest = -WHEEL_ORDER.indexOf(number) * STEP;
    if (spinMs === null) {
      // Колесо уже едет к этому сектору или стоит на нём — анимацию не трогаем: снимок с результатом
      // может прийти на мгновение раньше, чем она закончится.
      const settled = rest + Math.round((rotation - rest) / 360) * 360;
      if (Math.abs(settled - rotation) < 0.01) return;
      // Зашли во время показа результата: ставим нужный сектор под указатель без вращения.
      setDuration(0);
      setRotation(settled);
      return;
    }
    // Крутим только вперёд; зашедшему посреди вращения достаётся меньше оборотов.
    const turns = Math.max(1, Math.round((FULL_TURNS * spinMs) / SPIN_MS));
    setDuration(spinMs);
    setRotation(rest + (Math.ceil((rotation - rest) / 360) + turns) * 360);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number, spinning]);

  return (
    <svg className="wheel" viewBox="-104 -104 208 208" role="img" aria-label="Колесо рулетки">
      <g
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: duration ? `transform ${duration}ms cubic-bezier(0.12, 0.6, 0.12, 1)` : 'none',
        }}
      >
        <circle r="100" className="wheel-rim" />
        {SECTORS.map(({ number: value, index, path }) => (
          <g key={value}>
            <path d={path} className={`wheel-${numberColor(value)}`} />
            <text className="wheel-number" transform={`rotate(${index * STEP}) translate(0 -80)`}>
              {value}
            </text>
          </g>
        ))}
        <circle r="56" className="wheel-hub" />
      </g>
      {shown !== null && (
        <text className={`wheel-result wheel-${numberColor(shown)}`} y="2">
          {shown}
        </text>
      )}
      <path d="M-9 -104 L9 -104 L0 -86 Z" className="wheel-pointer" />
    </svg>
  );
}
