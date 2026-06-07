// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
const STATE = {
  countries: {},         // loaded country data keyed by slug
  countryIndex: [],      // parsed index.json countries array — single source of truth
  currentCountry: null,
  currentContinent: null, // tracks active continent for two-row desktop nav
  pool: [],              // {id, name, location, price_usd, duration, category, multi_day, custom}
  itinerary: {},         // {day: [{...item, hour?}]}
  dayCount: 5,
  hourMode: false,
  headcount: 10,
  filterCategory: '',
  filterPrice: '',
  filterRegion: '',
  filterSubRegion: '',
  searchQuery: '',
  currentView: 'activities',
  poolCollapsed: false,
};

// ═══════════════════════════════════════════════════════
// UTILITY: Safe JSON comment stripper
// ═══════════════════════════════════════════════════════
function stripJSONComments(text) {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }

    if (!inString && ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      result += '\n';
      continue;
    }
    result += ch;
  }
  return result;
}

// ═══════════════════════════════════════════════════════
// UTILITY: Is the current viewport mobile?
// ═══════════════════════════════════════════════════════
function isMobile() {
  return window.innerWidth <= 900;
}

// ═══════════════════════════════════════════════════════
// LOAD DATA
// ═══════════════════════════════════════════════════════
async function loadCountries() {
  const fill = document.getElementById('loading-fill');
  const txt  = document.getElementById('loading-text');

  txt.textContent = 'Loading index…';
  let indexData;
  try {
    const r = await fetch('index.json');
    if (!r.ok) throw new Error(`index.json returned ${r.status}`);
    indexData = await r.json();
  } catch(e) {
    txt.textContent = 'Error: could not load index.json';
    fill.style.width = '100%';
    fill.style.background = '#E57373';
    console.error('loadCountries: failed to fetch index.json', e);
    return;
  }

  STATE.countryIndex = indexData.countries;
  fill.style.width = '10%';

  txt.textContent = 'Loading destinations…';

  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} returned ${r.status}`);
    const text = await r.text();
    const clean = stripJSONComments(text);
    return JSON.parse(clean);
  }

  const results = await Promise.allSettled(
    STATE.countryIndex.map(entry => fetchJSON(entry.file))
  );

  results.forEach((result, i) => {
    const entry = STATE.countryIndex[i];
    if (result.status === 'fulfilled') {
      const data = result.value;
      if (Array.isArray(data)) {
        STATE.countries[entry.slug] = { country: entry.name, activities: data };
      } else if (data.activities && Array.isArray(data.activities)) {
        STATE.countries[entry.slug] = data;
      } else {
        const firstArray = Object.values(data).find(v => Array.isArray(v));
        STATE.countries[entry.slug] = { country: entry.name, activities: firstArray || [] };
        if (!firstArray) console.warn(`loadCountries: ${entry.file} has no activities array. Keys:`, Object.keys(data));
      }
      console.log(`✓ ${entry.name}: ${STATE.countries[entry.slug].activities.length} activities`);
    } else {
      console.warn(`loadCountries: failed to load ${entry.file}`, result.reason);
      STATE.countries[entry.slug] = { country: entry.name, activities: [] };
    }
  });

  fill.style.width = '100%';
  STATE.currentCountry = STATE.countryIndex[0].slug;
  // Set initial continent from first country
  STATE.currentContinent = STATE.countryIndex[0].continent || null;
  txt.textContent = 'Ready';

  setTimeout(() => {
    document.getElementById('loading').classList.add('done');
    initApp();
  }, 400);
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
function initApp() {
  buildNav();
  renderPool();
  renderActivityView();
  renderItinerary();
  bindEvents();
  for (let i = 1; i <= STATE.dayCount; i++) {
    if (!STATE.itinerary[i]) STATE.itinerary[i] = [];
  }
  updateLayoutHeight();
}

// ═══════════════════════════════════════════════════════
// NAV
// ═══════════════════════════════════════════════════════
function buildNav() {
  buildDesktopNav();
  buildMobileNav();
}

// ── DESKTOP NAV: two-row layout ─────────────────────────
// Row 1: Planner button + one pill per continent
// Row 2: Country tabs for the active continent only
function buildDesktopNav() {
  const nav = document.getElementById('nav-bar');
  nav.innerHTML = '';

  if (!STATE.countryIndex || !STATE.countryIndex.length) return;

  // ── Row 1: continent pills ───────────────────────────
  const row1 = document.createElement('div');
  row1.className = 'nav-row nav-row-continents';

  // Planner always visible in row 1
  const plannerBtn = document.createElement('button');
  plannerBtn.className = 'nav-tab nav-planner' + (STATE.currentCountry === '__planner' ? ' active' : '');
  plannerBtn.textContent = '📋 Planner';
  plannerBtn.dataset.country = '__planner';
  plannerBtn.addEventListener('click', () => switchTab('__planner'));
  row1.appendChild(plannerBtn);

  // Build continent map from index
  const continentMap = {};
  for (const entry of STATE.countryIndex) {
    const c = entry.continent || 'Other';
    if (!continentMap[c]) continentMap[c] = [];
    continentMap[c].push(entry);
  }

  const continentEmoji = {
    'Asia': '🌏', 'Americas': '🌎', 'Europe': '🌍',
    'Africa': '🌍', 'Oceania': '🌏', 'Other': '🌐',
  };

  // Ensure currentContinent is valid; fall back to first continent
  const continentNames = Object.keys(continentMap);
  if (!STATE.currentContinent || !continentMap[STATE.currentContinent]) {
    STATE.currentContinent = continentNames[0];
  }

  for (const [continent, entries] of Object.entries(continentMap)) {
    const isActive = continent === STATE.currentContinent && STATE.currentCountry !== '__planner';
    const pill = document.createElement('button');
    pill.className = 'nav-continent-pill' + (isActive ? ' active' : '');
    pill.textContent = `${continentEmoji[continent] || '🌐'} ${continent}`;
    pill.dataset.continent = continent;
    pill.addEventListener('click', () => {
      STATE.currentContinent = continent;
      // Switch to first country in this continent if not already on one within it
      const inContinent = entries.some(e => e.slug === STATE.currentCountry);
      if (!inContinent) {
        switchTab(entries[0].slug);
      } else {
        buildDesktopNav(); // just refresh the nav highlight
      }
    });
    row1.appendChild(pill);
  }

  nav.appendChild(row1);

  // ── Row 2: country tabs for active continent ─────────
  // Hidden when Planner is active (no country row needed)
  const row2 = document.createElement('div');
  row2.className = 'nav-row nav-row-countries';

  if (STATE.currentCountry !== '__planner') {
    const activeEntries = continentMap[STATE.currentContinent] || [];
    for (const entry of activeEntries) {
      const d = STATE.countries[entry.slug];
      const btn = document.createElement('button');
      btn.className = 'nav-tab' + (STATE.currentCountry === entry.slug ? ' active' : '');
      const count = document.createElement('span');
      count.className = 'tab-count';
      count.textContent = d ? d.activities.length : 0;
      btn.innerHTML = `${entry.flag} ${entry.name} `;
      btn.appendChild(count);
      btn.dataset.country = entry.slug;
      btn.addEventListener('click', () => switchTab(entry.slug));
      row2.appendChild(btn);
    }
    nav.appendChild(row2);
  }
}

// ── MOBILE NAV: continent dropdown groups (unchanged) ───
function buildMobileNav() {
  const nav = document.getElementById('mobile-nav');
  nav.innerHTML = '';

  if (!STATE.countryIndex || !STATE.countryIndex.length) return;

  const plannerBtn = document.createElement('button');
  plannerBtn.className = 'mobile-planner-btn' + (STATE.currentCountry === '__planner' ? ' active' : '');
  plannerBtn.textContent = '📋 Planner';
  plannerBtn.addEventListener('click', () => {
    closeAllDropdowns();
    switchTab('__planner');
  });
  nav.appendChild(plannerBtn);

  const continentMap = {};
  for (const entry of STATE.countryIndex) {
    const c = entry.continent || 'Other';
    if (!continentMap[c]) continentMap[c] = [];
    continentMap[c].push(entry);
  }

  const continentEmoji = {
    'Asia': '🌏', 'Americas': '🌎', 'Europe': '🌍',
    'Africa': '🌍', 'Oceania': '🌏', 'Other': '🌐',
  };

  for (const [continent, entries] of Object.entries(continentMap)) {
    const hasActive = entries.some(e => e.slug === STATE.currentCountry);

    const group = document.createElement('div');
    group.className = 'continent-group';

    const trigger = document.createElement('button');
    trigger.className = 'continent-trigger' + (hasActive ? ' has-active' : '');
    trigger.innerHTML = `${continentEmoji[continent] || '🌐'} ${continent} <span class="caret">▼</span>`;

    const dropdown = document.createElement('div');
    dropdown.className = 'continent-dropdown';

    for (const entry of entries) {
      const d = STATE.countries[entry.slug];
      const item = document.createElement('button');
      item.className = 'continent-dropdown-item' + (STATE.currentCountry === entry.slug ? ' active' : '');
      item.innerHTML = `
        <span>${entry.flag} ${entry.name}</span>
        <span class="item-count">${d ? d.activities.length : 0}</span>
      `;
      item.addEventListener('click', () => {
        closeAllDropdowns();
        switchTab(entry.slug);
      });
      dropdown.appendChild(item);
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        dropdown.classList.add('open');
        trigger.classList.add('open');
      }
    });

    group.appendChild(trigger);
    group.appendChild(dropdown);
    nav.appendChild(group);
  }
}

function closeAllDropdowns() {
  document.querySelectorAll('.continent-dropdown.open').forEach(d => d.classList.remove('open'));
  document.querySelectorAll('.continent-trigger.open').forEach(t => t.classList.remove('open'));
}

function switchTab(key) {
  STATE.currentCountry = key;
  // Keep currentContinent in sync when switching to a country
  if (key !== '__planner') {
    const entry = STATE.countryIndex.find(e => e.slug === key);
    if (entry && entry.continent) STATE.currentContinent = entry.continent;
  }
  STATE.filterCategory = '';
  STATE.filterPrice = '';
  STATE.filterRegion = '';
  STATE.filterSubRegion = '';
  STATE.searchQuery = '';
  document.getElementById('search-input').value = '';
  document.getElementById('filter-category').value = '';
  document.getElementById('filter-price').value = '';

  buildNav();

  if (key === '__planner') {
    switchView('itinerary');
  } else {
    switchView('activities');
    renderActivityView();
  }
}

// ═══════════════════════════════════════════════════════
// VIEW SWITCHER
// ═══════════════════════════════════════════════════════
function switchView(view) {
  STATE.currentView = view;
  document.getElementById('activity-view').style.display  = view === 'activities' ? 'flex' : 'none';
  document.getElementById('itinerary-view').style.display = view === 'itinerary'  ? 'flex' : 'none';
  document.getElementById('export-view').style.display    = view === 'export'     ? 'block' : 'none';

  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));

  if (view === 'itinerary') renderItinerary();
  if (view === 'export') renderExport();

  requestAnimationFrame(updateLayoutHeight);
}

// ═══════════════════════════════════════════════════════
// ACTIVITY VIEW
// ═══════════════════════════════════════════════════════
function renderActivityView() {
  if (STATE.currentCountry === '__planner') return;
  const data = STATE.countries[STATE.currentCountry];
  if (!data) return;

  document.getElementById('country-label').textContent = data.country || '';

  buildRegionSelects(data);
  renderCards(data);
}

// ── Region key detection ─────────────────────────────────
function getRegionKey(activities) {
  return activities.some(a => a.region != null && a.region !== '') ? 'region' : 'destination';
}

// ── Unified region selects (desktop + mobile) ───────────
// 2C: replaces pill bars on desktop and the old mobile-only selects.
// On desktop the wrapper sits inline in the filter bar area.
// On mobile it stacks vertically (CSS handles the layout difference).
function buildRegionSelects(data) {
  // Always hide the old pill bars — they are no longer used
  const pillBar    = document.getElementById('region-pills');
  const subPillBar = document.getElementById('subregion-pills');
  if (pillBar)    pillBar.style.display    = 'none';
  if (subPillBar) subPillBar.style.display = 'none';

  const wrapper = document.getElementById('region-select-bar');
  if (!wrapper) return;
  wrapper.innerHTML = '';

  const acts      = data.activities;
  const regionKey = getRegionKey(acts);

  const regions = [
    ...new Set(acts.map(a => a[regionKey]).filter(v => v != null && v !== ''))
  ].sort();

  if (!regions.length) {
    wrapper.style.display = 'none';
    return;
  }
  wrapper.style.display = '';

  // Region select
  const allLabel = regionKey === 'destination' ? 'All Cities' : 'All Regions';
  const regionSel = document.createElement('select');
  regionSel.id = 'region-select';
  regionSel.className = 'region-select';

  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = allLabel;
  regionSel.appendChild(allOpt);

  for (const r of regions) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    if (STATE.filterRegion === r) opt.selected = true;
    regionSel.appendChild(opt);
  }

  regionSel.addEventListener('change', () => {
    STATE.filterRegion = regionSel.value;
    STATE.filterSubRegion = '';
    buildRegionSelects(data);
    renderCards(data);
  });

  wrapper.appendChild(regionSel);

  // Sub-region select — only when a region is selected and has multiple cities
  if (STATE.filterRegion && regionKey === 'region') {
    const inRegion = acts.filter(a => a.region === STATE.filterRegion);
    const cities = [
      ...new Set(inRegion.map(a => a.destination).filter(v => v != null && v !== ''))
    ].sort();

    if (cities.length > 1) {
      const citySel = document.createElement('select');
      citySel.id = 'subregion-select';
      citySel.className = 'region-select';

      const allCityOpt = document.createElement('option');
      allCityOpt.value = '';
      allCityOpt.textContent = 'All ' + STATE.filterRegion + ' Cities';
      citySel.appendChild(allCityOpt);

      for (const city of cities) {
        const opt = document.createElement('option');
        opt.value = city;
        opt.textContent = city;
        if (STATE.filterSubRegion === city) opt.selected = true;
        citySel.appendChild(opt);
      }

      citySel.addEventListener('change', () => {
        STATE.filterSubRegion = citySel.value;
        buildRegionSelects(data);
        renderCards(data);
      });

      wrapper.appendChild(citySel);
    }
  }
}

function renderCards(data) {
  const grid = document.getElementById('activity-grid');
  let acts = data.activities;

  const regionKey = getRegionKey(acts);

  if (STATE.filterRegion) {
    acts = acts.filter(a => {
      const val = a[regionKey];
      return val != null && val === STATE.filterRegion;
    });
  }
  if (STATE.filterSubRegion) {
    acts = acts.filter(a => {
      const val = a.destination;
      return val != null && val === STATE.filterSubRegion;
    });
  }
  if (STATE.filterCategory) {
    acts = acts.filter(a => (a.category || '') === STATE.filterCategory);
  }
  if (STATE.searchQuery) {
    const q = STATE.searchQuery.toLowerCase();
    acts = acts.filter(a =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q) ||
      (a.destination || '').toLowerCase().includes(q)
    );
  }
  if (STATE.filterPrice) {
    if (STATE.filterPrice === 'free') {
      acts = acts.filter(a => (a.price_usd || 0) === 0);
    } else if (STATE.filterPrice === '200+') {
      acts = acts.filter(a => (a.price_usd || 0) >= 200);
    } else {
      const [lo, hi] = STATE.filterPrice.split('-').map(Number);
      acts = acts.filter(a => (a.price_usd || 0) >= lo && (a.price_usd || 0) < hi);
    }
  }

  document.getElementById('filter-count').textContent = `${acts.length} activities`;

  if (!acts.length) {
    grid.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>No activities match your filters.<br>Try adjusting your search.</p></div>';
    return;
  }

  const inPool = new Set(STATE.pool.map(p => p.id));
  grid.innerHTML = '';
  for (const act of acts) {
    grid.appendChild(buildActivityCard(act, inPool.has(act.id)));
  }
}

function buildActivityCard(act, added) {
  const card = document.createElement('div');
  card.className = 'activity-card' + (act.multi_day ? ' multi-day' : '') + (added ? ' added' : '');

  const catKey = (act.category || '')
    .replace('Food & Dining', 'Food')
    .replace('Water Sports', 'Water')
    .replace('& ', '')
    .replace(' ', '');
  const priceStr   = act.price_usd === 0 ? 'Free' : `$${act.price_usd}`;
  const priceRange = (act.price_usd_min !== undefined && act.price_usd_min !== act.price_usd_max)
    ? `$${act.price_usd_min}–$${act.price_usd_max}` : priceStr;
  const dur = act.duration >= 24
    ? `${Math.round(act.duration / 24)}d` : `${act.duration}h`;

  card.innerHTML = `
    <div class="card-header">
      <span class="card-category cat-${catKey}">${act.category || 'General'}</span>
      <div class="card-name">${act.name}</div>
      <div class="card-location">📍 ${act.destination || act.location || ''}</div>
    </div>
    <div class="card-desc">${act.description || ''}</div>
    <div class="card-footer">
      <div class="card-meta">
        <span class="price">💰 ${priceRange}</span>
        <span>⏱ ${dur}</span>
        ${act.multi_day ? '<span style="color:var(--gold-dim)">★ Multi-day</span>' : ''}
      </div>
      <button class="card-add-btn${added ? ' added' : ''}" data-id="${act.id}">${added ? '✓ Added' : 'Add to Trip'}</button>
    </div>
  `;

  card.querySelector('.card-add-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    // If already in pool, toggle it off (same on both platforms)
    if (STATE.pool.find(p => p.id === act.id)) {
      removeFromPool(act.id);
      return;
    }
    // 5C: On mobile, show a two-option choice sheet.
    // On desktop, add to pool immediately (existing behavior).
    if (isMobile()) {
      showAddToTripSheet(act);
    } else {
      addToPool(act);
    }
  });

  return card;
}

// ── 5C: Mobile "Add to Trip" choice sheet ───────────────
// Shows "Save to Pool" and "Schedule a Day" options.
// Both paths add to the pool so cost tracking stays accurate.
function showAddToTripSheet(act) {
  const existing = document.getElementById('add-trip-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'tap-assign-overlay';
  overlay.id = 'add-trip-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'tap-assign-sheet';

  sheet.innerHTML = `
    <div class="tap-assign-title">${act.name}</div>
    <div class="tap-assign-sub">What would you like to do?</div>
    <div class="add-trip-choices">
      <button class="add-trip-choice-btn" id="choice-pool">
        <span class="choice-icon">🗂</span>
        <span class="choice-label">Save to Pool</span>
        <span class="choice-desc">Add to your trip pool for later</span>
      </button>
      <button class="add-trip-choice-btn" id="choice-day">
        <span class="choice-icon">📅</span>
        <span class="choice-label">Schedule a Day</span>
        <span class="choice-desc">Assign directly to a day</span>
      </button>
    </div>
    <button class="tap-assign-cancel">Cancel</button>
  `;

  sheet.querySelector('#choice-pool').addEventListener('click', () => {
    overlay.remove();
    addToPool(act);
  });

  sheet.querySelector('#choice-day').addEventListener('click', () => {
    overlay.remove();
    // Add to pool first (ensures cost tracking), then open day picker
    if (!STATE.pool.find(p => p.id === act.id)) addToPool(act);
    showTapAssign(act);
  });

  sheet.querySelector('.tap-assign-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

// ═══════════════════════════════════════════════════════
// POOL
// ═══════════════════════════════════════════════════════
function addToPool(act) {
  if (STATE.pool.find(p => p.id === act.id)) return;
  STATE.pool.push({ ...act });
  renderPool();
  refreshCardsAddedState();
  toast(`${act.name} added to trip pool`, 'success');
}

function removeFromPool(id) {
  STATE.pool = STATE.pool.filter(p => p.id !== id);
  renderPool();
  refreshCardsAddedState();
  for (const day of Object.keys(STATE.itinerary)) {
    STATE.itinerary[day] = STATE.itinerary[day].filter(i => i.id !== id);
  }
  if (STATE.currentView === 'itinerary') renderItinerary();
}

function refreshCardsAddedState() {
  const inPool = new Set(STATE.pool.map(p => p.id));
  document.querySelectorAll('.activity-card').forEach(card => {
    const btn = card.querySelector('.card-add-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    const added = inPool.has(id);
    card.classList.toggle('added', added);
    btn.classList.toggle('added', added);
    btn.textContent = added ? '✓ Added' : 'Add to Trip';
  });
}

function renderPool() {
  const body  = document.getElementById('pool-body');
  const empty = document.getElementById('pool-empty');
  const meta  = document.getElementById('pool-meta');
  const total = STATE.pool.reduce((s, p) => s + (p.price_usd || 0), 0);
  const perPerson = STATE.headcount > 0 ? Math.round(total / STATE.headcount) : 0;

  meta.textContent = `${STATE.pool.length} activit${STATE.pool.length === 1 ? 'y' : 'ies'} selected`;
  document.getElementById('pool-total').textContent = '$' + total.toLocaleString();
  document.getElementById('pool-per-person').textContent = '$' + perPerson.toLocaleString();

  if (!STATE.pool.length) {
    empty.style.display = 'block';
    body.querySelectorAll('.pool-card').forEach(c => c.remove());
    updateMobilePoolToggleLabel();
    return;
  }
  empty.style.display = 'none';

  body.querySelectorAll('.pool-card').forEach(c => c.remove());
  for (const item of STATE.pool) {
    body.appendChild(buildPoolCard(item));
  }
  updateMobilePoolToggleLabel();
}

function buildPoolCard(item) {
  const card = document.createElement('div');
  card.className = 'pool-card';
  card.draggable = true;
  card.dataset.id = item.id;
  const dur = item.duration >= 24 ? `${Math.round(item.duration / 24)}d` : `${item.duration}h`;

  // 4C: "Assign to Day" button removed from pool cards.
  // Desktop: drag from pool to itinerary day column.
  // Mobile: use "Schedule a Day" from the Add to Trip sheet,
  //         or long-press itinerary items to rearrange.
  card.innerHTML = `
    <div class="pool-card-name">${item.name}</div>
    <div class="pool-card-meta">
      <span class="pool-card-badge">${item.country || ''}</span>
      <span class="pool-card-badge price">$${item.price_usd || 0}</span>
      <span class="pool-card-badge">${dur}</span>
    </div>
    <button class="pool-card-remove" data-id="${item.id}">✕</button>
  `;

  card.querySelector('.pool-card-remove').addEventListener('click', () => removeFromPool(item.id));

  // Desktop drag-and-drop from pool to itinerary
  card.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ source: 'pool', id: item.id }));
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));

  return card;
}

// ═══════════════════════════════════════════════════════
// ITINERARY
// ═══════════════════════════════════════════════════════

const SLOT_H    = 60;  // px per hour
const DAY_START = 6;   // 6 AM
const DAY_HOURS = 24;  // render 24 hours

function renderItinerary() {
  const canvas = document.getElementById('itinerary-canvas');
  canvas.innerHTML = '';

  for (let i = 1; i <= STATE.dayCount; i++) {
    if (!STATE.itinerary[i]) STATE.itinerary[i] = [];
  }

  for (let day = 1; day <= STATE.dayCount; day++) {
    canvas.appendChild(buildDayColumn(day));
  }

  requestAnimationFrame(updateLayoutHeight);
}

function buildDayColumn(day) {
  const col = document.createElement('div');
  col.className = 'day-column';
  col.dataset.day = day;

  const itemCount = STATE.itinerary[day]?.length || 0;
  col.innerHTML = `
    <div class="day-header">
      <span>Day ${day}</span>
      <span style="font-size:.68rem">${itemCount} item${itemCount === 1 ? '' : 's'}</span>
    </div>
    <div class="day-body" id="day-body-${day}" data-day="${day}"></div>
  `;

  const body = col.querySelector('.day-body');

  if (STATE.hourMode) {
    renderTimeline(body, day);
  } else {
    renderDayItems(body, day);
  }

  return col;
}

// ── LIST MODE (hour mode OFF) ────────────────────────────
function renderDayItems(body, day) {
  body.style.padding = '8px';
  const items = STATE.itinerary[day] || [];

  body.addEventListener('dragover', e => { e.preventDefault(); body.classList.add('drag-over'); });
  body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
  body.addEventListener('drop', e => {
    e.preventDefault();
    body.classList.remove('drag-over');
    handleDrop(e, day, null);
  });

  if (!items.length) {
    const zone = document.createElement('div');
    zone.className = 'day-drop-zone';
    zone.textContent = 'Drop activities here';
    body.appendChild(zone);
  }
  for (const item of items) {
    body.appendChild(buildItineraryItem(item, day));
  }
}

// ── TIMELINE MODE (hour mode ON) ─────────────────────────
function renderTimeline(body, day) {
  body.style.padding = '0';
  const items = STATE.itinerary[day] || [];

  // Unscheduled bin
  const unscheduled = items.filter(i => i.hour == null);
  if (unscheduled.length) {
    const bin = document.createElement('div');
    bin.className = 'unscheduled-block';

    bin.addEventListener('dragover', e => { e.preventDefault(); bin.style.background = 'rgba(201,168,76,.06)'; });
    bin.addEventListener('dragleave', () => bin.style.background = '');
    bin.addEventListener('drop', e => {
      e.preventDefault();
      bin.style.background = '';
      handleDrop(e, day, null);
    });

    bin.innerHTML = '<div class="unscheduled-label">Unscheduled — drag to timeline to schedule</div>';
    unscheduled.forEach(item => bin.appendChild(buildItineraryItem(item, day)));
    body.appendChild(bin);
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'timeline-wrapper';
  body.appendChild(wrapper);

  const grid = document.createElement('div');
  grid.className = 'timeline-grid';
  grid.style.height = (DAY_HOURS * SLOT_H) + 'px';
  wrapper.appendChild(grid);

  // Hour rows
  for (let i = 0; i < DAY_HOURS; i++) {
    const h = (DAY_START + i) % 24;
    const row = document.createElement('div');
    row.className = 'timeline-row';
    row.style.top = (i * SLOT_H) + 'px';

    const label = document.createElement('div');
    label.className = 'timeline-hour-label';
    label.textContent = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;

    const half = document.createElement('div');
    half.className = 'timeline-half';

    row.appendChild(label);
    row.appendChild(half);
    grid.appendChild(row);
  }

  // Drag-capture surface
  const surface = document.createElement('div');
  surface.className = 'timeline-drop-surface';
  grid.appendChild(surface);

  const ghostLine = document.createElement('div');
  ghostLine.className = 'timeline-ghost-line';
  ghostLine.style.display = 'none';
  grid.appendChild(ghostLine);

  surface.addEventListener('dragenter', e => {
    e.preventDefault();
    surface.classList.add('drag-active');
    ghostLine.style.display = 'block';
  });
  surface.addEventListener('dragleave', e => {
    if (!surface.contains(e.relatedTarget)) {
      surface.classList.remove('drag-active');
      ghostLine.style.display = 'none';
    }
  });
  surface.addEventListener('dragover', e => {
    e.preventDefault();
    const { hour, snapY } = hourFromY(e.offsetY);
    ghostLine.style.top  = snapY + 'px';
    ghostLine.style.display = 'block';
    e.dataTransfer.dropEffect = 'move';
  });
  surface.addEventListener('drop', e => {
    e.preventDefault();
    surface.classList.remove('drag-active');
    ghostLine.style.display = 'none';
    const { hour } = hourFromY(e.offsetY);
    handleDrop(e, day, hour);
  });

  // Scheduled blocks
  const scheduled = items.filter(i => i.hour != null);
  const columns   = resolveColumns(scheduled);

  for (const { item, col, totalCols } of columns) {
    grid.appendChild(buildTimelineBlock(item, day, col, totalCols));
  }

  // Current-time line
  if (day === 1) {
    const now  = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const startMins = DAY_START * 60;
    const offsetMins = (mins - startMins + 24 * 60) % (24 * 60);
    const topPx = (offsetMins / 60) * SLOT_H;
    const nowLine = document.createElement('div');
    nowLine.className = 'timeline-now-line';
    nowLine.style.top = topPx + 'px';
    grid.appendChild(nowLine);
  }
}

function hourFromY(offsetY) {
  const rawHour  = offsetY / SLOT_H;
  const hour     = (Math.floor(rawHour) + DAY_START) % 24;
  const snapY    = Math.floor(rawHour) * SLOT_H;
  return { hour, snapY };
}

function resolveColumns(items) {
  const sorted = [...items].sort((a, b) => a.hour - b.hour);
  const result = [];

  for (const item of sorted) {
    const startH = item.hour;
    const endH   = startH + (item.duration || 1);
    let col = 0;
    const usedCols = result
      .filter(r => r.item.hour < endH && (r.item.hour + (r.item.duration || 1)) > startH)
      .map(r => r.col);
    while (usedCols.includes(col)) col++;
    result.push({ item, col, totalCols: 1 });
  }

  for (const entry of result) {
    const startH = entry.item.hour;
    const endH   = startH + (entry.item.duration || 1);
    const concurrent = result.filter(r =>
      r.item.hour < endH && (r.item.hour + (r.item.duration || 1)) > startH
    );
    const maxCol = Math.max(...concurrent.map(r => r.col)) + 1;
    entry.totalCols = maxCol;
  }

  return result;
}

function buildTimelineBlock(item, day, col, totalCols) {
  const startH = item.hour;
  const dur    = Math.max(item.duration || 1, 0.25);
  const topPx  = ((startH - DAY_START + 24) % 24) * SLOT_H;
  const hPx    = dur * SLOT_H;
  const isShort = hPx < 46;

  const colW    = (100 / totalCols);
  const leftPct = col * colW;

  const el = document.createElement('div');
  el.className = 'timeline-block' + (item.custom ? ' custom-item' : '');
  el.draggable  = true;
  el.dataset.id  = item.id;
  el.dataset.day = day;
  if (isShort) el.dataset.short = 'true';

  el.style.top    = topPx + 'px';
  el.style.height = hPx   + 'px';
  el.style.left   = `calc(${leftPct}% + 2px)`;
  el.style.right  = 'auto';
  el.style.width  = `calc(${colW}% - 4px)`;

  const endH   = startH + dur;
  const endDisp = endH >= 24 ? endH - 24 : endH;
  const timeStr = `${formatHour(startH)} – ${formatHour(endDisp)}`;

  el.innerHTML = `
    <div class="timeline-block-name">${item.name}</div>
    <div class="timeline-block-time">${timeStr} · $${item.price_usd || 0}</div>
    <button class="timeline-block-remove" title="Remove">✕</button>
  `;

  el.querySelector('.timeline-block-remove').addEventListener('click', e => {
    e.stopPropagation();
    removeFromItinerary(item.id, day);
  });

  // Desktop drag
  el.addEventListener('dragstart', e => {
    const rect = el.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const hourOffset = offsetY / SLOT_H;
    e.dataTransfer.setData('text/plain', JSON.stringify({
      source: 'itinerary', id: item.id, fromDay: day, hourOffset
    }));
    setTimeout(() => el.classList.add('dragging'), 0);
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));

  // 4C: Mobile long-press drag
  attachLongPressDrag(el, item, day);

  return el;
}

// ── SHARED ITEM (list mode + unscheduled bin) ─────────────
function buildItineraryItem(item, day) {
  const el = document.createElement('div');
  el.className = 'itinerary-item' + (item.custom ? ' custom-item' : '');
  el.draggable = true;
  el.dataset.id = item.id;
  el.dataset.day = day;

  const dur = item.duration >= 24 ? `${Math.round(item.duration / 24)}d` : `${item.duration}h`;
  el.innerHTML = `
    <div class="itinerary-item-name">${item.name}</div>
    <div class="itinerary-item-meta">
      <span>$${item.price_usd || 0}</span>
      <span>•</span>
      <span>${dur}</span>
      ${item.hour != null ? `<span>• ${formatHour(item.hour)}</span>` : ''}
    </div>
    <button class="itinerary-item-remove" data-id="${item.id}" data-day="${day}">✕</button>
  `;

  el.querySelector('.itinerary-item-remove').addEventListener('click', e => {
    e.stopPropagation();
    removeFromItinerary(item.id, day);
  });

  // Desktop drag
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', JSON.stringify({
      source: 'itinerary', id: item.id, fromDay: day, hourOffset: 0
    }));
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));

  // 4C: Mobile long-press drag
  attachLongPressDrag(el, item, day);

  return el;
}

// ── 4C: Long-press touch drag for mobile itinerary items ──
// Hold ~400ms to initiate; then drag finger to a day column to move.
// Visual feedback: gold border + slight scale on activation.
function attachLongPressDrag(el, item, fromDay) {
  let holdTimer = null;
  let dragActive = false;
  let touchDragEl = null; // floating clone shown under finger

  function cancelHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
  }

  function startFloatingClone(touch) {
    // Create a lightweight visual clone that follows the finger
    touchDragEl = document.createElement('div');
    touchDragEl.className = 'touch-drag-clone';
    touchDragEl.textContent = item.name;
    touchDragEl.style.left = (touch.clientX - 80) + 'px';
    touchDragEl.style.top  = (touch.clientY - 20) + 'px';
    document.body.appendChild(touchDragEl);
  }

  function moveFloatingClone(touch) {
    if (!touchDragEl) return;
    touchDragEl.style.left = (touch.clientX - 80) + 'px';
    touchDragEl.style.top  = (touch.clientY - 20) + 'px';
  }

  function removeFloatingClone() {
    if (touchDragEl) { touchDragEl.remove(); touchDragEl = null; }
  }

  // Highlight day columns as potential drop targets
  function highlightDropTargets(on) {
    document.querySelectorAll('.day-body').forEach(body => {
      body.classList.toggle('touch-drop-target', on);
    });
  }

  function findDayBodyUnder(x, y) {
    // Temporarily hide clone so elementFromPoint works through it
    if (touchDragEl) touchDragEl.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    if (touchDragEl) touchDragEl.style.display = '';
    if (!el) return null;
    return el.closest('.day-body');
  }

  el.addEventListener('touchstart', e => {
    if (!isMobile()) return;
    dragActive = false;
    holdTimer = setTimeout(() => {
      dragActive = true;
      el.classList.add('long-press-active');
      highlightDropTargets(true);
      // Haptic if supported
      if (navigator.vibrate) navigator.vibrate(40);
      const touch = e.touches[0];
      startFloatingClone(touch);
    }, 400);
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (!dragActive) { cancelHold(); return; }
    e.preventDefault(); // prevent scroll during drag
    const touch = e.touches[0];
    moveFloatingClone(touch);

    // Highlight the day body currently under the finger
    document.querySelectorAll('.day-body').forEach(b => b.classList.remove('touch-drop-hover'));
    const target = findDayBodyUnder(touch.clientX, touch.clientY);
    if (target) target.classList.add('touch-drop-hover');
  }, { passive: false });

  el.addEventListener('touchend', e => {
    cancelHold();
    el.classList.remove('long-press-active');
    document.querySelectorAll('.day-body').forEach(b => {
      b.classList.remove('touch-drop-target', 'touch-drop-hover');
    });

    if (!dragActive) { removeFloatingClone(); return; }
    dragActive = false;

    const touch = e.changedTouches[0];
    removeFloatingClone();

    const targetBody = findDayBodyUnder(touch.clientX, touch.clientY);
    if (!targetBody) return;

    const toDay = parseInt(targetBody.dataset.day);
    if (!toDay) return;

    // Move the item from fromDay to toDay
    const fromItems = STATE.itinerary[fromDay] || [];
    const idx = fromItems.findIndex(i => i.id === item.id);
    if (idx === -1) return;
    const [moved] = fromItems.splice(idx, 1);
    moved.hour = null; // drop into unscheduled on touch (no pixel-precise hour)
    if (!STATE.itinerary[toDay]) STATE.itinerary[toDay] = [];
    STATE.itinerary[toDay].push(moved);

    renderItinerary();
    toast(`${item.name} → Day ${toDay}`, 'success');
  }, { passive: true });

  el.addEventListener('touchcancel', () => {
    cancelHold();
    dragActive = false;
    el.classList.remove('long-press-active');
    document.querySelectorAll('.day-body').forEach(b => {
      b.classList.remove('touch-drop-target', 'touch-drop-hover');
    });
    removeFloatingClone();
  }, { passive: true });
}

function formatHour(h) {
  const norm = ((h % 24) + 24) % 24;
  if (norm === 0)  return '12:00 AM';
  if (norm < 12)   return `${norm}:00 AM`;
  if (norm === 12) return '12:00 PM';
  return `${norm - 12}:00 PM`;
}

function handleDrop(e, toDay, hour) {
  let data;
  try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }

  if (data.source === 'pool') {
    const item = STATE.pool.find(p => p.id === data.id);
    if (!item) return;
    const already = (STATE.itinerary[toDay] || []).find(i => i.id === data.id);
    if (already) {
      if (hour != null) { already.hour = hour; renderItinerary(); }
      else { toast('Already on this day'); }
      return;
    }
    if (!STATE.itinerary[toDay]) STATE.itinerary[toDay] = [];
    const finalHour = hour != null ? Math.round((hour - (data.hourOffset || 0)) * 2) / 2 : null;
    STATE.itinerary[toDay].push({ ...item, hour: finalHour });
    toast(`${item.name} → Day ${toDay}`, 'success');

  } else if (data.source === 'itinerary') {
    const fromDay = parseInt(data.fromDay);
    const idx = (STATE.itinerary[fromDay] || []).findIndex(i => i.id === data.id);
    if (idx === -1) return;
    const [item] = STATE.itinerary[fromDay].splice(idx, 1);

    if (hour != null) {
      item.hour = Math.round((hour - (data.hourOffset || 0)) * 2) / 2;
      item.hour = ((item.hour % 24) + 24) % 24;
    } else {
      item.hour = null;
    }

    if (!STATE.itinerary[toDay]) STATE.itinerary[toDay] = [];
    STATE.itinerary[toDay].push(item);
  }

  renderItinerary();
}

function removeFromItinerary(id, day) {
  STATE.itinerary[day] = (STATE.itinerary[day] || []).filter(i => i.id !== id);
  renderItinerary();
}

// ═══════════════════════════════════════════════════════
// EXPORT / SUMMARY
// ═══════════════════════════════════════════════════════
function renderExport() {
  const container = document.getElementById('export-content');
  const totalCost = STATE.pool.reduce((s, p) => s + (p.price_usd || 0), 0);
  const perPerson = STATE.headcount > 0 ? Math.round(totalCost / STATE.headcount) : 0;

  let html = `<div class="export-section">
    <h3>Trip Overview</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:8px">
      <div style="background:var(--surface3);border-radius:6px;padding:14px;text-align:center">
        <div style="font-size:1.6rem;color:var(--gold);font-family:var(--font-display)">${STATE.pool.length}</div>
        <div style="font-size:.72rem;color:var(--text-dim);margin-top:2px">Activities Selected</div>
      </div>
      <div style="background:var(--surface3);border-radius:6px;padding:14px;text-align:center">
        <div style="font-size:1.6rem;color:var(--gold);font-family:var(--font-display)">${STATE.dayCount}</div>
        <div style="font-size:.72rem;color:var(--text-dim);margin-top:2px">Days Planned</div>
      </div>
      <div style="background:var(--surface3);border-radius:6px;padding:14px;text-align:center">
        <div style="font-size:1.6rem;color:var(--gold);font-family:var(--font-display)">$${totalCost.toLocaleString()}</div>
        <div style="font-size:.72rem;color:var(--text-dim);margin-top:2px">Total Estimated Cost</div>
      </div>
      <div style="background:var(--surface3);border-radius:6px;padding:14px;text-align:center">
        <div style="font-size:1.6rem;color:var(--gold);font-family:var(--font-display)">$${perPerson.toLocaleString()}</div>
        <div style="font-size:.72rem;color:var(--text-dim);margin-top:2px">Per Person (${STATE.headcount})</div>
      </div>
    </div>
  </div>`;

  let hasItinerary = false;
  let itinHtml = '';
  for (let d = 1; d <= STATE.dayCount; d++) {
    const items = STATE.itinerary[d] || [];
    if (!items.length) continue;
    hasItinerary = true;
    const sorted = [...items].sort((a, b) => (a.hour ?? 99) - (b.hour ?? 99));
    itinHtml += `<div class="export-day"><h4>Day ${d}</h4>`;
    for (const item of sorted) {
      const dur = item.duration >= 24 ? `${Math.round(item.duration / 24)} days` : `${item.duration} hrs`;
      let timeStr = '';
      if (item.hour != null) {
        const endH = item.hour + (item.duration || 0);
        timeStr = ` — ${formatHour(item.hour)} – ${formatHour(endH)}`;
      }
      itinHtml += `<div class="export-item"><span>${item.name}${timeStr}</span><span style="color:var(--text-dim)">$${item.price_usd || 0} · ${dur}</span></div>`;
    }
    itinHtml += '</div>';
  }
  if (hasItinerary) {
    html += `<div class="export-section"><h3>Itinerary Schedule</h3>${itinHtml}</div>`;
  }

  if (STATE.pool.length) {
    html += `<div class="export-section"><h3>All Selected Activities</h3>`;
    for (const item of STATE.pool) {
      const dur = item.duration >= 24 ? `${Math.round(item.duration / 24)} days` : `${item.duration} hrs`;
      html += `<div class="export-item"><span>${item.name} <span style="color:var(--text-muted);font-size:.7rem">— ${item.country || ''}</span></span><span style="color:var(--text-dim)">$${item.price_usd || 0} · ${dur}</span></div>`;
    }
    html += `<div class="export-total"><span>Total Estimated Cost</span><span style="color:var(--gold)">$${totalCost.toLocaleString()} ($${perPerson.toLocaleString()} / person)</span></div>`;
    html += '</div>';
  }

  html += `<div style="display:flex;gap:10px;justify-content:flex-end;padding:8px 0">
    <button class="btn btn-outline" onclick="window.print()">🖨️ Print / Save PDF</button>
    <button class="btn btn-outline" onclick="exportJSON()">📥 Export JSON</button>
  </div>`;

  container.innerHTML = html;
}

function exportJSON() {
  const data = {
    trip_name: 'Bachelor Party Trip',
    generated: new Date().toISOString(),
    headcount: STATE.headcount,
    total_cost_usd: STATE.pool.reduce((s, p) => s + (p.price_usd || 0), 0),
    pool: STATE.pool,
    itinerary: STATE.itinerary,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'bachelor-trip.json'; a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════
// SAVE / LOAD
// ═══════════════════════════════════════════════════════
function saveTrip(name) {
  const key  = 'bp_trip_' + (name || 'default').replace(/\s+/g, '_');
  const data = {
    name, saved: new Date().toISOString(),
    pool: STATE.pool, itinerary: STATE.itinerary,
    dayCount: STATE.dayCount, headcount: STATE.headcount,
  };
  localStorage.setItem(key, JSON.stringify(data));
  localStorage.setItem('bp_last_trip', key);
  toast(`Trip "${name}" saved`, 'success');
}

function loadLastTrip() {
  const key = localStorage.getItem('bp_last_trip');
  if (!key) return;
  const raw = localStorage.getItem(key);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    STATE.pool      = data.pool      || [];
    STATE.itinerary = data.itinerary || {};
    STATE.dayCount  = data.dayCount  || 5;
    STATE.headcount = data.headcount || 10;
    document.getElementById('day-count').value = STATE.dayCount;
    document.getElementById('headcount').value  = STATE.headcount;
    renderPool();
    renderItinerary();
    toast(`Trip "${data.name}" loaded`, 'success');
  } catch(e) { toast('Could not load trip'); }
}

// ═══════════════════════════════════════════════════════
// CUSTOM EVENT
// ═══════════════════════════════════════════════════════
function openCustomModal() {
  document.getElementById('modal-custom').classList.add('open');
  document.getElementById('custom-name').focus();
}
function closeCustomModal() {
  document.getElementById('modal-custom').classList.remove('open');
}
function saveCustomEvent() {
  const name = document.getElementById('custom-name').value.trim();
  if (!name) { toast('Please enter an event name'); return; }
  const item = {
    id:          'custom_' + Date.now(),
    name,
    location:    document.getElementById('custom-location').value.trim(),
    country:     'Custom',
    category:    document.getElementById('custom-category').value,
    price_usd:     parseFloat(document.getElementById('custom-price').value)    || 0,
    price_usd_min: parseFloat(document.getElementById('custom-price').value)    || 0,
    price_usd_max: parseFloat(document.getElementById('custom-price').value)    || 0,
    duration:      parseFloat(document.getElementById('custom-duration').value) || 2,
    description: document.getElementById('custom-notes').value.trim(),
    custom:      true,
    multi_day:   false,
  };
  addToPool(item);
  closeCustomModal();
  ['custom-name', 'custom-location', 'custom-price', 'custom-duration', 'custom-notes'].forEach(id => {
    document.getElementById(id).value = '';
  });
}

// ═══════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ═══════════════════════════════════════════════════════
// LAYOUT HEIGHT
// ═══════════════════════════════════════════════════════
function updateLayoutHeight() {
  const header = document.getElementById('app-header');
  const nav    = document.getElementById('nav-bar');
  const layout = document.getElementById('main-layout');
  const used   = header.offsetHeight + nav.offsetHeight;
  layout.style.height = `calc(100vh - ${used}px)`;
}

// ═══════════════════════════════════════════════════════
// MOBILE POOL TOGGLE
// ═══════════════════════════════════════════════════════
function toggleMobilePool() {
  STATE.poolCollapsed = !STATE.poolCollapsed;
  document.getElementById('trip-pool').classList.toggle('collapsed', STATE.poolCollapsed);
  updateMobilePoolToggleLabel();
}

function updateMobilePoolToggleLabel() {
  const bar = document.getElementById('pool-toggle-bar');
  if (!bar) return;
  const count = STATE.pool.length;
  const countBadge = count > 0 ? `· ${count} item${count === 1 ? '' : 's'}` : '';
  if (STATE.poolCollapsed) {
    bar.innerHTML = `▼ Show Trip Pool <span id="pool-toggle-count" style="color:var(--text-dim);margin-left:4px">${countBadge}</span>`;
  } else {
    bar.innerHTML = `▲ Hide Trip Pool <span id="pool-toggle-count" style="color:var(--text-dim);margin-left:4px">${countBadge}</span>`;
  }
}

// ═══════════════════════════════════════════════════════
// TAP-TO-ASSIGN (assign pool item to a specific day)
// Used by both "Schedule a Day" flow (mobile) and can be
// called directly if needed.
// ═══════════════════════════════════════════════════════
function showTapAssign(item) {
  const existing = document.getElementById('tap-assign-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'tap-assign-overlay';
  overlay.id = 'tap-assign-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'tap-assign-sheet';

  sheet.innerHTML = `
    <div class="tap-assign-title">${item.name}</div>
    <div class="tap-assign-sub">Assign to which day?</div>
    <div class="tap-assign-days" id="tap-assign-days"></div>
    <button class="tap-assign-cancel">Cancel</button>
  `;

  const daysEl = sheet.querySelector('#tap-assign-days');
  for (let d = 1; d <= STATE.dayCount; d++) {
    const alreadyOnDay = (STATE.itinerary[d] || []).find(i => i.id === item.id);
    const btn = document.createElement('button');
    btn.className = 'tap-assign-day-btn';
    btn.textContent = alreadyOnDay ? `Day ${d} ✓` : `Day ${d}`;
    btn.disabled = !!alreadyOnDay;
    if (alreadyOnDay) btn.style.opacity = '0.45';
    btn.addEventListener('click', () => {
      if (!STATE.itinerary[d]) STATE.itinerary[d] = [];
      STATE.itinerary[d].push({ ...item });
      overlay.remove();
      toast(`${item.name} → Day ${d}`, 'success');
      if (STATE.currentView === 'itinerary') renderItinerary();
    });
    daysEl.appendChild(btn);
  }

  sheet.querySelector('.tap-assign-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

// ═══════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════
function bindEvents() {
  // Theme
  (function initTheme() {
    const saved = localStorage.getItem('bp_theme') || 'dark';
    if (saved === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      document.getElementById('btn-theme').textContent = '☀️';
    }
  })();

  document.getElementById('btn-theme').addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) {
      document.documentElement.removeAttribute('data-theme');
      document.getElementById('btn-theme').textContent = '🌙';
      localStorage.setItem('bp_theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      document.getElementById('btn-theme').textContent = '☀️';
      localStorage.setItem('bp_theme', 'light');
    }
  });

  // View buttons
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Filters
  document.getElementById('search-input').addEventListener('input', e => {
    STATE.searchQuery = e.target.value;
    if (STATE.currentCountry !== '__planner') renderCards(STATE.countries[STATE.currentCountry]);
  });
  document.getElementById('filter-category').addEventListener('change', e => {
    STATE.filterCategory = e.target.value;
    if (STATE.currentCountry !== '__planner') renderCards(STATE.countries[STATE.currentCountry]);
  });
  document.getElementById('filter-price').addEventListener('change', e => {
    STATE.filterPrice = e.target.value;
    if (STATE.currentCountry !== '__planner') renderCards(STATE.countries[STATE.currentCountry]);
  });

  // Pool collapse (desktop)
  document.getElementById('pool-collapse-btn').addEventListener('click', () => {
    STATE.poolCollapsed = !STATE.poolCollapsed;
    document.getElementById('trip-pool').classList.toggle('collapsed', STATE.poolCollapsed);
    document.getElementById('pool-collapse-btn').textContent = STATE.poolCollapsed ? '›' : '‹';
    document.getElementById('pool-reopen-tab').classList.toggle('visible', STATE.poolCollapsed);
  });

  document.getElementById('pool-reopen-tab').addEventListener('click', () => {
    STATE.poolCollapsed = false;
    document.getElementById('trip-pool').classList.remove('collapsed');
    document.getElementById('pool-collapse-btn').textContent = '‹';
    document.getElementById('pool-reopen-tab').classList.remove('visible');
  });

  // Headcount
  document.getElementById('headcount').addEventListener('input', e => {
    STATE.headcount = parseInt(e.target.value) || 1;
    renderPool();
  });

  // Pool clear
  document.getElementById('pool-clear-btn').addEventListener('click', () => {
    if (!STATE.pool.length) return;
    STATE.pool = [];
    for (const d of Object.keys(STATE.itinerary)) STATE.itinerary[d] = [];
    renderPool();
    refreshCardsAddedState();
    if (STATE.currentView === 'itinerary') renderItinerary();
    toast('Trip pool cleared');
  });

  // Day controls
  document.getElementById('day-minus').addEventListener('click', () => {
    if (STATE.dayCount <= 1) return;
    STATE.dayCount--;
    document.getElementById('day-count').value = STATE.dayCount;
    renderItinerary();
  });
  document.getElementById('day-plus').addEventListener('click', () => {
    if (STATE.dayCount >= 14) return;
    STATE.dayCount++;
    if (!STATE.itinerary[STATE.dayCount]) STATE.itinerary[STATE.dayCount] = [];
    document.getElementById('day-count').value = STATE.dayCount;
    renderItinerary();
  });
  document.getElementById('day-count').addEventListener('change', e => {
    const v = Math.min(14, Math.max(1, parseInt(e.target.value) || 1));
    STATE.dayCount = v;
    for (let i = 1; i <= v; i++) { if (!STATE.itinerary[i]) STATE.itinerary[i] = []; }
    renderItinerary();
  });

  // Hour mode toggle
  document.getElementById('hour-mode-toggle').addEventListener('change', e => {
    STATE.hourMode = e.target.checked;
    renderItinerary();
  });

  // Clear itinerary
  document.getElementById('btn-clear-itinerary').addEventListener('click', () => {
    for (const d of Object.keys(STATE.itinerary)) STATE.itinerary[d] = [];
    renderItinerary();
    toast('Itinerary cleared');
  });

  // Save
  document.getElementById('btn-save').addEventListener('click', () => {
    document.getElementById('save-name').value = '';
    document.getElementById('modal-save').classList.add('open');
    document.getElementById('save-name').focus();
  });
  document.getElementById('save-cancel').addEventListener('click', () => {
    document.getElementById('modal-save').classList.remove('open');
  });
  document.getElementById('save-confirm').addEventListener('click', () => {
    const name = document.getElementById('save-name').value.trim() || 'My Trip';
    saveTrip(name);
    document.getElementById('modal-save').classList.remove('open');
  });

  // Load
  document.getElementById('btn-load').addEventListener('click', loadLastTrip);

  // Export
  document.getElementById('btn-export').addEventListener('click', () => switchView('export'));

  // Custom event
  document.getElementById('btn-custom-event').addEventListener('click', openCustomModal);
  document.getElementById('custom-cancel').addEventListener('click', closeCustomModal);
  document.getElementById('custom-save').addEventListener('click', saveCustomEvent);

  // Mobile pool toggle (header button)
  const mobileToggle = document.getElementById('pool-toggle-mobile');
  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => toggleMobilePool());
  }

  // Mobile pool toggle bar
  const toggleBar = document.getElementById('pool-toggle-bar');
  if (toggleBar) {
    toggleBar.addEventListener('click', () => toggleMobilePool());
  }

  // Modal overlay click-to-close
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Keyboard: Escape closes modals and dropdowns
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
      closeAllDropdowns();
    }
  });

  // Tap outside closes continent dropdowns
  document.addEventListener('click', e => {
    if (!e.target.closest('.continent-group')) closeAllDropdowns();
  });

  // Mobile responsiveness
  function checkMobile() {
    const mobile = window.innerWidth <= 900;
    if (mobileToggle) mobileToggle.style.display = mobile ? 'flex' : 'none';
    const bar = document.getElementById('pool-toggle-bar');
    if (bar) bar.style.display = mobile ? 'flex' : 'none';
    updateMobilePoolToggleLabel();
  }
  window.addEventListener('resize', checkMobile);
  checkMobile();

  window.addEventListener('resize', updateLayoutHeight);
}

// ═══════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════
loadCountries();
