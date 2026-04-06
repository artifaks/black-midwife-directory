/* ============================================================
   Black Birth Connect — app.js
   Handles: data, filtering, card rendering, modal, animations,
            shareable links, featured listings, map view,
            autocomplete, near me, newsletter, state pages
   ============================================================ */

// ── Supabase Client ──────────────────────────────────────────
const SUPABASE_URL = 'https://icpgljdwmtofmdeigrmr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljcGdsamR3bXRvZm1kZWlncm1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjUwODYsImV4cCI6MjA5MDkwMTA4Nn0.o_RZfoUS6rZe4_7Ol9M6lQA8I75Z-CEQiWig5rGOP30';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Utilities ────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Practice Data (loaded from Supabase) ──────────────────────
let PRACTICES = [];
let filtered = [];
const PAGE_SIZE = 12;
let visibleCount = PAGE_SIZE;
let mapInstance = null;
let mapMarkers = [];
let userLat = null;
let userLng = null;

async function loadPractices() {
  try {
    const { data, error } = await db
      .from('practices')
      .select('*')
      .eq('status', 'approved')
      .order('name');

    if (error) throw error;

    PRACTICES = data.map(p => ({
      id: p.id,
      name: p.name,
      abbr: p.abbr,
      city: p.city,
      state: p.state,
      zip: p.zip,
      practiceType: p.practice_type,
      care: p.care || [],
      payment: p.payment || [],
      blackOwned: p.black_owned,
      accepting: p.accepting,
      phone: p.phone,
      email: p.email,
      website: (p.website && !p.website.toLowerCase().includes('sistamidwife') && !p.website.toLowerCase().includes('blackdouladirectory')) ? p.website : null,
      bio: p.bio,
      specialties: p.specialties,
      color: p.color,
      featured: p.featured,
      listingTier: p.listing_tier,
      lat: p.lat || null,
      lng: p.lng || null
    }));

    filtered = [...PRACTICES];
    renderGrid();
  } catch (err) {
    console.error('Failed to load practices from Supabase:', err);
    PRACTICES = [];
    filtered = [];
    renderGrid();
  }
}

// ── DOM References ────────────────────────────────────────────
const grid          = document.getElementById('practices-grid');
const resultsCount  = document.getElementById('results-count');
const modal         = document.getElementById('detail-modal');
const modalBody     = document.getElementById('modal-body');
const closeModalBtn = document.getElementById('close-modal');
const clearBtn      = document.getElementById('clear-filters');
const locationInput = document.getElementById('location-input');
const heroSearch    = document.getElementById('quick-search');
const searchBtn     = document.getElementById('quick-search-btn');
const stateSelect   = document.getElementById('state-select');
const sortSelect    = document.getElementById('sort-select');
const mobileToggle  = document.getElementById('mobile-filter-toggle');
const sidebar       = document.querySelector('.sidebar-filters');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const viewToggleBtns = document.querySelectorAll('.view-toggle-btn');
const acDropdown    = document.getElementById('autocomplete-dropdown');
const nearMeBtn     = document.getElementById('near-me-btn');
const toast         = document.getElementById('near-me-toast');

// ── Helpers ───────────────────────────────────────────────────
function getCheckedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)]
    .map(el => el.value);
}

function initials(name) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('');
}

function formatLocation(p) {
  return `${p.city}, ${p.state}`;
}

// ── State Name Map ───────────────────────────────────────────
const STATE_ABBR_TO_NAME = {
  'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
  'CO':'Colorado','CT':'Connecticut','DE':'Delaware','DC':'District of Columbia',
  'FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois',
  'IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana',
  'ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota',
  'MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada',
  'NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York',
  'NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon',
  'PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota',
  'TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia',
  'WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming'
};

const STATE_NAME_TO_ABBR = {};
Object.entries(STATE_ABBR_TO_NAME).forEach(([abbr, name]) => {
  STATE_NAME_TO_ABBR[name.toLowerCase()] = abbr;
});

function fullStateName(abbr) {
  return STATE_ABBR_TO_NAME[abbr] || abbr;
}

// ── Haversine Distance (miles) ──────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Filter Logic ──────────────────────────────────────────────
function applyFilters() {
  const keyword   = (heroSearch?.value || '').toLowerCase().trim();
  const loc       = (locationInput?.value || '').toLowerCase().trim();
  const state     = stateSelect?.value || '';
  const types     = getCheckedValues('practiceType');
  const cares     = getCheckedValues('careType');
  const payments  = getCheckedValues('paymentType');
  const blackOnly = document.querySelector('input[name="blackOwned"]')?.checked;
  const acceptingOnly = document.querySelector('input[name="accepting"]')?.checked;

  visibleCount = PAGE_SIZE;
  filtered = PRACTICES.filter(p => {
    if (keyword) {
      const haystack = `${p.name} ${p.city} ${p.state} ${fullStateName(p.state)} ${p.specialties} ${p.bio} ${p.practiceType}`.toLowerCase();
      const words = keyword.split(/\s+/);
      if (!words.every(w => haystack.includes(w))) return false;
    }
    if (loc) {
      const haystack = `${p.city} ${p.zip}`.toLowerCase();
      if (!haystack.includes(loc)) return false;
    }
    if (state && p.state !== state) return false;
    if (types.length && !types.includes(p.practiceType)) return false;
    if (cares.length && !cares.some(c => p.care.includes(c))) return false;
    if (payments.length && !payments.some(pm => p.payment.includes(pm))) return false;
    if (blackOnly && !p.blackOwned) return false;
    if (acceptingOnly && !p.accepting) return false;
    return true;
  });

  applySorting();
  renderGrid();
}

// ── Sorting (featured listings always first) ─────────────────
function applySorting() {
  const sort = sortSelect?.value || 'default';
  const featuredFirst = (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0);

  switch (sort) {
    case 'name-asc':
      filtered.sort((a, b) => featuredFirst(a, b) || a.name.localeCompare(b.name));
      break;
    case 'name-desc':
      filtered.sort((a, b) => featuredFirst(a, b) || b.name.localeCompare(a.name));
      break;
    case 'state-asc':
      filtered.sort((a, b) => featuredFirst(a, b) || a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
      break;
    case 'accepting':
      filtered.sort((a, b) => featuredFirst(a, b) || (b.accepting ? 1 : 0) - (a.accepting ? 1 : 0));
      break;
    case 'nearest':
      if (userLat && userLng) {
        filtered.forEach(p => {
          p._distance = (p.lat && p.lng) ? haversine(userLat, userLng, p.lat, p.lng) : 99999;
        });
        filtered.sort((a, b) => a._distance - b._distance);
      }
      break;
    default:
      filtered.sort(featuredFirst);
  }
}

// ── Populate State Dropdown (with full names + counts) ───────
function populateStateDropdown() {
  if (!stateSelect) return;
  const stateCounts = {};
  PRACTICES.forEach(p => {
    if (p.state) {
      stateCounts[p.state] = (stateCounts[p.state] || 0) + 1;
    }
  });
  const states = Object.keys(stateCounts).sort();
  states.forEach(st => {
    const opt = document.createElement('option');
    opt.value = st;
    opt.textContent = `${fullStateName(st)} (${stateCounts[st]})`;
    stateSelect.appendChild(opt);
  });
}

// ── Browse by State Links ────────────────────────────────────
function populateStateLinks() {
  const container = document.getElementById('state-links');
  if (!container) return;
  const stateCounts = {};
  PRACTICES.forEach(p => {
    if (p.state) stateCounts[p.state] = (stateCounts[p.state] || 0) + 1;
  });
  const states = Object.keys(stateCounts).sort();
  container.innerHTML = states.map(st => {
    const name = fullStateName(st);
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    return `<a href="state.html?state=${st}" class="state-link">
      <span class="state-link-name">${name}</span>
      <span class="state-link-count">${stateCounts[st]}</span>
    </a>`;
  }).join('');
}

// ── Clear Filters ─────────────────────────────────────────────
function clearFilters() {
  document.querySelectorAll('.sidebar-filters input').forEach(el => {
    if (el.type === 'checkbox') el.checked = false;
    if (el.type === 'text')     el.value   = '';
  });
  if (heroSearch) heroSearch.value = '';
  if (stateSelect) stateSelect.value = '';
  if (sortSelect) sortSelect.value = 'default';
  filtered = [...PRACTICES];
  visibleCount = PAGE_SIZE;
  renderGrid();
}

// ── Card HTML ─────────────────────────────────────────────────
function buildCard(p) {
  const owned   = p.blackOwned ? `<span class="tag tag-owned">Black-Owned</span>` : '';
  const featuredBadge = p.featured
    ? `<span class="featured-badge">&#9733; Featured</span>`
    : '';
  const status  = p.accepting
    ? `<span class="accepting-status open">Accepting clients</span>`
    : `<span class="accepting-status closed">Waitlist only</span>`;

  const careShown = p.care.slice(0, 2).map(c =>
    `<span class="tag tag-care">${c.replace('/Contraception','').replace('Care After Birth/','')}</span>`
  ).join('');

  const paymentShown = p.payment.map(pm =>
    `<span class="tag tag-payment">${pm}</span>`
  ).join('');

  const featuredClass = p.featured ? ' card-featured' : '';

  const distanceBadge = (p._distance && p._distance < 99999)
    ? `<span class="distance-badge">${Math.round(p._distance)} mi</span>`
    : '';

  return `
    <div class="practice-card animate-fade-up${featuredClass}" role="button" tabindex="0"
         aria-label="View profile for ${p.name}"
         onclick="openModal(${p.id})"
         onkeydown="if(event.key==='Enter')openModal(${p.id})">
      <div class="card-color-bar" style="background:${p.color}"></div>
      <div class="card-body">
        ${featuredBadge}
        ${distanceBadge}
        <div class="card-top">
          <div class="practice-avatar" style="background:${p.color}">${p.abbr}</div>
          <div>
            <div class="card-name">${p.name}</div>
            <div class="card-location">${formatLocation(p)}</div>
          </div>
        </div>
        <div class="card-tags">
          ${owned}
          <span class="tag tag-type">${p.practiceType}</span>
          ${careShown}
        </div>
        <div class="card-tags">${paymentShown}</div>
        <hr class="card-divider" />
        <div class="card-footer">
          ${status}
          <button class="card-view-btn" onclick="event.stopPropagation();openModal(${p.id})">
            View profile &rarr;
          </button>
        </div>
      </div>
    </div>`;
}

// ── Render Grid ───────────────────────────────────────────────
function renderGrid() {
  const total = filtered.length;
  const showing = Math.min(visibleCount, total);
  resultsCount.textContent = `Viewing ${showing} of ${total} practice${total !== 1 ? 's' : ''}`;

  if (!total) {
    grid.innerHTML = `
      <div class="empty-state">
        <p>No practices match your current filters.</p>
        <button class="btn-outline" onclick="clearFilters()">Clear filters</button>
      </div>`;
    return;
  }

  const visible = filtered.slice(0, visibleCount);
  const cards = visible.map((p, i) => {
    const card = buildCard(p);
    return card.replace('animate-fade-up', `animate-fade-up animate-delay-${Math.min(i + 1, 3)}`);
  }).join('');

  const remaining = total - visibleCount;
  const loadMoreHtml = remaining > 0
    ? `<div class="load-more-wrapper">
         <button class="btn-load-more" onclick="loadMore()">
           Load More <span class="load-more-count">(${remaining} remaining)</span>
         </button>
       </div>`
    : '';

  grid.innerHTML = cards + loadMoreHtml;

  if (document.getElementById('map-container')?.style.display !== 'none') {
    updateMap();
  }
}

function loadMore() {
  visibleCount += PAGE_SIZE;
  renderGrid();
  const cards = grid.querySelectorAll('.practice-card');
  const target = cards[visibleCount - PAGE_SIZE];
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Autocomplete ─────────────────────────────────────────────
let acIndex = -1;

function showAutocomplete(query) {
  if (!acDropdown || !query || query.length < 2) {
    hideAutocomplete();
    return;
  }

  const q = query.toLowerCase();
  const results = [];

  // Match states first
  Object.entries(STATE_ABBR_TO_NAME).forEach(([abbr, name]) => {
    if (name.toLowerCase().includes(q) || abbr.toLowerCase() === q) {
      const count = PRACTICES.filter(p => p.state === abbr).length;
      if (count > 0) {
        results.push({ type: 'state', abbr, label: `All midwives in ${name}`, sub: `${count} practices`, icon: '\u{1F4CD}' });
      }
    }
  });

  // Match practices
  const matched = PRACTICES.filter(p => {
    const haystack = `${p.name} ${p.city} ${p.specialties || ''} ${p.practiceType}`.toLowerCase();
    return haystack.includes(q);
  }).slice(0, 6);

  matched.forEach(p => {
    results.push({ type: 'practice', id: p.id, label: p.name, sub: `${formatLocation(p)} \u2022 ${p.practiceType}`, icon: '' });
  });

  if (!results.length) {
    hideAutocomplete();
    return;
  }

  acIndex = -1;
  acDropdown.innerHTML = results.slice(0, 8).map((r, i) => `
    <div class="autocomplete-item" data-index="${i}" data-type="${r.type}" data-id="${r.id || ''}" data-abbr="${r.abbr || ''}">
      <span class="ac-icon">${r.icon}</span>
      <div>
        <div class="ac-label">${highlightMatch(r.label, query)}</div>
        <div class="ac-sub">${r.sub}</div>
      </div>
    </div>
  `).join('');

  acDropdown.hidden = false;

  // Click handlers
  acDropdown.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectAutocomplete(item);
    });
  });
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return text.slice(0, idx) + `<strong>${text.slice(idx, idx + query.length)}</strong>` + text.slice(idx + query.length);
}

function selectAutocomplete(item) {
  const type = item.dataset.type;
  if (type === 'state') {
    const abbr = item.dataset.abbr;
    if (stateSelect) stateSelect.value = abbr;
    heroSearch.value = '';
    hideAutocomplete();
    applyFilters();
  } else if (type === 'practice') {
    const id = parseInt(item.dataset.id);
    heroSearch.value = '';
    hideAutocomplete();
    openModal(id);
  }
}

function hideAutocomplete() {
  if (acDropdown) {
    acDropdown.hidden = true;
    acDropdown.innerHTML = '';
    acIndex = -1;
  }
}

function navigateAutocomplete(dir) {
  const items = acDropdown.querySelectorAll('.autocomplete-item');
  if (!items.length) return;
  acIndex = Math.max(-1, Math.min(items.length - 1, acIndex + dir));
  items.forEach((it, i) => it.classList.toggle('ac-active', i === acIndex));
  if (acIndex >= 0) items[acIndex].scrollIntoView({ block: 'nearest' });
}

const debouncedAutocomplete = debounce((val) => showAutocomplete(val), 150);

// ── Near Me (Geolocation) ────────────────────────────────────
function showToast(msg, type = 'info') {
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast toast-${type}`;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 4000);
}

async function nearMe() {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser. Try searching by city instead.', 'error');
    return;
  }

  nearMeBtn.classList.add('loading');
  nearMeBtn.innerHTML = '<span class="spinner"></span> Locating...';

  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
    });

    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;

    // Geocode all practices that don't have lat/lng
    const toGeocode = PRACTICES.filter(p => !p.lat && p.city && p.state);
    let geocoded = 0;
    for (const p of toGeocode.slice(0, 30)) {
      const coords = await geocodeCity(p.city, p.state);
      if (coords) {
        p.lat = coords[0];
        p.lng = coords[1];
        geocoded++;
      }
    }

    // Calculate distances
    PRACTICES.forEach(p => {
      p._distance = (p.lat && p.lng) ? haversine(userLat, userLng, p.lat, p.lng) : 99999;
    });

    // Set sort to nearest
    if (sortSelect) sortSelect.value = 'nearest';
    applyFilters();

    showToast(`Found ${filtered.filter(p => p._distance < 100).length} practices within 100 miles`, 'success');
  } catch (err) {
    if (err.code === 1) {
      showToast('Location access denied. Try searching by city or zip instead.', 'error');
    } else {
      showToast('Could not determine your location. Try searching by city instead.', 'error');
    }
  } finally {
    nearMeBtn.classList.remove('loading');
    nearMeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Near Me';
  }
}

// ── Modal (with shareable link) ──────────────────────────────
function openModal(id) {
  const p = PRACTICES.find(x => x.id === id);
  if (!p) return;

  history.replaceState(null, '', `#practice/${p.id}`);

  const owned = p.blackOwned
    ? `<span class="tag tag-owned" style="font-size:12px;padding:4px 12px">Black-Owned Practice</span>`
    : '';

  const featuredBadge = p.featured
    ? `<span class="featured-badge" style="position:static;font-size:12px;padding:4px 14px;margin-bottom:8px;display:inline-block">&#9733; Featured Listing</span>`
    : '';

  const status = p.accepting
    ? `<span style="font-size:13px;font-weight:500;color:#4a6741">Currently accepting new clients</span>`
    : `<span style="font-size:13px;color:#9e8478">Currently on waitlist only</span>`;

  const careTags = p.care.map(c =>
    `<span class="tag tag-care">${c.replace('/Contraception','').replace('Care After Birth/','')}</span>`
  ).join('');

  const payTags = p.payment.map(pm =>
    `<span class="tag tag-payment">${pm}</span>`
  ).join('');

  const shareUrl = `${window.location.origin}${window.location.pathname}#practice/${p.id}`;

  const distanceInfo = (p._distance && p._distance < 99999)
    ? `<span style="font-size:12px;color:var(--sky);font-weight:500;margin-left:8px">${Math.round(p._distance)} miles away</span>`
    : '';

  modalBody.innerHTML = `
    <div class="modal-banner" style="background:${p.color}">
      <div class="modal-avatar" style="background:${p.color}">${p.abbr}</div>
    </div>
    <div class="modal-inner">
      ${featuredBadge}
      <div class="modal-name">${p.name} ${distanceInfo}</div>
      <div class="modal-subtitle">${formatLocation(p)} &bull; ${p.practiceType}</div>

      <div class="modal-badges">
        ${owned}
        ${status}
      </div>

      <div class="modal-section">
        <div class="modal-section-title">About This Practice</div>
        <div class="modal-text">${p.bio || 'No description available.'}</div>
      </div>

      <div class="modal-section">
        <div class="modal-section-title">Specialties</div>
        <div class="modal-text">${p.specialties || 'Not specified.'}</div>
      </div>

      <hr class="modal-divider" />

      <div class="modal-section">
        <div class="modal-section-title">Services Offered</div>
        <div class="modal-tags">${careTags || '<span style="color:var(--text-hint);font-size:13px">Not specified</span>'}</div>
      </div>

      <div class="modal-section" style="margin-top:14px">
        <div class="modal-section-title">Payment Accepted</div>
        <div class="modal-tags">${payTags || '<span style="color:var(--text-hint);font-size:13px">Not specified</span>'}</div>
      </div>

      <hr class="modal-divider" />

      <div class="modal-section">
        <div class="modal-section-title">Contact</div>
        ${p.phone ? `
        <div class="contact-item">
          <div class="contact-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.6a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 10.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 17z"/></svg>
          </div>
          <span>${p.phone}</span>
        </div>` : ''}
        ${p.email ? `
        <div class="contact-item">
          <div class="contact-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </div>
          <a href="mailto:${p.email}">${p.email}</a>
        </div>` : ''}
        ${p.website ? `
        <div class="contact-item">
          <div class="contact-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </div>
          <a href="${p.website}" target="_blank" rel="noopener">${p.website.replace('https://','')}</a>
        </div>` : ''}
        ${!p.phone && !p.email && !p.website ? '<span style="color:var(--text-hint);font-size:13px">No contact info available</span>' : ''}
      </div>

      <div class="modal-cta">
        ${p.email ? `<a href="mailto:${p.email}" class="btn-primary">Contact Practice</a>` : ''}
        ${p.website ? `<a href="${p.website}" target="_blank" rel="noopener" class="btn-outline">Visit Website</a>` : ''}
        <button class="btn-outline btn-share" onclick="copyShareLink('${shareUrl}', this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Share
        </button>
      </div>
    </div>`;

  modal.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function copyShareLink(url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '&#10003; Link Copied!';
    setTimeout(() => btn.innerHTML = orig, 2000);
  });
}

function closeModal() {
  modal.classList.remove('is-open');
  document.body.style.overflow = '';
  history.replaceState(null, '', window.location.pathname);
}

// ── Hash-Based Deep Links ────────────────────────────────────
function checkHash() {
  const hash = window.location.hash;
  const match = hash.match(/^#practice\/(\d+)$/);
  if (match) {
    const id = parseInt(match[1]);
    if (PRACTICES.length) {
      openModal(id);
    } else {
      const waitForData = setInterval(() => {
        if (PRACTICES.length) {
          clearInterval(waitForData);
          openModal(id);
        }
      }, 100);
    }
  }
}

// ── Mobile Sidebar Drawer ────────────────────────────────────
function openSidebar() {
  sidebar?.classList.add('is-open');
  sidebarOverlay?.classList.add('is-visible');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  sidebar?.classList.remove('is-open');
  sidebarOverlay?.classList.remove('is-visible');
  document.body.style.overflow = '';
}

// ── View Toggle (Grid / Map) ─────────────────────────────────
let currentView = 'grid';

function setView(view) {
  currentView = view;
  const gridContainer = document.getElementById('practices-grid');
  const mapContainer = document.getElementById('map-container');

  viewToggleBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  if (view === 'map') {
    gridContainer.style.display = 'none';
    mapContainer.style.display = 'block';
    initMap();
    updateMap();
  } else {
    gridContainer.style.display = '';
    mapContainer.style.display = 'none';
  }
}

// ── Map (Leaflet.js) ─────────────────────────────────────────
const CITY_COORDS = {};

async function geocodeCity(city, state) {
  const key = `${city},${state}`.toLowerCase();
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  try {
    const q = encodeURIComponent(`${city}, ${state}, USA`);
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`);
    const data = await resp.json();
    if (data.length) {
      const coords = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
      CITY_COORDS[key] = coords;
      return coords;
    }
  } catch (e) {
    console.warn('Geocode failed for', city, state, e);
  }
  return null;
}

function initMap() {
  if (mapInstance) return;
  const mapEl = document.getElementById('map-view');
  if (!mapEl) return;

  mapInstance = L.map('map-view').setView([37.5, -96], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18
  }).addTo(mapInstance);
}

async function updateMap() {
  if (!mapInstance) return;
  mapMarkers.forEach(m => mapInstance.removeLayer(m));
  mapMarkers = [];

  const toShow = filtered.slice(0, 50);
  for (const p of toShow) {
    if (!p.city || !p.state) continue;
    let coords = (p.lat && p.lng) ? [p.lat, p.lng] : await geocodeCity(p.city, p.state);
    if (!coords) continue;

    const color = p.featured ? '#c9973a' : (p.blackOwned ? '#b85c38' : '#4a6741');
    const marker = L.circleMarker(coords, {
      radius: p.featured ? 10 : 7,
      fillColor: color,
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85
    }).addTo(mapInstance);

    marker.bindPopup(`
      <div style="font-family:'DM Sans',sans-serif;min-width:180px">
        <strong style="font-size:14px">${p.name}</strong><br/>
        <span style="font-size:12px;color:#6b5247">${formatLocation(p)}</span><br/>
        <span style="font-size:12px;color:#6b5247">${p.practiceType}</span><br/>
        ${p.featured ? '<span style="font-size:11px;color:#c9973a;font-weight:600">&#9733; Featured</span><br/>' : ''}
        <a href="javascript:void(0)" onclick="closeMapPopups();openModal(${p.id})" style="font-size:12px;color:#b85c38;font-weight:500">View Profile &rarr;</a>
      </div>
    `);
    mapMarkers.push(marker);
  }

  if (mapMarkers.length) {
    const group = L.featureGroup(mapMarkers);
    mapInstance.fitBounds(group.getBounds().pad(0.1));
  }
}

function closeMapPopups() {
  if (mapInstance) mapInstance.closePopup();
}

// ── Newsletter ───────────────────────────────────────────────
const newsletterForm = document.getElementById('newsletter-form');
const newsletterMsg  = document.getElementById('newsletter-msg');

if (newsletterForm) {
  newsletterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('newsletter-email')?.value?.trim();
    if (!email) return;

    const btn = newsletterForm.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Subscribing...';

    try {
      const { error } = await db.from('newsletter_subscribers').insert([{ email }]);
      if (error) {
        if (error.code === '23505') {
          newsletterMsg.textContent = 'You\'re already subscribed!';
          newsletterMsg.className = 'newsletter-msg newsletter-msg--info';
        } else {
          throw error;
        }
      } else {
        newsletterMsg.textContent = 'Welcome! You\'re now subscribed.';
        newsletterMsg.className = 'newsletter-msg newsletter-msg--success';
        newsletterForm.reset();
      }
    } catch (err) {
      newsletterMsg.textContent = 'Something went wrong. Please try again.';
      newsletterMsg.className = 'newsletter-msg newsletter-msg--error';
    } finally {
      newsletterMsg.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Subscribe';
    }
  });
}

// ── Event Listeners ───────────────────────────────────────────

// Close modal
closeModalBtn?.addEventListener('click', closeModal);
modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Sidebar filters
document.querySelectorAll('.sidebar-filters input[type="checkbox"]')
  .forEach(cb => cb.addEventListener('change', applyFilters));

locationInput?.addEventListener('input', applyFilters);

// Hero keyword search + autocomplete
searchBtn?.addEventListener('click', () => { hideAutocomplete(); applyFilters(); });
heroSearch?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (acIndex >= 0) {
      const items = acDropdown.querySelectorAll('.autocomplete-item');
      if (items[acIndex]) selectAutocomplete(items[acIndex]);
    } else {
      hideAutocomplete();
      applyFilters();
    }
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    navigateAutocomplete(1);
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    navigateAutocomplete(-1);
    e.preventDefault();
  } else if (e.key === 'Escape') {
    hideAutocomplete();
  }
});
heroSearch?.addEventListener('input', (e) => {
  debouncedAutocomplete(e.target.value);
  applyFilters();
});
heroSearch?.addEventListener('blur', () => {
  setTimeout(hideAutocomplete, 200);
});

// State dropdown
stateSelect?.addEventListener('change', applyFilters);

// Sort dropdown
sortSelect?.addEventListener('change', applyFilters);

// Clear filters
clearBtn?.addEventListener('click', clearFilters);

// Mobile sidebar toggle
mobileToggle?.addEventListener('click', openSidebar);
sidebarOverlay?.addEventListener('click', closeSidebar);

// View toggle (grid/map)
viewToggleBtns.forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

// Near Me
nearMeBtn?.addEventListener('click', nearMe);

// Mobile nav toggle
const mobileNavToggle = document.getElementById('mobile-nav-toggle');
const mobileNav = document.getElementById('mobile-nav');
mobileNavToggle?.addEventListener('click', () => {
  mobileNav.classList.toggle('is-open');
});

// Hash navigation
window.addEventListener('hashchange', checkHash);

// ── Init ──────────────────────────────────────────────────────
async function init() {
  await loadPractices();
  populateStateDropdown();
  populateStateLinks();
  checkHash();
}
init();
