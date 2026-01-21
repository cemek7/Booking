import { PAGINATION } from '@/lib/constants';

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * Parse pagination parameters from URL search params.
 * Uses constants for defaults and limits.
 */
export function parsePaginationParams(
  searchParams: URLSearchParams,
  options?: {
    defaultSort?: string;
    defaultOrder?: 'asc' | 'desc';
    maxLimit?: number;
  }
): PaginationParams {
  const maxLimit = options?.maxLimit ?? PAGINATION.MAX_LIMIT;
  const page = Math.max(
    PAGINATION.DEFAULT_PAGE,
    parseInt(searchParams.get('page') || String(PAGINATION.DEFAULT_PAGE), 10)
  );
  const limit = Math.min(
    maxLimit,
    Math.max(
      PAGINATION.MIN_LIMIT,
      parseInt(searchParams.get('limit') || String(PAGINATION.DEFAULT_LIMIT), 10)
    )
  );
  const offset = (page - 1) * limit;

  return {
    page,
    limit,
    offset,
    sort: searchParams.get('sort') || options?.defaultSort || 'created_at',
    order: (searchParams.get('order') as 'asc' | 'desc') || options?.defaultOrder || 'desc',
  };
}

/**
 * Build a paginated response object from data and total count.
 */
export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  params: PaginationParams
): PaginatedResult<T> {
  const totalPages = Math.ceil(total / params.limit);

  return {
    data,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages,
      hasNextPage: params.page < totalPages,
      hasPreviousPage: params.page > 1,
    },
  };
}

/**
 * Apply pagination to a Supabase query builder.
 * Returns the range to use with .range()
 */
export function getSupabaseRange(params: PaginationParams): { from: number; to: number } {
  return {
    from: params.offset,
    to: params.offset + params.limit - 1,
  };
}

/**
 * Create a cursor-based pagination token.
 * Useful for infinite scroll or large datasets.
 */
export function encodeCursor(value: string | number | Date): string {
  const timestamp = value instanceof Date ? value.toISOString() : String(value);
  return Buffer.from(timestamp).toString('base64');
}

/**
 * Decode a cursor-based pagination token.
 */
export function decodeCursor(cursor: string): string {
  try {
    return Buffer.from(cursor, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * Validate pagination params and throw if invalid.
 */
export function validatePaginationParams(params: PaginationParams): void {
  if (params.page < 1) {
    throw new Error('Page must be at least 1');
  }
  if (params.limit < PAGINATION.MIN_LIMIT || params.limit > PAGINATION.MAX_LIMIT) {
    throw new Error(`Limit must be between ${PAGINATION.MIN_LIMIT} and ${PAGINATION.MAX_LIMIT}`);
  }
}
