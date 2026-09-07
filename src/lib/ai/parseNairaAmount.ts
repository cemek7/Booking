const SMALL_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

const SCALE_NUMBERS: Record<string, number> = {
  thousand: 1_000,
  million: 1_000_000,
};

function parseWordAmount(text: string): number | null {
  const normalized = text
    .toLowerCase()
    .replace(/\b(?:naira|only|and)\b/gi, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  let total = 0;
  let current = 0;
  let matched = false;

  for (const token of normalized.split(' ')) {
    if (token in SMALL_NUMBERS) {
      matched = true;
      if (token === 'hundred') {
        current = current === 0 ? 100 : current * 100;
      } else {
        current += SMALL_NUMBERS[token];
      }
      continue;
    }

    if (token in SCALE_NUMBERS) {
      matched = true;
      const scale = SCALE_NUMBERS[token];
      total += (current || 1) * scale;
      current = 0;
      continue;
    }
  }

  if (!matched) return null;
  return total + current;
}

export function parseNairaAmount(text: string): number | null {
  if (!text || !text.trim()) return null;

  const normalized = text.trim().toLowerCase();
  const compactMatch = normalized.match(/(?:₦|\bngn\b|\bnaira\b)?\s*([\d,]+(?:\.\d+)?)\s*(k|m)?\b/i);
  if (compactMatch) {
    const numeric = Number(compactMatch[1].replace(/,/g, ''));
    if (Number.isFinite(numeric)) {
      const multiplier = compactMatch[2]?.toLowerCase() === 'm'
        ? 1_000_000
        : compactMatch[2]?.toLowerCase() === 'k'
          ? 1_000
          : 1;
      return Math.round(numeric * multiplier * 100);
    }
  }

  const wordAmount = parseWordAmount(normalized);
  if (wordAmount !== null) {
    return wordAmount * 100;
  }

  return null;
}
