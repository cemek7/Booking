export type InventoryUom = 'piece' | 'pack' | 'ml' | 'l' | 'g' | 'kg';

const DIRECT_FACTORS: Record<string, number> = {
  'l:ml': 1000,
  'ml:l': 1 / 1000,
  'kg:g': 1000,
  'g:kg': 1 / 1000,
};

export function convert(
  qty: number,
  fromUom: InventoryUom,
  toUom: InventoryUom,
  packSize?: number | null,
): number {
  if (!Number.isFinite(qty)) {
    throw new Error('Quantity must be a finite number');
  }

  if (fromUom === toUom) return qty;

  const direct = DIRECT_FACTORS[`${fromUom}:${toUom}`];
  if (direct != null) {
    return qty * direct;
  }

  if ((fromUom === 'pack' && toUom === 'piece') || (fromUom === 'piece' && toUom === 'pack')) {
    if (!packSize || !Number.isFinite(packSize) || packSize <= 0) {
      throw new Error(`Pack size is required to convert ${fromUom} to ${toUom}`);
    }

    return fromUom === 'pack' ? qty * packSize : qty / packSize;
  }

  throw new Error(`Cannot convert ${fromUom} to ${toUom}`);
}
