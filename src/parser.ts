import type { Product, DictationResult } from './types';

const NUMBER_WORDS: Record<string, number> = {
  'cero': 0,
  'un': 1, 'una': 1, 'uno': 1,
  'dos': 2,
  'tres': 3,
  'cuatro': 4,
  'cinco': 5,
  'seis': 6,
  'siete': 7,
  'ocho': 8,
  'nueve': 9,
  'diez': 10,
  'once': 11,
  'doce': 12,
  'trece': 13,
  'catorce': 14,
  'quince': 15,
  'veinte': 20,
  'media': 0.5,
  'medio': 0.5,
  'cuarto': 0.25,
};

const PAYMENT_PATTERNS: Array<{ regex: RegExp; result: string }> = [
  { regex: /d[eé]bito|tarjeta\s+d[eé]b/i,    result: 'Débito' },
  { regex: /cr[eé]dito|tarjeta\s+cr[eé]d/i,   result: 'Crédito' },
  { regex: /transfer[eé]ncia/i,                result: 'Transferencia' },
  { regex: /efectivo|cash|billete/i,           result: 'Efectivo' },
];

const ABASTECER_RE = [
  /compr[eéó]|comprar/i,
  /ingres[eéó]|ingresar/i,
  /abastec/i,
  /lleg[oó]|llegaron/i,
  /recib[íi]|recibieron/i,
  /añad[íi]|añadir/i,
  /agreg[aéeó]|agregar/i,
];

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wordsA = na.split(' ').filter(w => w.length > 2);
  const wordsB = nb.split(' ').filter(w => w.length > 2);
  if (!wordsA.length || !wordsB.length) return 0;
  let matches = 0;
  for (const wa of wordsA) {
    if (wordsB.some(wb => wa === wb || wa.includes(wb) || wb.includes(wa))) matches++;
  }
  return matches / Math.max(wordsA.length, wordsB.length);
}

function matchInventory(name: string, inventory: Product[]): Product | null {
  let best: Product | null = null;
  let bestScore = 0.3;
  for (const p of inventory) {
    const score = similarity(name, p.nombre);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

function parseSegment(segment: string, inventory: Product[]): DictationResult['items'][0] | null {
  let s = segment.replace(/^(vend[íi]|vend[oa]|compr[eéó]|ingres[eéó]|recib[íi])\s+/i, '').trim();
  if (s.length < 2) return null;

  let cantidad = 1;
  let productName = s;
  let unidadMedida = 'unidades';

  // Número al inicio: "2 panes", "1.5 kg"
  const numericMatch = s.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (numericMatch) {
    cantidad = parseFloat(numericMatch[1].replace(',', '.'));
    productName = numericMatch[2].trim();
  } else {
    // Palabras numéricas: "dos", "media", etc.
    for (const [word, val] of Object.entries(NUMBER_WORDS)) {
      const re = new RegExp(`^${word}\\b(.*)$`, 'i');
      const m = s.match(re);
      if (m) { cantidad = val; productName = m[1].trim(); break; }
    }
  }

  // Detectar unidad de medida
  const kgMatch = productName.match(/^(kilo(?:gramo)?s?\s+de\s+|kg\s+de\s+|kilos?\s+)/i);
  if (kgMatch) { unidadMedida = 'kg'; productName = productName.slice(kgMatch[0].length); }
  const litroMatch = productName.match(/^(litros?\s+de\s+|litros?\s+)/i);
  if (litroMatch) { unidadMedida = 'litros'; productName = productName.slice(litroMatch[0].length); }

  // Quitar artículos al inicio
  productName = productName.replace(/^(de\s+|del\s+|la\s+|las\s+|el\s+|los\s+|un\s+|una\s+)/i, '').trim();
  if (!productName) return null;

  const match = matchInventory(productName, inventory);

  return {
    nombre: match ? match.nombre : productName.charAt(0).toUpperCase() + productName.slice(1),
    cantidad,
    precioUnitarioEstimado: match ? match.precioVenta : 0,
    unidadMedida: match ? match.unidadMedida : unidadMedida,
  };
}

// Detecta nueva cantidad implícita en medio del texto (ej: "un jumex una chokita")
function splitImplicit(text: string): string[] {
  const QTY_SET = new Set(Object.keys(NUMBER_WORDS));
  const FILLER = new Set(['de','del','la','las','el','los','al','con','a','en','o']);
  const words = text.split(/\s+/);
  const segments: string[][] = [];
  let current: string[] = [];

  for (const word of words) {
    const w = word.toLowerCase().replace(/[.,]/g, '');
    const isQty = QTY_SET.has(w) || /^\d+$/.test(w) || /^\d+[.,]\d+$/.test(w);
    // Arranca nuevo segmento si hay cantidad y ya hay al menos una palabra de producto antes
    if (isQty && current.length > 0) {
      const hasProduct = current.some(cw => {
        const c = cw.toLowerCase();
        return !QTY_SET.has(c) && !FILLER.has(c);
      });
      if (hasProduct) {
        segments.push(current);
        current = [];
      }
    }
    current.push(word);
  }
  if (current.length > 0) segments.push(current);
  return segments.map(s => s.join(' ')).filter(s => s.trim().length > 1);
}

export function parsearVentaLocal(text: string, inventory: Product[]): DictationResult {
  const accion: DictationResult['accion'] = ABASTECER_RE.some(r => r.test(text)) ? 'abastecer' : 'venta';

  let metodoPago = 'Efectivo';
  for (const { regex, result } of PAYMENT_PATTERNS) {
    if (regex.test(text)) { metodoPago = result; break; }
  }

  // Limpiar texto de frases de pago y verbos de acción
  let cleaned = text
    .replace(/\bcon\s+(d[eé]bito|cr[eé]dito|transferencia|efectivo|tarjeta\s*\w*)\b/gi, '')
    .replace(/\b(d[eé]bito|cr[eé]dito|transferencia)\b/gi, '')
    .replace(/\b(compr[eéó]|ingres[eéó]|vend[íi]|recib[íi]|abastec[íi])\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 1. Separar por separadores explícitos ("y", ",", "más")
  // 2. Dentro de cada segmento, buscar cantidades implícitas sin separador
  const rawSegments = cleaned.split(/\s*(?:,|\by\b|\bmas\b|\bm[aá]s\b|\btambi[eé]n\b)\s*/i);
  const segments = rawSegments.flatMap(seg => splitImplicit(seg.trim()));

  const items: DictationResult['items'] = segments
    .map(seg => parseSegment(seg.trim(), inventory))
    .filter((item): item is DictationResult['items'][0] => item !== null && item.nombre.length > 1);

  if (items.length === 0) {
    items.push({
      nombre: cleaned.charAt(0).toUpperCase() + cleaned.slice(1) || 'Producto',
      cantidad: 1,
      precioUnitarioEstimado: 0,
      unidadMedida: 'unidades',
    });
  }

  const comentario = `${accion === 'venta' ? 'Venta' : 'Ingreso de stock'}: ${items.map(i => `${i.cantidad} × ${i.nombre}`).join(', ')}`;

  return { accion, items, metodoPago, comentario };
}
