const puppeteer = require('puppeteer');
const fs = require('fs');

// ── Config ────────────────────────────────────────────────────
const BASE = 'https://blackmidwifedirectory.com';

// All US states (slug format used by the site)
const STATES = [
  'alabama','alaska','arizona','arkansas','california','colorado',
  'connecticut','delaware','florida','georgia','hawaii','idaho',
  'illinois','indiana','iowa','kansas','kentucky','louisiana',
  'maine','maryland','massachusetts','michigan','minnesota',
  'mississippi','missouri','montana','nebraska','nevada',
  'new-hampshire','new-jersey','new-mexico','new-york',
  'north-carolina','north-dakota','ohio','oklahoma','oregon',
  'pennsylvania','rhode-island','south-carolina','south-dakota',
  'tennessee','texas','utah','vermont','virginia','washington',
  'west-virginia','wisconsin','wyoming','district-of-columbia'
];

// State slug → abbreviation
const STATE_ABBR = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
  'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
  'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA',
  'kansas':'KS','kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD',
  'massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS',
  'missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV',
  'new-hampshire':'NH','new-jersey':'NJ','new-mexico':'NM','new-york':'NY',
  'north-carolina':'NC','north-dakota':'ND','ohio':'OH','oklahoma':'OK',
  'oregon':'OR','pennsylvania':'PA','rhode-island':'RI','south-carolina':'SC',
  'south-dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
  'virginia':'VA','washington':'WA','west-virginia':'WV','wisconsin':'WI',
  'wyoming':'WY','district-of-columbia':'DC'
};

const COLORS = [
  '#b85c38','#4a6741','#5e3a5a','#c9973a','#2d6a8a','#8a3a5a',
  '#6b4226','#3a6b5e','#7a4a7a','#a0522d','#2e5e4e','#8b4513',
  '#556b2f','#6a5acd','#cd853f','#708090','#9b4d3a','#4b7f52',
  '#704214','#2f4f4f','#8b0000','#483d8b','#b8860b','#006400'
];

function pickColor(i) { return COLORS[i % COLORS.length]; }

function makeAbbr(name) {
  return name.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '??';
}

function mapPracticeType(urlType) {
  if (/midwife/i.test(urlType)) return 'Home Birth';
  if (/lactation/i.test(urlType)) return 'Private Office';
  if (/wellness/i.test(urlType)) return 'Private Office';
  return 'Home Birth';
}

async function scrapeSista() {
  console.log('=== Sista Midwife Directory Scraper ===\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1400,900']
  });
  const page = await browser.newPage();

  // Load existing practices
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync('practices.json', 'utf8'));
  } catch (_) {}
  const existingNames = new Set(existing.map(p => p.name.toLowerCase().trim()));
  let nextId = existing.length ? Math.max(...existing.map(p => p.id)) + 1 : 1;

  const allNew = [];

  for (const stateSlug of STATES) {
    const stateAbbr = STATE_ABBR[stateSlug] || stateSlug.toUpperCase();
    const url = `${BASE}/united-states/${stateSlug}`;
    console.log(`\n── ${stateAbbr} ── ${url}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise(r => setTimeout(r, 2000));

      // Keep clicking "Load More" until all results are visible
      let loadMoreClicks = 0;
      while (loadMoreClicks < 20) {
        const clicked = await page.evaluate(() => {
          const btn = [...document.querySelectorAll('a, button')]
            .find(el => /load\s*more/i.test(el.textContent));
          if (btn) { btn.click(); return true; }
          return false;
        });
        if (!clicked) break;
        loadMoreClicks++;
        await new Promise(r => setTimeout(r, 2000));
      }

      // Extract all listing links from the state page
      const listings = await page.evaluate(() => {
        const results = [];
        // Find all "View Listing" links
        const links = document.querySelectorAll('a[href*="/united-states/"]');
        const seen = new Set();
        links.forEach(a => {
          const href = a.getAttribute('href') || '';
          // Profile URLs have at least 4 path segments: /united-states/city/type/name
          const parts = href.replace(/^\//, '').split('/');
          if (parts.length >= 4 && parts[0] === 'united-states' && !seen.has(href)) {
            seen.add(href);

            // Try to get name and city from the card context
            const card = a.closest('.search_result, .grid_element, div[class*="result"], article, li') || a.parentElement;
            const nameEl = card?.querySelector('h2, h3, h4, .title, a') || a;
            const name = nameEl.textContent.trim().replace(/View Listing|Send Message/gi, '').trim();

            // Get phone from card if visible
            const phoneEl = card?.querySelector('a[href^="tel:"]');
            const phone = phoneEl ? phoneEl.textContent.trim() : '';

            results.push({ href, name, phone, parts });
          }
        });
        return results;
      });

      // Filter to only "midwife" type listings (skip lactation-only, wellness-only if desired)
      const midwifeListings = listings.filter(l => {
        const type = l.parts[2] || '';
        return /midwife/i.test(type);
      });

      console.log(`  Found ${listings.length} total, ${midwifeListings.length} midwife listings`);

      // Visit each midwife profile for full details
      for (const listing of midwifeListings) {
        const profileName = listing.name || listing.parts[3]?.replace(/-/g, ' ') || '';
        if (existingNames.has(profileName.toLowerCase().trim())) {
          console.log(`  SKIP (duplicate): ${profileName}`);
          continue;
        }

        try {
          const profileUrl = listing.href.startsWith('http')
            ? listing.href
            : `${BASE}${listing.href}`;

          await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 15000 });
          await new Promise(r => setTimeout(r, 1500));

          const profile = await page.evaluate(() => {
            const text = document.body.innerText;

            // Name: usually the biggest heading
            const h1 = document.querySelector('h1, .member-profile-header h2, .logo');
            const name = h1 ? h1.textContent.trim() : '';

            // Phone
            const phoneLink = document.querySelector('a[href^="tel:"]');
            const phone = phoneLink ? phoneLink.textContent.trim() : '';

            // Website
            const websiteLink = [...document.querySelectorAll('a[href]')]
              .find(a => {
                const h = a.getAttribute('href') || '';
                return h.startsWith('http') &&
                  !h.includes('blackmidwifedirectory') &&
                  !h.includes('facebook.com') &&
                  !h.includes('instagram.com') &&
                  !h.includes('twitter.com') &&
                  !h.includes('youtube.com') &&
                  !h.includes('pinterest.com') &&
                  !h.includes('linkedin.com') &&
                  !h.includes('tiktok.com');
              });
            const website = websiteLink ? websiteLink.getAttribute('href') : '';

            // Bio / description
            const descEl = document.querySelector('.description, .bio, .about, p.member-description, .module p');
            const bio = descEl ? descEl.textContent.trim().substring(0, 300) : '';

            // Address / location
            const addrEl = document.querySelector('.address, [class*="address"], [class*="location"]');
            const address = addrEl ? addrEl.textContent.trim() : '';

            return { name, phone, website, bio, address };
          });

          const city = listing.parts[1]?.replace(/-/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase()) || '';
          const practiceType = mapPracticeType(listing.parts[2] || '');
          const finalName = profile.name || profileName;

          if (existingNames.has(finalName.toLowerCase().trim())) continue;

          allNew.push({
            id: nextId++,
            name: finalName,
            abbr: makeAbbr(finalName),
            city: city,
            state: stateAbbr,
            zip: '',
            practiceType: practiceType,
            care: ['Prenatal Care', 'Labor and Birth', 'Care After Birth/Postpartum'],
            payment: ['Self Pay'],
            blackOwned: true,
            accepting: true,
            phone: profile.phone || listing.phone || '',
            email: '',
            website: profile.website || '',
            bio: profile.bio || `${finalName} — a Black midwifery practice in ${city}, ${stateAbbr}.`,
            specialties: '',
            color: pickColor(allNew.length)
          });

          existingNames.add(finalName.toLowerCase().trim());
          console.log(`  ✓ ${finalName} — ${city}, ${stateAbbr}`);

        } catch (profileErr) {
          console.log(`  ✗ Could not load profile: ${listing.href} — ${profileErr.message}`);
        }
      }

    } catch (stateErr) {
      console.log(`  ✗ Failed to load state page: ${stateErr.message}`);
    }
  }

  // Merge and save
  const merged = [...existing, ...allNew];
  fs.writeFileSync('practices.json', JSON.stringify(merged, null, 2));

  console.log(`\n========================================`);
  console.log(`Added ${allNew.length} new Black midwife practices`);
  console.log(`Total practices in directory: ${merged.length}`);
  console.log(`Saved to practices.json`);
  console.log(`========================================`);

  await browser.close();
}

scrapeSista();
