import { Page, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const AUTH_FILE = path.join(__dirname, '.auth.json');

export async function login(page: Page) {
  const { email, password } = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
  await page.goto('/');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  // Esperar a que cargue la app principal
  await expect(page.locator('text=Inventario').or(page.locator('text=Caja'))).toBeVisible({ timeout: 15000 });
}

export async function waitForAppReady(page: Page) {
  await expect(page.locator('text=Caja').or(page.locator('text=Inventario'))).toBeVisible({ timeout: 15000 });
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
  await page.click('text=Stock');
  await expect(page.locator('text=Inventario')).toBeVisible();
}

// Crear un producto via UI
export async function createProduct(page: Page, opts: {
  nombre: string;
  categoria?: string;
  precioVenta?: number;
  codigoBarras?: string;
}) {
  await goToInventario(page);
  await page.click('text=+ Nuevo');
  await page.fill('input[placeholder*="Nombre"]', opts.nombre);
  if (opts.precioVenta) {
    await page.fill('input[placeholder*="Precio venta"]', String(opts.precioVenta));
  }
  if (opts.codigoBarras) {
    await page.fill('input[placeholder*="Opcional"]', opts.codigoBarras);
  }
  await page.click('button:has-text("Guardar")');
  await expect(page.locator(`text=${opts.nombre}`).first()).toBeVisible({ timeout: 5000 });
}
