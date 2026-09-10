import { config } from 'dotenv';
import { resolve } from 'path';

// Integration tests read from .env.test (local Supabase stack). Unit tests are
// pure functions and need none of this, but loading it keeps both paths uniform.
config({ path: resolve(process.cwd(), '.env.test'), override: false });
