import { keyBelongsToRestaurant } from './helpers';
import type { StorageService } from './index';

// ============================================================
// Best-effort cleanup of replaced/deleted image URLs.
//
// Guarantees (see rule "delete old image"):
//   - Only URLs that belong to the CURRENT tenant's storage are touched.
//   - External URLs (Unsplash seeds, CDNs) and foreign-tenant keys are
//     skipped — a tenant can never delete another tenant's file.
//   - Delete failures are logged and reported, but NEVER thrown, so a
//     storage hiccup cannot roll back an already-committed DB change.
// ============================================================

export interface CleanupResult {
  deleted: string[];
  skipped: string[];
  failed: string[];
}

export async function deleteManagedAssets(
  storage: Pick<StorageService, 'keyFromUrl' | 'delete'>,
  restaurantId: string,
  urls: Array<string | null | undefined>
): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: [], skipped: [], failed: [] };
  const seen = new Set<string>();

  for (const raw of urls) {
    if (!raw) continue;
    const url = String(raw).trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const key = storage.keyFromUrl(url);
    if (!key) {
      // Not a URL we manage (external/CDN/legacy) — nothing to delete.
      result.skipped.push(url);
      continue;
    }
    if (!keyBelongsToRestaurant(key, restaurantId)) {
      // Belongs to another tenant (or a legacy flat key) — NEVER delete.
      result.skipped.push(url);
      continue;
    }
    try {
      await storage.delete(key);
      result.deleted.push(url);
    } catch (err) {
      result.failed.push(url);
      console.error(`[storage] delete failed for key "${key}":`, err);
    }
  }

  return result;
}
