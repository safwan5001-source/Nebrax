const PRODUCT_STORAGE_KEY = 'nibras_demo_products_v1';
const MEDIA_STORAGE_KEY = 'nibras_demo_product_media_v1';
const MEDIA_DB_NAME = 'nibras-demo-product-media';
const MEDIA_DB_STORE = 'files';

export const DEMO_MEDIA_PREFIX = 'demo-product-media:';

export type DemoStoredProduct = Record<string, unknown> & { id: string };

export interface DemoStoredMedia {
  id: string;
  product_id: string;
  original_name: string;
  mime_type: string;
  size: number;
  sort_order: number;
  download_url: string;
}

let memoryProducts: DemoStoredProduct[] = [];
let memoryMedia: DemoStoredMedia[] = [];
const memoryFiles = new Map<string, Blob>();

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string, fallback: T): T {
  const storage = browserStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // وضع المعاينة يجب ألا يتعطل إذا منع المتصفح التخزين المحلي.
  }
}

function storedProducts(): DemoStoredProduct[] {
  return browserStorage() ? readJson(PRODUCT_STORAGE_KEY, []) : memoryProducts;
}

function storedMedia(): DemoStoredMedia[] {
  return browserStorage() ? readJson(MEDIA_STORAGE_KEY, []) : memoryMedia;
}

export function listDemoProducts(): DemoStoredProduct[] {
  return storedProducts();
}

export function saveDemoProduct<T extends { id: string }>(product: T): void {
  const storedProduct = product as unknown as DemoStoredProduct;
  const next = [storedProduct, ...storedProducts().filter((item) => item.id !== product.id)];
  if (browserStorage()) writeJson(PRODUCT_STORAGE_KEY, next);
  else memoryProducts = next;
}

export function listDemoProductMedia(productId: string): DemoStoredMedia[] {
  return storedMedia()
    .filter((item) => item.product_id === productId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export async function saveDemoProductMedia(productId: string, files: Blob[]): Promise<DemoStoredMedia[]> {
  const current = listDemoProductMedia(productId);
  const additions: DemoStoredMedia[] = [];

  for (const [offset, file] of files.entries()) {
    const id = demoId('media');
    const namedFile = file as File;
    const item: DemoStoredMedia = {
      id,
      product_id: productId,
      original_name: namedFile.name || `product-${offset + 1}`,
      mime_type: file.type || 'application/octet-stream',
      size: file.size,
      sort_order: current.length + offset,
      download_url: `${DEMO_MEDIA_PREFIX}${id}`,
    };
    await writeMediaFile(id, file);
    additions.push(item);
  }

  const next = [...storedMedia(), ...additions];
  if (browserStorage()) writeJson(MEDIA_STORAGE_KEY, next);
  else memoryMedia = next;
  return [...current, ...additions];
}

export async function deleteDemoProductMedia(productId: string, mediaId: string): Promise<void> {
  const next = storedMedia().filter((item) => item.product_id !== productId || item.id !== mediaId);
  if (browserStorage()) writeJson(MEDIA_STORAGE_KEY, next);
  else memoryMedia = next;
  memoryFiles.delete(mediaId);

  const db = await openMediaDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const request = db.transaction(MEDIA_DB_STORE, 'readwrite').objectStore(MEDIA_DB_STORE).delete(mediaId);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
  db.close();
}

export async function readDemoMediaFile(path: string): Promise<Blob | null> {
  if (!path.startsWith(DEMO_MEDIA_PREFIX)) return null;
  const id = path.slice(DEMO_MEDIA_PREFIX.length);
  const memory = memoryFiles.get(id);
  if (memory) return memory;

  const db = await openMediaDb();
  if (!db) return null;
  const file = await new Promise<Blob | null>((resolve) => {
    const request = db.transaction(MEDIA_DB_STORE).objectStore(MEDIA_DB_STORE).get(id);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => resolve(null);
  });
  db.close();
  return file;
}

export function demoId(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `demo-${prefix}-${uuid}`;
}

async function writeMediaFile(id: string, file: Blob): Promise<void> {
  memoryFiles.set(id, file);
  const db = await openMediaDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const request = db.transaction(MEDIA_DB_STORE, 'readwrite').objectStore(MEDIA_DB_STORE).put(file, id);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
  db.close();
}

async function openMediaDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    const request = indexedDB.open(MEDIA_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MEDIA_DB_STORE)) {
        request.result.createObjectStore(MEDIA_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export function resetDemoProductStoreForTests(): void {
  memoryProducts = [];
  memoryMedia = [];
  memoryFiles.clear();
}
