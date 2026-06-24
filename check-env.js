#!/usr/bin/env node
/**
 * Pre-build check for Supabase env vars
 * Warns in deployed builds if cloud vars are missing.
 * Local builds without cloud vars are expected to run in localStorage-only mode.
 */

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_ANON_KEY;

const hasCloud = URL && KEY;
const isVercel = Boolean(process.env.VERCEL);
const isCi = String(process.env.CI || '').toLowerCase() === 'true';

if (!hasCloud) {
  if (isVercel) {
    console.warn('\n⚠️  [Vyact Build Warning]');
    console.warn('VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set.');
    console.warn('App will run in localStorage-only mode (no cloud features).\n');
    console.warn('🔴 ON VERCEL: Your deployment will NOT have cloud features.');
    console.warn('   1. Go to Vercel → Settings → Environment Variables');
    console.warn('   2. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    console.warn('   3. Redeploy this commit\n');
  } else if (isCi) {
    console.log('\nℹ️  [Vyact Build Info]');
    console.log('VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set.');
    console.log('Build will use localStorage-only mode (no cloud features).\n');
  }
}

if (hasCloud || isVercel || isCi) {
  console.log('ℹ️  Build environment:');
  console.log(`    VITE_SUPABASE_URL: ${URL ? '✓ set' : '✗ missing'}`);
  console.log(`    VITE_SUPABASE_ANON_KEY: ${KEY ? '✓ set' : '✗ missing'}`);
  console.log(`    App URL: ${process.env.VITE_APP_URL || '(auto - will be ' + process.env.VERCEL_URL + ')'}\n`);
}
