import { test, expect } from '@playwright/test';
import { login, goToInventario, createProduct } from './helpers';

test.describe('App básica', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('carga correctamente y muestra las 4 pestañas', async ({ page }) => {
    await expect(page.locator('#tab-caja')).toBeVisible();
    await expect(page.locator('#tab-inventario')).toBeVisible();
    await expect(page.locator('#tab-ventas')).toBeVisible();
    await expect(page.locator('#tab-reportes')).toBeVisible();
  });

  test('puede navegar a Inventario y muestra el contador de productos', async ({ page }) => {
    await page.click('#tab-inventario');
    await expect(page.locator('text=/productos registrados/')).toBeVisible();
  });

  test('puede crear un producto nuevo', async ({ page }) => {
    await createProduct(page, { nombre: 'Producto Test Smoke', precioVenta: 1000 });
    await expect(page.locator('text=Producto Test Smoke').first()).toBeAttached();
  });

  test('muestra el modal de versión con fecha del build', async ({ page }) => {
    await page.click('button[title="Novedades y versiones"]');
    await expect(page.getByRole('heading', { name: 'Versión instalada' })).toBeVisible();
    await expect(page.getByText('ACTUAL', { exact: true })).toBeVisible();
  });
});
