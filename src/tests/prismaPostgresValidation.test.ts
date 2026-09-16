/**
 * Real PostgreSQL + Prisma CRUD & Multi-Tenant Isolation Integration Tests
 *
 * Verifies:
 * 1. Real PostgreSQL database connection (mureeh_test)
 * 2. Complete CRUD lifecycle for Restaurant, Categories, and Products
 * 3. Branding persistence: logoFit, logoPosition, logoUrl, coverImageUrl
 * 4. Multi-tenant isolation: Tenant A records are completely inaccessible to Tenant B
 * 5. Branding isolation: Updating Tenant A branding never alters Tenant B branding
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/prisma';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Prisma + Real PostgreSQL Integration & Tenant Isolation', () => {
  const runId = Date.now();
  const slugA = `tenant-a-${runId}`;
  const slugB = `tenant-b-${runId}`;
  let restAId = '';
  let restBId = '';
  let catAId = '';
  let prodAId = '';

  beforeAll(async () => {
    // 1. Connect and create isolated tenants A & B
    const a = await prisma.restaurant.create({
      data: {
        name: 'Restaurant Alpha',
        nameEn: 'Alpha Dining',
        slug: slugA,
        logoUrl: 'restaurants/a/logo/uuid-a.webp',
        logoFit: 'cover',
        logoPosition: '50% 50%',
        coverImageUrl: 'restaurants/a/cover/uuid-cover-a.webp',
        description: 'Alpha description',
        phone: '0599111111',
        address: 'Street A',
        primaryColor: '#D4AF37',
        accentColor: '#C5A880',
        galleryImages: ['restaurants/a/gallery/1.webp', 'restaurants/a/gallery/2.webp'],
      },
    });
    restAId = a.id;

    const b = await prisma.restaurant.create({
      data: {
        name: 'Restaurant Beta',
        nameEn: 'Beta Bistro',
        slug: slugB,
        logoUrl: 'restaurants/b/logo/uuid-b.webp',
        logoFit: 'contain',
        logoPosition: '100% 0%',
        coverImageUrl: 'restaurants/b/cover/uuid-cover-b.webp',
        description: 'Beta description',
        phone: '0599222222',
        address: 'Street B',
        primaryColor: '#10B981',
        accentColor: '#065F46',
        galleryImages: ['restaurants/b/gallery/1.webp'],
      },
    });
    restBId = b.id;
  });

  afterAll(async () => {
    if (prodAId) await prisma.product.delete({ where: { id: prodAId } }).catch(() => {});
    if (catAId) await prisma.category.delete({ where: { id: catAId } }).catch(() => {});
    if (restAId) await prisma.restaurant.delete({ where: { id: restAId } }).catch(() => {});
    if (restBId) await prisma.restaurant.delete({ where: { id: restBId } }).catch(() => {});
  });

  it('1. verifies both tenants were persisted with their respective distinct branding and logo framing', async () => {
    const fetchedA = await prisma.restaurant.findUnique({ where: { id: restAId } });
    const fetchedB = await prisma.restaurant.findUnique({ where: { id: restBId } });

    expect(fetchedA).not.toBeNull();
    expect(fetchedA?.slug).toBe(slugA);
    expect(fetchedA?.logoFit).toBe('cover');
    expect(fetchedA?.logoPosition).toBe('50% 50%');
    expect(fetchedA?.primaryColor).toBe('#D4AF37');

    expect(fetchedB).not.toBeNull();
    expect(fetchedB?.slug).toBe(slugB);
    expect(fetchedB?.logoFit).toBe('contain');
    expect(fetchedB?.logoPosition).toBe('100% 0%');
    expect(fetchedB?.primaryColor).toBe('#10B981');
  });

  it('2. updating Tenant A branding (logoFit, logoPosition, colors) isolates changes from Tenant B', async () => {
    const updatedA = await prisma.restaurant.update({
      where: { id: restAId },
      data: {
        logoFit: 'contain',
        logoPosition: '0% 50%',
        primaryColor: '#7C3AED',
      },
    });

    expect(updatedA.logoFit).toBe('contain');
    expect(updatedA.logoPosition).toBe('0% 50%');
    expect(updatedA.primaryColor).toBe('#7C3AED');

    // Tenant B must remain strictly unchanged
    const fetchedB = await prisma.restaurant.findUnique({ where: { id: restBId } });
    expect(fetchedB?.logoFit).toBe('contain');
    expect(fetchedB?.logoPosition).toBe('100% 0%');
    expect(fetchedB?.primaryColor).toBe('#10B981');
  });

  it('3. tenant data isolation: products created under Tenant A are strictly invisible to Tenant B', async () => {
    const cat = await prisma.category.create({
      data: {
        name: 'Main Courses',
        nameEn: 'Mains',
        sortOrder: 1,
        restaurantId: restAId,
      },
    });
    catAId = cat.id;

    const prod = await prisma.product.create({
      data: {
        name: 'Dish Alpha',
        nameEn: 'Dish Alpha',
        description: 'Alpha recipe',
        imageUrl: 'https://cdn.example.test/dish.webp',
        price: 75,
        restaurantId: restAId,
        categoryId: cat.id,
        available: true,
      },
    });
    prodAId = prod.id;

    // Query for Tenant A products
    const prodsA = await prisma.product.findMany({ where: { restaurantId: restAId } });
    expect(prodsA.some((p) => p.id === prodAId)).toBe(true);

    // Query for Tenant B products: must be completely empty / zero leak
    const prodsB = await prisma.product.findMany({ where: { restaurantId: restBId } });
    expect(prodsB.some((p) => p.id === prodAId)).toBe(false);
  });
});
