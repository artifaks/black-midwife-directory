const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = 'https://icpgljdwmtofmdeigrmr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljcGdsamR3bXRvZm1kZWlncm1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjUwODYsImV4cCI6MjA5MDkwMTA4Nn0.o_RZfoUS6rZe4_7Ol9M6lQA8I75Z-CEQiWig5rGOP30';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function migrate() {
  console.log('Loading practices.json...');
  const practices = JSON.parse(fs.readFileSync('practices.json', 'utf8'));
  console.log(`Found ${practices.length} practices to migrate.`);

  // Transform camelCase to snake_case for Supabase
  const rows = practices.map(p => ({
    name: p.name || '',
    abbr: p.abbr || '',
    city: p.city || '',
    state: p.state || '',
    zip: p.zip || '',
    practice_type: p.practiceType || 'Home Birth',
    care: p.care || [],
    payment: p.payment || [],
    black_owned: p.blackOwned || false,
    accepting: p.accepting !== undefined ? p.accepting : true,
    phone: p.phone || '',
    email: p.email || '',
    website: p.website || '',
    bio: p.bio || '',
    specialties: p.specialties || '',
    color: p.color || '#b85c38',
    featured: false,
    listing_tier: 'free'
  }));

  // Insert in batches of 25
  const BATCH_SIZE = 25;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from('practices')
      .insert(batch)
      .select();

    if (error) {
      console.error(`Error inserting batch ${i / BATCH_SIZE + 1}:`, error.message);
    } else {
      inserted += data.length;
      console.log(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${data.length} rows (${inserted} total)`);
    }
  }

  console.log(`\nMigration complete! ${inserted} practices inserted into Supabase.`);

  // Verify
  const { count } = await supabase
    .from('practices')
    .select('*', { count: 'exact', head: true });
  console.log(`Verified: ${count} rows in practices table.`);
}

migrate().catch(console.error);
