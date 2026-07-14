import Dexie, { type Table } from 'dexie';
import type { Product, Sale } from './types';

export interface CategoryRow {
  id: string;
  name: string;
  parent_id?: string;
}

class AppDB extends Dexie {
  products!: Table<Product, string>;
  sales!: Table<Sale, string>;
  categories!: Table<CategoryRow, string>;

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
  }
}

export const db = new AppDB();
