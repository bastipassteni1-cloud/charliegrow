import { test, expect } from '@playwright/test';
import { login, getDexieProducts, getPendingOps, goToInventario, createProduct } from './helpers';

test.describe('Cola de sincronización', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('productos offline se sincronizan en bulk al volver online', async ({ page, context }) => {
    // Capturar console del browser para debug
    const logs: string[] = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => logs.push(`[pageerror] ${err.message}`));

    await goToInventario(page);
    await context.setOffline(true);

    const nombres = ['Sync Test A', 'Sync Test B', 'Sync Test C'];
    for (const nombre of nombres) {
      await createProduct(page, { nombre, precioVenta: 1000 });
    }

    // Verificar ops pendientes
    const opsPendientes = await getPendingOps(page);
    expect(opsPendientes.filter((op: any) => op.type === 'ADD_PRODUCT').length).toBeGreaterThanOrEqual(3);

    // Capturar llamadas para verificar bulk upsert
    let bulkUpsertCalled = false;
    await page.route('**/rest/v1/products**', async route => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        if (Array.isArray(body) && body.length > 1) bulkUpsertCalled = true;
      }
      await route.continue();
    });

    // Asegurar que checkRealConnectivity pase respondiendo rápido a categories
    await page.route('**/rest/v1/categories**', async route => {
      await route.fulfill({ json: [], status: 200 });
    });

    // Volver online — disparar evento manualmente porque CDP no siempre lo emite
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    // Debug: verificar estado del browser
    const debugInfo = await page.evaluate(() => ({
      navigatorOnLine: navigator.onLine,
      pendingOps: JSON.parse(localStorage.getItem('almacen_pending') || '[]').length,
    }));
    console.log('DEBUG after online:', JSON.stringify(debugInfo));

    // Dar 5s y ver qué logea el browser
    await page.waitForTimeout(5000);
    console.log('Browser logs:', logs.slice(-20).join('\n'));

    // Esperar hasta que la cola esté vacía para esos productos (max 30s)
    await page.waitForFunction(
      (ns: string[]) => {
        const ops = JSON.parse(localStorage.getItem('almacen_pending') || '[]');
        return ops.filter((op: any) => op.type === 'ADD_PRODUCT' && ns.includes(op.data?.nombre)).length === 0;
      },
      nombres,
      { timeout: 30000 }
    );

    expect(bulkUpsertCalled).toBe(true);

    // Cola vacía para esos productos
    const opsRestantes = await getPendingOps(page);
    expect(opsRestantes.filter((op: any) =>
      op.type === 'ADD_PRODUCT' && nombres.includes(op.data?.nombre)
    ).length).toBe(0);
  });

  test('Dexie gana sobre Supabase cuando datos locales son más nuevos', async ({ page }) => {
    await createProduct(page, { nombre: 'Test Merge Priority', precioVenta: 9999 });
    await page.waitForTimeout(2000);

    // Supabase devuelve el mismo producto con precio viejo y fecha más antigua (solo interceptar GET)
    await page.route('**/rest/v1/products**', async route => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const json = await response.json();
      if (Array.isArray(json)) {
        await route.fulfill({ json: json.map((p: any) =>
          p.nombre === 'Test Merge Priority'
            ? { ...p, precio_venta: 1, updated_at: '2020-01-01T00:00:00.000Z' }
            : p
        )});
      } else {
        await route.continue();
      }
    });

    await page.reload();
    await expect(page.locator('#tab-caja')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Precio en Dexie debe ser 9999, no el 1 de Supabase
    const productos = await getDexieProducts(page);
    const prod = productos.find((p: any) => p.nombre === 'Test Merge Priority');
    expect(prod?.precioVenta).toBe(9999);
  });
});
