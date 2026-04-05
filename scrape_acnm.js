const puppeteer = require('puppeteer');
const fs = require('fs');

// Color palette for generating card colors
const COLORS = [
  '#b85c38', '#4a6741', '#5e3a5a', '#c9973a', '#2d6a8a', '#8a3a5a',
  '#6b4226', '#3a6b5e', '#7a4a7a', '#a0522d', '#2e5e4e', '#8b4513',
  '#556b2f', '#6a5acd', '#cd853f', '#708090', '#9b4d3a', '#4b7f52'
];

function pickColor(index) {
  return COLORS[index % COLORS.length];
}

function makeAbbr(name) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

async function scrapeMidwives() {
  console.log('Starting ACNM directory scraper...');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1400,900']
  });
  const page = await browser.newPage();

  try {
    // Load the existing practices so we can assign new IDs
    let existing = [];
    try {
      existing = JSON.parse(fs.readFileSync('practices.json', 'utf8'));
    } catch (_) {}
    let nextId = existing.length ? Math.max(...existing.map(p => p.id)) + 1 : 1;

    console.log('Navigating to ACNM directory...');
    await page.goto('https://ams.midwife.org/web-directory/1', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for the page to fully render (dynamic JS portal)
    await page.waitForFunction(
      () => document.body.innerText.includes('Showing'),
      { timeout: 20000 }
    );
    console.log('Directory loaded.');

    // --- Try to open filters and apply "Home Birth" if available ---
    console.log('Looking for filter controls...');
    try {
      // Click "Filters" button if one exists
      const filterBtn = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button, a, div[role="button"]')];
        const f = btns.find(b => /filter/i.test(b.textContent));
        if (f) { f.click(); return true; }
        return false;
      });
      if (filterBtn) {
        await new Promise(r => setTimeout(r, 2000));
        console.log('Filter panel opened.');

        // Try to check "Home Birth" checkbox or similar
        await page.evaluate(() => {
          const labels = [...document.querySelectorAll('label, span, div')];
          const hb = labels.find(el => /home\s*birth/i.test(el.textContent));
          if (hb) hb.click();
        });
        await new Promise(r => setTimeout(r, 1000));

        // Click "Apply Filters"
        await page.evaluate(() => {
          const btns = [...document.querySelectorAll('button, a, div[role="button"]')];
          const apply = btns.find(b => /apply/i.test(b.textContent));
          if (apply) apply.click();
        });
        await new Promise(r => setTimeout(r, 3000));
        console.log('Filters applied (attempted Home Birth).');
      }
    } catch (filterErr) {
      console.log('Could not apply filters, scraping all listings:', filterErr.message);
    }

    // --- Scrape all pages ---
    const allPractices = [];
    let pageNum = 1;

    while (true) {
      console.log(`Scraping page ${pageNum}...`);

      // Wait for table rows to be present
      await new Promise(r => setTimeout(r, 2000));

      // Extract listing data from the current page
      const rows = await page.evaluate(() => {
        const results = [];
        // Look for table rows — the directory shows Name, City, State, Action
        const trs = document.querySelectorAll('table tbody tr, .directory-row, [class*="row"]');
        trs.forEach(tr => {
          const cells = tr.querySelectorAll('td, [class*="cell"]');
          if (cells.length >= 3) {
            const name = (cells[0]?.textContent || '').trim();
            const state = (cells[1]?.textContent || '').trim();
            const city = (cells[2]?.textContent || '').trim();
            if (name && name !== 'Name' && state.length <= 30) {
              results.push({ name, state, city });
            }
          }
        });
        // Fallback: try extracting from any visible structured text
        if (results.length === 0) {
          const links = document.querySelectorAll('a[href*="detail"], a[href*="view"]');
          links.forEach(link => {
            const row = link.closest('tr, div[class*="row"], li');
            if (row) {
              const text = row.textContent.trim();
              results.push({ name: text, state: '', city: '', raw: true });
            }
          });
        }
        return results;
      });

      console.log(`  Found ${rows.length} listings on page ${pageNum}`);

      // For each listing, try to click "View Details" to get full info
      for (let i = 0; i < rows.length; i++) {
        try {
          // Click the View Details link for this row
          const hasDetail = await page.evaluate((idx) => {
            const detailLinks = [...document.querySelectorAll('a, button')]
              .filter(el => /view\s*detail|view\s*>/i.test(el.textContent));
            if (detailLinks[idx]) {
              detailLinks[idx].click();
              return true;
            }
            return false;
          }, i);

          if (hasDetail) {
            await new Promise(r => setTimeout(r, 2000));

            // Extract detail info from the modal/detail view
            const detail = await page.evaluate(() => {
              const body = document.body.innerText;
              const getText = (label) => {
                const regex = new RegExp(label + '\\s*[:\\-]?\\s*(.+)', 'i');
                const match = body.match(regex);
                return match ? match[1].split('\n')[0].trim() : '';
              };

              return {
                phone: getText('Phone|Telephone|Tel'),
                email: getText('Email'),
                website: getText('Website|Web|URL'),
                address: getText('Address'),
                practiceType: getText('Practice Type|Setting|Type'),
                services: getText('Services|Care|Specialt'),
                bio: getText('About|Description|Bio')
              };
            });

            rows[i] = { ...rows[i], ...detail };

            // Close the modal/detail
            await page.evaluate(() => {
              const closeBtn = document.querySelector('[class*="close"], [aria-label="close"], button.close, .modal-close');
              if (closeBtn) closeBtn.click();
              // Also try pressing Escape
            });
            await page.keyboard.press('Escape');
            await new Promise(r => setTimeout(r, 1000));
          }
        } catch (detailErr) {
          console.log(`  Could not get details for row ${i}: ${detailErr.message}`);
        }
      }

      allPractices.push(...rows);

      // --- Pagination: try to go to next page ---
      const hasNext = await page.evaluate((current) => {
        const pageLinks = [...document.querySelectorAll('a, button')]
          .filter(el => {
            const text = el.textContent.trim();
            return text === String(current + 1) || /next|›|»|>/i.test(text);
          });
        const nextLink = pageLinks.find(el => el.textContent.trim() === String(current + 1))
          || pageLinks.find(el => /next|›|»/i.test(el.textContent));
        if (nextLink) {
          nextLink.click();
          return true;
        }
        return false;
      }, pageNum);

      if (!hasNext) {
        console.log('No more pages to scrape.');
        break;
      }

      pageNum++;
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log(`\nScraped ${allPractices.length} total listings.`);

    // --- Convert to our practices.json format ---
    const newPractices = allPractices
      .filter(p => p.name && !p.raw)
      .map((p, i) => ({
        id: nextId + i,
        name: p.name,
        abbr: makeAbbr(p.name),
        city: p.city || '',
        state: p.state || '',
        zip: '',
        practiceType: /home/i.test(p.practiceType || '') ? 'Home Birth'
          : /birth\s*center/i.test(p.practiceType || '') ? 'Freestanding Birth Center'
          : /hospital/i.test(p.practiceType || '') ? 'Hospital'
          : /clinic/i.test(p.practiceType || '') ? 'Community Health Clinic'
          : /office|private/i.test(p.practiceType || '') ? 'Private Office'
          : 'Home Birth',
        care: ['Prenatal Care', 'Labor and Birth', 'Care After Birth/Postpartum'],
        payment: ['Self Pay'],
        blackOwned: false,
        accepting: true,
        phone: p.phone || '',
        email: p.email || '',
        website: p.website || '',
        bio: p.bio || `${p.name} — a midwifery practice in ${p.city || 'your area'}, ${p.state || ''}.`,
        specialties: p.services || '',
        color: pickColor(i)
      }));

    // Merge with existing practices (avoid duplicates by name)
    const existingNames = new Set(existing.map(p => p.name.toLowerCase()));
    const unique = newPractices.filter(p => !existingNames.has(p.name.toLowerCase()));

    const merged = [...existing, ...unique];
    fs.writeFileSync('practices.json', JSON.stringify(merged, null, 2));
    console.log(`\nAdded ${unique.length} new practices (${merged.length} total). Saved to practices.json!`);

  } catch (err) {
    console.error('Scraper error:', err);
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

scrapeMidwives();
