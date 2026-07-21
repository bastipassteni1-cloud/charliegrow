import { Page, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, '.auth.json');

export function readAuth() {
  return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8')) as { email: string; password: string };
}

export async function login(page: Page) {
  const { email, password } = readAuth();
  await page.goto('/');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  // Esperar a que cargue la app — el tab Caja tiene id="tab-caja"
  await expect(page.locator('#tab-caja')).toBeVisible({ timeout: 15000 });
}

export async function waitForAppReady(page: Page) {
  await expect(page.locator('#tab-caja')).toBeVisible({ timeout: 15000 });
}

// Leer productos directamente desde Dexie (IndexedDB)
export async function getDexieProducts(page: Page): Promise<any[]> {
  return page.evaluate(() => {
    return new Promise<any[]>((resolve, reject) => {
      const req = indexedDB.open('charlie-grow-db');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('products', 'readonly');
        const store = tx.objectStore('products');
        const getAll = store.getAll();
        getAll.onsuccess = () => resolve(getAll.result);
        getAll.onerror = () => reject(getAll.error);
      };
    });
  });
}

// Leer pendingOps de localStorage
export async function getPendingOps(page: Page): Promise<any[]> {
  const raw = await page.evaluate(() => localStorage.getItem('almacen_pending'));
  return raw ? JSON.parse(raw) : [];
}

// Ir a pestaña Inventario
export async function goToInventario(page: Page) {
  await page.click('#tab-inventario');
  await expect(page.locator('h2:has-text("Inventario")')).toBeVisible({ timeout: 8000 });
}

// Crear un producto via UI
export async function createProduct(page: Page, opts: {
  nombre: string;
  precioVenta?: number;
  codigoBarras?: string;
}) {
  await goToInventario(page);
  await page.getByRole('button', { name: /Nuevo/ }).click();
  await expect(page.locator('h3:has-text("Agregar Nuevo Producto")')).toBeVisible({ timeout: 5000 });
  await page.locator('#add-product-nombre').fill(opts.nombre);
  if (opts.precioVenta) {
    await page.locator('#add-product-precio-venta').fill(String(opts.precioVenta));
  }
  if (opts.codigoBarras) {
    await page.locator('input[placeholder="Escanear o tipear"]').fill(opts.codigoBarras);
  }
  await page.locator('button[type="submit"]:has-text("Guardar Producto")').click();
  // El modal se cierra cuando el producto se guarda correctamente
  await expect(page.locator('h3:has-text("Agregar Nuevo Producto")')).not.toBeVisible({ timeout: 8000 });
  // Confirmar que el producto aparece en la lista
  await expect(page.locator(`text=${opts.nombre}`).first()).toBeAttached({ timeout: 5000 });
}
