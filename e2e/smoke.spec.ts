import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('App básica', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('carga correctamente y muestra las 4 pestañas', async ({ page }) => {
    await expect(page.locator('text=Caja')).toBeVisible();
    await expect(page.locator('text=Stock')).toBeVisible();
    await expect(page.locator('text=Ventas')).toBeVisible();
    await expect(page.locator('text=Reportes')).toBeVisible();
  });

  test('puede navegar a Inventario y muestra el contador de productos', async ({ page }) => {
    await page.click('text=Stock');
    await expect(page.locator('text=Inventario')).toBeVisible();
    await expect(page.locator('text=/productos registrados/')).toBeVisible();
  });

  test('puede crear un producto nuevo', async ({ page }) => {
    await page.click('text=Stock');
    await page.click('text=+ Nuevo');
    await page.fill('input[placeholder*="Nombre"]', 'Producto Test Smoke');
    await page.fill('input[placeholder*="Precio venta"]', '1000');
    await page.click('button:has-text("Guardar")');
    await expect(page.locator('text=Producto Test Smoke').first()).toBeVisible({ timeout: 8000 });
  });

  test('muestra el modal de versión con fecha del build', async ({ page }) => {
    await page.click('button[title="Novedades y versiones"]');
    await expect(page.locator('text=Versión instalada')).toBeVisible();
    await expect(page.locator('text=ACTUAL')).toBeVisible();
  });
});
