import { test, expect } from '@playwright/test';
import { login, getDexieProducts, getPendingOps, goToInventario, createProduct } from './helpers';

test.describe('Comportamiento offline', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('producto creado offline persiste en Dexie y en cola pendiente', async ({ page, context }) => {
    await goToInventario(page);
    await context.setOffline(true);

    await createProduct(page, { nombre: 'Producto Offline Test', precioVenta: 5000 });

    // Verificar en Dexie
    const productos = await getDexieProducts(page);
    expect(productos.find((p: any) => p.nombre === 'Producto Offline Test')).toBeTruthy();

    // Verificar en cola pendiente (localStorage)
    const ops = await getPendingOps(page);
    expect(ops.some((op: any) => op.type === 'ADD_PRODUCT' && op.data.nombre === 'Producto Offline Test')).toBe(true);

    // Navegar entre pestañas sin recargar — los datos persisten desde Dexie en memoria
    await page.click('#tab-caja');
    await page.click('#tab-inventario');
    await expect(page.locator('text=Producto Offline Test').first()).toBeAttached({ timeout: 5000 });

    await context.setOffline(false);
  });

  test('código de barra NO se pierde cuando Supabase devuelve null', async ({ page }) => {
    // Barcode único por run para evitar duplicados en retries
    const BARCODE = `CG-TEST-${Date.now()}`;

    await createProduct(page, { nombre: 'Test Barcode Persist', precioVenta: 1000, codigoBarras: BARCODE });
    await page.waitForTimeout(2000); // esperar sync inicial

    // Verificar barcode en Dexie
    const antes = await getDexieProducts(page);
    const prodAntes = antes.find((p: any) => p.nombre === 'Test Barcode Persist');
    expect(prodAntes?.codigoBarras).toBe(BARCODE);

    // Simular Supabase devolviendo barcode como null
    await page.route('**/rest/v1/products**', async route => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      try {
        const response = await route.fetch();
        const json = await response.json();
        if (Array.isArray(json)) {
          await route.fulfill({ json: json.map((p: any) =>
            p.nombre === 'Test Barcode Persist' ? { ...p, codigo_barras: null } : p
          )});
          return;
        }
      } catch {
        // response disposed (p.ej. por reload concurrente)
      }
      await route.continue();
    });

    // Recargar para forzar loadAll con el mock
    await page.reload();
    await expect(page.locator('#tab-caja')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000);

    // Barcode debe seguir intacto en Dexie
    const despues = await getDexieProducts(page);
    const prodDespues = despues.find((p: any) => p.nombre === 'Test Barcode Persist');
    expect(prodDespues?.codigoBarras).toBe(BARCODE);
  });

  test('app funciona sin internet — datos disponibles desde memoria y Dexie', async ({ page, context }) => {
    // Crear un producto online para tenerlo en Dexie
    await createProduct(page, { nombre: 'Producto Pre-Offline', precioVenta: 2000 });

    // Cortar internet — app sigue en memoria, Dexie intacto
    await context.setOffline(true);

    // Navegar entre pestañas sin recargar (SPA, no necesita red)
    await page.click('#tab-caja');
    await page.click('#tab-inventario');
    await expect(page.locator('text=/productos registrados/')).toBeVisible({ timeout: 5000 });

    // Verificar que el producto está en Dexie sin red
    const productos = await getDexieProducts(page);
    expect(productos.find((p: any) => p.nombre === 'Producto Pre-Offline')).toBeTruthy();

    await context.setOffline(false);
  });
});
