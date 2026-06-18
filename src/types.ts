export interface Product {
  id: string;
  nombre: string;
  codigoBarras?: string;
  categoria: string;
  precioCompra: number;
  precioVenta: number;
  stock: number;
  stockMinimo: number;
  unidadMedida: string;
  updatedAt: string;
}

export interface SaleItem {
  id?: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  unidadMedida: string;
}

export interface Sale {
  id: string;
  total: number;
  metodoPago: "Efectivo" | "Débito" | "Crédito" | "Transferencia";
  fecha: string;
  items: SaleItem[];
}

export interface DictationResult {
  accion: "venta" | "abastecer";
  items: {
    nombre: string;
    cantidad: number;
    precioUnitarioEstimado?: number;
    unidadMedida?: string;
  }[];
  metodoPago: string;
  comentario?: string;
}
