import { createClient } from '@supabase/supabase-js';
import { config } from './env.js';

let rawUrl = config.supabase.url || '';

// Sanitize URL by removing /rest/v1 or trailing slashes if present
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

// Prefer service role key for backend operations to bypass RLS securely; fallback to anonKey
const supabaseKey = config.supabase.serviceRoleKey || config.supabase.anonKey;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️ [SUPABASE WARNING] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not defined.');
}

/**
 * Supabase Admin Client for database access and service role mutations
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export default supabaseAdmin;
