/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';
import type { Product, Sale } from './types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Row → Product (snake_case DB → camelCase TS)
export const toProduct = (row: any): Product => ({
  id: row.id,
  nombre: row.nombre,
  codigoBarras: row.codigo_barras || '',
  categoria: row.categoria,
  subcategoria: row.subcategoria || undefined,
  precioCompra: row.precio_compra,
  precioVenta: row.precio_venta,
  stock: Number(row.stock),
  stockMinimo: Number(row.stock_minimo),
  unidadMedida: row.unidad_medida,
  updatedAt: row.updated_at,
});

// Product → Row (camelCase TS → snake_case DB)
export const fromProduct = (p: Product, userId: string) => ({
  id: p.id,
  user_id: userId,
  nombre: p.nombre,
  codigo_barras: p.codigoBarras || null,
  categoria: p.categoria,
  subcategoria: p.subcategoria || null,
  precio_compra: p.precioCompra,
  precio_venta: p.precioVenta,
  stock: p.stock,
  stock_minimo: p.stockMinimo,
  unidad_medida: p.unidadMedida,
  updated_at: new Date().toISOString(),
});

// Sale row (con sale_items anidados) → Sale TS
export const toSale = (row: any): Sale => ({
  id: row.id,
  total: row.total,
  metodoPago: row.metodo_pago as Sale['metodoPago'],
  fecha: row.fecha,
  items: (row.sale_items || []).map((item: any) => ({
    id: item.product_id,
    nombre: item.nombre,
    cantidad: Number(item.cantidad),
    precioUnitario: item.precio_unitario,
    subtotal: item.subtotal,
    unidadMedida: item.unidad_medida,
  })),
});
