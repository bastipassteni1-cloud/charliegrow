import Dexie, { type Table } from 'dexie';
import type { Product, Sale } from './types';

export interface CategoryRow {
  id: string;
  name: string;
}

export interface SubcategoryRow {
  id: string;
  category_id: string;
  name: string;
}

class AppDB extends Dexie {
  products!: Table<Product, string>;
  sales!: Table<Sale, string>;
  categories!: Table<CategoryRow, string>;
  subcategories!: Table<SubcategoryRow, string>;

  constructor() {
    super('charlie-grow-db');
    this.version(1).stores({
      products: 'id, codigoBarras, categoria',
      sales: 'id, fecha',
      categories: 'id, name',
    });
    this.version(2).stores({
      products: 'id, codigoBarras, categoria',
      sales: 'id, fecha',
      categories: 'id, name, parent_id',
    });
    this.version(3).stores({
      products: 'id, codigoBarras, categoria',
      sales: 'id, fecha',
      categories: 'id, name',
      subcategories: 'id, category_id, name',
    }).upgrade(tx => {
      // Limpiar subcategorías almacenadas como categorías con parent_id
      return tx.table('categories').filter((c: any) => !!c.parent_id).delete();
    });
  }
}

export const db = new AppDB();
