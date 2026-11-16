import { DxfParserState } from './parserState';

export const parseFiniteNumber = (value: string): number | null => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const isFiniteNumberInRange = (
  value: number | null,
  min: number,
  max: number,
  includeMin = false,
): value is number => {
  if (value === null || !Number.isFinite(value)) return false;
  const aboveMin = includeMin ? value >= min : value > min;
  return aboveMin && value < max;
};

export const consumeEntityGroups = (
  state: DxfParserState,
  onGroup?: (code: number, value: string) => void,
) => {
  while (state.hasNext) {
    const p = state.peek();
    if (!p || p.code === 0) break;
    const g = state.next()!;
    onGroup?.(g.code, g.value);
  }
};
