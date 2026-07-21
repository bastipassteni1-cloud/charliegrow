import { test, expect } from '@playwright/test';
import { login, getDexieProducts, getPendingOps, goToInventario } from './helpers';

test.describe('Comportamiento offline', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('producto creado offline persiste en Dexie y se ve al recargar', async ({ page, context }) => {
    await goToInventario(page);

    // Cortar internet
    await context.setOffline(true);

    // Crear producto offline
    await page.click('text=+ Nuevo');
    await page.fill('input[placeholder*="Nombre"]', 'Producto Offline Test');
    await page.fill('input[placeholder*="Precio venta"]', '5000');
    await page.click('button:has-text("Guardar")');
    await expect(page.locator('text=Producto Offline Test').first()).toBeVisible({ timeout: 5000 });

    // Verificar que está en Dexie
    const productos = await getDexieProducts(page);
    const encontrado = productos.find(p => p.nombre === 'Producto Offline Test');
    expect(encontrado).toBeTruthy();

    // Verificar que hay op pendiente en la cola
    const ops = await getPendingOps(page);
    expect(ops.some(op => op.type === 'ADD_PRODUCT' && op.data.nombre === 'Producto Offline Test')).toBe(true);

    // Recargar página (aún offline)
    await page.reload();
    await page.fill('input[type="email"]', (await import('fs')).readFileSync((await import('path')).join(__dirname, '.auth.json'), 'utf-8').match(/"email":"([^"]+)"/)?.[1] ?? '');

    // Esperar carga desde Dexie
    await expect(page.locator('text=Producto Offline Test').first()).toBeVisible({ timeout: 10000 });

    await context.setOffline(false);
  });

  test('código de barra NO se pierde cuando Supabase devuelve null', async ({ page, context }) => {
    // Interceptar la llamada de productos de Supabase y devolver el producto sin barcode
    const BARCODE = 'CG-TEST-12345678';
    const productId = crypto.randomUUID();

    // Primero crear el producto con barcode (online)
    await page.click('text=Stock');
    await page.click('text=+ Nuevo');
    await page.fill('input[placeholder*="Nombre"]', 'Test Barcode Persist');
    await page.fill('input[placeholder*="Precio venta"]', '1000');
    await page.fill('input[placeholder*="Opcional"]', BARCODE);
    await page.click('button:has-text("Guardar")');
    await expect(page.locator('text=Test Barcode Persist').first()).toBeVisible({ timeout: 8000 });

    // Verificar que el barcode está en Dexie
    const antes = await getDexieProducts(page);
    const prodAntes = antes.find(p => p.nombre === 'Test Barcode Persist');
    expect(prodAntes?.codigoBarras).toBe(BARCODE);

    // Simular que Supabase devuelve el producto SIN barcode (el bug anterior)
    await page.route('**/rest/v1/products**', async route => {
      const response = await route.fetch();
      const json = await response.json();
      if (Array.isArray(json)) {
        const modified = json.map((p: any) =>
          p.nombre === 'Test Barcode Persist' ? { ...p, codigo_barras: null } : p
        );
        await route.fulfill({ json: modified });
      } else {
        await route.continue();
      }
    });

    // Recargar para forzar loadAll con el mock activo
    await page.reload();
    await expect(page.locator('text=Caja').or(page.locator('text=Stock'))).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000); // esperar sync

    // Verificar que el barcode NO se perdió (el fix lo protege)
    const despues = await getDexieProducts(page);
    const prodDespues = despues.find(p => p.nombre === 'Test Barcode Persist');
    expect(prodDespues?.codigoBarras).toBe(BARCODE);
  });

  test('app carga desde Dexie sin internet al abrir', async ({ page, context }) => {
    // Primero cargar online para poblar Dexie
    await page.click('text=Stock');
    await expect(page.locator('text=/productos registrados/')).toBeVisible();

    // Cortar internet y recargar
    await context.setOffline(true);
    await page.reload();

    // La app debe cargar igual desde Dexie
    await expect(page.locator('text=Inventario')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=/productos registrados/')).toBeVisible({ timeout: 5000 });

    await context.setOffline(false);
  });
});
