import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ynyjkwcjjfswcfzwgumv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlueWprd2NqamZzd2NmendndW12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NjQyOTMsImV4cCI6MjEwMjA0MDI5M30.ICWF8vCJ_8xJVzXS5yQkhUNF4h_oHjeSMsRmaaX5XdU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
