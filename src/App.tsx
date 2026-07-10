import React, { useState, useEffect, useRef } from "react";
import {
  Plus,
  Search,
  Trash2,
  Barcode,
  TrendingUp,
  User,
  ShoppingCart,
  ShieldAlert,
  Edit3,
  CheckCircle,
  AlertCircle,
  X,
  Coins,
  HelpCircle,
  Sparkles,
  Camera,
  Upload,
  RefreshCw,
  Clock,
  ArrowDownLeft,
  DollarSign,
  Receipt,
  CalendarDays,
  Share2,
  LogOut,
  Lock,
  Mail,
  Eye,
  EyeOff,
  Bell,
  BellOff,
  Printer
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { supabase, toProduct, fromProduct, toSale } from "./supabase";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { Product, Sale, SaleItem } from "./types";
import AuthScreen from "./AuthScreen";
import { BrowserMultiFormatReader } from "@zxing/browser";
import Quagga from "@ericblade/quagga2";
import { readBarcodes } from "zxing-wasm/reader";
import { Joyride, ACTIONS, EVENTS, STATUS, type EventData, type Step } from "react-joyride";
import heic2any from "heic2any";
import JsBarcode from "jsbarcode";

type PendingOp = {
  id: string;
  timestamp: string;
  type: 'ADD_PRODUCT' | 'UPDATE_PRODUCT' | 'DELETE_PRODUCT' | 'UPDATE_STOCK' | 'CHECKOUT_SALE' | 'DELETE_SALE';
  data: any;
};

// Unique categories helper — defined outside component to avoid recreation on every render
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0;
  return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

const DEFAULT_CATEGORIES = ["Semillas", "Nutrientes", "Sustratos", "Iluminación", "Equipamiento", "Papeles y Filtros", "CBD", "Accesorios", "Otros"];

// Punto 5: verificación real de conectividad — no se fía solo de navigator.onLine
const checkRealConnectivity = async (): Promise<boolean> => {
  if (!navigator.onLine) return false;
  try {
    const check = supabase.from('categories').select('id').limit(1);
    const timeout = new Promise<false>(resolve => setTimeout(() => resolve(false), 4000));
    return await Promise.race([check.then(({ error }) => !error), timeout]);
  } catch {
    return false;
  }
};

const detectCategoria = (text: string): string => {
  const t = text.toLowerCase();
  if (/semilla|seed|cannabis|marihuana|feminiz|autoflow|indica|sativa|hybrid|kush|haze|og |gorilla|gelato|zkittlez|runtz|wedding cake|bruce banner|northern light|white widow/i.test(t))
    return "Semillas";
  if (/nutrien|fertiliz|abono|estimulador|booster|bloom|grow|biobizz|canna|plagron|advanced nutrient|general hydropon|athena|verde|enzym|root|raiz|pk|npk|cal.?mag|calcium|magnesium|humic|fulvic/i.test(t))
    return "Nutrientes";
  if (/sustrato|substrate|tierra|coco|cocotek|perlita|perlite|vermiculit|fibra de coco|turba|arcilla|clay|lana de roca|rockwool|grow bag|bolsa de cultivo/i.test(t))
    return "Sustratos";
  if (/led|hps|cfl|cmh|lec|light|luz|lamp|luminaria|foco|reflector|hood|driver|quantum board|hlg|mars hydro|spider farmer|gavita|lumatek|lux|watt|espectro/i.test(t))
    return "Iluminación";
  if (/fan|ventilador|extractor|carbon filter|filtro de carbon|carbon activo|tent|carpa|grow tent|intake|ph meter|ph metro|ec meter|tds|humidity|hygrometer|timer|temporizador|controlador|controller|clip fan|inline fan|duct/i.test(t))
    return "Equipamiento";
  if (/paper|papel|rolling|ocb|raw |rizla|slim|king size|filter tip|boquilla|grinder|molino|pipe|pipa|bong|bubbler|bowl|vaporiz|vaporizador|dugout|one hitter/i.test(t))
    return "Papeles y Filtros";
  if (/cbd|cannabidiol|hemp|cañamo|canamo|broad.?spectrum|full.?spectrum|aceite cbd|oil cbd|tincture/i.test(t))
    return "CBD";
  return "Accesorios";
};

export default function App() {
  // Dark mode
  const [isDark, setIsDark] = useState(() => localStorage.getItem('almacen_dark') === 'true');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('almacen_dark', String(isDark));
  }, [isDark]);

  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<"caja" | "inventario" | "ventas" | "reportes">("caja");

  // Authentication State
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Offline mode
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingOps, setPendingOps] = useState<PendingOp[]>(() => {
    try { return JSON.parse(localStorage.getItem('almacen_pending') || '[]'); } catch { return []; }
  });
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  const isSyncingRef = useRef(false);
  const isLoadingRef = useRef(false);
  const pendingReloadRef = useRef(false);
  const reloadRef = useRef<() => Promise<boolean>>(async () => true);

  // Live camera scanner
  const [showLiveScanner, setShowLiveScanner] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<{ stop: () => void } | null>(null);
  const lastScannedRef = useRef<string | null>(null);
  const productsRef = useRef<Product[]>([]);
  const pendingInsertIds = useRef<Set<string>>(new Set());
  const isCheckingOutRef = useRef(false);
  const lastLoadTimeRef = useRef<number>(0);       // Punto 4: throttle focus/visibility
  const reloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Punto 3: debounce realtime

  // Escaneo de carrito por foto (no requiere HTTPS)
  const [isScanningCartPhoto, setIsScanningCartPhoto] = useState(false);
  const cartPhotoInputRef = useRef<HTMLInputElement>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const notifyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // UI state - Notifications
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // POS / Cart State
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [salesFilter, setSalesFilter] = useState<"all" | "today" | "yesterday" | "week" | "month">("all");
  const [paymentMethod, setPaymentMethod] = useState<Sale["metodoPago"]>("Efectivo");
  const [cashAmount, setCashAmount] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [barcodeSearch, setBarcodeSearch] = useState("");
  const [lastScannedProduct, setLastScannedProduct] = useState<Product | null>(null);
  const lastScannedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("Todos");
  const [userCategories, setUserCategories] = useState<{ id: string; name: string }[]>([]);
  const [showAddCategoryInput, setShowAddCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<{ original: string; value: string } | null>(null);
  const [inventorySort, setInventorySort] = useState<'recent' | 'stock-desc' | 'stock-asc' | 'alpha'>('recent');
  const [showBarcodeModal, setShowBarcodeModal] = useState<Product | null>(null);
  const [barcodeCode, setBarcodeCode] = useState("");
  const [barcodeLabel, setBarcodeLabel] = useState("");
  const [barcodePrintQty, setBarcodePrintQty] = useState(1);
  const barcodeRef = useRef<SVGSVGElement>(null);

  const [lowStockAlert, setLowStockAlert] = useState<{ nombre: string; stock: number; stockMinimo: number; unidadMedida: string }[]>([]);

  // Modals & Form State
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [showEditStockModal, setShowEditStockModal] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState({
    nombre: "", codigoBarras: "", categoria: "Accesorios",
    precioCompra: "", precioVenta: "", stock: "", stockMinimo: "", unidadMedida: "unidades"
  });
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);

  // AI Vision Photo Scanner State
  const [showAiPhotoModal, setShowAiPhotoModal] = useState(false);
  const [aiPhotoPreview, setAiPhotoPreview] = useState<string | null>(null);
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false);
  const [aiInventoryMatch, setAiInventoryMatch] = useState<Product | null>(null);
  const [aiAnalyzedProduct, setAiAnalyzedProduct] = useState<{
    nombre: string;
    descripcion: string;
    codigoBarras: string;
    categoria: string;
    unidadMedida: string;
  } | null>(null);

  // User inputs for AI scanned product
  const [aiProductPriceVenta, setAiProductPriceVenta] = useState("");
  const [aiProductPriceCompra, setAiProductPriceCompra] = useState("");
  const [aiProductStock, setAiProductStock] = useState("10");
  const [aiProductStockMin, setAiProductStockMin] = useState("3");

  // Upgrade de cuenta anónima a permanente
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeEmail, setUpgradeEmail] = useState('');
  const [upgradePassword, setUpgradePassword] = useState('');
  const [upgradeShowPassword, setUpgradeShowPassword] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);

  const userCategoryNames = userCategories.map(c => c.name);
  // Categorías en productos que aún no están en userCategories (compatibilidad con datos viejos)
  const orphanCategories = Array.from(new Set(products.map(p => p.categoria).filter(c => c && !userCategoryNames.includes(c))));
  const allCategories = ["Todos", ...userCategoryNames, ...orphanCategories];

  const addCategory = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || allCategories.includes(trimmed)) return;
    if (!user) return;
    const tempId = uuid();
    setUserCategories(prev => [...prev, { id: tempId, name: trimmed }]);
    setNewCategoryName("");
    const { data, error } = await supabase.from('categories').insert({ user_id: user.id, name: trimmed }).select().single();
    if (error) {
      setUserCategories(prev => prev.filter(c => c.id !== tempId));
      notify("Error al crear la categoría.", "error");
      return;
    }
    setUserCategories(prev => prev.map(c => c.id === tempId ? { id: data.id, name: trimmed } : c));
  };

  const renameCategory = async (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    if (!user) return;

    const alreadyExists = allCategories.filter(c => c !== oldName).includes(trimmed);
    if (alreadyExists) {
      notify(`La categoría "${trimmed}" ya existe.`, "error");
      return;
    }

    // Actualizar estado local optimistamente
    setUserCategories(prev => prev.map(c => c.name === oldName ? { ...c, name: trimmed } : c));
    if (selectedCategory === oldName) setSelectedCategory(trimmed);
    setEditingCategory(null);

    if (isOnline) {
      // Renombrar en Supabase: borrar vieja e insertar nueva
      await supabase.from('categories').delete().eq('name', oldName).eq('user_id', user.id);
      const { error: insErr } = await supabase.from('categories').insert({ user_id: user.id, name: trimmed });
      if (insErr) {
        // Restaurar la categoría vieja en DB para no perderla
        await supabase.from('categories').insert({ user_id: user.id, name: oldName });
        setUserCategories(prev => prev.map(c => c.name === trimmed ? { ...c, name: oldName } : c));
        if (selectedCategory === trimmed) setSelectedCategory(oldName);
        notify("Error al renombrar la categoría. Reintenta.", "error");
        return;
      }
      // Actualizar productos afectados
      const affected = productsRef.current.filter(p => p.categoria === oldName);
      if (affected.length > 0) {
        setProducts(prev => prev.map(p => p.categoria === oldName ? { ...p, categoria: trimmed } : p));
        const results = await Promise.all(affected.map(p =>
          supabase.from('products').update({ categoria: trimmed }).eq('id', p.id)
        ));
        if (results.find(r => r.error)) {
          notify("Error al renombrar en algunos productos. Reintenta.", "error");
          return;
        }
      }
    } else {
      const affected = productsRef.current.filter(p => p.categoria === oldName);
      if (affected.length > 0) {
        setProducts(prev => prev.map(p => p.categoria === oldName ? { ...p, categoria: trimmed } : p));
        affected.forEach(p => queueOp('UPDATE_PRODUCT', fromProduct({ ...p, categoria: trimmed }, user.id)));
      }
    }
    notify("Categoría renombrada.", "success");
  };

  const deleteCategory = (cat: string) => {
    setConfirmModal({
      message: `¿Eliminar la categoría "${cat}"? Los productos quedarán como "Otros".`,
      onConfirm: async () => {
        const removedCat = userCategories.find(c => c.name === cat);
        setUserCategories(prev => prev.filter(c => c.name !== cat));
        if (selectedCategory === cat) setSelectedCategory("Todos");
        if (isOnline) {
          const { error } = await supabase.from('categories').delete().eq('name', cat).eq('user_id', user!.id);
          if (error) {
            if (removedCat) setUserCategories(prev => [...prev, removedCat]);
            notify("Error al eliminar la categoría. Reintenta.", "error");
            return;
          }
        }

        const affected = productsRef.current.filter(p => p.categoria === cat);
        if (affected.length > 0) {
          setProducts(prev => prev.map(p => p.categoria === cat ? { ...p, categoria: "Otros" } : p));
          if (isOnline) {
            await Promise.all(affected.map(p =>
              supabase.from('products').update({ categoria: "Otros" }).eq('id', p.id)
            ));
          } else {
            affected.forEach(p => queueOp('UPDATE_PRODUCT', fromProduct({ ...p, categoria: "Otros" }, user!.id)));
          }
        }
        notify("Categoría eliminada.", "success");
      }
    });
  };

  // Tour guiado
  const [tourRunning, setTourRunning] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  // Alertas (notificación navegador + email via Supabase)
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState(() => localStorage.getItem('alerts_enabled') === 'true');
  const [alertTestLoading, setAlertTestLoading] = useState(false);


  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  };

  const sendAlerts = async (lowProducts: { nombre: string; stock: number; stockMinimo: number; unidadMedida: string }[], toEmail: string) => {
    if (!alertsEnabled || lowProducts.length === 0) return;
    const date = new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });

    // 1. Notificación del navegador (inmediata)
    if (Notification.permission === 'granted') {
      const body = lowProducts.map(p => `${p.nombre}: ${p.stock} ${p.unidadMedida} (mín. ${p.stockMinimo})`).join('\n');
      new Notification('⚠️ Stock bajo en tu negocio', { body, icon: '/favicon.ico' });
    }

    // 2. Email via Supabase Edge Function
    supabase.functions.invoke('send-stock-alert', {
      body: { email: toEmail, products: lowProducts, date },
    }).catch(console.error);
  };

  const [newProduct, setNewProduct] = useState({
    nombre: "",
    codigoBarras: "",
    categoria: "Accesorios",
    precioCompra: "",
    precioVenta: "",
    stock: "10",
    stockMinimo: "3",
    unidadMedida: "unidades"
  });

  // Show visual notification helper
  const notify = (message: string, type: "success" | "error" | "info" = "success") => {
    if (notifyTimeoutRef.current) clearTimeout(notifyTimeoutRef.current);
    setNotification({ message, type });
    notifyTimeoutRef.current = setTimeout(() => {
      setNotification(null);
      notifyTimeoutRef.current = null;
    }, 4000);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setProducts([]);
    setSales([]);
    setCart([]);
    setPendingOps([]);
  };

  const handleUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!upgradeEmail || !upgradePassword) return;
    setUpgradeLoading(true);
    const { error } = await supabase.auth.updateUser({ email: upgradeEmail, password: upgradePassword });
    setUpgradeLoading(false);
    if (error) {
      const msg = error.message.includes('already')
        ? 'Ese email ya está en uso por otra cuenta.'
        : 'No se pudo registrar. Intenta de nuevo.';
      notify(msg, 'error');
    } else {
      setShowUpgradeModal(false);
      setUpgradeEmail('');
      setUpgradePassword('');
      notify('¡Cuenta registrada! Tus datos están seguros.', 'success');
    }
  };

  // Escuchar cambios de sesión de Supabase
  useEffect(() => {
    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setUser(session?.user ?? null);
      } catch (e) {
        console.error("Auth init error:", e);
      } finally {
        setLoadingAuth(false);
      }
    };
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Cargar y sincronizar datos en tiempo real desde Supabase
  useEffect(() => {
    if (!user) return;

    // Punto 1: mostrar datos cacheados de inmediato mientras carga Supabase
    const ck = (t: string) => `cg_${t}_${user.id}`;
    try {
      const cp = localStorage.getItem(ck('products'));
      if (cp) setProducts(JSON.parse(cp));
      const cc = localStorage.getItem(ck('cats'));
      if (cc) setUserCategories(JSON.parse(cc));
      const cs = localStorage.getItem(ck('sales'));
      if (cs) setSales(JSON.parse(cs));
    } catch {}

    setIsSyncing(true);
    setSyncError(null);

    const loadAll = async (): Promise<boolean> => {
      if (isLoadingRef.current) { pendingReloadRef.current = true; return true; }
      isLoadingRef.current = true;
      pendingReloadRef.current = false;

      // Cargar categorías — sembrar predefinidas si el usuario no tiene ninguna
      const { data: cats } = await supabase.from('categories').select('*').eq('user_id', user.id).order('created_at', { ascending: true });
      if (!cats || cats.length === 0) {
        const seed = DEFAULT_CATEGORIES.map(name => ({ user_id: user.id, name }));
        const { data: seeded } = await supabase.from('categories').insert(seed).select();
        const mapped = seeded ? seeded.map((c: any) => ({ id: c.id, name: c.name })) : [];
        setUserCategories(mapped);
        try { localStorage.setItem(ck('cats'), JSON.stringify(mapped)); } catch {}
      } else {
        const mapped = cats.map((c: any) => ({ id: c.id, name: c.name }));
        setUserCategories(mapped);
        try { localStorage.setItem(ck('cats'), JSON.stringify(mapped)); } catch {}
      }

      const { data: prods, error: prodErr } = await supabase
        .from('products')
        .select('*')
        .order('updated_at', { ascending: false });

      if (prodErr) {
        setSyncError("Error cargando productos.");
        setIsSyncing(false);
        isLoadingRef.current = false;
        return false;
      }

      const dbProds = prods ? prods.map(toProduct) : [];
      setProducts(prev => {
        const dbIds = new Set(dbProds.map(p => p.id));
        const pending = prev.filter(p => pendingInsertIds.current.has(p.id) && !dbIds.has(p.id));
        return [...pending, ...dbProds];
      });
      try { localStorage.setItem(ck('products'), JSON.stringify(dbProds)); } catch {}

      const { data: salesData, error: salesErr } = await supabase
        .from('sales')
        .select('*, sale_items(*)')
        .order('fecha', { ascending: false })
        .limit(300);

      if (salesErr) {
        notify("No se pudieron cargar las ventas. Intenta recargar.", "error");
      } else if (salesData) {
        const mapped = salesData.map(toSale);
        setSales(mapped);
        try { localStorage.setItem(ck('sales'), JSON.stringify(mapped)); } catch {}
      }

      lastLoadTimeRef.current = Date.now(); // Punto 4
      setIsSyncing(false);
      isLoadingRef.current = false;

      if (pendingReloadRef.current) loadAll();
      return true;
    };

    // Punto 6: retry automático con backoff (3s → 6s → 12s)
    const loadWithRetry = async (attempt = 0) => {
      const ok = await loadAll();
      if (!ok && attempt < 2) {
        setTimeout(() => loadWithRetry(attempt + 1), 3000 * Math.pow(2, attempt));
      }
    };

    // Punto 3: debounce para eventos realtime — agrupa ráfagas en una sola recarga
    const debouncedLoad = () => {
      if (reloadDebounceRef.current) clearTimeout(reloadDebounceRef.current);
      reloadDebounceRef.current = setTimeout(() => loadAll(), 300);
    };

    reloadRef.current = loadAll;
    loadWithRetry();

    const prodsSub = supabase.channel('rt-products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, debouncedLoad)
      .subscribe();

    const salesSub = supabase.channel('rt-sales')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_items' }, debouncedLoad)
      .subscribe();

    const catsSub = supabase.channel('rt-categories')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, debouncedLoad)
      .subscribe();

    return () => {
      prodsSub.unsubscribe();
      salesSub.unsubscribe();
      catsSub.unsubscribe();
      if (reloadDebounceRef.current) clearTimeout(reloadDebounceRef.current);
    };
  }, [user]);

  // Persistir cola en localStorage cuando cambia
  useEffect(() => {
    localStorage.setItem('almacen_pending', JSON.stringify(pendingOps));
  }, [pendingOps]);

  // Listeners de conexión
  useEffect(() => {
    const goOnline  = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online',  goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online',  goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Punto 2: auto-sincronizar al volver conexión O al iniciar sesión con ops pendientes
  useEffect(() => {
    if (isOnline && user && pendingOps.length > 0 && !isSyncingRef.current) {
      syncQueue(pendingOps);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, user]);

  // Punto 4: recargar al volver al tab solo si pasaron más de 60s desde la última carga
  useEffect(() => {
    const THROTTLE = 60_000;
    const shouldReload = () => isOnline && Date.now() - lastLoadTimeRef.current > THROTTLE;
    const onFocus = () => { if (shouldReload()) reloadRef.current?.(); };
    const onVisibility = () => { if (!document.hidden && shouldReload()) reloadRef.current?.(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isOnline]);

  // Mantener productsRef siempre actualizado
  useEffect(() => { productsRef.current = products; }, [products]);

  useEffect(() => { setSearchTerm(""); }, [activeTab]);

  const openBarcodeModal = (product: Product) => {
    setBarcodeCode(product.codigoBarras || "");
    setBarcodeLabel(product.nombre);
    setBarcodePrintQty(1);
    setShowBarcodeModal(product);
  };

  const renderBarcodeSvg = (el: SVGSVGElement | null, code: string) => {
    (barcodeRef as any).current = el;
    if (el && code.trim()) {
      try {
        JsBarcode(el, code.trim(), {
          format: "CODE128", width: 2, height: 60,
          displayValue: true, fontSize: 14, margin: 8,
        });
      } catch {}
    }
  };

  // Scanner de cámara en tiempo real
  useEffect(() => {
    if (!showLiveScanner) return;

    let active = true;

    const startScanner = async () => {
      // La API de cámara requiere HTTPS o localhost
      if (!navigator.mediaDevices?.getUserMedia) {
        const httpsUrl = window.location.href.replace(/^http:/, "https:").replace(/:\d+/, ":3443");
        notify(`La cámara requiere HTTPS. Abre: ${httpsUrl}`, "error");
        if (active) setShowLiveScanner(false);
        return;
      }

      if (!videoRef.current) return;

      try {
        const codeReader = new BrowserMultiFormatReader();
        const controls = await codeReader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (!result || !active) return;
          const barcode = result.getText();
          if (barcode === lastScannedRef.current) return;
          lastScannedRef.current = barcode;
          setTimeout(() => { if (active) lastScannedRef.current = null; }, 2500);

          const matched = productsRef.current.find(p => p.codigoBarras === barcode);
          if (matched) {
            addToCart(matched);
            notify(`✓ ${matched.nombre} agregado al carrito`, "success");
          } else {
            notify("Código no encontrado en el catálogo", "info");
          }
        });
        if (active) codeReaderRef.current = controls;
      } catch (err: any) {
        if (!active) return;
        console.error("Scanner error:", err);
        const msg =
          err?.name === "NotAllowedError"
            ? "Permiso de cámara denegado. Actívalo en el navegador."
            : err?.name === "NotFoundError"
            ? "No se encontró ninguna cámara en este dispositivo."
            : "No se pudo iniciar el escáner de cámara.";
        notify(msg, "error");
        setShowLiveScanner(false);
      }
    };

    startScanner();

    return () => {
      active = false;
      codeReaderRef.current?.stop();
      codeReaderRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLiveScanner]);

  // Redirige teclas de la pistola USB al input de código de barras cuando no hay otro foco
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (activeTab !== 'caja') return;
      // No interceptar cuando hay modales abiertos
      if (confirmModal || showBarcodeModal || showCategoryModal || showAddProductModal ||
          showAiPhotoModal || showLiveScanner || showUpgradeModal || showAlertModal) return;
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.key.length === 1) {
        // Capturar el primer caracter — sin esto la pistola USB siempre pierde la primera letra
        e.preventDefault();
        setBarcodeSearch(prev => prev + e.key);
        barcodeInputRef.current?.focus();
      } else if (e.key === 'Enter') {
        barcodeInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [activeTab, confirmModal, showBarcodeModal, showCategoryModal, showAddProductModal,
      showAiPhotoModal, showLiveScanner, showUpgradeModal, showAlertModal]);

  const queueOp = (type: PendingOp['type'], data: any) => {
    const op: PendingOp = { id: `op-${Date.now()}`, timestamp: new Date().toISOString(), type, data };
    setPendingOps(prev => [...prev, op]);
  };

  const syncQueue = async (ops: PendingOp[]) => {
    if (!user || ops.length === 0 || isSyncingRef.current) return;
    // Punto 5: verificar conectividad real antes de intentar sincronizar
    const reallyOnline = await checkRealConnectivity();
    if (!reallyOnline) { setIsOnline(false); return; }
    isSyncingRef.current = true;
    setIsSyncingQueue(true);
    const failed: PendingOp[] = [];

    for (const op of ops) {
      try {
        if (op.type === 'ADD_PRODUCT') {
          const { error } = await supabase.from('products').upsert(op.data);
          if (error) throw error;
        } else if (op.type === 'UPDATE_PRODUCT') {
          const { error } = await supabase.from('products').update({
            nombre: op.data.nombre,
            codigo_barras: op.data.codigo_barras,
            categoria: op.data.categoria,
            precio_compra: op.data.precio_compra,
            precio_venta: op.data.precio_venta,
            stock: op.data.stock,
            stock_minimo: op.data.stock_minimo,
            unidad_medida: op.data.unidad_medida,
            updated_at: op.data.updated_at,
          }).eq('id', op.data.id);
          if (error) throw error;
        } else if (op.type === 'DELETE_PRODUCT') {
          const { error } = await supabase.from('products').delete().eq('id', op.data.id);
          if (error) throw error;
        } else if (op.type === 'UPDATE_STOCK') {
          const { error } = await supabase.from('products').update({ stock: op.data.stock, updated_at: op.data.updated_at }).eq('id', op.data.id);
          if (error) throw error;
        } else if (op.type === 'DELETE_SALE') {
          const { error } = await supabase.from('sales').delete().eq('id', op.data.id);
          if (error) throw error;
        } else if (op.type === 'CHECKOUT_SALE') {
          const { error: saleErr } = await supabase.from('sales').upsert(op.data.sale);
          if (saleErr) throw saleErr;
          if (op.data.items?.length) {
            const { error: itemsErr } = await supabase.from('sale_items').upsert(op.data.items);
            if (itemsErr) throw itemsErr;
          }
          if (op.data.stockUpdates?.length) {
            const results = await Promise.all(op.data.stockUpdates.map((u: any) =>
              supabase.from('products').update({ stock: u.stock, updated_at: u.updated_at }).eq('id', u.id)
            ));
            const stockErr = results.find(r => r.error);
            if (stockErr?.error) throw stockErr.error;
          }
        }
      } catch (e) {
        console.error('Sync failed:', op.type, e);
        failed.push(op);
      }
    }

    setPendingOps(failed);
    isSyncingRef.current = false;
    setIsSyncingQueue(false);

    if (failed.length === 0) {
      notify(`¡${ops.length} cambio${ops.length !== 1 ? 's' : ''} sincronizado${ops.length !== 1 ? 's' : ''} con éxito!`, 'success');
      await reloadRef.current();
    } else {
      notify(`${failed.length} cambio(s) no se pudieron sincronizar.`, 'error');
    }
  };

  const handleShareDailySummary = async () => {
    const today = new Date();
    const dateStr = today.toLocaleDateString("es-CL", { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const paymentBreakdown = todaySales.reduce((acc, s) => {
      acc[s.metodoPago] = (acc[s.metodoPago] || 0) + s.total;
      return acc;
    }, {} as Record<string, number>);

    const productMap: Record<string, { nombre: string; cantidad: number; total: number }> = {};
    todaySales.forEach(sale => {
      sale.items.forEach(item => {
        if (!productMap[item.nombre]) productMap[item.nombre] = { nombre: item.nombre, cantidad: 0, total: 0 };
        productMap[item.nombre].cantidad += item.cantidad;
        productMap[item.nombre].total += item.subtotal;
      });
    });
    const topProducts = Object.values(productMap).sort((a, b) => b.total - a.total).slice(0, 5);

    const paymentEmoji: Record<string, string> = { Efectivo: "💵", Débito: "💳", Crédito: "💳", Transferencia: "📲" };

    const lines = [
      `📊 *Resumen del Día*`,
      `📅 ${dateStr.charAt(0).toUpperCase() + dateStr.slice(1)}`,
      ``,
      `💰 *Total vendido:* $${todaySalesSum.toLocaleString("es-CL")}`,
      `📈 *Ganancia estimada:* $${estimatedProfitToday.toLocaleString("es-CL")}`,
      `🧾 *Transacciones:* ${todaySales.length}`,
      ``,
      `💳 *Por método de pago:*`,
      ...Object.entries(paymentBreakdown)
        .filter(([, amt]) => (amt as number) > 0)
        .map(([method, amt]) => {
          const pct = Math.round(((amt as number) / (todaySalesSum || 1)) * 100);
          return `  ${paymentEmoji[method] || "•"} ${method}: $${(amt as number).toLocaleString("es-CL")} (${pct}%)`;
        }),
      ...(topProducts.length > 0 ? [
        ``,
        `🏆 *Más vendido:*`,
        ...topProducts.map((p, i) => `  ${i + 1}. ${p.nombre} — ${p.cantidad} uds — $${p.total.toLocaleString("es-CL")}`),
      ] : []),
      ``,
      `⚡ Charlie Grow`,
    ];

    const text = lines.join("\n");

    if (navigator.share) {
      try { await navigator.share({ text }); } catch { /* usuario canceló */ }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        notify("Resumen copiado al portapapeles", "success");
      } catch {
        notify("No se pudo copiar el resumen", "error");
      }
    }
  };

  const printReceipt = (sale: Sale) => {
    const dateStr = new Date(sale.fecha).toLocaleString('es-CL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const rows = sale.items.map(item => `
      <tr>
        <td style="padding:1mm 0;vertical-align:top">${item.nombre}</td>
        <td style="text-align:right;padding:1mm 0;white-space:nowrap">${item.cantidad} u.</td>
        <td style="text-align:right;padding:1mm 0;white-space:nowrap">$${item.precioUnitario.toLocaleString('es-CL')}</td>
        <td style="text-align:right;padding:1mm 0;white-space:nowrap;font-weight:bold">$${item.subtotal.toLocaleString('es-CL')}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:'Courier New',monospace;font-size:11px;width:58mm;padding:3mm}
      .center{text-align:center}.bold{font-weight:bold}.large{font-size:15px}
      .divider{border-top:1px dashed #000;margin:2.5mm 0}
      table{width:100%;border-collapse:collapse}
      @media print{@page{size:58mm auto;margin:0}body{width:58mm}}
    </style></head><body>
      <div class="center bold large">Charlie Grow</div>
      <div class="center" style="font-size:9px">Ahumada 85, local 020 subterráneo</div>
      <div class="center" style="font-size:9px;margin-top:1mm">${dateStr}</div>
      <div class="divider"></div>
      <table><tbody>${rows}</tbody></table>
      <div class="divider"></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:bold">
        <span>TOTAL</span><span>$${sale.total.toLocaleString('es-CL')}</span>
      </div>
      <div style="font-size:10px;margin-top:1.5mm">Pago: ${sale.metodoPago}</div>
      <div class="divider"></div>
      <div class="center" style="font-size:9px">¡Gracias por tu compra!</div>
      <br>
    </body></html>`;

    const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank', 'width=300,height=600,menubar=no,toolbar=no,location=no,scrollbars=no');
    if (!w) { notify('Permite las ventanas emergentes para imprimir.', 'error'); URL.revokeObjectURL(url); return; }
    w.addEventListener('afterprint', () => { w.close(); URL.revokeObjectURL(url); });
    setTimeout(() => { w.focus(); w.print(); }, 700);
  };


  // Add Product manual action
  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProduct.nombre || !newProduct.precioVenta || !newProduct.stock) {
      notify("Rellena todos los campos obligatorios (*).", "error");
      return;
    }

    if (newProduct.codigoBarras.trim()) {
      const dup = productsRef.current.find(p => p.codigoBarras === newProduct.codigoBarras.trim());
      if (dup) {
        notify(`El código "${newProduct.codigoBarras.trim()}" ya está asignado a "${dup.nombre}".`, "error");
        return;
      }
    }

    const pCompra = parseInt(newProduct.precioCompra) || 0;
    const pVenta = parseInt(newProduct.precioVenta) || 0;
    const stockQty = parseFloat(newProduct.stock) || 0;
    const sMinimo = parseFloat(newProduct.stockMinimo) || 3;

    if (pVenta < pCompra) {
      notify("Atención: El precio de venta es menor que el de compra.", "info");
    }

    const id = uuid();
    const createdProduct: Product = {
      id,
      nombre: newProduct.nombre,
      codigoBarras: newProduct.codigoBarras,
      categoria: newProduct.categoria,
      precioCompra: pCompra,
      precioVenta: pVenta,
      stock: stockQty,
      stockMinimo: sMinimo,
      unidadMedida: newProduct.unidadMedida,
      updatedAt: new Date().toISOString()
    };

    if (!user) { notify("Sesión expirada. Recarga la página.", "error"); return; }
    pendingInsertIds.current.add(id);
    setProducts(prev => [createdProduct, ...prev]);
    if (isOnline) {
      const { error } = await supabase.from('products').insert(fromProduct(createdProduct, user.id));
      pendingInsertIds.current.delete(id);
      if (error) {
        setProducts(prev => prev.filter(p => p.id !== createdProduct.id));
        notify(`Error: ${error.message}`, "error");
        return;
      }
    } else {
      pendingInsertIds.current.delete(id);
      queueOp('ADD_PRODUCT', fromProduct(createdProduct, user.id));
    }
    notify("Producto guardado.", "success");

    // Reset Form
    setNewProduct({
      nombre: "",
      codigoBarras: "",
      categoria: "Accesorios",
      precioCompra: "",
      precioVenta: "",
      stock: "10",
      stockMinimo: "3",
      unidadMedida: "unidades"
    });
    setShowAddProductModal(false);
  };

  // Detección de código de barras reutilizable (sin HTTPS requerido)
  const detectBarcodeFromDataUrl = async (dataUrl: string): Promise<string | null> => {
    const img = document.createElement("img");
    img.src = dataUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("No se pudo cargar la imagen."));
    });

    const toCanvas = (maxDim: number): HTMLCanvasElement => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || maxDim, img.naturalHeight || maxDim));
      canvas.width = Math.round((img.naturalWidth || maxDim) * scale);
      canvas.height = Math.round((img.naturalHeight || maxDim) * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas;
    };

    const tryZxingWasm = async (
      input: Blob | ImageData,
      binarizer?: "LocalAverage" | "GlobalHistogram" | "FixedThreshold"
    ): Promise<string | null> => {
      try {
        const results = await readBarcodes(input, {
          tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true,
          formats: [],
          ...(binarizer ? { binarizer } : {}),
        });
        return results.find(r => r.text)?.text ?? null;
      } catch { return null; }
    };

    const tryQuagga = (src: string, patchSize: "x-small"|"small"|"medium"|"large" = "medium"): Promise<string | null> =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 8000);
        try {
          Quagga.decodeSingle({
            decoder: { readers: ["ean_reader","ean_8_reader","upc_reader","upc_e_reader","code_128_reader","code_39_reader"] },
            locate: true,
            locator: { patchSize, halfSample: false },
            src,
          }, (result: any) => { clearTimeout(timer); resolve(result?.codeResult?.code ?? null); });
        } catch { clearTimeout(timer); resolve(null); }
      });

    let barcode: string | null = null;

    if ("BarcodeDetector" in window) {
      try {
        const formats = ["ean_13","ean_8","upc_a","upc_e","code_128","code_39","code_93","qr_code","itf","codabar"];
        const detector = new (window as any).BarcodeDetector({ formats });
        const codes = await detector.detect(img);
        if (codes.length > 0) barcode = codes[0].rawValue;
      } catch { }
    }

    if (!barcode) {
      const blob = await (await fetch(dataUrl)).blob();
      barcode = await tryZxingWasm(blob);
      if (!barcode) barcode = await tryZxingWasm(blob, "GlobalHistogram");
      if (!barcode) barcode = await tryZxingWasm(blob, "FixedThreshold");
    }

    if (!barcode) {
      for (const dim of [1200, 700]) {
        if (barcode) break;
        const c = toCanvas(dim);
        barcode = await tryZxingWasm(c.getContext("2d")!.getImageData(0, 0, c.width, c.height));
      }
    }

    if (!barcode) barcode = await tryQuagga(toCanvas(1600).toDataURL("image/jpeg", 0.92), "medium");
    if (!barcode) barcode = await tryQuagga(toCanvas(900).toDataURL("image/jpeg", 0.92), "small");
    if (!barcode) barcode = await tryQuagga(toCanvas(1200).toDataURL("image/jpeg", 0.92), "large");

    return barcode;
  };

  // Photo scanner handlers
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    let blob: Blob = file;

    // Chrome doesn't render HEIC — convert to JPEG first
    const isHeic = file.type === "image/heic" || file.type === "image/heif" ||
      file.name.toLowerCase().endsWith(".heic") || file.name.toLowerCase().endsWith(".heif");
    if (isHeic) {
      try {
        blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 }) as Blob;
      } catch {
        notify("No se pudo convertir la foto HEIC. Intenta guardarla como JPG primero.", "error");
        return;
      }
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setAiPhotoPreview(reader.result as string);
    };
    reader.readAsDataURL(blob);
  };

  const handleCartPhotoScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setIsScanningCartPhoto(true);
    try {
      let blob: Blob = file;
      const isHeic = file.type === "image/heic" || file.type === "image/heif" ||
        file.name.toLowerCase().endsWith(".heic") || file.name.toLowerCase().endsWith(".heif");
      if (isHeic) {
        try {
          blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 }) as Blob;
        } catch {
          notify("No se pudo convertir la foto. Intenta con JPG.", "error");
          setIsScanningCartPhoto(false);
          return;
        }
      }

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const barcode = await detectBarcodeFromDataUrl(dataUrl);
      if (!barcode) {
        notify("No se detectó ningún código. Acerca más la cámara y asegúrate de que el código llene la foto.", "error");
        return;
      }

      const product = productsRef.current.find(p => p.codigoBarras === barcode);
      if (product) {
        addToCart(product);
        notify(`✓ ${product.nombre} agregado al carrito`, "success");
      } else {
        notify("Código no está en el catálogo. Regístralo primero desde Stock.", "info");
      }
    } catch {
      notify("No se pudo procesar la foto.", "error");
    } finally {
      setIsScanningCartPhoto(false);
    }
  };

  const handleAnalyzePhoto = async () => {
    if (!aiPhotoPreview) {
      notify("Carga o toma una foto primero.", "error");
      return;
    }

    setIsAnalyzingPhoto(true);
    setAiAnalyzedProduct(null);
    setAiInventoryMatch(null);

    try {
      const barcode = await detectBarcodeFromDataUrl(aiPhotoPreview);

      if (!barcode) {
        throw new Error(
          "No se encontró código de barras. Asegúrate de que el código esté completamente visible y enfocado en la foto."
        );
      }

      // Primero: buscar en el inventario propio (cubre productos chilenos no indexados globalmente)
      const inventoryMatch = products.find(p => p.codigoBarras === barcode);
      if (inventoryMatch) {
        setAiInventoryMatch(inventoryMatch);
        return;
      }

      // Buscar en múltiples bases de datos gratuitas (sin API key, CORS habilitado)
      // Misma estructura de respuesta en las cuatro APIs de Open*Facts
      const fetchOFF = async (base: string): Promise<any> => {
        try {
          const r = await fetch(`https://${base}/api/v0/product/${barcode}.json`);
          const d = await r.json();
          return d.status === 1 ? d.product : null;
        } catch { return null; }
      };

      // UPC Item DB: cubre productos internacionales que no están en Open Food Facts
      const fetchUpcItemDb = async (): Promise<any> => {
        try {
          const r = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
          const d = await r.json();
          if (d.code === "OK" && d.items?.length > 0) return { _upc: true, ...d.items[0] };
        } catch { /* cors o rate limit */ }
        return null;
      };

      // 1. Open Food Facts (alimentos — global)
      let rawProduct: any = await fetchOFF("world.openfoodfacts.org");
      // 2. Open Beauty Facts (cosméticos, desodorantes, perfumes, cremas)
      if (!rawProduct) rawProduct = await fetchOFF("world.openbeautyfacts.org");
      // 3. Open Products Facts (artículos del hogar, limpieza)
      if (!rawProduct) rawProduct = await fetchOFF("world.openproductsfacts.org");
      // 4. UPC Item DB (base de datos amplia, buena cobertura latinoamericana)
      let upcItem: any = null;
      if (!rawProduct) upcItem = await fetchUpcItemDb();

      let nombre: string;
      let categoria = "Accesorios";
      let unidadMedida = "unidades";
      let descripcion = `EAN: ${barcode}`;
      const found = !!(rawProduct || upcItem);

      if (rawProduct?._upc) {
        rawProduct = null;
      }

      if (rawProduct) {
        const nameRaw = rawProduct.product_name_es || rawProduct.product_name || "";
        const brand = rawProduct.brands?.split(",")[0]?.trim() || "";
        const quantity = rawProduct.quantity || "";
        descripcion = rawProduct.product_name || `EAN: ${barcode}`;
        const nameParts = [nameRaw];
        if (brand && !nameRaw.toLowerCase().includes(brand.toLowerCase())) nameParts.push(brand);
        if (quantity) nameParts.push(quantity);
        nombre = nameParts.filter(Boolean).join(" ").trim() || `Producto ${barcode}`;
        unidadMedida = /\b(l|ml|litro|liter)/i.test(quantity) ? "litros" : "unidades";

        // Detectar por nombre primero (más preciso para growshop)
        categoria = detectCategoria(nombre + " " + (rawProduct.categories || ""));

        // Fallback: tags de Open Food Facts si no se detectó growshop
        if (categoria === "Accesorios") {
          const tags: string[] = rawProduct.categories_tags || rawProduct.labels_tags || [];
          const hasTag = (kws: string[]) => tags.some(t => kws.some(k => t.includes(k)));
          if (hasTag(["beverage","drink","soda","water","juice","beer","wine","spirit","alcohol"]))
            categoria = "Accesorios";
        }
      } else if (upcItem) {
        const brand = upcItem.brand || "";
        const title = upcItem.title || "";
        descripcion = title || `EAN: ${barcode}`;
        const nameParts = [title];
        if (brand && !title.toLowerCase().includes(brand.toLowerCase())) nameParts.unshift(brand);
        nombre = nameParts.filter(Boolean).join(" ").trim() || `Producto ${barcode}`;
        categoria = detectCategoria(nombre + " " + (upcItem.category || "") + " " + (upcItem.description || ""));
      } else {
        nombre = `Producto ${barcode}`;
      }

      setAiAnalyzedProduct({ nombre, descripcion, codigoBarras: barcode, categoria, unidadMedida });

      notify(
        found
          ? "¡Producto identificado con éxito!"
          : "Código detectado pero no está en ninguna base de datos — ajusta el nombre manualmente.",
        found ? "success" : "info"
      );
    } catch (err: any) {
      console.error(err);
      notify(err.message || "No pudimos reconocer el producto.", "error");
    } finally {
      setIsAnalyzingPhoto(false);
    }
  };

  const handleSaveAiAnalyzedProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiAnalyzedProduct) return;

    if (!aiProductPriceVenta) {
      notify("Por favor, ingresa el precio de venta (*).", "error");
      return;
    }

    if (aiAnalyzedProduct.codigoBarras?.trim()) {
      const dup = productsRef.current.find(p => p.codigoBarras === aiAnalyzedProduct.codigoBarras.trim());
      if (dup) {
        notify(`El código "${aiAnalyzedProduct.codigoBarras.trim()}" ya está asignado a "${dup.nombre}".`, "error");
        return;
      }
    }

    const pCompra = parseInt(aiProductPriceCompra) || 0;
    const pVenta = parseInt(aiProductPriceVenta) || 0;
    const stockQty = parseFloat(aiProductStock) || 0;
    const sMinimo = parseFloat(aiProductStockMin) || 3;

    const id = uuid();
    const createdProduct = {
      id,
      nombre: aiAnalyzedProduct.nombre,
      codigoBarras: aiAnalyzedProduct.codigoBarras || "",
      categoria: aiAnalyzedProduct.categoria || "Otros",
      precioCompra: pCompra,
      precioVenta: pVenta,
      stock: stockQty,
      stockMinimo: sMinimo,
      unidadMedida: aiAnalyzedProduct.unidadMedida || "unidades",
      updatedAt: new Date().toISOString()
    };

    if (!user) return;
    pendingInsertIds.current.add(id);
    setProducts(prev => [createdProduct as Product, ...prev]);
    if (isOnline) {
      const { error } = await supabase.from('products').insert(fromProduct(createdProduct as Product, user.id));
      pendingInsertIds.current.delete(id);
      if (error) {
        setProducts(prev => prev.filter(p => p.id !== createdProduct.id));
        notify("Error al guardar el producto.", "error");
        return;
      }
    } else {
      pendingInsertIds.current.delete(id);
      queueOp('ADD_PRODUCT', fromProduct(createdProduct as Product, user.id));
    }
    notify("Producto guardado.", "success");

    // Reset fields
    setAiPhotoPreview(null);
    setAiAnalyzedProduct(null);
    setAiProductPriceVenta("");
    setAiProductPriceCompra("");
    setAiProductStock("10");
    setAiProductStockMin("3");
    setShowAiPhotoModal(false);
  };

  // Update Stock manual action
  const handleUpdateStock = async (prodId: string, addedStock: number) => {
    const prod = products.find(p => p.id === prodId);
    if (!prod) return;
    const nStock = Math.max(0, prod.stock + addedStock);
    const updatedAt = new Date().toISOString();
    setProducts(prev => prev.map(p => p.id === prodId ? { ...p, stock: nStock, updatedAt } : p));
    if (isOnline) {
      const { error } = await supabase.from('products')
        .update({ stock: nStock, updated_at: updatedAt })
        .eq('id', prodId);
      if (error) {
        setProducts(prev => prev.map(p => p.id === prodId ? { ...p, stock: prod.stock } : p));
        notify("Error al actualizar stock.", "error");
        return;
      }
    } else {
      queueOp('UPDATE_STOCK', { id: prodId, stock: nStock, updated_at: updatedAt });
    }
    notify("Stock modificado correctamente.", "success");
    setShowEditStockModal(null);
  };

  const handleSaveEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditStockModal || !user) return;
    if (!editForm.nombre || !editForm.precioVenta) {
      notify("El nombre y el precio de venta son obligatorios.", "error");
      return;
    }

    if (editForm.codigoBarras.trim()) {
      const dup = productsRef.current.find(p => p.codigoBarras === editForm.codigoBarras.trim() && p.id !== showEditStockModal.id);
      if (dup) {
        notify(`El código "${editForm.codigoBarras.trim()}" ya está asignado a "${dup.nombre}".`, "error");
        return;
      }
    }

    const originalProduct = showEditStockModal; // capture before clearing

    const updatedProduct: Product = {
      ...showEditStockModal,
      nombre: editForm.nombre,
      codigoBarras: editForm.codigoBarras,
      categoria: editForm.categoria,
      precioCompra: parseInt(editForm.precioCompra) || 0,
      precioVenta: parseInt(editForm.precioVenta) || 0,
      stock: parseFloat(editForm.stock) || 0,
      stockMinimo: parseFloat(editForm.stockMinimo) || 3,
      unidadMedida: editForm.unidadMedida,
      updatedAt: new Date().toISOString(),
    };

    setProducts(prev => prev.map(p => p.id === updatedProduct.id ? updatedProduct : p));
    setShowEditStockModal(null);

    if (isOnline) {
      const { error } = await supabase.from('products').update({
        nombre: updatedProduct.nombre,
        codigo_barras: updatedProduct.codigoBarras || null,
        categoria: updatedProduct.categoria,
        precio_compra: updatedProduct.precioCompra,
        precio_venta: updatedProduct.precioVenta,
        stock: updatedProduct.stock,
        stock_minimo: updatedProduct.stockMinimo,
        unidad_medida: updatedProduct.unidadMedida,
        updated_at: updatedProduct.updatedAt,
      }).eq('id', updatedProduct.id);
      if (error) {
        setProducts(prev => prev.map(p => p.id === originalProduct.id ? originalProduct : p)); // use captured original
        notify("Error al guardar los cambios.", "error");
        return;
      }
    } else {
      queueOp('UPDATE_PRODUCT', fromProduct(updatedProduct, user.id));
    }
    notify("Producto actualizado.", "success");
  };

  const handleGenerateBarcode = () => {
    const code = "CG" + String(Math.floor(100000000000 + Math.random() * 900000000000));
    setBarcodeCode(code);
  };

  const handleSaveAndPrintBarcode = async () => {
    if (!showBarcodeModal || !barcodeCode.trim()) return;
    const code = barcodeCode.trim();

    // Guardar código en producto si cambió
    if (code !== showBarcodeModal.codigoBarras) {
      const dup = productsRef.current.find(p => p.codigoBarras === code && p.id !== showBarcodeModal.id);
      if (dup) {
        notify(`El código "${code}" ya está asignado a "${dup.nombre}".`, "error");
        return;
      }
      const updated = { ...showBarcodeModal, codigoBarras: code };
      setProducts(prev => prev.map(p => p.id === showBarcodeModal.id ? updated : p));
      if (isOnline) {
        const { error } = await supabase.from('products').update({ codigo_barras: code }).eq('id', showBarcodeModal.id);
        if (error) {
          notify("Error al guardar el código. Reintenta.", "error");
          setProducts(prev => prev.map(p => p.id === showBarcodeModal.id ? showBarcodeModal : p));
          return;
        }
      } else {
        queueOp('UPDATE_PRODUCT', fromProduct(updated, user!.id));
      }
    }

    // Generar SVG fresco para impresión con dimensiones optimizadas para 50x30mm
    const printSvgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    try {
      JsBarcode(printSvgEl, code, {
        format: "CODE128",
        width: 1.8,
        height: 44,
        displayValue: true,
        fontSize: 9,
        margin: 2,
        textMargin: 2,
      });
    } catch { return; }
    const svgData = new XMLSerializer().serializeToString(printSvgEl);
    const label = barcodeLabel.trim() || showBarcodeModal.nombre;
    const qty = barcodePrintQty;

    const labelHtml = `<div class="label"><div class="name">${label}</div>${svgData}</div>`;
    const win = window.open('', '_blank', 'width=300,height=250');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Etiqueta</title>
      <style>
        @page { size: 50mm 30mm; margin: 0; }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; font-family: Arial, sans-serif; background: white; }
        .page { display: flex; flex-wrap: wrap; }
        .label {
          width: 50mm; height: 30mm;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 1.5mm 2mm 1mm;
          overflow: hidden;
          page-break-after: always;
        }
        .name {
          font-size: 7.5pt; font-weight: bold;
          text-align: center; line-height: 1.1;
          max-width: 46mm; word-break: break-word;
          margin-bottom: 1mm;
        }
        svg { width: 46mm; height: auto; display: block; }
      </style></head><body>
      <div class="page">${Array(qty).fill(labelHtml).join("")}</div>
      <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>
    </body></html>`);
    win.document.close();
  };

  // Delete product
  const handleDeleteProduct = (prodId: string) => {
    setConfirmModal({
      message: "¿Eliminar este producto del catálogo?",
      onConfirm: async () => {
        const removed = products.find(p => p.id === prodId);
        setProducts(prev => prev.filter(p => p.id !== prodId));
        if (isOnline) {
          const { error } = await supabase.from('products').delete().eq('id', prodId);
          if (error) {
            if (removed) setProducts(prev => [...prev, removed]);
            notify("Error al eliminar producto.", "error");
            return;
          }
        } else {
          queueOp('DELETE_PRODUCT', { id: prodId });
        }
        notify("Producto eliminado.", "info");
      }
    });
  };

  const handleDeleteSale = (saleId: string) => {
    setConfirmModal({
      message: "¿Eliminar esta venta del historial?",
      onConfirm: async () => {
        const removed = sales.find(s => s.id === saleId);
        setSales(prev => prev.filter(s => s.id !== saleId));
        if (isOnline) {
          const { error } = await supabase.from('sales').delete().eq('id', saleId);
          if (error) {
            if (removed) setSales(prev => [...prev, removed]);
            notify("Error al eliminar venta.", "error");
            return;
          }
        } else {
          queueOp('DELETE_SALE', { id: saleId });
        }
        notify("Venta eliminada.", "info");
      }
    });
  };

  // Click to add product from Catalogue into the Cart
  const addToCart = (product: Product) => {
    if (product.stock <= 0) {
      notify(`Alerta: ${product.nombre} tiene stock en 0.`, "info");
    }
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        const step = product.unidadMedida === 'kg' ? 0.25 : 1;
        return prev.map(item =>
          item.id === product.id
            ? { ...item, cantidad: item.cantidad + step, subtotal: item.precioUnitario * (item.cantidad + step) }
            : item
        );
      }
      const initialQty = product.unidadMedida === 'kg' ? 0.25 : 1;
      return [...prev, {
        id: product.id,
        nombre: product.nombre,
        cantidad: initialQty,
        precioUnitario: product.precioVenta,
        subtotal: product.precioVenta * initialQty,
        unidadMedida: product.unidadMedida
      }];
    });
  };

  // Change quantity in cart
  const updateCartQty = (idx: number, newQty: number) => {
    if (newQty <= 0) {
      setCart(cart.filter((_, i) => i !== idx));
      return;
    }
    setCart(cart.map((item, i) => 
      i === idx 
        ? { ...item, cantidad: newQty, subtotal: item.precioUnitario * newQty }
        : item
    ));
  };

  // Total cart calculator
  const cartSubtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const discountAmount = Math.round(cartSubtotal * (discountPct / 100));
  const cartTotal = cartSubtotal - discountAmount;

  // Submit cart sale transaction
  const checkoutSale = async () => {
    if (cart.length === 0) {
      notify("El carrito está vacío.", "error");
      return;
    }
    if (isCheckingOutRef.current) return;
    isCheckingOutRef.current = true;

    const saleId = uuid();
    const now = new Date().toISOString();

    const completedSale: Sale = {
      id: saleId,
      total: cartTotal,
      metodoPago: paymentMethod,
      fecha: now,
      items: [...cart]
    };

    if (!user) return;

    const stockUpdates = cart
      .map(item => {
        const prod = products.find(p => p.id === item.id);
        if (!prod) return null;
        return { id: prod.id, stock: Math.max(0, prod.stock - item.cantidad), updated_at: now };
      })
      .filter(Boolean) as { id: string; stock: number; updated_at: string }[];

    // Optimistic update
    setSales(prev => [completedSale, ...prev]);
    const updatedProducts = products.map(p => {
      const upd = stockUpdates.find(u => u.id === p.id);
      return upd ? { ...p, stock: upd.stock, updatedAt: upd.updated_at } : p;
    });
    setProducts(updatedProducts);
    setCart([]);
    setLastSale(completedSale);
    setCashAmount("");
    setDiscountPct(0);
    setTimeout(() => barcodeInputRef.current?.focus(), 100);

    // Alerta de stock bajo para productos afectados por esta venta
    const lowAfterSale = stockUpdates
      .map(u => updatedProducts.find(p => p.id === u.id))
      .filter((p): p is typeof updatedProducts[0] => !!p && p.stock <= p.stockMinimo);

    if (lowAfterSale.length > 0) {
      setLowStockAlert(lowAfterSale);
    }

    // Email solo a los que recién cruzaron el umbral
    const crossedMinimum = stockUpdates
      .map(u => {
        const prev = products.find(p => p.id === u.id);
        const updated = updatedProducts.find(p => p.id === u.id);
        if (prev && updated && updated.stock <= updated.stockMinimo && prev.stock > prev.stockMinimo) return updated;
        return null;
      })
      .filter(Boolean) as { nombre: string; stock: number; stockMinimo: number; unidadMedida: string }[];
    if (user?.email) sendAlerts(crossedMinimum, user.email);

    const saleRow = {
      id: saleId,
      user_id: user.id,
      total: completedSale.total,
      metodo_pago: completedSale.metodoPago,
      fecha: completedSale.fecha,
    };
    const saleItems = completedSale.items.map(item => ({
      sale_id: saleId,
      product_id: item.id ?? null,
      nombre: item.nombre,
      cantidad: item.cantidad,
      precio_unitario: item.precioUnitario,
      subtotal: item.subtotal,
      unidad_medida: item.unidadMedida,
    }));

    if (!isOnline) {
      queueOp('CHECKOUT_SALE', { sale: saleRow, items: saleItems, stockUpdates });
      notify("¡Venta guardada! Se sincronizará cuando vuelva la conexión.", "success");
      isCheckingOutRef.current = false;
      return;
    }

    try {
      const { error: saleErr } = await supabase.from('sales').insert(saleRow);
      if (saleErr) throw saleErr;

      const { error: itemsErr } = await supabase.from('sale_items').insert(saleItems);
      if (itemsErr) throw itemsErr;

      const stockResults = await Promise.all(stockUpdates.map(u =>
        supabase.from('products').update({ stock: u.stock, updated_at: u.updated_at }).eq('id', u.id)
      ));
      const stockErr = stockResults.find(r => r.error);
      if (stockErr) {
        console.error("Stock update partial failure:", stockErr.error);
        notify("Venta registrada, pero hubo un error al actualizar el stock. Revisa el inventario.", "error");
      } else {
        notify("¡Venta registrada! Stock actualizado.", "success");
      }
    } catch (err) {
      console.error("Checkout failed:", err);
      setSales(prev => prev.filter(s => s.id !== saleId));
      setProducts(prev => prev.map(p => {
        const upd = stockUpdates.find(u => u.id === p.id);
        const cartItem = completedSale.items.find(c => c.id === p.id);
        return upd && cartItem ? { ...p, stock: upd.stock + cartItem.cantidad } : p;
      }));
      setCart(completedSale.items);
      setLastSale(null);
      notify("No se pudo procesar la venta. El carrito fue restaurado.", "error");
    } finally {
      isCheckingOutRef.current = false;
    }
  };

  // Barcode quick search scanner simulator (Very useful for neighbor stores)
  const handleBarcodeSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcodeSearch.trim();
    if (!code) return;

    const matched = productsRef.current.find(p => p.codigoBarras === code);
    if (matched) {
      addToCart(matched);
      setBarcodeSearch("");
      if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
      setLastScannedProduct(matched);
      lastScannedTimeoutRef.current = setTimeout(() => setLastScannedProduct(null), 2000);
    } else {
      notify(`Código "${code}" no encontrado en el inventario.`, "error");
    }
  };

  // Reports calculations
  // Today's total sales
  const todaySales = sales.filter(s => {
    const saleDate = new Date(s.fecha);
    const today = new Date();
    return saleDate.getDate() === today.getDate() &&
      saleDate.getMonth() === today.getMonth() &&
      saleDate.getFullYear() === today.getFullYear();
  });
  const todaySalesSum = todaySales.reduce((sum, s) => sum + s.total, 0);

  // Profit estimation for today
  // Let's compute based on items cost in the actual inventory catalogs
  const estimatedProfitToday = todaySales.reduce((profitAccum, sale) => {
    const saleProfit = sale.items.reduce((itemProfitAccum, item) => {
      // Find cost in inventory
      const catalogueProduct = products.find(p => p.nombre === item.nombre);
      if (catalogueProduct) {
        const cost = catalogueProduct.precioCompra;
        const profitPerItem = catalogueProduct.precioVenta - cost;
        return itemProfitAccum + (profitPerItem * item.cantidad);
      }
      return itemProfitAccum + (item.subtotal * 0.35); // assume 35% standard neighborhood margin if generic
    }, 0);
    return profitAccum + saleProfit;
  }, 0);

  // Distribution of payment methods
  const paymentMethodsSum = sales.reduce((acc, s) => {
    acc[s.metodoPago] = (acc[s.metodoPago] || 0) + s.total;
    return acc;
  }, { "Efectivo": 0, "Débito": 0, "Crédito": 0, "Transferencia": 0 } as Record<string, number>);

  // Comparativa semana a semana
  const getWeekStart = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const thisWeekStart = getWeekStart(new Date());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const thisWeekSales = sales.filter(s => new Date(s.fecha) >= thisWeekStart);
  const lastWeekSales = sales.filter(s => {
    const d = new Date(s.fecha);
    return d >= lastWeekStart && d < thisWeekStart;
  });
  const thisWeekTotal = thisWeekSales.reduce((sum, s) => sum + s.total, 0);
  const lastWeekTotal = lastWeekSales.reduce((sum, s) => sum + s.total, 0);
  const weekChangePct = lastWeekTotal > 0
    ? Math.round(((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100)
    : null;

  const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const toDayIdx = (d: Date) => { const day = d.getDay(); return day === 0 ? 6 : day - 1; };
  const thisWeekByDay = Array(7).fill(0);
  const lastWeekByDay = Array(7).fill(0);
  thisWeekSales.forEach(s => { thisWeekByDay[toDayIdx(new Date(s.fecha))] += s.total; });
  lastWeekSales.forEach(s => { lastWeekByDay[toDayIdx(new Date(s.fecha))] += s.total; });
  const maxDayValue = Math.max(...thisWeekByDay, 1);

  // Ayer — para comparar con hoy
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdaySalesSum = sales
    .filter(s => { const d = new Date(s.fecha); return d.toDateString() === yesterday.toDateString(); })
    .reduce((sum, s) => sum + s.total, 0);
  const todayVsYesterdayDiff = todaySalesSum - yesterdaySalesSum;
  const todayVsYesterdayPct = yesterdaySalesSum > 0
    ? Math.round((todayVsYesterdayDiff / yesterdaySalesSum) * 100)
    : null;

  // Top productos más vendidos esta semana
  const topProductsMap: Record<string, { nombre: string; cantidad: number }> = {};
  thisWeekSales.forEach(sale => {
    sale.items.forEach(item => {
      if (!topProductsMap[item.nombre]) topProductsMap[item.nombre] = { nombre: item.nombre, cantidad: 0 };
      topProductsMap[item.nombre].cantidad += item.cantidad;
    });
  });
  const topProducts = Object.values(topProductsMap).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5);

  // Top productos más vendidos hoy
  const topProductsTodayMap: Record<string, { nombre: string; cantidad: number }> = {};
  todaySales.forEach(sale => {
    sale.items.forEach(item => {
      if (!topProductsTodayMap[item.nombre]) topProductsTodayMap[item.nombre] = { nombre: item.nombre, cantidad: 0 };
      topProductsTodayMap[item.nombre].cantidad += item.cantidad;
    });
  });
  const topProductsToday = Object.values(topProductsTodayMap).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5);

  // Productos bajo el stock mínimo
  const lowStockProducts = products.filter(p => p.stock <= p.stockMinimo).sort((a, b) => a.stock - b.stock);

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-yellow-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  // ── Tour guiado ──────────────────────────────────────────────────────────
  const TOUR_TAB: Record<number, 'caja' | 'inventario' | 'ventas' | 'reportes'> = {
    0:'caja', 1:'caja', 2:'caja', 3:'caja', 4:'caja', 5:'caja', 6:'caja',
    7:'inventario', 8:'inventario', 9:'inventario',
    10:'ventas',
    11:'reportes', 12:'reportes',
  };

  const tourSteps: Step[] = [
    {
      target: 'body',
      placement: 'center',
      title: '¡Bienvenido/a a Charlie Grow! 👋',
      content: 'Te mostramos en 2 minutos cómo usar la app. Toca Siguiente para empezar o ✕ para salir.',
      skipBeacon: true,
    },
    {
      target: '#tab-caja',
      placement: 'right',
      title: 'Caja 🛒',
      content: 'Aquí registras cada venta. Es la pantalla que usarás todo el día.',
      skipBeacon: true,
    },
    {
      target: '#tour-search',
      placement: 'bottom',
      title: 'Buscar producto',
      content: 'Escribe el nombre del producto para encontrarlo en tu catálogo.',
      skipBeacon: true,
    },
    {
      target: '#tour-barcode',
      placement: 'bottom',
      title: 'Pistola de códigos de barras',
      content: 'Pasa la pistola lectora sobre el código. El producto se agrega al carrito solo.',
      skipBeacon: true,
    },
    {
      target: '#tour-catalog',
      placement: 'top',
      title: 'Catálogo de productos',
      content: 'Toca cualquier tarjeta para agregarla al carrito. Cada clic suma una unidad más.',
      skipBeacon: true,
    },
    {
      target: '#tour-boleta',
      placement: 'left',
      title: 'Boleta y cobro',
      content: 'Elige Efectivo, Débito, Crédito o Transferencia. Aplica descuento si quieres y presiona Cobrar.',
      skipBeacon: true,
    },
    {
      target: '#tab-inventario',
      placement: 'right',
      title: 'Stock / Inventario 📦',
      content: 'Aquí administras todos tus productos: precios, cantidades y alertas cuando se acaban.',
      skipBeacon: true,
    },
    {
      target: '#tour-inv-nuevo',
      placement: 'bottom',
      title: 'Agregar producto',
      content: 'Toca + Nuevo para registrar un producto nuevo con nombre, precio de costo, precio de venta y stock.',
      skipBeacon: true,
    },
    {
      target: '#tour-inv-foto',
      placement: 'bottom',
      title: 'Agregar con foto 📷',
      content: 'Saca una foto del producto y la inteligencia artificial identifica nombre y categoría automáticamente.',
      skipBeacon: true,
    },
    {
      target: '#tab-ventas',
      placement: 'right',
      title: 'Historial de Ventas 🧾',
      content: 'Consulta todas las boletas registradas. Filtra por hoy, ayer, esta semana o este mes.',
      skipBeacon: true,
    },
    {
      target: '#tab-reportes',
      placement: 'right',
      title: 'Reportes 📈',
      content: 'Ve cuánto vendiste hoy, qué producto se vende más y cómo va la semana.',
      skipBeacon: true,
    },
    {
      target: 'body',
      placement: 'center',
      title: '¡Listo! 🎉',
      content: 'Ya conoces lo básico. Cuando quieras volver a ver el tour, toca el botón ? en la esquina superior derecha.',
      skipBeacon: true,
    },
  ];

  const handleTourCallback = (data: EventData) => {
    const { action, index, status, type } = data;

    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      const nextIndex = index + (action === ACTIONS.PREV ? -1 : 1);
      const clampedNext = Math.max(0, Math.min(tourSteps.length - 1, nextIndex));
      const nextTab = TOUR_TAB[clampedNext];
      const currentTab = TOUR_TAB[index];

      if (nextTab && nextTab !== currentTab) {
        setTourRunning(false);
        setActiveTab(nextTab);
        setTimeout(() => {
          setTourStep(clampedNext);
          setTourRunning(true);
        }, 350);
      } else {
        setTourStep(clampedNext);
      }
    }

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setTourRunning(false);
      setTourStep(0);
    }
  };
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div id="app-container" className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col antialiased">

      {/* Fixed global notification — always visible at top of viewport */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -80 }}
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
            className={`fixed top-3 left-3 right-3 z-[70] p-3.5 rounded-2xl shadow-xl flex items-center gap-2.5 font-sans font-medium text-sm text-white ${
              notification.type === "success"
                ? "bg-emerald-600 border border-emerald-500"
                : notification.type === "error"
                ? "bg-rose-600 border border-rose-500"
                : "bg-blue-600 border border-blue-500"
            }`}
          >
            {notification.type === "success" ? <CheckCircle className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
            <span>{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Friendly Header */}
      <header id="main-header" className="bg-white border-b border-slate-200/80 shadow-sm">
        <div className="max-w-7xl mx-auto px-3 py-2 md:px-4 md:py-3 flex items-center justify-between gap-2">
          {/* Logo + title */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="bg-yellow-400 p-1 rounded-xl shadow-sm shrink-0 overflow-hidden">
              <img src="/logo.jpg" alt="Charlie Grow" className="w-8 h-8 md:w-10 md:h-10 object-cover rounded-lg" />
            </div>
            <div className="min-w-0">
              <h1 id="app-title" className="text-lg md:text-xl font-extrabold tracking-tight text-slate-900 truncate leading-none">
                Charlie Grow
              </h1>
              <p className="text-[10px] text-slate-400 font-medium hidden md:block">Grow Shop · Ahumada 85</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isSyncing && (
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <RefreshCw className="w-3 h-3 animate-spin" />
              </div>
            )}
            {isSyncingQueue && (
              <div className="flex items-center gap-1 text-xs bg-yellow-400/80 text-yellow-900 px-2 py-0.5 rounded-full font-medium">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span className="hidden sm:inline">Sincronizando...</span>
              </div>
            )}
            {!isSyncingQueue && !isOnline && (
              <div className="flex items-center gap-1 text-xs bg-orange-500/90 text-white px-2 py-0.5 rounded-full font-semibold">
                <span>Sin conexión</span>
                {pendingOps.length > 0 && (
                  <span className="bg-white/30 rounded-full px-1.5 py-0">{pendingOps.length}</span>
                )}
              </div>
            )}
            {syncError && (
              <div className="flex items-center gap-1 text-xs bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-semibold" title={syncError}>
                <AlertCircle className="w-3 h-3" />
                <span className="hidden sm:inline">Error sync</span>
              </div>
            )}
            {!isSyncingQueue && isOnline && pendingOps.length > 0 && (
              <button
                onClick={() => syncQueue(pendingOps)}
                className="flex items-center gap-1 text-xs bg-amber-500/90 text-white px-2 py-0.5 rounded-full font-semibold hover:bg-amber-500 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span className="hidden sm:inline">Sincronizar</span>
                <span className="bg-white/30 rounded-full px-1.5">{pendingOps.length}</span>
              </button>
            )}
            <button
              onClick={() => setShowAlertModal(true)}
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition cursor-pointer relative ${alertsEnabled ? 'bg-emerald-50 hover:bg-emerald-100' : 'bg-slate-100 hover:bg-slate-200'}`}
              title="Alertas de stock"
            >
              {alertsEnabled ? <Bell className="w-5 h-5 text-emerald-600" /> : <BellOff className="w-5 h-5 text-slate-400" />}
              {alertsEnabled && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full" />}
            </button>
            <button
              onClick={() => setIsDark(d => !d)}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 transition cursor-pointer text-xl"
              title={isDark ? "Modo claro" : "Modo oscuro"}
            >
              {isDark ? "☀️" : "🌙"}
            </button>
            <button
              onClick={() => { setActiveTab('caja'); setTourStep(0); setTourRunning(true); }}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-yellow-100 transition cursor-pointer font-bold text-slate-500 hover:text-yellow-700 text-base"
              title="Ver guía de uso"
            >
              ?
            </button>
            <button
              onClick={handleLogout}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-500 transition cursor-pointer"
              title="Cerrar sesión"
            >
              <LogOut className="w-5 h-5 text-slate-400 hover:text-rose-500" />
            </button>
          </div>
        </div>
      </header>

      {/* Banner de upgrade para usuarios con sesión anónima */}
      {user.is_anonymous && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span className="font-medium">Tus datos no están respaldados — regístralos para no perderlos si cambias de dispositivo.</span>
          </div>
          <button
            onClick={() => setShowUpgradeModal(true)}
            className="shrink-0 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer"
          >
            Registrarme
          </button>
        </div>
      )}

      {/* Main Container Area */}
      <main className={`flex-1 w-full max-w-7xl mx-auto px-4 py-6 flex flex-col md:flex-row gap-6 pb-20 md:pb-6 ${(cart.length > 0 || (lastSale && cart.length === 0)) && activeTab === 'caja' ? 'pb-36 md:pb-6' : ''}`}>
        
        {/* Navigation Sidebar Controls */}
        <aside id="nav-and-actions" className="hidden md:flex md:w-48 flex-col gap-4 shrink-0">

          <div className="bg-white p-2 rounded-2xl border border-slate-200/80 shadow-sm flex flex-row md:flex-col gap-1">
            <button
              id="tab-caja"
              onClick={() => setActiveTab("caja")}
              className={`flex-1 md:flex-none flex flex-col md:flex-row items-center justify-center md:justify-start gap-1 md:gap-3 py-2 md:py-3.5 px-1 md:px-4 rounded-xl font-bold transition-all cursor-pointer ${
                activeTab === "caja"
                  ? "bg-yellow-50 text-yellow-700 shadow-sm"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <ShoppingCart className="w-6 h-6 shrink-0" />
              <span className="text-xs md:text-base whitespace-nowrap leading-tight font-bold">Caja</span>
            </button>

            <button
              id="tab-inventario"
              onClick={() => setActiveTab("inventario")}
              className={`flex-1 md:flex-none flex flex-col md:flex-row items-center justify-center md:justify-start gap-1 md:gap-3 py-2 md:py-3.5 px-1 md:px-4 rounded-xl font-bold transition-all cursor-pointer relative ${
                activeTab === "inventario"
                  ? "bg-yellow-50 text-yellow-700 shadow-sm"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <Barcode className="w-6 h-6 shrink-0" />
              <span className="text-xs md:text-base whitespace-nowrap leading-tight font-bold">Stock</span>
              {products.filter(p => p.stock <= p.stockMinimo).length > 0 && (
                <span className="absolute top-1 right-1 bg-amber-500 text-white rounded-full text-[9px] w-4 h-4 flex items-center justify-center font-bold shrink-0">
                  {products.filter(p => p.stock <= p.stockMinimo).length}
                </span>
              )}
            </button>

            <button
              id="tab-ventas"
              onClick={() => setActiveTab("ventas")}
              className={`flex-1 md:flex-none flex flex-col md:flex-row items-center justify-center md:justify-start gap-1 md:gap-3 py-2 md:py-3.5 px-1 md:px-4 rounded-xl font-bold transition-all cursor-pointer ${
                activeTab === "ventas"
                  ? "bg-yellow-50 text-yellow-700 shadow-sm"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <Receipt className="w-6 h-6 shrink-0" />
              <span className="text-xs md:text-base whitespace-nowrap leading-tight font-bold">Ventas</span>
            </button>

            <button
              id="tab-reportes"
              onClick={() => setActiveTab("reportes")}
              className={`flex-1 md:flex-none flex flex-col md:flex-row items-center justify-center md:justify-start gap-1 md:gap-3 py-2 md:py-3.5 px-1 md:px-4 rounded-xl font-bold transition-all cursor-pointer ${
                activeTab === "reportes"
                  ? "bg-yellow-50 text-yellow-700 shadow-sm"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <TrendingUp className="w-6 h-6 shrink-0" />
              <span className="text-xs md:text-base whitespace-nowrap leading-tight font-bold">Reportes</span>
            </button>
          </div>

          {/* Quick Metrics Display on Sidebar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm hidden md:flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Hoy</h3>
            <div className="flex items-center gap-2">
              <div className="bg-yellow-50 text-yellow-600 p-2 rounded-xl">
                <DollarSign className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-slate-400">Vendido</div>
                <div className="text-xl font-extrabold text-slate-700 font-mono">${todaySalesSum.toLocaleString("es-CL")}</div>
              </div>
            </div>
          </div>

        </aside>

        {/* Content Tabs Switch */}
        <section id="tab-content" className="flex-1 min-w-0 flex flex-col gap-6">
          
          {/* TAB 1: QUICK CASHIER WINDOW */}
          {activeTab === "caja" && (
            <motion.div
              key="caja-tab"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6"
            >

              {/* Left catalog search & quick tap catalog */}
              <div className="col-span-1 lg:col-span-5 flex flex-col gap-4">

                {/* Catalogue Filter Panel */}
                <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200/80 flex flex-col gap-4">

                  {/* Search + cámara */}
                  <div id="tour-search" className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3.5 top-3.5 text-slate-400 w-5 h-5" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Buscar producto por nombre..."
                        className="w-full bg-slate-50 py-3 pl-11 pr-4 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 transition"
                      />
                    </div>
                    <div className="relative shrink-0">
                      <button
                        onClick={() => {
                          if (navigator.mediaDevices?.getUserMedia) {
                            setShowLiveScanner(true);
                          } else {
                            cartPhotoInputRef.current?.click();
                          }
                        }}
                        disabled={isScanningCartPhoto}
                        className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-sm transition ${isScanningCartPhoto ? 'bg-slate-400 text-white cursor-wait' : 'bg-yellow-400 text-slate-900 hover:bg-yellow-300 cursor-pointer'}`}
                        title="Escanear código con cámara"
                      >
                        {isScanningCartPhoto
                          ? <RefreshCw className="w-5 h-5 animate-spin" />
                          : <Camera className="w-5 h-5" />}
                      </button>
                      <input
                        ref={cartPhotoInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleCartPhotoScan}
                        className="hidden"
                      />
                    </div>
                  </div>

                  {/* Input pistola USB */}
                  <form id="tour-barcode" onSubmit={handleBarcodeSearchSubmit} className="flex gap-2">
                    <div className="relative flex-1">
                      <Barcode className="absolute left-3.5 top-3 text-slate-400 w-4 h-4" />
                      <input
                        ref={barcodeInputRef}
                        type="text"
                        value={barcodeSearch}
                        onChange={e => setBarcodeSearch(e.target.value)}
                        placeholder="Pistola / código de barras..."
                        className="w-full bg-amber-50 border border-amber-200 py-2.5 pl-10 pr-4 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400 transition placeholder-amber-400"
                      />
                    </div>
                    <button
                      type="submit"
                      className="bg-amber-500 hover:bg-amber-400 text-white px-4 rounded-xl font-bold text-sm transition cursor-pointer shrink-0"
                    >
                      ↵
                    </button>
                  </form>

                  {/* Preview en tiempo real del producto escaneado */}
                  {(() => {
                    const code = barcodeSearch.trim();
                    if (!code) return null;
                    const match = products.find(p => p.codigoBarras === code);
                    if (!match) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          addToCart(match);
                          setBarcodeSearch("");
                          if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
                          setLastScannedProduct(match);
                          lastScannedTimeoutRef.current = setTimeout(() => setLastScannedProduct(null), 2000);
                        }}
                        className="w-full flex items-center gap-3 bg-green-50 border border-green-300 rounded-xl px-4 py-3 text-left hover:bg-green-100 active:bg-green-200 transition cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-slate-800 text-sm truncate">{match.nombre}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{match.categoria} · Stock: {match.stock} {match.unidadMedida}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-slate-800 text-sm">${match.precioVenta.toLocaleString("es-CL")}</p>
                          <p className="text-xs text-green-600 font-semibold mt-0.5">Agregar →</p>
                        </div>
                      </button>
                    );
                  })()}

                  {/* Confirmación visual post-escaneo */}
                  {!barcodeSearch.trim() && lastScannedProduct && (
                    <div className="flex items-center gap-3 bg-green-50 border border-green-300 rounded-xl px-4 py-3">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-800 text-sm truncate">{lastScannedProduct.nombre}</p>
                        <p className="text-xs text-green-600 font-semibold">Agregado al carrito</p>
                      </div>
                      <p className="font-bold text-slate-800 text-sm shrink-0">${lastScannedProduct.precioVenta.toLocaleString("es-CL")}</p>
                    </div>
                  )}

                  {/* Horizontal Scroll Categories */}
                  <div className="flex gap-1.5 overflow-x-auto pb-1.5 scrollbar-thin">
                    {allCategories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`py-1.5 px-3.5 rounded-full font-bold text-xs shrink-0 cursor-pointer transition ${
                          selectedCategory === cat
                            ? "bg-slate-800 text-white"
                            : "bg-slate-100 hover:bg-slate-200 text-slate-500"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                    {showAddCategoryInput ? (
                      <form
                        onSubmit={e => { e.preventDefault(); addCategory(newCategoryName); }}
                        className="flex gap-1 shrink-0"
                      >
                        <input
                          autoFocus
                          value={newCategoryName}
                          onChange={e => setNewCategoryName(e.target.value)}
                          placeholder="Nueva categoría"
                          className="py-1.5 px-3 rounded-full border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 w-36"
                          onBlur={() => { if (!newCategoryName.trim()) setShowAddCategoryInput(false); }}
                        />
                        <button type="submit" className="py-1.5 px-3 rounded-full bg-slate-800 text-white font-bold text-xs shrink-0 cursor-pointer">+</button>
                      </form>
                    ) : (
                      <button
                        onClick={() => setShowAddCategoryInput(true)}
                        className="py-1.5 px-3 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold text-xs shrink-0 cursor-pointer transition"
                        title="Crear categoría"
                      >
                        + Categoría
                      </button>
                    )}
                  </div>

                  {/* Catalog list — 2 columnas, ordenado por más vendido */}
                  {(() => {
                    const saleCount = sales.reduce((acc, sale) => {
                      sale.items.forEach(item => { if (item.id) acc[item.id] = (acc[item.id] || 0) + item.cantidad; });
                      return acc;
                    }, {} as Record<string, number>);

                    const filtered = products
                      .filter(p => selectedCategory === "Todos" || p.categoria === selectedCategory)
                      .filter(p => p.nombre.toLowerCase().includes(searchTerm.toLowerCase()))
                      .sort((a, b) => (saleCount[b.id] || 0) - (saleCount[a.id] || 0));

                    return (
                      <div id="tour-catalog" className="grid grid-cols-2 gap-3 overflow-y-auto pr-1">
                        {filtered.map((product) => {
                          const isLow = product.stock <= product.stockMinimo;
                          return (
                            <button
                              key={product.id}
                              onClick={() => addToCart(product)}
                              className="bg-white border border-slate-200 hover:border-yellow-400 hover:shadow-md rounded-2xl text-left transition-all flex flex-col cursor-pointer active:scale-[0.97] overflow-hidden group"
                            >
                              {/* Top content */}
                              <div className="p-3 flex-1 flex flex-col gap-1">
                                <span className={`self-start text-[10px] font-bold px-2 py-0.5 rounded-full ${isLow ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {isLow ? `⚠ ${product.stock}` : product.stock}{product.unidadMedida === 'kg' ? ' kg' : isLow ? '' : ' un.'}
                                </span>
                                <h3 className="font-bold text-slate-800 text-sm leading-tight line-clamp-2 mt-0.5">{product.nombre}</h3>
                                {product.codigoBarras && (
                                  <p className="text-[10px] text-slate-400 font-mono truncate">{product.codigoBarras}</p>
                                )}
                              </div>
                              {/* Price + add button row */}
                              <div className="flex items-center justify-between px-3 pb-3 gap-2">
                                <span className="font-mono font-extrabold text-slate-900 text-lg md:text-xl leading-none">${product.precioVenta.toLocaleString("es-CL")}</span>
                                <div className="bg-yellow-400 group-hover:bg-yellow-300 rounded-xl p-2 text-slate-900 shadow-sm transition-colors shrink-0">
                                  <Plus className="w-5 h-5" />
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}

                </div>

              </div>

              {/* Right side cart checkout pane */}
              <div id="tour-boleta" className="col-span-1 lg:col-span-7">
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/80 flex flex-col gap-5 sticky top-4">
                  <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                    <ShoppingCart className="w-6 h-6 text-yellow-600" />
                    <h2 className="font-bold text-xl text-slate-800">Boleta</h2>
                    {cart.length > 0 && (
                      <span className="bg-yellow-100 text-yellow-800 text-sm px-3 py-0.5 rounded-full font-bold ml-auto">
                        {cart.length} ítems
                      </span>
                    )}
                  </div>

                  {/* Cart Item Rows */}
                  {cart.length === 0 ? (
                    <div className="py-16 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400 text-center px-4">
                      <ShoppingCart className="w-14 h-14 text-slate-300 mb-3" />
                      <p className="font-semibold text-base">El carrito está vacío</p>
                      <p className="mt-1 text-sm text-slate-400 md:block hidden">Toca un producto para agregarlo</p>
                      <p className="mt-1 text-sm text-slate-400 md:hidden block">Toca un producto arriba para agregarlo</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-1">
                      {cart.map((item, idx) => (
                        <div key={idx} className="bg-slate-50 border border-slate-200/60 p-4 rounded-2xl flex items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <h4 className="font-bold text-base text-slate-800 truncate">{item.nombre}</h4>
                            <span className="text-sm text-slate-400 font-mono">
                              ${item.precioUnitario.toLocaleString("es-CL")} c/u
                            </span>
                          </div>

                          {/* Qty Manager */}
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => updateCartQty(idx, item.cantidad - (item.unidadMedida === 'kg' ? 0.25 : 1))}
                              className="w-9 h-9 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center cursor-pointer font-extrabold text-slate-600 text-lg transition"
                            >
                              −
                            </button>
                            <span className="text-base font-bold font-mono w-12 text-center bg-white border border-slate-200 py-2 rounded-xl shadow-inner">
                              {item.cantidad}
                            </span>
                            <button
                              onClick={() => updateCartQty(idx, item.cantidad + (item.unidadMedida === 'kg' ? 0.25 : 1))}
                              className="w-9 h-9 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center cursor-pointer font-extrabold text-slate-600 text-lg transition"
                            >
                              +
                            </button>
                          </div>

                          <span className="text-base font-bold font-mono text-slate-700 w-20 text-right shrink-0">
                            ${item.subtotal.toLocaleString("es-CL")}
                          </span>
                          <button
                            onClick={() => updateCartQty(idx, 0)}
                            className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-300 hover:text-red-500 hover:bg-red-50 transition shrink-0 cursor-pointer"
                            title="Eliminar"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Payment Method selectors — hidden on mobile (sticky bar handles it) */}
                  <div className="hidden md:flex flex-col gap-3 pt-4 border-t border-slate-100">
                    <label className="text-sm font-bold text-slate-400 uppercase tracking-wider">Método de Pago</label>
                    <div className="grid grid-cols-4 gap-2">
                      {["Efectivo", "Débito", "Crédito", "Transferencia"].map((met: any) => (
                        <button
                          key={met}
                          onClick={() => setPaymentMethod(met)}
                          className={`py-3 px-2 text-center rounded-2xl font-bold text-sm cursor-pointer transition ${
                            paymentMethod === met
                              ? "bg-yellow-100 border-2 border-yellow-500 text-yellow-900"
                              : "bg-slate-100 border border-slate-200 text-slate-500 hover:bg-slate-200"
                          }`}
                        >
                          {met === "Efectivo" ? "💵 Efectivo" : met === "Débito" ? "💳 Débito" : met === "Crédito" ? "💳 Crédito" : "📲 Transf."}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Campo efectivo + vuelto — hidden on mobile */}
                  {paymentMethod === "Efectivo" && (
                    <div className="hidden md:flex flex-col gap-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider font-sans">¿Con cuánto paga?</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">$</span>
                        <input
                          type="number"
                          min="0"
                          value={cashAmount}
                          onChange={e => setCashAmount(e.target.value)}
                          placeholder="0"
                          className="w-full pl-7 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono font-bold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
                        />
                      </div>
                      {cashAmount !== "" && Number(cashAmount) >= cartTotal && (
                        <div className="flex justify-between items-center bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl">
                          <span className="text-xs font-bold text-emerald-700 font-sans">Vuelto</span>
                          <span className="font-mono font-extrabold text-emerald-700 text-base">
                            ${(Number(cashAmount) - cartTotal).toLocaleString("es-CL")}
                          </span>
                        </div>
                      )}
                      {cashAmount !== "" && Number(cashAmount) < cartTotal && Number(cashAmount) > 0 && (
                        <div className="flex justify-between items-center bg-red-50 border border-red-200 px-3 py-2 rounded-xl">
                          <span className="text-xs font-bold text-red-600 font-sans">Falta</span>
                          <span className="font-mono font-extrabold text-red-600 text-base">
                            ${(cartTotal - Number(cashAmount)).toLocaleString("es-CL")}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Checkout summary — hidden on mobile (sticky bar handles it) */}
                  <div className="hidden md:flex bg-slate-50 border border-slate-200/50 p-5 rounded-2xl flex-col gap-2">
                    <div className="flex justify-between items-center text-slate-400 font-medium text-sm">
                      <span>Subtotal</span>
                      <span>${cartSubtotal.toLocaleString("es-CL")}</span>
                    </div>

                    {/* Descuento */}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-400 font-medium">Descuento</span>
                      <div className="flex items-center gap-2">
                        {[0, 5, 10, 15, 20].map(pct => (
                          <button
                            key={pct}
                            onClick={() => setDiscountPct(pct)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                              discountPct === pct
                                ? 'bg-yellow-400 text-slate-900'
                                : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                            }`}
                          >
                            {pct === 0 ? 'Sin desc.' : `${pct}%`}
                          </button>
                        ))}
                        <div className="flex items-center bg-slate-100 rounded-lg overflow-hidden border border-slate-200 focus-within:border-yellow-400 transition">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={discountPct === 0 ? '' : discountPct}
                            onChange={e => {
                              const v = Math.min(100, Math.max(0, Number(e.target.value)));
                              setDiscountPct(isNaN(v) ? 0 : v);
                            }}
                            placeholder="0"
                            className="w-10 py-1 pl-2 pr-0 text-xs font-bold bg-transparent text-slate-700 focus:outline-none"
                          />
                          <span className="text-xs text-slate-400 font-bold pr-1.5">%</span>
                        </div>
                      </div>
                    </div>

                    {discountPct > 0 && (
                      <div className="flex justify-between items-center text-emerald-600 text-sm font-medium">
                        <span>Ahorro ({discountPct}%)</span>
                        <span>-${discountAmount.toLocaleString("es-CL")}</span>
                      </div>
                    )}

                    <div className="flex justify-between items-center pt-2 text-slate-800 border-t border-slate-200/60">
                      <span className="font-extrabold text-lg">Total a Cobrar</span>
                      <span className="font-mono font-extrabold text-2xl text-yellow-700">${cartTotal.toLocaleString("es-CL")}</span>
                    </div>
                  </div>

                  {/* Process checkout button — hidden on mobile (sticky bar handles it) */}
                  <button
                    onClick={checkoutSale}
                    disabled={cart.length === 0}
                    className="hidden md:flex w-full py-5 bg-yellow-400 hover:bg-yellow-300 active:scale-95 text-slate-900 font-extrabold text-xl rounded-2xl shadow-md disabled:opacity-40 disabled:hover:bg-yellow-400 cursor-pointer transition items-center justify-center gap-3"
                  >
                    <CheckCircle className="w-6 h-6" />
                    <span>Confirmar Venta</span>
                  </button>

                  {/* Estado post-venta desktop */}
                  {lastSale && cart.length === 0 && (
                    <div className="hidden md:flex flex-col gap-2">
                      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
                        <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-bold text-emerald-800 text-sm">Venta completada</p>
                          <p className="text-emerald-600 text-xs">${lastSale.total.toLocaleString('es-CL')} · {lastSale.metodoPago}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => printReceipt(lastSale)}
                        className="flex w-full py-3 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-bold text-sm rounded-2xl cursor-pointer transition items-center justify-center gap-2"
                      >
                        <Printer className="w-4 h-4" />
                        <span>Imprimir boleta</span>
                      </button>
                    </div>
                  )}

                </div>
              </div>

            </motion.div>
          )}

          {/* TAB 2: CATALOGUE / PRODUCTS STOCK */}
          {activeTab === "inventario" && (
            <motion.div 
              key="inventario-tab"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/80 flex flex-col gap-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="font-extrabold text-xl text-slate-800">Inventario</h2>
                  <p className="text-sm text-slate-400 mt-0.5">{products.length} productos registrados</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const conCodigo = products.filter(p => p.codigoBarras);
                      if (conCodigo.length > 0) openBarcodeModal(conCodigo[0]);
                      else notify("Ningún producto tiene código de barras aún. Agrégalo al crear el producto.", "info");
                    }}
                    className="py-2.5 px-4 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-sm rounded-xl border border-blue-200 transition flex items-center gap-2 cursor-pointer shadow-sm"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Imprimir</span>
                  </button>
                  <button
                    onClick={() => setShowCategoryModal(true)}
                    className="py-2.5 px-4 bg-violet-50 hover:bg-violet-100 text-violet-700 font-bold text-sm rounded-xl border border-violet-200 cursor-pointer shrink-0 transition shadow-sm"
                  >
                    + Categoría
                  </button>
                  <button
                    id="tour-inv-foto"
                    onClick={() => setShowAiPhotoModal(true)}
                    className="py-2.5 px-4 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 font-bold text-sm rounded-xl border border-yellow-200 transition flex items-center gap-2 cursor-pointer shadow-sm"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Foto</span>
                  </button>
                  <button
                    id="tour-inv-nuevo"
                    onClick={() => setShowAddProductModal(true)}
                    className="py-2.5 px-4 bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-bold text-sm rounded-xl shadow-sm transition flex items-center gap-2 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Nuevo</span>
                  </button>
                </div>
              </div>

              {/* Filtros */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pb-3 border-b border-slate-100">
                <div className="col-span-1 sm:col-span-5 relative">
                  <Search className="absolute left-3 top-3.5 text-slate-400 w-4 h-4" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar producto..."
                    className="w-full bg-slate-50 py-3 pl-9 pr-4 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 transition"
                  />
                </div>
                <div className="col-span-1 sm:col-span-3">
                  <select
                    value={inventorySort}
                    onChange={e => setInventorySort(e.target.value as typeof inventorySort)}
                    className="w-full bg-slate-50 py-3 px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    <option value="recent">Último registrado</option>
                    <option value="stock-desc">Mayor stock primero</option>
                    <option value="stock-asc">Menor stock primero</option>
                    <option value="alpha">Alfabético A-Z</option>
                  </select>
                </div>
                <div className="col-span-1 sm:col-span-4 flex gap-2">
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="flex-1 bg-slate-50 py-3 px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    <option value="Todos">Todas las categorías</option>
                    {allCategories.filter(c => c !== "Todos").map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  {selectedCategory !== "Todos" && selectedCategory !== "Otros" && (
                    <button
                      onClick={() => deleteCategory(selectedCategory)}
                      className="p-3 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-xl transition cursor-pointer shrink-0"
                      title="Eliminar categoría"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Vista mobile: lista de tarjetas */}
              <div className="flex flex-col divide-y divide-slate-100 sm:hidden">
                {products
                  .filter(p => selectedCategory === "Todos" || p.categoria === selectedCategory)
                  .filter(p => p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) || (p.codigoBarras && p.codigoBarras.includes(searchTerm)))
                  .sort((a, b) => {
                    if (inventorySort === 'stock-desc') return b.stock - a.stock;
                    if (inventorySort === 'stock-asc') return a.stock - b.stock;
                    if (inventorySort === 'alpha') return a.nombre.localeCompare(b.nombre, 'es');
                    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
                  })
                  .map((product) => {
                    const isLow = product.stock <= product.stockMinimo;
                    const markup = product.precioCompra > 0
                      ? Math.round(((product.precioVenta - product.precioCompra) / product.precioCompra) * 100)
                      : 0;
                    return (
                      <div key={product.id} className="py-3.5 flex items-center gap-3 hover:bg-slate-50/60 transition -mx-2 px-2 rounded-xl">
                        <div className={`shrink-0 flex flex-col items-center justify-center w-12 h-12 rounded-xl font-bold font-mono ${
                          isLow ? "bg-rose-100 text-rose-700 border border-rose-200" : "bg-emerald-50 text-emerald-700"
                        }`}>
                          <span className="text-base leading-none">{product.stock}</span>
                          <span className="text-[9px] font-semibold opacity-70">{product.unidadMedida === 'kg' ? 'kg' : 'uds'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-800 text-sm leading-snug truncate">{product.nombre}</div>
                          <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-semibold">{product.categoria}</span>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono font-extrabold text-slate-800 text-sm">${product.precioVenta.toLocaleString("es-CL")}</div>
                          {markup > 0 && <div className="text-[10px] text-emerald-600 font-bold">+{markup}%</div>}
                        </div>
                        <div className="shrink-0 flex items-center gap-1">
                          <button
                            onClick={() => openBarcodeModal(product)}
                            className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-700 transition cursor-pointer"
                            title="Código de barras"
                          >
                            <Barcode className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setShowEditStockModal(product);
                              setEditForm({
                                nombre: product.nombre, codigoBarras: product.codigoBarras || "",
                                categoria: product.categoria, precioCompra: String(product.precioCompra),
                                precioVenta: String(product.precioVenta), stock: String(product.stock),
                                stockMinimo: String(product.stockMinimo), unidadMedida: product.unidadMedida,
                              });
                            }}
                            className="p-2 hover:bg-yellow-50 rounded-xl text-slate-400 hover:text-yellow-600 transition cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteProduct(product.id)}
                            className="p-2 hover:bg-rose-50 rounded-xl text-slate-400 hover:text-rose-500 transition cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Vista desktop: tabla original */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b-2 border-slate-100 text-slate-400 text-xs font-bold uppercase tracking-wide">
                      <th className="py-3 px-2">Producto</th>
                      <th className="py-3 px-2">Costo</th>
                      <th className="py-3 px-2">Precio venta</th>
                      <th className="py-3 px-2 text-center">Stock</th>
                      <th className="py-3 px-2 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {products
                      .filter(p => selectedCategory === "Todos" || p.categoria === selectedCategory)
                      .filter(p => p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) || (p.codigoBarras && p.codigoBarras.includes(searchTerm)))
                      .sort((a, b) => {
                        if (inventorySort === 'stock-desc') return b.stock - a.stock;
                        if (inventorySort === 'stock-asc') return a.stock - b.stock;
                        if (inventorySort === 'alpha') return a.nombre.localeCompare(b.nombre, 'es');
                        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
                      })
                      .map((product) => {
                        const isLow = product.stock <= product.stockMinimo;
                        const markup = product.precioCompra > 0
                          ? Math.round(((product.precioVenta - product.precioCompra) / product.precioCompra) * 100)
                          : 0;
                        return (
                          <tr key={product.id} className="hover:bg-slate-50/50 transition">
                            <td className="py-4 px-2 min-w-[150px]">
                              <div className="font-bold text-base text-slate-800 leading-tight">{product.nombre}</div>
                              <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                                <span className="bg-slate-100 px-2 py-0.5 rounded-full font-semibold">{product.categoria}</span>
                                {product.codigoBarras && (
                                  <span className="flex items-center gap-0.5 font-mono">
                                    <Barcode className="w-3 h-3 text-slate-300" /> {product.codigoBarras}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-4 px-2 font-mono text-sm text-slate-500">
                              ${product.precioCompra.toLocaleString("es-CL")}
                            </td>
                            <td className="py-4 px-2">
                              <span className="font-mono font-bold text-base text-slate-800">${product.precioVenta.toLocaleString("es-CL")}</span>
                              {markup > 0 && (
                                <span className="ml-1.5 text-xs bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">+{markup}%</span>
                              )}
                            </td>
                            <td className="py-4 px-2 text-center">
                              <span className={`font-bold font-mono text-sm px-3 py-1.5 rounded-full ${
                                isLow ? "bg-rose-100 text-rose-800 border border-rose-200 animate-pulse" : "bg-emerald-50 text-emerald-800"
                              }`}>
                                {product.stock} {product.unidadMedida === 'kg' ? 'kg' : 'uds'}
                              </span>
                            </td>
                            <td className="py-4 px-2 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => openBarcodeModal(product)}
                                  className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-700 transition cursor-pointer"
                                  title="Código de barras"
                                >
                                  <Barcode className="w-5 h-5" />
                                </button>
                                <button
                                  onClick={() => {
                                    setShowEditStockModal(product);
                                    setEditForm({
                                      nombre: product.nombre, codigoBarras: product.codigoBarras || "",
                                      categoria: product.categoria, precioCompra: String(product.precioCompra),
                                      precioVenta: String(product.precioVenta), stock: String(product.stock),
                                      stockMinimo: String(product.stockMinimo), unidadMedida: product.unidadMedida,
                                    });
                                  }}
                                  className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 hover:text-yellow-600 transition cursor-pointer"
                                >
                                  <Edit3 className="w-5 h-5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteProduct(product.id)}
                                  className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-rose-600 transition cursor-pointer"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

            </motion.div>
          )}



          {/* TAB 3: SALES HISTORY */}
          {activeTab === "ventas" && (
            <motion.div
              key="ventas-tab"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-slate-200/80 flex flex-col gap-5"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-extrabold text-xl text-slate-800">Historial de Ventas</h2>
                  <p className="text-sm text-slate-400 mt-0.5">{sales.length} boletas registradas</p>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-xs text-slate-400 uppercase font-bold">Total acumulado</span>
                  <span className="text-2xl font-black font-mono text-yellow-700">
                    ${sales.reduce((s, v) => s + v.total, 0).toLocaleString("es-CL")}
                  </span>
                </div>
              </div>

              {/* Filtros de fecha */}
              <div className="flex gap-2 flex-wrap">
                {([
                  { key: "all",       label: "Todas" },
                  { key: "today",     label: "Hoy" },
                  { key: "yesterday", label: "Ayer" },
                  { key: "week",      label: "Esta semana" },
                  { key: "month",     label: "Este mes" },
                ] as const).map(f => (
                  <button
                    key={f.key}
                    onClick={() => setSalesFilter(f.key)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                      salesFilter === f.key
                        ? 'bg-yellow-400 text-slate-900'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {(() => {
                const now = new Date();
                const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
                const filtered = sales.filter(sale => {
                  const d = new Date(sale.fecha);
                  if (salesFilter === "today") return d.toDateString() === now.toDateString();
                  if (salesFilter === "yesterday") return d.toDateString() === yesterday.toDateString();
                  if (salesFilter === "week") {
                    const start = new Date(now); start.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1)); start.setHours(0,0,0,0);
                    return d >= start;
                  }
                  if (salesFilter === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                  return true;
                });
                const filterTotal = filtered.reduce((s, sale) => s + sale.total, 0);
                const filterLabel = { all: "en total", today: "hoy", yesterday: "ayer", week: "esta semana", month: "este mes" }[salesFilter];
                return (
                  <>
                    {salesFilter !== "all" && filtered.length > 0 && (
                      <div className="flex items-center justify-between bg-yellow-50 border border-yellow-200 rounded-2xl px-4 py-3">
                        <div>
                          <p className="text-xs text-yellow-700 font-semibold uppercase tracking-wide">Total vendido {filterLabel}</p>
                          <p className="font-extrabold text-2xl text-slate-800 font-mono">${filterTotal.toLocaleString('es-CL')}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-400 font-semibold">{filtered.length} venta{filtered.length !== 1 ? 's' : ''}</p>
                          <p className="text-xs text-slate-400">{filtered.reduce((s, sale) => s + sale.items.reduce((si, i) => si + i.cantidad, 0), 0)} productos</p>
                        </div>
                      </div>
                    )}
                    {sales.length === 0 ? (
                      <div className="py-16 flex flex-col items-center text-slate-300 gap-3">
                        <Receipt className="w-14 h-14" />
                        <p className="text-base text-slate-400">Aún no hay ventas registradas</p>
                      </div>
                    ) : filtered.length === 0 ? (
                      <div className="py-10 flex flex-col items-center text-slate-300 gap-2">
                        <Receipt className="w-10 h-10" />
                        <p className="text-sm text-slate-400">Sin ventas {filterLabel}</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 max-h-[65vh] overflow-y-auto pr-1">
                        {filtered.map((sale) => {
                    const date = new Date(sale.fecha);
                    const today = new Date();
                    const isToday = date.toDateString() === today.toDateString();
                    const dateLabel = isToday
                      ? `Hoy, ${date.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}`
                      : date.toLocaleDateString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

                    const metodoPagoColor: Record<string, string> = {
                      Efectivo: "bg-yellow-100 text-yellow-800",
                      Débito: "bg-blue-100 text-blue-800",
                      Crédito: "bg-purple-100 text-purple-800",
                      Transferencia: "bg-amber-100 text-amber-800",
                    };

                    return (
                      <div key={sale.id} className="bg-slate-50 border border-slate-200/70 p-4 rounded-2xl hover:bg-slate-100/60 transition">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
                            <span className="text-sm text-slate-500 font-medium">{dateLabel}</span>
                            <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full shrink-0 ${metodoPagoColor[sale.metodoPago] || "bg-slate-100 text-slate-600"}`}>
                              {sale.metodoPago}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-black font-mono text-slate-800 text-lg">${sale.total.toLocaleString("es-CL")}</span>
                            <button
                              onClick={() => printReceipt(sale)}
                              className="p-1.5 rounded-xl text-slate-400 hover:text-yellow-600 hover:bg-yellow-50 transition cursor-pointer"
                              title="Imprimir boleta"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteSale(sale.id)}
                              className="p-1.5 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <ul className="space-y-1">
                          {sale.items.map((item, i) => (
                            <li key={i} className="text-sm text-slate-600 flex items-center gap-1.5">
                              <span className="font-bold text-slate-800 font-mono">{item.cantidad}×</span>
                              <span className="truncate">{item.nombre}</span>
                              <span className="text-slate-400 shrink-0 ml-auto font-mono">${item.subtotal.toLocaleString("es-CL")}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                        );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
            </motion.div>
          )}

          {/* TAB 4: METRICS & CHARTS */}
          {activeTab === "reportes" && (
            <motion.div
              key="reportes-tab"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col gap-4"
            >

              {/* 1. HÉROE — Resumen de hoy */}
              <div className="bg-slate-900 rounded-3xl p-6 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-slate-400 text-base font-semibold capitalize">
                      {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                    <p className="text-5xl font-black font-mono mt-2 leading-none text-yellow-400">
                      ${todaySalesSum.toLocaleString('es-CL')}
                    </p>
                    <p className="text-slate-400 text-base mt-3">
                      {todaySales.length === 0
                        ? 'Sin ventas hoy todavía'
                        : `${todaySales.length} venta${todaySales.length !== 1 ? 's' : ''} · ganancia est. $${estimatedProfitToday.toLocaleString('es-CL')}`}
                    </p>
                  </div>
                  <button
                    onClick={handleShareDailySummary}
                    disabled={todaySales.length === 0}
                    className="flex items-center gap-1.5 py-2 px-3 bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-bold text-xs rounded-xl transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Compartir</span>
                  </button>
                </div>

                {/* Comparación vs ayer */}
                <div className="mt-5 bg-white/5 rounded-2xl px-5 py-4 flex items-center gap-4">
                  {todayVsYesterdayPct !== null ? (
                    <>
                      <span className="text-3xl">{todayVsYesterdayPct >= 0 ? '↑' : '↓'}</span>
                      <div>
                        <p className="font-extrabold text-lg">
                          {todayVsYesterdayPct >= 0
                            ? `${todayVsYesterdayPct}% más que ayer`
                            : `${Math.abs(todayVsYesterdayPct)}% menos que ayer`}
                        </p>
                        <p className="text-slate-400 text-sm mt-0.5">
                          Ayer: ${yesterdaySalesSum.toLocaleString('es-CL')} · diferencia: {todayVsYesterdayDiff >= 0 ? '+' : ''}${todayVsYesterdayDiff.toLocaleString('es-CL')}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="text-3xl">📊</span>
                      <p className="text-base text-slate-400 font-medium">
                        {todaySalesSum > 0 ? 'Aún no hay datos de ayer para comparar.' : 'Registra tu primera venta del día.'}
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* 2. TOP PRODUCTOS — Hoy y esta semana lado a lado */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Hoy */}
                <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6 flex flex-col gap-5">
                  <div>
                    <h3 className="font-extrabold text-xl text-slate-800">⭐ Más vendido hoy</h3>
                    <p className="text-sm text-slate-400 mt-0.5">Lo que más salió hoy</p>
                  </div>
                  {topProductsToday.length === 0 ? (
                    <p className="text-base text-slate-400 py-2">Sin ventas hoy todavía.</p>
                  ) : (
                    <div className="flex flex-col gap-5">
                      {topProductsToday.map((p, i) => {
                        const maxQ = topProductsToday[0].cantidad;
                        const medals = ['🥇', '🥈', '🥉'];
                        return (
                          <div key={p.nombre} className="flex items-center gap-4">
                            <span className="text-2xl shrink-0">{medals[i] ?? `${i + 1}`}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-baseline gap-2 mb-2">
                                <span className="font-bold text-slate-800 text-base leading-tight truncate">{p.nombre}</span>
                                <span className="text-base font-black text-yellow-700 font-mono shrink-0">{p.cantidad} uds</span>
                              </div>
                              <div className="w-full bg-slate-100 h-3 rounded-full">
                                <div
                                  className="bg-yellow-400 h-full rounded-full transition-all duration-500"
                                  style={{ width: `${Math.round((p.cantidad / maxQ) * 100)}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Esta semana */}
                <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6 flex flex-col gap-5">
                  <div>
                    <h3 className="font-extrabold text-xl text-slate-800">🏆 Más vendido esta semana</h3>
                    <p className="text-sm text-slate-400 mt-0.5">Acumulado de la semana</p>
                  </div>
                  {topProducts.length === 0 ? (
                    <p className="text-base text-slate-400 py-2">Aún no hay ventas esta semana.</p>
                  ) : (
                    <div className="flex flex-col gap-5">
                      {topProducts.map((p, i) => {
                        const maxQ = topProducts[0].cantidad;
                        const medals = ['🥇', '🥈', '🥉'];
                        return (
                          <div key={p.nombre} className="flex items-center gap-4">
                            <span className="text-2xl shrink-0">{medals[i] ?? `${i + 1}`}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-baseline gap-2 mb-2">
                                <span className="font-bold text-slate-800 text-base leading-tight truncate">{p.nombre}</span>
                                <span className="text-base font-black text-yellow-700 font-mono shrink-0">{p.cantidad} uds</span>
                              </div>
                              <div className="w-full bg-slate-100 h-3 rounded-full">
                                <div
                                  className="bg-yellow-400 h-full rounded-full transition-all duration-500"
                                  style={{ width: `${Math.round((p.cantidad / maxQ) * 100)}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

              </div>

              {/* 3. REPOSICIÓN — Productos bajo el mínimo */}
              {lowStockProducts.length > 0 && (
                <div className="bg-amber-50 border-2 border-amber-200 rounded-3xl p-6 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">⚠️</span>
                    <div>
                      <h3 className="font-extrabold text-xl text-amber-900">Necesita reposición</h3>
                      <p className="text-sm text-amber-600">{lowStockProducts.length} producto{lowStockProducts.length !== 1 ? 's' : ''} bajo el mínimo</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {lowStockProducts.map(p => (
                      <div key={p.id} className="flex items-center justify-between bg-white rounded-2xl px-5 py-4">
                        <span className="font-bold text-base text-amber-900 truncate pr-4">{p.nombre}</span>
                        <div className="text-right shrink-0">
                          <span className="font-mono font-black text-red-600 text-xl">{p.stock}</span>
                          <span className="text-amber-500 text-sm"> / {p.stockMinimo} mín</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. GRÁFICO — Ventas de la semana (abajo) */}
              <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6 flex flex-col gap-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-extrabold text-xl text-slate-800">Esta semana</h3>
                    <p className="text-sm text-slate-400 mt-1">
                      {weekChangePct !== null
                        ? (weekChangePct >= 0
                            ? `↑ ${weekChangePct}% más que la semana pasada`
                            : `↓ ${Math.abs(weekChangePct)}% menos que la semana pasada`)
                        : (thisWeekTotal > 0 ? 'Sin datos de la semana pasada aún' : 'Sin ventas esta semana')}
                    </p>
                  </div>
                  <span className="text-2xl font-black font-mono text-yellow-700 shrink-0">
                    ${thisWeekTotal.toLocaleString('es-CL')}
                  </span>
                </div>

                {/* Barras por día — más altas y con números más grandes */}
                <div className="flex items-end gap-2" style={{ height: 140 }}>
                  {dayNames.map((day, i) => {
                    const h = Math.round((thisWeekByDay[i] / maxDayValue) * 100);
                    const isToday = i === toDayIdx(new Date());
                    return (
                      <div key={day} className="flex-1 flex flex-col items-center gap-2">
                        {thisWeekByDay[i] > 0 && (
                          <span className="text-xs font-bold text-slate-500 font-mono">
                            ${(thisWeekByDay[i] / 1000).toFixed(0)}k
                          </span>
                        )}
                        <div className="w-full flex items-end flex-1">
                          <div
                            className={`w-full rounded-t-xl transition-all duration-500 ${isToday ? 'bg-yellow-500' : 'bg-yellow-200'}`}
                            style={{ height: `${Math.max(h, thisWeekByDay[i] > 0 ? 6 : 0)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-bold ${isToday ? 'text-yellow-600' : 'text-slate-400'}`}>{day}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-400">
                  <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-yellow-500" /><span>Hoy</span></div>
                  <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-yellow-200" /><span>Otros días</span></div>
                </div>
              </div>

            </motion.div>
          )}

        </section>

      </main>

      {/* Mobile sticky cart bar — visible only on mobile when cart has items in Caja tab */}
      {cart.length > 0 && activeTab === "caja" && (
        <div className="fixed bottom-0 left-0 right-0 z-40 md:hidden animate-fade-in">
          <div className="mx-3 mb-3 bg-slate-900 rounded-2xl shadow-2xl overflow-hidden">
            {/* Payment method pills */}
            <div className="flex gap-1.5 px-4 pt-3 pb-2">
              {(["Efectivo", "Débito", "Crédito", "Transferencia"] as const).map((met) => (
                <button
                  key={met}
                  onClick={() => setPaymentMethod(met)}
                  className={`flex-1 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                    paymentMethod === met
                      ? "bg-yellow-400 text-slate-900"
                      : "bg-slate-700 text-slate-400"
                  }`}
                >
                  {met === "Efectivo" ? "💵" : met === "Débito" ? "💳 Déb." : met === "Crédito" ? "💳 Cré." : "📲"}
                  {met === "Efectivo" ? " Efectivo" : ""}
                </button>
              ))}
            </div>
            {/* Total + cobrar */}
            <div className="flex items-center justify-between px-4 pb-4 pt-1 gap-3">
              <div>
                <div className="text-slate-400 text-xs font-semibold">
                  {cart.reduce((s, i) => s + i.cantidad, 0)} ítem{cart.reduce((s, i) => s + i.cantidad, 0) !== 1 ? "s" : ""}
                </div>
                <div className="text-white font-extrabold text-2xl font-mono leading-tight">
                  ${cartTotal.toLocaleString("es-CL")}
                </div>
              </div>
              <button
                onClick={checkoutSale}
                className="bg-yellow-400 text-slate-900 font-extrabold px-6 py-3.5 rounded-xl text-base flex items-center gap-2 shrink-0 active:scale-95 transition cursor-pointer shadow-lg"
              >
                <CheckCircle className="w-5 h-5" />
                Cobrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom navigation bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-white border-t border-slate-200/80 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <div className="flex items-stretch pb-safe">
          {([
            { key: "caja",       label: "Caja",     Icon: ShoppingCart },
            { key: "inventario", label: "Stock",    Icon: Barcode },
            { key: "ventas",     label: "Ventas",   Icon: Receipt },
            { key: "reportes",   label: "Reportes", Icon: TrendingUp },
          ] as const).map(({ key, label, Icon }) => {
            const isActive = activeTab === key;
            const lowStockCount = key === "inventario" ? products.filter(p => p.stock <= p.stockMinimo).length : 0;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-3 relative transition cursor-pointer ${
                  isActive ? "text-yellow-600" : "text-slate-400"
                }`}
              >
                {isActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-yellow-400 rounded-full" />
                )}
                <Icon className={`w-5 h-5 ${isActive ? "text-yellow-500" : "text-slate-400"}`} />
                <span className={`text-[10px] font-bold ${isActive ? "text-yellow-600" : "text-slate-400"}`}>{label}</span>
                {lowStockCount > 0 && (
                  <span className="absolute top-2 right-[22%] bg-amber-500 text-white rounded-full text-[8px] w-3.5 h-3.5 flex items-center justify-center font-bold">
                    {lowStockCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile sticky post-sale bar — print button after checkout */}
      {lastSale && cart.length === 0 && activeTab === "caja" && (
        <div className="fixed bottom-0 left-0 right-0 z-40 md:hidden animate-fade-in">
          <div className="mx-3 mb-3 bg-slate-900 rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-white font-bold text-sm">Venta completada</p>
                  <p className="text-slate-400 text-xs">${lastSale.total.toLocaleString('es-CL')} · {lastSale.metodoPago}</p>
                </div>
              </div>
              <button
                onClick={() => printReceipt(lastSale)}
                className="bg-yellow-400 text-slate-900 font-bold px-4 py-2.5 rounded-xl text-sm flex items-center gap-2 shrink-0 active:scale-95 transition cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                Boleta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      {/* --- MODAL DIALOGS --- */}


      {/* Modal alerta stock bajo */}
      {lowStockAlert.length > 0 && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
            {/* Header rojo */}
            <div className="bg-rose-600 px-6 pt-6 pb-8 flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mb-3">
                <span className="text-4xl">⚠️</span>
              </div>
              <h2 className="text-white font-extrabold text-xl leading-tight">
                {lowStockAlert.length === 1 ? '¡Queda poco stock!' : `¡${lowStockAlert.length} productos con stock bajo!`}
              </h2>
              <p className="text-rose-200 text-sm mt-1">Considera reabastecer pronto</p>
            </div>

            {/* Lista de productos */}
            <div className="-mt-4 mx-4 bg-white rounded-2xl shadow-md border border-rose-100 overflow-hidden">
              {lowStockAlert.map((p, i) => (
                <div key={i} className={`flex items-center justify-between px-4 py-3 ${i < lowStockAlert.length - 1 ? 'border-b border-slate-100' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-800 text-sm truncate">{p.nombre}</p>
                    <p className="text-xs text-slate-400">Mínimo: {p.stockMinimo} {p.unidadMedida}</p>
                  </div>
                  <div className={`shrink-0 ml-3 px-3 py-1.5 rounded-xl font-extrabold font-mono text-sm ${
                    p.stock === 0 ? 'bg-rose-100 text-rose-700' : 'bg-orange-100 text-orange-700'
                  }`}>
                    {p.stock === 0 ? 'Sin stock' : `${p.stock} ${p.unidadMedida}`}
                  </div>
                </div>
              ))}
            </div>

            {/* Botón */}
            <div className="p-4 mt-2">
              <button
                onClick={() => setLowStockAlert([])}
                className="w-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-extrabold py-3.5 rounded-2xl transition cursor-pointer text-base"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: ADD PRODUCT */}
      {showAddProductModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl flex flex-col gap-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <h3 className="font-extrabold text-base text-slate-800 font-sans">Agregar Nuevo Producto</h3>
              <button onClick={() => setShowAddProductModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddProduct} className="flex flex-col gap-3 text-xs">
              <div>
                <label className="block text-slate-500 font-bold mb-1 font-sans">Nombre del Producto *</label>
                <input
                  type="text"
                  required
                  value={newProduct.nombre}
                  onChange={(e) => setNewProduct({ ...newProduct, nombre: e.target.value })}
                  placeholder=""
                  className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-bold mb-1 font-sans">Categoría</label>
                <select
                  value={newProduct.categoria}
                  onChange={(e) => setNewProduct({ ...newProduct, categoria: e.target.value })}
                  className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200"
                >
                  {allCategories.filter(c => c !== "Todos").map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-500 font-bold mb-1 font-sans">Código de Barras</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newProduct.codigoBarras}
                    onChange={(e) => setNewProduct({ ...newProduct, codigoBarras: e.target.value })}
                    placeholder="Escanear o tipear"
                    className="flex-1 bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const code = "CG" + String(Math.floor(100000000000 + Math.random() * 900000000000));
                      setNewProduct(prev => ({ ...prev, codigoBarras: code }));
                    }}
                    className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-lg border border-slate-200 transition cursor-pointer shrink-0"
                  >
                    Auto
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-500 font-bold mb-1 font-sans font-mono text-rose-800">Precio Compra</label>
                  <input
                    type="number"
                    value={newProduct.precioCompra}
                    onChange={(e) => setNewProduct({ ...newProduct, precioCompra: e.target.value })}
                    placeholder="Valor"
                    className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1 font-sans">Precio Venta *</label>
                  <input
                    type="number"
                    required
                    value={newProduct.precioVenta}
                    onChange={(e) => setNewProduct({ ...newProduct, precioVenta: e.target.value })}
                    placeholder="Valor"
                    className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-500 font-bold mb-1 font-sans">U. Medida</label>
                  <div className="w-full bg-slate-100 p-2.5 rounded-lg border border-slate-200 text-slate-500 text-sm font-semibold">
                    unidades
                  </div>
                </div>
                <div>
                  <label className="block text-slate-500 font-bold mb-1 font-sans">Stock Inicial</label>
                  <input
                    type="number"
                    value={newProduct.stock}
                    onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                    className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-bold mb-1 font-sans">Mínimo Alerta</label>
                  <input
                    type="number"
                    value={newProduct.stockMinimo}
                    onChange={(e) => setNewProduct({ ...newProduct, stockMinimo: e.target.value })}
                    className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-yellow-400 hover:bg-yellow-300 text-white font-bold py-3 mt-4 rounded-xl cursor-pointer"
              >
                Guardar Producto
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CONFIRMACIÓN (reemplaza confirm() nativo del browser) */}
      <AnimatePresence>
        {confirmModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-xs flex flex-col gap-5"
            >
              <div className="flex items-center gap-3">
                <div className="bg-red-100 p-3 rounded-2xl shrink-0">
                  <Trash2 className="w-5 h-5 text-red-500" />
                </div>
                <p className="text-slate-800 font-bold text-sm leading-snug">{confirmModal.message}</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmModal(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => { await confirmModal.onConfirm(); setConfirmModal(null); }}
                  className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 transition cursor-pointer"
                >
                  Eliminar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL 1.5: ADD PRODUCT VIA AI PHOTO SCANNER */}
      {showAiPhotoModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <div className="flex items-center gap-1.5 text-slate-800">
                <Barcode className="w-5 h-5 text-yellow-600" />
                <h3 className="font-extrabold text-base text-slate-800 font-sans">Registrar con Código de Barras</h3>
              </div>
              <button
                onClick={() => {
                  setShowAiPhotoModal(false);
                  setAiPhotoPreview(null);
                  setAiAnalyzedProduct(null);
                  setAiInventoryMatch(null);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step 1: No Photo Loaded */}
            {!aiPhotoPreview && (
              <div className="flex flex-col gap-4">
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-800 leading-relaxed flex gap-2">
                  <span className="shrink-0 mt-0.5">📸</span>
                  <span><strong>Consejo:</strong> Enfoca solo el código de barras (líneas negras). Que ocupe la mayor parte de la foto. Buena luz, sin reflejo ni sombra.</span>
                </div>
                <label className="border-2 border-dashed border-slate-300 rounded-3xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-yellow-400 hover:bg-yellow-50/20 transition duration-200">
                  <div className="bg-yellow-50 text-yellow-600 p-4 rounded-full">
                    <Camera className="w-8 h-8" />
                  </div>
                  <div className="text-center">
                    <span className="font-bold text-slate-700 block text-sm">Fotografiar Código de Barras</span>
                    <span className="text-slate-400 text-[10px] block mt-1">Acerca la cámara hasta que el código llene la pantalla</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                <label className="border border-slate-200 rounded-2xl p-3 flex items-center justify-center gap-2 cursor-pointer hover:bg-slate-50 transition">
                  <Upload className="w-4 h-4 text-slate-400" />
                  <span className="text-xs text-slate-500 font-medium">O elige una foto de la galería</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            {/* Step 2: Photo Loaded but not yet analyzed */}
            {aiPhotoPreview && !aiAnalyzedProduct && !aiInventoryMatch && !isAnalyzingPhoto && (
              <div className="flex flex-col gap-4">
                <div className="relative rounded-2xl overflow-hidden border border-slate-100 max-h-[220px]">
                  <img src={aiPhotoPreview} alt="Preview" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setAiPhotoPreview(null)}
                    className="absolute top-2 right-2 bg-slate-900/70 text-white p-1.5 rounded-full hover:bg-slate-900 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setAiPhotoPreview(null)}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl"
                  >
                    Cambiar Foto
                  </button>
                  <button
                    onClick={handleAnalyzePhoto}
                    className="flex-1 py-2.5 bg-yellow-400 hover:bg-yellow-300 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1 shadow-md shadow-indigo-100"
                  >
                    <Barcode className="w-4 h-4" />
                    <span>Escanear código de barras</span>
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Analyzing photo */}
            {isAnalyzingPhoto && (
              <div className="flex flex-col items-center justify-center py-10 px-4 gap-4 text-center">
                <div className="relative">
                  <div className="w-12 h-12 border-4 border-yellow-200 border-t-yellow-500 rounded-full animate-spin"></div>
                  <Sparkles className="w-5 h-5 text-yellow-500 absolute top-3.5 left-3.5 animate-pulse" />
                </div>
                <div>
                  <span className="font-sans font-extrabold text-slate-800 text-sm block">Detectando código de barras...</span>
                  <span className="text-xs text-slate-400 font-sans block mt-1.5 max-w-xs leading-relaxed">
                    Escaneando la imagen y buscando el producto en la base de datos global de productos.
                  </span>
                </div>
              </div>
            )}

            {/* Step 4: Analyzed Results & Price Inputs */}
            {/* Step 3A: Producto ya existe en inventario */}
            {aiInventoryMatch && !isAnalyzingPhoto && (
              <div className="flex flex-col gap-4">
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
                      <CheckCircle className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="font-bold text-amber-800 text-sm">Este producto ya está en tu stock</p>
                      <p className="text-amber-600 text-xs">No es necesario registrarlo de nuevo.</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-amber-100 p-3 flex flex-col gap-2">
                    <p className="font-bold text-slate-800 text-sm">{aiInventoryMatch.nombre}</p>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-slate-400 block font-semibold uppercase text-[10px]">Stock actual</span>
                        <span className={`font-bold font-mono ${aiInventoryMatch.stock <= aiInventoryMatch.stockMinimo ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {aiInventoryMatch.stock} {aiInventoryMatch.unidadMedida}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-semibold uppercase text-[10px]">Precio venta</span>
                        <span className="font-bold font-mono text-slate-700">${aiInventoryMatch.precioVenta.toLocaleString('es-CL')}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-semibold uppercase text-[10px]">Categoría</span>
                        <span className="font-bold text-slate-700">{aiInventoryMatch.categoria}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setAiInventoryMatch(null); setAiPhotoPreview(null); }}
                    className="flex-1 border border-slate-200 text-slate-600 font-bold py-2.5 rounded-xl text-sm hover:bg-slate-50 transition cursor-pointer"
                  >
                    Escanear otro
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAiPhotoModal(false); setAiPhotoPreview(null); setAiInventoryMatch(null); setActiveTab('inventario'); }}
                    className="flex-1 bg-yellow-400 hover:bg-yellow-300 text-white font-bold py-2.5 rounded-xl text-sm transition cursor-pointer"
                  >
                    Ver en inventario
                  </button>
                </div>
              </div>
            )}

            {/* Step 3B: Producto nuevo identificado — formulario para agregar */}
            {aiAnalyzedProduct && !isAnalyzingPhoto && (
              <form onSubmit={handleSaveAiAnalyzedProduct} className="flex flex-col gap-3 text-xs">
                {/* Visual Image Preview small */}
                <div className="flex gap-3 bg-slate-50 p-3 rounded-2xl items-center border border-slate-100">
                  {aiPhotoPreview && (
                    <img src={aiPhotoPreview} alt="Target" className="w-14 h-14 object-cover rounded-xl border border-slate-200" />
                  )}
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full uppercase">Identificado</span>
                    <h4 className="font-bold text-slate-800 text-xs truncate mt-1">{aiAnalyzedProduct.nombre}</h4>
                    <p className="text-[10px] text-slate-400 truncate leading-tight">{aiAnalyzedProduct.descripcion}</p>
                  </div>
                </div>

                {/* Characterics recap */}
                <div className="grid grid-cols-2 gap-2 bg-yellow-50/30 p-3 rounded-xl border border-yellow-100/40">
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold block uppercase">Categoría</span>
                    <span className="font-bold text-slate-800 text-xs">{aiAnalyzedProduct.categoria}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold block uppercase">U. Medida</span>
                    <span className="font-bold text-slate-800 text-xs">{aiAnalyzedProduct.unidadMedida}</span>
                  </div>
                  <div className="col-span-2 pt-1.5 border-t border-yellow-100/30 flex items-center gap-1.5">
                    <Barcode className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <span className="text-[9px] text-slate-400 font-semibold block uppercase leading-none">Código Barras</span>
                      <span className="font-mono text-xs font-bold text-slate-700">{aiAnalyzedProduct.codigoBarras || "No se detectó"}</span>
                    </div>
                  </div>
                </div>

                {/* Confirm characteristics in fields or let user tune if they wish */}
                <div className="space-y-1.5 mt-1 border-t border-slate-100 pt-2">
                  <div>
                    <label className="block text-slate-500 font-bold font-sans">Ajustar Nombre del Producto (Opcional)</label>
                    <input
                      type="text"
                      required
                      value={aiAnalyzedProduct.nombre}
                      onChange={(e) => setAiAnalyzedProduct({ ...aiAnalyzedProduct, nombre: e.target.value })}
                      className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-500 font-bold font-sans">Código de Barras Reclasificado (Opcional)</label>
                    <input
                      type="text"
                      value={aiAnalyzedProduct.codigoBarras}
                      onChange={(e) => setAiAnalyzedProduct({ ...aiAnalyzedProduct, codigoBarras: e.target.value })}
                      className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono"
                    />
                  </div>
                </div>

                {/* User price inputs */}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1 font-sans">Precio de Venta ($Público) *</label>
                    <input
                      type="number"
                      required
                      autoFocus
                      value={aiProductPriceVenta}
                      onChange={(e) => setAiProductPriceVenta(e.target.value)}
                      placeholder="Monto de venta"
                      className="w-full bg-slate-50 p-3 rounded-lg border-2 border-yellow-500 focus:ring-0 focus:outline-none font-mono font-bold text-slate-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 font-bold mb-1 font-sans font-mono text-rose-850">Precio de Compra ($Coste)</label>
                    <input
                      type="number"
                      value={aiProductPriceCompra}
                      onChange={(e) => setAiProductPriceCompra(e.target.value)}
                      placeholder="Monto de costo"
                      className="w-full bg-slate-50 p-3 rounded-lg border border-slate-200 focus:outline-none font-mono text-sm text-slate-700"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-500 font-bold mb-1 font-sans">Stock Inicial</label>
                    <input
                      type="number"
                      value={aiProductStock}
                      onChange={(e) => setAiProductStock(e.target.value)}
                      className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 font-bold mb-1 font-sans">Mínimo Alerta</label>
                    <input
                      type="number"
                      value={aiProductStockMin}
                      onChange={(e) => setAiProductStockMin(e.target.value)}
                      className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono"
                    />
                  </div>
                </div>

                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setAiAnalyzedProduct(null);
                    }}
                    className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl"
                  >
                    Atrás
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-extrabold py-3 rounded-xl shadow-md transition"
                  >
                    💾 Guardar en Inventario
                  </button>
                </div>
              </form>
            )}

          </div>
        </div>
      )}

      {/* MODAL 2: EDIT PRODUCT */}
      {showEditStockModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <h3 className="font-extrabold text-base text-slate-800 font-sans">Editar Producto</h3>
              <button onClick={() => setShowEditStockModal(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditProduct} className="flex flex-col gap-3 text-xs">
              <div>
                <label className="block text-slate-500 font-bold mb-1 font-sans">Nombre del Producto *</label>
                <input
                  type="text"
                  required
                  value={editForm.nombre}
                  onChange={e => setEditForm({ ...editForm, nombre: e.target.value })}
                  className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-500 font-bold mb-1 font-sans">Categoría</label>
                  <select
                    value={editForm.categoria}
                    onChange={e => setEditForm({ ...editForm, categoria: e.target.value })}
                    className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 focus:outline-none"
                  >
                    {allCategories.filter(c => c !== "Todos").map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-500 font-bold mb-1 font-sans">Código de Barras</label>
                  <input
                    type="text"
                    value={editForm.codigoBarras}
                    onChange={e => setEditForm({ ...editForm, codigoBarras: e.target.value })}
                    placeholder="Opcional"
                    className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-500 font-bold mb-1 font-sans text-rose-800">Precio Compra ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.precioCompra}
                    onChange={e => setEditForm({ ...editForm, precioCompra: e.target.value })}
                    className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-bold mb-1 font-sans">Precio Venta ($) *</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editForm.precioVenta}
                    onChange={e => setEditForm({ ...editForm, precioVenta: e.target.value })}
                    className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono font-bold focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-500 font-bold mb-1 font-sans">U. Medida</label>
                  <div className="w-full bg-slate-100 p-2.5 rounded-lg border border-slate-200 text-slate-500 text-sm font-semibold">
                    unidades
                  </div>
                </div>
                <div>
                  <label className="block text-slate-500 font-bold mb-1 font-sans">Stock</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.stock}
                    onChange={e => setEditForm({ ...editForm, stock: e.target.value })}
                    className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-bold mb-1 font-sans">Mín. Alerta</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.stockMinimo}
                    onChange={e => setEditForm({ ...editForm, stockMinimo: e.target.value })}
                    className="w-full bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowEditStockModal(null)}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 cursor-pointer transition text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-yellow-400 hover:bg-yellow-300 text-white font-bold rounded-xl cursor-pointer transition text-xs"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* MODAL: SCANNER DE CÁMARA EN TIEMPO REAL */}
      {showLiveScanner && (
        <div className="fixed inset-0 z-[80] bg-black flex flex-col">
          {/* Barra superior */}
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-4 bg-gradient-to-b from-black/80 to-transparent">
            <div className="flex items-center gap-2 text-white">
              <Camera className="w-5 h-5 text-white" />
              <span className="font-bold text-sm">Escanear producto</span>
            </div>
            <button
              onClick={() => setShowLiveScanner(false)}
              className="w-9 h-9 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Video en tiempo real */}
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            playsInline
            muted
          />

          {/* Overlay con retícula */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="absolute inset-0 bg-black/45" />
            <div className="relative w-72 h-36 z-10">
              {/* Esquinas del visor */}
              <div className="absolute top-0 left-0 w-7 h-7 border-t-2 border-l-2 border-white rounded-tl" />
              <div className="absolute top-0 right-0 w-7 h-7 border-t-2 border-r-2 border-white rounded-tr" />
              <div className="absolute bottom-0 left-0 w-7 h-7 border-b-2 border-l-2 border-white rounded-bl" />
              <div className="absolute bottom-0 right-0 w-7 h-7 border-b-2 border-r-2 border-white rounded-br" />
              {/* Línea de escaneo animada */}
              <div className="animate-scan-line absolute left-1 right-1 h-0.5 bg-yellow-400 shadow-[0_0_6px_2px_rgba(250,204,21,0.8)]" />
            </div>
          </div>

          {/* Barra inferior */}
          <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col items-center gap-3 px-6 py-6 bg-gradient-to-t from-black/80 to-transparent">
            <p className="text-white/70 text-xs text-center">
              Apunta la cámara al código de barras del producto
            </p>
            {cart.length > 0 && (
              <div className="bg-slate-900/80 backdrop-blur-sm text-yellow-400 text-xs font-bold px-4 py-1.5 rounded-full">
                {cart.length} producto{cart.length !== 1 ? 's' : ''} en el carrito
              </div>
            )}
            <button
              onClick={() => setShowLiveScanner(false)}
              className="pointer-events-auto mt-1 py-2.5 px-8 bg-white/15 hover:bg-white/25 text-white font-bold text-sm rounded-2xl border border-white/20 transition cursor-pointer backdrop-blur-sm"
            >
              Cerrar escáner
            </button>
          </div>
        </div>
      )}

      {/* Modal: Registrar cuenta desde sesión anónima */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-500" />
                <h2 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Protege tus datos</h2>
              </div>
              <button onClick={() => setShowUpgradeModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-500 dark:text-slate-400">
              Crea una cuenta con tu email y contraseña. Todos tus productos y ventas actuales quedan guardados.
            </p>

            <form onSubmit={handleUpgrade} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5 block">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    value={upgradeEmail}
                    onChange={e => setUpgradeEmail(e.target.value)}
                    required
                    placeholder="tu@email.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 transition"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5 block">Contraseña</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                  <input
                    type={upgradeShowPassword ? 'text' : 'password'}
                    value={upgradePassword}
                    onChange={e => setUpgradePassword(e.target.value)}
                    required
                    placeholder="Mínimo 6 caracteres"
                    className="w-full pl-10 pr-10 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setUpgradeShowPassword(s => !s)}
                    className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {upgradeShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={upgradeLoading}
                className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-slate-900 font-bold py-3 rounded-xl transition cursor-pointer"
              >
                {upgradeLoading ? 'Guardando...' : 'Crear cuenta y conservar datos'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Alertas de stock */}
      {showAlertModal && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-yellow-500" />
                <h2 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Alertas de stock</h2>
              </div>
              <button onClick={() => setShowAlertModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Cómo funciona */}
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-3 bg-slate-50 dark:bg-slate-700/50 rounded-2xl px-4 py-3">
                <span className="text-xl mt-0.5">🔔</span>
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Notificación del navegador</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Aparece al instante en tu pantalla cuando se registra una venta que baja un producto al mínimo.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-slate-50 dark:bg-slate-700/50 rounded-2xl px-4 py-3">
                <span className="text-xl mt-0.5">📧</span>
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Email a <span className="text-yellow-600">{user?.email}</span></p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Sale desde tu backend de Supabase. Requiere un paso de configuración abajo.</p>
                </div>
              </div>
            </div>

            {/* Toggle principal */}
            <button
              onClick={async () => {
                const next = !alertsEnabled;
                if (next) {
                  const granted = await requestNotificationPermission();
                  if (!granted) { notify('Activa los permisos de notificación en tu navegador', 'error'); return; }
                }
                setAlertsEnabled(next);
                localStorage.setItem('alerts_enabled', String(next));
              }}
              className={`flex items-center gap-3 px-4 py-4 rounded-2xl border-2 transition cursor-pointer ${alertsEnabled ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 bg-slate-50 dark:bg-slate-700 text-slate-500'}`}
            >
              {alertsEnabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
              <div className="text-left">
                <p className="font-bold text-sm">{alertsEnabled ? 'Alertas activadas' : 'Alertas desactivadas'}</p>
                <p className="text-xs opacity-70">{alertsEnabled ? 'Recibirás notificación + email al bajar el stock' : 'Toca para activar'}</p>
              </div>
            </button>

            {/* Instrucciones email */}
            <div className="border border-slate-200 dark:border-slate-600 rounded-2xl p-4 flex flex-col gap-3">
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Configurar email — solo una vez</p>
              <ol className="text-xs text-slate-500 dark:text-slate-400 flex flex-col gap-2 list-decimal list-inside leading-relaxed">
                <li>Crea cuenta gratis en <span className="font-bold text-yellow-600">resend.com</span></li>
                <li>Ve a <span className="font-bold">API Keys</span> → crea una clave</li>
                <li>En tu proyecto de Supabase → <span className="font-bold">Edge Functions → Secrets</span> → agrega: <span className="font-mono bg-slate-100 dark:bg-slate-600 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-200">RESEND_API_KEY = tu_clave</span></li>
                <li>Desde la terminal del proyecto ejecuta: <span className="font-mono bg-slate-100 dark:bg-slate-600 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-200">npx supabase functions deploy send-stock-alert</span></li>
              </ol>
            </div>

            {/* Botón probar */}
            <button
              onClick={async () => {
                if (!alertsEnabled) { notify('Activa las alertas primero', 'error'); return; }
                setAlertTestLoading(true);
                const testProducts = [{ nombre: 'Producto de prueba', stock: 2, stockMinimo: 5, unidadMedida: 'unidades' }];
                // Notificación del navegador
                if (Notification.permission === 'granted') {
                  new Notification('⚠️ Stock bajo (prueba)', { body: 'Producto de prueba: 2 unidades (mín. 5)', icon: '/favicon.ico' });
                }
                // Email
                const { error } = await supabase.functions.invoke('send-stock-alert', {
                  body: { email: user?.email, products: testProducts, date: new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }) },
                });
                if (error) notify('Notificación enviada. Email: revisa la configuración de Supabase', 'info');
                else notify('¡Prueba enviada! Revisa tu email y notificaciones', 'success');
                setAlertTestLoading(false);
              }}
              disabled={alertTestLoading}
              className="w-full py-3 border-2 border-yellow-400 text-yellow-700 dark:text-yellow-400 font-bold rounded-xl hover:bg-yellow-50 dark:hover:bg-yellow-900/20 transition cursor-pointer disabled:opacity-50 text-sm"
            >
              {alertTestLoading ? 'Enviando prueba...' : 'Enviar prueba'}
            </button>
          </div>
        </div>
      )}

      {/* Tour guiado */}
      {tourRunning && <Joyride
        steps={tourSteps}
        run={tourRunning}
        stepIndex={tourStep}
        continuous
        onEvent={handleTourCallback}
        locale={{
          back: 'Anterior',
          close: 'Cerrar',
          last: '¡Listo!',
          next: 'Siguiente',
          nextWithProgress: 'Siguiente ({current} de {total})',
          skip: 'Salir del tour',
        }}
        options={{
          showProgress: true,
          overlayClickAction: false,
          buttons: ['back', 'close', 'primary', 'skip'],
          zIndex: 10000,
          primaryColor: '#facc15',
          textColor: '#1e293b',
        }}
        styles={{
          buttonPrimary: {
            backgroundColor: '#facc15',
            color: '#1e293b',
            fontWeight: 700,
          },
          buttonBack: {
            color: '#64748b',
            fontWeight: 600,
          },
          tooltipTitle: {
            fontSize: '1rem',
            fontWeight: 800,
            color: '#1e293b',
          },
          tooltipContent: {
            fontSize: '0.9rem',
            color: '#475569',
            padding: '8px 0 0',
          },
          tooltip: {
            borderRadius: 16,
            padding: '20px 24px',
          },
        }}
      />}


      {/* Modal: Gestionar categorías */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4 max-h-[85vh]">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-lg">Categorías</h2>
              <button onClick={() => { setShowCategoryModal(false); setEditingCategory(null); setNewCategoryName(""); }} className="p-2 hover:bg-slate-100 rounded-xl cursor-pointer">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Lista de categorías */}
            <div className="flex flex-col gap-1 overflow-y-auto">
              {allCategories.filter(c => c !== "Todos").map(cat => {
                const isEditing = editingCategory?.original === cat;
                return (
                  <div key={cat} className="flex items-center gap-2 py-2 px-3 rounded-xl hover:bg-slate-50 group">
                    {isEditing ? (
                      <form onSubmit={e => { e.preventDefault(); renameCategory(cat, editingCategory.value); }} className="flex flex-1 gap-2">
                        <input
                          autoFocus
                          value={editingCategory.value}
                          onChange={e => setEditingCategory({ ...editingCategory, value: e.target.value })}
                          className="flex-1 bg-slate-50 border border-yellow-400 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
                        />
                        <button type="submit" className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer">Guardar</button>
                        <button type="button" onClick={() => setEditingCategory(null)} className="text-slate-400 px-2 cursor-pointer text-xs">✕</button>
                      </form>
                    ) : (
                      <>
                        <span className="flex-1 text-sm font-semibold text-slate-700">{cat}</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setEditingCategory({ original: cat, value: cat })}
                            className="p-1.5 hover:bg-yellow-50 rounded-lg text-slate-400 hover:text-yellow-600 cursor-pointer transition"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => { setShowCategoryModal(false); deleteCategory(cat); }}
                            className="p-1.5 hover:bg-rose-50 rounded-lg text-slate-400 hover:text-rose-500 cursor-pointer transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Crear nueva */}
            <div className="border-t border-slate-100 pt-4">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-2">Nueva categoría</label>
              <form onSubmit={e => { e.preventDefault(); addCategory(newCategoryName); }} className="flex gap-2">
                <input
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  placeholder="Nombre..."
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
                <button type="submit" disabled={!newCategoryName.trim()} className="bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 text-slate-900 font-bold px-4 rounded-xl text-sm cursor-pointer transition">
                  Crear
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Código de barras */}
      {showBarcodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">

            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-bold text-slate-800 text-lg">Código de barras</h2>
                <p className="text-slate-400 text-xs mt-0.5">Imprime una etiqueta para tu producto</p>
              </div>
              <button onClick={() => setShowBarcodeModal(null)} className="p-2 hover:bg-slate-100 rounded-xl cursor-pointer">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Selector de producto — solo los que tienen código */}
            <select
              value={showBarcodeModal.id}
              onChange={e => {
                const p = products.find(p => p.id === e.target.value);
                if (p) openBarcodeModal(p);
              }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-yellow-400"
            >
              {products.filter(p => p.codigoBarras).map(p => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>

            {/* Input de código */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Código</label>
              <div className="flex gap-2">
                <input
                  value={barcodeCode}
                  onChange={e => setBarcodeCode(e.target.value)}
                  placeholder="Escribe o genera automático"
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
                <button
                  onClick={handleGenerateBarcode}
                  className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-xl transition cursor-pointer shrink-0"
                >
                  Auto
                </button>
              </div>
            </div>

            {/* Nombre en etiqueta */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Nombre en etiqueta (opcional)</label>
              <input
                value={barcodeLabel}
                onChange={e => setBarcodeLabel(e.target.value)}
                placeholder={showBarcodeModal.nombre}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              />
            </div>

            {/* Preview */}
            {barcodeCode.trim() ? (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-4 flex flex-col items-center gap-1">
                <p className="text-xs font-bold text-slate-700 text-center">{barcodeLabel || showBarcodeModal.nombre}</p>
                <svg ref={el => renderBarcodeSvg(el, barcodeCode)} className="w-full max-w-[240px]" />
              </div>
            ) : (
              <div className="border-2 border-dashed border-slate-100 rounded-2xl p-6 flex items-center justify-center">
                <p className="text-slate-300 text-sm font-semibold">Vista previa del código</p>
              </div>
            )}

            {/* Cantidad */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-2">Cantidad de etiquetas</label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setBarcodePrintQty(q => Math.max(1, q - 1))}
                  className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-lg cursor-pointer transition"
                >−</button>
                <span className="font-bold text-slate-800 text-lg w-6 text-center">{barcodePrintQty}</span>
                <button
                  onClick={() => setBarcodePrintQty(q => Math.min(20, q + 1))}
                  className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-lg cursor-pointer transition"
                >+</button>
                <span className="text-slate-400 text-xs">máx. 20 por impresión</span>
              </div>
            </div>

            {/* Botones */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowBarcodeModal(null)}
                className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveAndPrintBarcode}
                disabled={!barcodeCode.trim()}
                className="flex-1 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 text-slate-900 font-bold text-sm flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Printer className="w-4 h-4" /> Imprimir
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
