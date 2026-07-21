import { test as setup } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TEST_EMAIL = 'test-e2e@charliegrow.internal';
const TEST_PASSWORD = 'TestCharlieGrow2026!';
const AUTH_FILE = path.join(__dirname, '.auth.json');

setup('crear usuario de test', async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Crear usuario de test si no existe (ignorar error si ya existe)
  await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });

  // Obtener token de sesión para reutilizar en tests
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: TEST_EMAIL,
  });
  if (error) throw new Error(`Setup auth error: ${error.message}`);

  // Guardar credenciales para que los tests las usen
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }));
  console.log('✓ Usuario de test listo:', TEST_EMAIL);
});
