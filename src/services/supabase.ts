import { createClient } from '@supabase/supabase-js';

// Get Supabase credentials from environment variables (Netlify or .env)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://vkaitejgyqxztrhlqcfz.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.dummy';

export const isSupabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Singleton Supabase Client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

/**
 * Helper to fetch restaurant data directly from Supabase tables if configured
 */
export async function getRestaurantFromSupabase(slug: string) {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from('Restaurant')
      .select('*, tables:Table(*), categories:Category(*), products:Product(*)')
      .eq('slug', slug)
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('Direct Supabase fetch fallback to local API:', err);
    return null;
  }
}
