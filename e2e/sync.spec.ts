import { test, expect } from '@playwright/test';
import { login, getDexieProducts, getPendingOps, goToInventario } from './helpers';

test.describe('Cola de sincronización', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('productos offline se sincronizan en bulk al volver online', async ({ page, context }) => {
    await goToInventario(page);

    // Cortar internet
    await context.setOffline(true);

    // Crear 3 productos offline
    const nombres = ['Sync Test A', 'Sync Test B', 'Sync Test C'];
    for (const nombre of nombres) {
      await page.click('text=+ Nuevo');
      await page.fill('input[placeholder*="Nombre"]', nombre);
      await page.fill('input[placeholder*="Precio venta"]', '1000');
      await page.click('button:has-text("Guardar")');
      await expect(page.locator(`text=${nombre}`).first()).toBeVisible({ timeout: 5000 });
    }

    // Verificar que hay ops pendientes
    const opsPendientes = await getPendingOps(page);
    const addOps = opsPendientes.filter(op => op.type === 'ADD_PRODUCT');
    expect(addOps.length).toBeGreaterThanOrEqual(3);

    // Capturar las llamadas a Supabase para verificar que va en bulk
    let bulkUpsertCalled = false;
    await page.route('**/rest/v1/products**', async route => {
      const request = route.request();
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        // Bulk si el body es un array con más de 1 elemento
        if (Array.isArray(body) && body.length > 1) {
          bulkUpsertCalled = true;
        }
      }
      await route.continue();
    });

    // Volver online
    await context.setOffline(false);

    // Esperar que el sync se dispare (la app detecta conexión)
    await page.waitForTimeout(5000);

    // Verificar que se usó bulk upsert
    expect(bulkUpsertCalled).toBe(true);

    // Verificar que la cola quedó vacía
    const opsRestantes = await getPendingOps(page);
    const addOpsRestantes = opsRestantes.filter(op =>
      op.type === 'ADD_PRODUCT' && nombres.includes(op.data.nombre)
    );
    expect(addOpsRestantes.length).toBe(0);
  });

  test('datos locales son más nuevos que Supabase — Dexie gana', async ({ page }) => {
    // Crear producto
    await goToInventario(page);
    await page.click('text=+ Nuevo');
    await page.fill('input[placeholder*="Nombre"]', 'Test Merge Priority');
    await page.fill('input[placeholder*="Precio venta"]', '9999');
    await page.click('button:has-text("Guardar")');
    await expect(page.locator('text=Test Merge Priority').first()).toBeVisible({ timeout: 8000 });

    // Simular que Supabase devuelve el mismo producto con precio distinto y fecha más antigua
    await page.route('**/rest/v1/products**', async route => {
      const response = await route.fetch();
      const json = await response.json();
      if (Array.isArray(json)) {
        const modified = json.map((p: any) =>
          p.nombre === 'Test Merge Priority'
            ? { ...p, precio_venta: 1, updated_at: '2020-01-01T00:00:00.000Z' }
            : p
        );
        await route.fulfill({ json: modified });
      } else {
        await route.continue();
      }
    });

    // Forzar loadAll
    await page.reload();
    await expect(page.locator('text=Caja').or(page.locator('text=Stock'))).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Verificar que Dexie tiene el precio correcto (9999), no el de Supabase (1)
    const productos = await getDexieProducts(page);
    const prod = productos.find(p => p.nombre === 'Test Merge Priority');
    expect(prod?.precioVenta).toBe(9999);
  });
});
