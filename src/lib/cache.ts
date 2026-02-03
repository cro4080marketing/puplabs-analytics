import { prisma } from './prisma';
import crypto from 'crypto';

const CACHE_TTL_MINUTES = 30;

export function generateCacheKey(params: Record<string, unknown>): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  return crypto.createHash('md5').update(sorted).digest('hex');
}

export async function getCachedData<T>(shopId: string, queryKey: string): Promise<T | null> {
  try {
    const cached = await prisma.cachedQuery.findUnique({
      where: {
        shopId_queryKey: { shopId, queryKey },
      },
    });

    if (!cached) return null;

    if (new Date() > cached.expiresAt) {
      await prisma.cachedQuery.delete({
        where: { id: cached.id },
      });
      return null;
    }

    return cached.data as T;
  } catch {
    return null;
  }
}

export async function setCachedData(
  shopId: string,
  queryKey: string,
  data: unknown
): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MINUTES * 60 * 1000);

  try {
    await prisma.cachedQuery.upsert({
      where: {
        shopId_queryKey: { shopId, queryKey },
      },
      update: {
        data: data as object,
        expiresAt,
      },
      create: {
        shopId,
        queryKey,
        data: data as object,
        expiresAt,
      },
    });
  } catch (error) {
    console.error('Cache write error:', error);
  }
}

export async function clearCache(shopId: string): Promise<void> {
  try {
    await prisma.cachedQuery.deleteMany({
      where: { shopId },
    });
  } catch (error) {
    console.error('Cache clear error:', error);
  }
}
