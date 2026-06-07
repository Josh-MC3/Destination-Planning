// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
const STATE = {
  countries: {},         // loaded country data keyed by slug
  countryIndex: [],      // parsed index.json countries array — single source of truth
  currentCountry: null,
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
// Strips // single-line comments only when they appear
// OUTSIDE of string literals, so URLs like https://...
// inside field values are never corrupted.
// ═══════════════════════════════════════════════════════
function stripJSONComments(text) {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    // Only strip // comments when we are NOT inside a string literal
    if (!inString && ch === '/' && text[i + 1] === '/') {
      // Advance past everything until the next newline
      while (i < text.length && text[i] !== '\n') i++;
      // Keep the newline so line numbers stay intact for debugging
      result += '\n';
      continue;
    }

    result += ch;
  }

  return result;
}

// ═══════════════════════════════════════════════════════
// LOAD DATA
// ═══════════════════════════════════════════════════════
async function loadCountries() {
  const fill = document.getElementById('loading-fill');
  const txt  = document.getElementById('loading-text');

  // ── Phase 1: fetch index.json ──────────────────────────
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

  // ── Phase 2: fetch all country files in parallel ───────
  txt.textContent = 'Loading destinations…';

  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} returned ${r.status}`);
    const text = await r.text();
    // Use the safe comment stripper that respects string literals
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

function buildDesktopNav() {
  const nav = document.getElementById('nav-bar');
  nav.innerHTML = '';

  if (!STATE.countryIndex || !STATE.countryIndex.length) return;

  const plannerBtn = document.createElement('button');
  plannerBtn.className = 'nav-tab' + (STATE.currentCountry === '__planner' ? ' active' : '');
  plannerBtn.textContent = '📋 Planner';
  plannerBtn.dataset.country = '__planner';
  plannerBtn.addEventListener('click', () => switchTab('__planner'));
  nav.appendChild(plannerBtn);

  for (const entry of STATE.countryIndex) {
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
    nav.appendChild(btn);
  }
}

function buildMobileNav() {
  const nav = document.getElementById('mobile-nav');
  nav.innerHTML = '';

  if (!STATE.countryIndex || !STATE.countryIndex.length) return;

  // Planner button
  const plannerBtn = document.createElement('button');
  plannerBtn.className = 'mobile-planner-btn' + (STATE.currentCountry === '__planner' ? ' active' : '');
  plannerBtn.textContent = '📋 Planner';
  plannerBtn.addEventListener('click', () => {
    closeAllDropdowns();
    switchTab('__planner');
  });
  nav.appendChild(plannerBtn);

  // Group countries by continent from index.json
  const continentMap = {};
  for (const entry of STATE.countryIndex) {
    const c = entry.continent || 'Other';
    if (!continentMap[c]) continentMap[c] = [];
    continentMap[c].push(entry);
  }

  // Continent emoji map
  const continentEmoji = {
    'Asia': '🌏',
    'Americas': '🌎',
    'Europe': '🌍',
    'Africa': '🌍',
    'Oceania': '🌏',
    'Other': '🌐',
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

  // Recalculate layout height whenever we switch views — fixes clipping in hour mode
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

  buildRegionPills(data);
  renderCards(data);
}

// ── UTILITY: Determine the best grouping key for a country's activities.
// Falls back to 'destination' for countries that omit the 'region' field
// (e.g. Thailand). Null/empty values are treated as absent.
function getRegionKey(activities) {
  return activities.some(a => a.region != null && a.region !== '') ? 'region' : 'destination';
}

function buildRegionPills(data) {
  const bar    = document.getElementById('region-pills');
  const subBar = document.getElementById('subregion-pills');
  const acts   = data.activities;

  const regionKey = getRegionKey(acts);

  // Guard: filter out null / undefined / empty-string values before sorting
  const regions = [
    ...new Set(
      acts
        .map(a => a[regionKey])
        .filter(v => v != null && v !== '')
    )
  ].sort();

  bar.innerHTML = '';

  if (!regions.length) {
    bar.style.display = 'none';
    subBar.style.display = 'none';
    buildMobileRegionSelects(data, regions, regionKey);
    return;
  }
  bar.style.display = 'flex';

  const allLabel = regionKey === 'destination' ? 'All Cities' : 'All Regions';
  const allBtn = document.createElement('button');
  allBtn.className = 'region-pill' + (!STATE.filterRegion ? ' active' : '');
  allBtn.textContent = allLabel;
  allBtn.addEventListener('click', () => {
    STATE.filterRegion = '';
    STATE.filterSubRegion = '';
    buildRegionPills(data);
    renderCards(data);
  });
  bar.appendChild(allBtn);

  for (const r of regions) {
    const btn = document.createElement('button');
    btn.className = 'region-pill' + (STATE.filterRegion === r ? ' active' : '');
    btn.textContent = r;
    btn.addEventListener('click', () => {
      STATE.filterRegion = r;
      STATE.filterSubRegion = '';
      buildRegionPills(data);
      renderCards(data);
    });
    bar.appendChild(btn);
  }

  // Sub-region pills (city breakdown within a selected region)
  subBar.innerHTML = '';
  if (STATE.filterRegion && regionKey === 'region') {
    const inRegion = acts.filter(a => a.region === STATE.filterRegion);
    const cities = [
      ...new Set(
        inRegion
          .map(a => a.destination)
          .filter(v => v != null && v !== '')
      )
    ].sort();

    if (cities.length > 1) {
      subBar.style.display = 'flex';

      const allCities = document.createElement('button');
      allCities.className = 'region-pill' + (!STATE.filterSubRegion ? ' active' : '');
      allCities.textContent = 'All ' + STATE.filterRegion + ' Cities';
      allCities.addEventListener('click', () => {
        STATE.filterSubRegion = '';
        buildRegionPills(data);
        renderCards(data);
      });
      subBar.appendChild(allCities);

      for (const city of cities) {
        const cityBtn = document.createElement('button');
        cityBtn.className = 'region-pill' + (STATE.filterSubRegion === city ? ' active' : '');
        cityBtn.textContent = STATE.filterRegion + ' — ' + city;
        cityBtn.addEventListener('click', () => {
          STATE.filterSubRegion = city;
          buildRegionPills(data);
          renderCards(data);
        });
        subBar.appendChild(cityBtn);
      }
    } else {
      subBar.style.display = 'none';
    }
  } else {
    subBar.style.display = 'none';
  }

  // Build the mobile select dropdowns in sync
  buildMobileRegionSelects(data, regions, regionKey);
}

function buildMobileRegionSelects(data, regions, regionKey) {
  const wrapper = document.getElementById('mobile-region-selects');
  if (!wrapper) return;
  wrapper.innerHTML = '';

  if (!regions.length) {
    wrapper.style.display = 'none';
    return;
  }

  // Region select
  const allLabel = regionKey === 'destination' ? 'All Cities' : 'All Regions';
  const regionSel = document.createElement('select');
  regionSel.id = 'mobile-region-select';

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
    buildRegionPills(data);
    renderCards(data);
  });

  wrapper.appendChild(regionSel);

  // Sub-region select — only show if a region is selected and has multiple cities
  if (STATE.filterRegion && regionKey === 'region') {
    const inRegion = data.activities.filter(a => a.region === STATE.filterRegion);
    const cities = [
      ...new Set(
        inRegion.map(a => a.destination).filter(v => v != null && v !== '')
      )
    ].sort();

    if (cities.length > 1) {
      const citySel = document.createElement('select');
      citySel.id = 'mobile-subregion-select';

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
        buildRegionPills(data);
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

  // Apply region/sub-region filters — null-safe comparisons
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
    if (STATE.pool.find(p => p.id === act.id)) { removeFromPool(act.id); }
    else { addToPool(act); }
  });

  return card;
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
    return;
  }
  empty.style.display = 'none';

  body.querySelectorAll('.pool-card').forEach(c => c.remove());
  for (const item of STATE.pool) {
    body.appendChild(buildPoolCard(item));
  }
}

function buildPoolCard(item) {
  const card = document.createElement('div');
  card.className = 'pool-card';
  card.draggable = true;
  card.dataset.id = item.id;
  const dur = item.duration >= 24 ? `${Math.round(item.duration / 24)}d` : `${item.duration}h`;
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
function renderItinerary() {
  const canvas = document.getElementById('itinerary-canvas');
  canvas.innerHTML = '';

  for (let i = 1; i <= STATE.dayCount; i++) {
    if (!STATE.itinerary[i]) STATE.itinerary[i] = [];
  }

  for (let day = 1; day <= STATE.dayCount; day++) {
    canvas.appendChild(buildDayColumn(day));
  }

  // Recalculate heights after DOM is fully populated — fixes clipping in hour mode
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

  body.addEventListener('dragover', e => { e.preventDefault(); body.classList.add('drag-over'); });
  body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
  body.addEventListener('drop', e => {
    e.preventDefault();
    body.classList.remove('drag-over');
    handleDrop(e, day, null);
  });

  if (STATE.hourMode) {
    renderHourSlots(body, day);
  } else {
    renderDayItems(body, day);
  }

  return col;
}

function renderDayItems(body, day) {
  const items = STATE.itinerary[day] || [];
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

function renderHourSlots(body, day) {
  const items = STATE.itinerary[day] || [];

  // Unscheduled items (no hour assigned) — render at the top
  const unscheduled = items.filter(i => i.hour === undefined || i.hour === null);
  if (unscheduled.length) {
    const unscheduledBlock = document.createElement('div');
    unscheduledBlock.className = 'unscheduled-block';
    unscheduledBlock.innerHTML = '<div class="unscheduled-label">Unscheduled</div>';
    unscheduled.forEach(item => unscheduledBlock.appendChild(buildItineraryItem(item, day)));
    body.appendChild(unscheduledBlock);
  }

  // Hour grid: 6 AM → 5 AM (full 24-hour cycle)
  const slotDiv = document.createElement('div');
  slotDiv.className = 'hour-slots';

  const hours = Array.from({ length: 24 }, (_, i) => (i + 6) % 24);
  for (const h of hours) {
    const slot = document.createElement('div');
    slot.className = 'hour-slot';

    const label = document.createElement('div');
    label.className = 'hour-label';
    label.textContent = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;

    const slotBody = document.createElement('div');
    slotBody.className = 'hour-slot-body';
    slotBody.dataset.day = day;
    slotBody.dataset.hour = h;

    slotBody.addEventListener('dragover', e => { e.preventDefault(); slotBody.classList.add('drag-over'); });
    slotBody.addEventListener('dragleave', () => slotBody.classList.remove('drag-over'));
    slotBody.addEventListener('drop', e => {
      e.preventDefault();
      slotBody.classList.remove('drag-over');
      handleDrop(e, day, h);
    });

    // Render items assigned to this specific hour
    items
      .filter(i => i.hour === h)
      .forEach(item => slotBody.appendChild(buildItineraryItem(item, day)));

    slot.appendChild(label);
    slot.appendChild(slotBody);
    slotDiv.appendChild(slot);
  }

  body.appendChild(slotDiv);
}

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
      ${item.hour !== undefined && item.hour !== null ? `<span>• ${formatHour(item.hour)}</span>` : ''}
    </div>
    <button class="itinerary-item-remove" data-id="${item.id}" data-day="${day}">✕</button>
  `;

  el.querySelector('.itinerary-item-remove').addEventListener('click', e => {
    e.stopPropagation();
    removeFromItinerary(item.id, day);
  });

  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ source: 'itinerary', id: item.id, fromDay: day }));
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));

  return el;
}

function formatHour(h) {
  if (h === 0)  return '12:00 AM';
  if (h < 12)   return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${h - 12}:00 PM`;
}

function handleDrop(e, toDay, hour) {
  let data;
  try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }

  if (data.source === 'pool') {
    const item = STATE.pool.find(p => p.id === data.id);
    if (!item) return;
    const already = (STATE.itinerary[toDay] || []).find(i => i.id === data.id);
    if (already) { toast('Already on this day'); return; }
    if (!STATE.itinerary[toDay]) STATE.itinerary[toDay] = [];
    STATE.itinerary[toDay].push({ ...item, hour: hour ?? undefined });
    toast(`${item.name} → Day ${toDay}`, 'success');
  } else if (data.source === 'itinerary') {
    const fromDay = data.fromDay;
    const idx = (STATE.itinerary[fromDay] || []).findIndex(i => i.id === data.id);
    if (idx === -1) return;
    const [item] = STATE.itinerary[fromDay].splice(idx, 1);
    if (toDay === fromDay && hour !== undefined && hour !== null) {
      item.hour = hour;
      STATE.itinerary[toDay].push(item);
    } else if (toDay !== fromDay) {
      item.hour = hour ?? undefined;
      if (!STATE.itinerary[toDay]) STATE.itinerary[toDay] = [];
      STATE.itinerary[toDay].push(item);
    } else {
      // Same day, no hour target — put it back
      STATE.itinerary[fromDay].push(item);
    }
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
    itinHtml += `<div class="export-day"><h4>Day ${d}</h4>`;
    for (const item of items) {
      const dur = item.duration >= 24 ? `${Math.round(item.duration / 24)} days` : `${item.duration} hrs`;
      const timeStr = item.hour !== undefined ? ` — ${formatHour(item.hour)}` : '';
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

  // Pool collapse
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

  // Hour mode toggle — recalculate layout height after re-render
  document.getElementById('hour-mode-toggle').addEventListener('change', e => {
    STATE.hourMode = e.target.checked;
    renderItinerary(); // already calls updateLayoutHeight via requestAnimationFrame
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

  // Mobile pool toggle
  const mobileToggle = document.getElementById('pool-toggle-mobile');
  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      STATE.poolCollapsed = !STATE.poolCollapsed;
      document.getElementById('trip-pool').classList.toggle('collapsed', STATE.poolCollapsed);
    });
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
    const isMobile = window.innerWidth <= 900;
    if (mobileToggle) mobileToggle.style.display = isMobile ? 'flex' : 'none';
  }
  window.addEventListener('resize', checkMobile);
  checkMobile();

  window.addEventListener('resize', updateLayoutHeight);
}

// ═══════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════
loadCountries();
