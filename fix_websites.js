const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://icpgljdwmtofmdeigrmr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljcGdsamR3bXRvZm1kZWlncm1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjUwODYsImV4cCI6MjA5MDkwMTA4Nn0.o_RZfoUS6rZe4_7Ol9M6lQA8I75Z-CEQiWig5rGOP30';
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const BASE = 'https://blackmidwifedirectory.com';

function slugify(text) {
  return text.toLowerCase()
    .replace(/['']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const STATE_TO_SLUG = {
  'AL':'alabama','AK':'alaska','AZ':'arizona','AR':'arkansas','CA':'california',
  'CO':'colorado','CT':'connecticut','DE':'delaware','FL':'florida','GA':'georgia',
  'HI':'hawaii','ID':'idaho','IL':'illinois','IN':'indiana','IA':'iowa',
  'KS':'kansas','KY':'kentucky','LA':'louisiana','ME':'maine','MD':'maryland',
  'MA':'massachusetts','MI':'michigan','MN':'minnesota','MS':'mississippi',
  'MO':'missouri','MT':'montana','NE':'nebraska','NV':'nevada',
  'NH':'new-hampshire','NJ':'new-jersey','NM':'new-mexico','NY':'new-york',
  'NC':'north-carolina','ND':'north-dakota','OH':'ohio','OK':'oklahoma',
  'OR':'oregon','PA':'pennsylvania','RI':'rhode-island','SC':'south-carolina',
  'SD':'south-dakota','TN':'tennessee','TX':'texas','UT':'utah','VT':'vermont',
  'VA':'virginia','WA':'washington','WV':'west-virginia','WI':'wisconsin',
  'WY':'wyoming','DC':'district-of-columbia'
};

async function fixWebsites() {
  console.log('=== Fix Sista Midwife Websites ===\n');

  // Get practices with bad URLs
  const { data: practices, error } = await db
    .from('practices')
    .select('id, name, city, state, website')
    .ilike('website', '%sistamidwife%');

  if (error) { console.error('DB error:', error.message); return; }
  console.log(`Found ${practices.length} practices with SistaMidwife URLs\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

  const updates = []; // { id, website }

  for (const p of practices) {
    const stateSlug = STATE_TO_SLUG[p.state] || slugify(p.state);
    const citySlug = slugify(p.city);
    const nameSlug = slugify(p.name);

    // Try to construct the profile URL
    const profileUrl = `${BASE}/united-states/${citySlug}/midwife/${nameSlug}`;
    console.log(`[${p.id}] ${p.name} — trying ${profileUrl}`);

    try {
      const resp = await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 12000 });
      if (!resp || resp.status() >= 400) {
        // Try alternate URL pattern with state
        const alt = `${BASE}/united-states/${stateSlug}/${citySlug}/midwife/${nameSlug}`;
        console.log(`  404, trying: ${alt}`);
        const resp2 = await page.goto(alt, { waitUntil: 'networkidle2', timeout: 12000 });
        if (!resp2 || resp2.status() >= 400) {
          console.log(`  ✗ Not found, will clear URL`);
          updates.push({ id: p.id, website: null });
          continue;
        }
      }

      await new Promise(r => setTimeout(r, 1000));

      // Extract real website from profile page
      const website = await page.evaluate(() => {
        const links = [...document.querySelectorAll('a[href]')];
        const real = links.find(a => {
          const h = (a.getAttribute('href') || '').toLowerCase();
          return h.startsWith('http') &&
            !h.includes('blackmidwife') &&
            !h.includes('sistamidwife') &&
            !h.includes('facebook.com') &&
            !h.includes('instagram.com') &&
            !h.includes('twitter.com') &&
            !h.includes('youtube.com') &&
            !h.includes('pinterest.com') &&
            !h.includes('linkedin.com') &&
            !h.includes('tiktok.com') &&
            !h.includes('google.com') &&
            !h.includes('goo.gl') &&
            !h.includes('yelp.com') &&
            !h.includes('maps.') &&
            !h.includes('mailto:') &&
            !h.includes('tel:') &&
            !h.includes('javascript:');
        });
        return real ? real.getAttribute('href') : null;
      });

      if (website) {
        console.log(`  ✓ Found: ${website}`);
        updates.push({ id: p.id, website });
      } else {
        console.log(`  – No website found, clearing`);
        updates.push({ id: p.id, website: null });
      }

    } catch (err) {
      console.log(`  ✗ Error: ${err.message}, clearing`);
      updates.push({ id: p.id, website: null });
    }
  }

  await browser.close();

  // Output SQL for the user to run in Supabase SQL Editor
  console.log('\n\n========================================');
  console.log('SQL TO RUN IN SUPABASE SQL EDITOR:');
  console.log('========================================\n');

  const sqlLines = updates.map(u => {
    if (u.website) {
      const escaped = u.website.replace(/'/g, "''");
      return `UPDATE practices SET website = '${escaped}' WHERE id = ${u.id};`;
    } else {
      return `UPDATE practices SET website = NULL WHERE id = ${u.id};`;
    }
  });

  const sql = sqlLines.join('\n');
  console.log(sql);

  // Also save to file
  const fs = require('fs');
  fs.writeFileSync('fix_websites.sql', sql);
  console.log('\n\nSaved to fix_websites.sql');
  console.log(`\nSummary: ${updates.filter(u => u.website).length} real websites found, ${updates.filter(u => !u.website).length} cleared`);
}

fixWebsites();
