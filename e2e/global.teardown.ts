import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TEST_EMAIL = 'test-e2e@charliegrow.internal';

export default async function teardown() {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Borrar todos los productos del usuario de test
  const { data: users } = await admin.auth.admin.listUsers();
  const testUser = (users?.users ?? []).find((u: any) => u.email === TEST_EMAIL);
  if (testUser) {
    await admin.from('products').delete().eq('user_id', testUser.id);
    await admin.from('categories').delete().eq('user_id', testUser.id);
    await admin.from('subcategories').delete().eq('user_id', testUser.id);
  }
  console.log('✓ Datos de test limpiados');
}
