import { Product, Sale } from "./types";

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: "prod-1",
    nombre: "Coca-Cola Original 1.5L (Desechable)",
    codigoBarras: "7801234567890",
    categoria: "Bebidas",
    precioCompra: 1100,
    precioVenta: 1700,
    stock: 18,
    stockMinimo: 5,
    unidadMedida: "unidades",
    updatedAt: new Date().toISOString()
  },
  {
    id: "prod-2",
    nombre: "Súper Ocho Carozzi (29g)",
    codigoBarras: "7804561239870",
    categoria: "Snacks y Dulces",
    precioCompra: 150,
    precioVenta: 300,
    stock: 85,
    stockMinimo: 15,
    unidadMedida: "unidades",
    updatedAt: new Date().toISOString()
  },
  {
    id: "prod-3",
    nombre: "Arroz Tucapel Grado 1 (1kg)",
    codigoBarras: "7809876543210",
    categoria: "Alimentación",
    precioCompra: 850,
    precioVenta: 1250,
    stock: 3, // Bajo stock a propósito
    stockMinimo: 6,
    unidadMedida: "unidades",
    updatedAt: new Date().toISOString()
  },
  {
    id: "prod-4",
    nombre: "Leche Entera Soprole (1L Caja)",
    codigoBarras: "7801212121212",
    categoria: "Refrigerados",
    precioCompra: 780,
    precioVenta: 1190,
    stock: 22,
    stockMinimo: 5,
    unidadMedida: "unidades",
    updatedAt: new Date().toISOString()
  },
  {
    id: "prod-5",
    nombre: "Pan Marraqueta Fresca (1kg)",
    codigoBarras: "",
    categoria: "Panadería",
    precioCompra: 1200,
    precioVenta: 1990,
    stock: 12,
    stockMinimo: 4,
    unidadMedida: "kg",
    updatedAt: new Date().toISOString()
  },
  {
    id: "prod-6",
    nombre: "Detergente Omo Polvo Multipoder (800g)",
    codigoBarras: "7809988776655",
    categoria: "Aseo y Limpieza",
    precioCompra: 1950,
    precioVenta: 2990,
    stock: 6,
    stockMinimo: 2,
    unidadMedida: "unidades",
    updatedAt: new Date().toISOString()
  },
  {
    id: "prod-7",
    nombre: "Aceite de Maravilla Chef (1L)",
    codigoBarras: "7805432109876",
    categoria: "Alimentación",
    precioCompra: 1350,
    precioVenta: 2050,
    stock: 14,
    stockMinimo: 3,
    unidadMedida: "unidades",
    updatedAt: new Date().toISOString()
  },
  {
    id: "prod-8",
    nombre: "Queso Laminado Gauda Colun (250g)",
    codigoBarras: "7803322110044",
    categoria: "Refrigerados",
    precioCompra: 1850,
    precioVenta: 2790,
    stock: 8,
    stockMinimo: 2,
    unidadMedida: "unidades",
    updatedAt: new Date().toISOString()
  },
  {
    id: "prod-9",
    nombre: "Papas Fritas Lays Clásicas (120g)",
    codigoBarras: "7807766554433",
    categoria: "Snacks y Dulces",
    precioCompra: 980,
    precioVenta: 1590,
    stock: 15,
    stockMinimo: 4,
    unidadMedida: "unidades",
    updatedAt: new Date().toISOString()
  }
];

export const INITIAL_SALES: Sale[] = [
  {
    id: "sale-init-1",
    total: 3400,
    metodoPago: "Efectivo",
    fecha: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    items: [
      {
        nombre: "Coca-Cola Original 1.5L (Desechable)",
        cantidad: 2,
        precioUnitario: 1700,
        subtotal: 3400,
        unidadMedida: "unidades"
      }
    ]
  },
  {
    id: "sale-init-2",
    total: 4500,
    metodoPago: "Efectivo",
    fecha: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    items: [
      {
        nombre: "Pan Marraqueta Fresca (1kg)",
        cantidad: 1,
        precioUnitario: 1990,
        subtotal: 1990,
        unidadMedida: "kg"
      },
      {
        nombre: "Queso Laminado Gauda Colun (250g)",
        cantidad: 1,
        precioUnitario: 2790,
        subtotal: 2790,
        unidadMedida: "unidades"
      }
    ]
  },
  {
    id: "sale-init-3",
    total: 3100,
    metodoPago: "Débito",
    fecha: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    items: [
      {
        nombre: "Súper Ocho Carozzi (29g)",
        cantidad: 5,
        precioUnitario: 300,
        subtotal: 1500,
        unidadMedida: "unidades"
      },
      {
        nombre: "Papas Fritas Lays Clásicas (120g)",
        cantidad: 1,
        precioUnitario: 1590,
        subtotal: 1590,
        unidadMedida: "unidades"
      }
    ]
  }
];
