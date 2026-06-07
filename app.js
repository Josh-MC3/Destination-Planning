// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
const STATE = {
  countries: {},
  countryIndex: [],
  currentCountry: null,
  currentContinent: null,
  pool: [],
  itinerary: {},
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
// UTILITY
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
    return JSON.parse(stripJSONComments(text));
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
        if (!firstArray) console.warn(`loadCountries: ${entry.file} has no activities array.`, Object.keys(data));
      }
      console.log(`✓ ${entry.name}: ${STATE.countries[entry.slug].activities.length} activities`);
    } else {
      console.warn(`loadCountries: failed to load ${entry.file}`, result.reason);
      STATE.countries[entry.slug] = { country: entry.name, activities: [] };
    }
  });

  fill.style.width = '100%';
  STATE.currentCountry   = STATE.countryIndex[0].slug;
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

// ── DESKTOP NAV: continent pills + collapsible country grid panel ──
// Row 1: Planner · continent pills (with count + caret) · active country label
// Panel: full-width grid of country cards, slides open below row 1
function buildDesktopNav() {
  const nav = document.getElementById('nav-bar');
  nav.innerHTML = '';
  if (!STATE.countryIndex || !STATE.countryIndex.length) return;

  const row1 = document.createElement('div');
  row1.className = 'nav-row nav-row-continents';

  // Planner button
  const plannerBtn = document.createElement('button');
  plannerBtn.className = 'nav-tab nav-planner' + (STATE.currentCountry === '__planner' ? ' active' : '');
  plannerBtn.textContent = '📋 Planner';
  plannerBtn.dataset.country = '__planner';
  plannerBtn.addEventListener('click', () => {
    closeCountryPanel();
    switchTab('__planner');
  });
  row1.appendChild(plannerBtn);

  // Build continent map
  const continentMap = {};
  for (const entry of STATE.countryIndex) {
    const c = entry.continent || 'Other';
    if (!continentMap[c]) continentMap[c] = [];
    continentMap[c].push(entry);
  }

  const continentEmoji = {
    'Asia':'🌏','Americas':'🌎','Europe':'🌍',
    'Africa':'🌍','Middle East':'🕌','Oceania':'🌏','Other':'🌐',
  };

  const continentNames = Object.keys(continentMap);
  if (!STATE.currentContinent || !continentMap[STATE.currentContinent]) {
    STATE.currentContinent = continentNames[0];
  }

  for (const [continent, entries] of Object.entries(continentMap)) {
    const isActive = continent === STATE.currentContinent && STATE.currentCountry !== '__planner';
    const pill = document.createElement('button');
    pill.className = 'nav-continent-pill' + (isActive ? ' active' : '');
    pill.innerHTML = `${continentEmoji[continent] || '🌐'} ${continent} <span class="pill-count">${entries.length}</span> <span class="pill-caret">▾</span>`;
    pill.dataset.continent = continent;

    pill.addEventListener('click', e => {
      e.stopPropagation();
      const panel = document.getElementById('country-grid-panel');
      const alreadyOpen = panel && panel.dataset.continent === continent && panel.classList.contains('open');
      closeCountryPanel();
      if (!alreadyOpen) openCountryPanel(continent, entries, pill);
    });
    row1.appendChild(pill);
  }

  // Active country label — persists in row 1 so you always see where you are
  const activeLabelWrap = document.createElement('div');
  activeLabelWrap.className = 'nav-active-label-wrap';
  if (STATE.currentCountry && STATE.currentCountry !== '__planner') {
    const activeEntry = STATE.countryIndex.find(e => e.slug === STATE.currentCountry);
    if (activeEntry) {
      const lbl = document.createElement('span');
      lbl.className = 'nav-active-label';
      lbl.textContent = `${activeEntry.flag} ${activeEntry.name}`;
      activeLabelWrap.appendChild(lbl);
    }
  }
  row1.appendChild(activeLabelWrap);
  nav.appendChild(row1);

  // Country grid panel — child of #nav-bar, hidden until a continent is clicked
  const panel = document.createElement('div');
  panel.id = 'country-grid-panel';
  panel.className = 'country-grid-panel';
  nav.appendChild(panel);
}

function openCountryPanel(continent, entries, anchorPill) {
  const panel = document.getElementById('country-grid-panel');
  if (!panel) return;

  panel.dataset.continent = continent;
  panel.innerHTML = '';

  const continentEmoji = {
    'Asia':'🌏','Americas':'🌎','Europe':'🌍',
    'Africa':'🌍','Middle East':'🕌','Oceania':'🌏','Other':'🌐',
  };

  const header = document.createElement('div');
  header.className = 'cgp-header';
  header.innerHTML = `<span class="cgp-title">${continentEmoji[continent] || '🌐'} ${continent}</span><span class="cgp-count">${entries.length} destinations</span>`;
  panel.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'cgp-grid';

  for (const entry of entries) {
    const d = STATE.countries[entry.slug];
    const actCount = d ? d.activities.length : 0;
    const isActive = STATE.currentCountry === entry.slug;

    const card = document.createElement('button');
    card.className = 'cgp-card' + (isActive ? ' active' : '');
    card.innerHTML = `
      <span class="cgp-flag">${entry.flag}</span>
      <span class="cgp-name">${entry.name}</span>
      <span class="cgp-acts">${actCount} activities</span>
    `;
    card.addEventListener('click', () => {
      closeCountryPanel();
      switchTab(entry.slug);
    });
    grid.appendChild(card);
  }

  panel.appendChild(grid);
  panel.classList.add('open');
  if (anchorPill) anchorPill.classList.add('open');
  requestAnimationFrame(updateLayoutHeight);
}

function closeCountryPanel() {
  const panel = document.getElementById('country-grid-panel');
  if (panel) {
    panel.classList.remove('open');
    panel.dataset.continent = '';
  }
  document.querySelectorAll('#nav-bar .nav-continent-pill.open').forEach(p => p.classList.remove('open'));
  requestAnimationFrame(updateLayoutHeight);
}

// ── MOBILE NAV: continent triggers + collapsible country grid panel ──
// Same grid panel approach as desktop, panel injected below #mobile-nav.
function buildMobileNav() {
  const nav = document.getElementById('mobile-nav');
  nav.innerHTML = '';
  if (!STATE.countryIndex || !STATE.countryIndex.length) return;

  const plannerBtn = document.createElement('button');
  plannerBtn.className = 'mobile-planner-btn' + (STATE.currentCountry === '__planner' ? ' active' : '');
  plannerBtn.textContent = '📋 Planner';
  plannerBtn.addEventListener('click', () => {
    closeMobilePanel();
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
    'Asia':'🌏','Americas':'🌎','Europe':'🌍',
    'Africa':'🌍','Middle East':'🕌','Oceania':'🌏','Other':'🌐',
  };

  for (const [continent, entries] of Object.entries(continentMap)) {
    const hasActive = entries.some(e => e.slug === STATE.currentCountry);
    const pill = document.createElement('button');
    pill.className = 'continent-trigger' + (hasActive ? ' has-active' : '');
    pill.innerHTML = `${continentEmoji[continent] || '🌐'} ${continent} <span class="caret">▼</span>`;
    pill.dataset.continent = continent;

    pill.addEventListener('click', e => {
      e.stopPropagation();
      const panel = document.getElementById('mobile-country-panel');
      const alreadyOpen = panel && panel.dataset.continent === continent && panel.classList.contains('open');
      closeMobilePanel();
      if (!alreadyOpen) openMobilePanel(continent, entries, pill);
    });

    nav.appendChild(pill);
  }

  // Mobile grid panel — inserted immediately after #mobile-nav in the DOM
  let mobilePanel = document.getElementById('mobile-country-panel');
  if (!mobilePanel) {
    mobilePanel = document.createElement('div');
    mobilePanel.id = 'mobile-country-panel';
    mobilePanel.className = 'mobile-country-panel';
    nav.parentNode.insertBefore(mobilePanel, nav.nextSibling);
  }
}

function openMobilePanel(continent, entries, anchorPill) {
  const panel = document.getElementById('mobile-country-panel');
  if (!panel) return;

  panel.dataset.continent = continent;
  panel.innerHTML = '';

  const continentEmoji = {
    'Asia':'🌏','Americas':'🌎','Europe':'🌍',
    'Africa':'🌍','Middle East':'🕌','Oceania':'🌏','Other':'🌐',
  };

  const header = document.createElement('div');
  header.className = 'cgp-header';
  header.innerHTML = `<span class="cgp-title">${continentEmoji[continent] || '🌐'} ${continent}</span><span class="cgp-count">${entries.length} destinations</span>`;
  panel.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'cgp-grid cgp-grid-mobile';

  for (const entry of entries) {
    const d = STATE.countries[entry.slug];
    const actCount = d ? d.activities.length : 0;
    const isActive = STATE.currentCountry === entry.slug;

    const card = document.createElement('button');
    card.className = 'cgp-card' + (isActive ? ' active' : '');
    card.innerHTML = `
      <span class="cgp-flag">${entry.flag}</span>
      <span class="cgp-name">${entry.name}</span>
      <span class="cgp-acts">${actCount} activities</span>
    `;
    card.addEventListener('click', () => {
      closeMobilePanel();
      switchTab(entry.slug);
    });
    grid.appendChild(card);
  }

  panel.appendChild(grid);
  panel.classList.add('open');
  if (anchorPill) anchorPill.classList.add('open');
  requestAnimationFrame(updateLayoutHeight);
}

function closeMobilePanel() {
  const panel = document.getElementById('mobile-country-panel');
  if (panel) {
    panel.classList.remove('open');
    panel.dataset.continent = '';
  }
  document.querySelectorAll('#mobile-nav .continent-trigger.open').forEach(p => p.classList.remove('open'));
  requestAnimationFrame(updateLayoutHeight);
}

function closeAllDropdowns() {
  closeCountryPanel();
  closeMobilePanel();
}

function switchTab(key) {
  STATE.currentCountry = key;
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

  closeCountryPanel();
  closeMobilePanel();
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

function getRegionKey(activities) {
  return activities.some(a => a.region != null && a.region !== '') ? 'region' : 'destination';
}

function buildRegionSelects(data) {
  const pillBar    = document.getElementById('region-pills');
  const subPillBar = document.getElementById('subregion-pills');
  if (pillBar)    pillBar.style.display = 'none';
  if (subPillBar) subPillBar.style.display = 'none';

  const wrapper = document.getElementById('region-select-bar');
  if (!wrapper) return;
  wrapper.innerHTML = '';

  const acts      = data.activities;
  const regionKey = getRegionKey(acts);
  const regions   = [...new Set(acts.map(a => a[regionKey]).filter(v => v != null && v !== ''))].sort();

  if (!regions.length) { wrapper.style.display = 'none'; return; }
  wrapper.style.display = '';

  const allLabel = regionKey === 'destination' ? 'All Cities' : 'All Regions';
  const regionSel = document.createElement('select');
  regionSel.id = 'region-select';
  regionSel.className = 'region-select';

  const allOpt = document.createElement('option');
  allOpt.value = ''; allOpt.textContent = allLabel;
  regionSel.appendChild(allOpt);

  for (const r of regions) {
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = r;
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

  if (STATE.filterRegion && regionKey === 'region') {
    const inRegion = acts.filter(a => a.region === STATE.filterRegion);
    const cities = [...new Set(inRegion.map(a => a.destination).filter(v => v != null && v !== ''))].sort();
    if (cities.length > 1) {
      const citySel = document.createElement('select');
      citySel.id = 'subregion-select';
      citySel.className = 'region-select';
      const allCityOpt = document.createElement('option');
      allCityOpt.value = ''; allCityOpt.textContent = 'All ' + STATE.filterRegion + ' Cities';
      citySel.appendChild(allCityOpt);
      for (const city of cities) {
        const opt = document.createElement('option');
        opt.value = city; opt.textContent = city;
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

  if (STATE.filterRegion)    acts = acts.filter(a => a[regionKey] === STATE.filterRegion);
  if (STATE.filterSubRegion) acts = acts.filter(a => a.destination === STATE.filterSubRegion);
  if (STATE.filterCategory)  acts = acts.filter(a => (a.category || '') === STATE.filterCategory);
  if (STATE.searchQuery) {
    const q = STATE.searchQuery.toLowerCase();
    acts = acts.filter(a =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q) ||
      (a.destination || '').toLowerCase().includes(q)
    );
  }
  if (STATE.filterPrice) {
    if (STATE.filterPrice === 'free')   acts = acts.filter(a => (a.price_usd || 0) === 0);
    else if (STATE.filterPrice === '200+') acts = acts.filter(a => (a.price_usd || 0) >= 200);
    else {
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
  for (const act of acts) grid.appendChild(buildActivityCard(act, inPool.has(act.id)));
}

function buildActivityCard(act, added) {
  const card = document.createElement('div');
  card.className = 'activity-card' + (act.multi_day ? ' multi-day' : '') + (added ? ' added' : '');

  const catKey = (act.category || '')
    .replace('Food & Dining', 'Food').replace('Water Sports', 'Water')
    .replace('& ', '').replace(' ', '');
  const priceStr   = act.price_usd === 0 ? 'Free' : `$${act.price_usd}`;
  const priceRange = (act.price_usd_min !== undefined && act.price_usd_min !== act.price_usd_max)
    ? `$${act.price_usd_min}–$${act.price_usd_max}` : priceStr;
  const dur = act.duration >= 24 ? `${Math.round(act.duration / 24)}d` : `${act.duration}h`;

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
    if (STATE.pool.find(p => p.id === act.id)) { removeFromPool(act.id); return; }
    // 6A: label unchanged. Mobile opens choice sheet; desktop adds immediately.
    if (isMobile()) showAddToTripSheet(act);
    else addToPool(act);
  });

  return card;
}

// ── Mobile "Add to Trip" choice sheet ──────────────────
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
        <div><span class="choice-label">Save to Pool</span><span class="choice-desc">Add to your trip pool for later</span></div>
      </button>
      <button class="add-trip-choice-btn" id="choice-day">
        <span class="choice-icon">📅</span>
        <div><span class="choice-label">Schedule a Day</span><span class="choice-desc">Assign directly to a day</span></div>
      </button>
    </div>
    <button class="tap-assign-cancel">Cancel</button>
  `;

  sheet.querySelector('#choice-pool').addEventListener('click', () => { overlay.remove(); addToPool(act); });
  sheet.querySelector('#choice-day').addEventListener('click', () => {
    overlay.remove();
    if (!STATE.pool.find(p => p.id === act.id)) addToPool(act);
    showTapAssign(act, null); // mobile — bottom sheet
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
    const added = inPool.has(btn.dataset.id);
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

  empty.style.display = STATE.pool.length ? 'none' : 'block';
  body.querySelectorAll('.pool-card').forEach(c => c.remove());
  for (const item of STATE.pool) body.appendChild(buildPoolCard(item));
  updateMobilePoolToggleLabel();
}

function buildPoolCard(item) {
  const card = document.createElement('div');
  card.className = 'pool-card';
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

  // 5B: draggable only on desktop; mobile uses long-press drag instead
  if (!isMobile()) {
    card.draggable = true;
    card.style.cursor = 'grab';
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ source: 'pool', id: item.id }));
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  }

  // 1C: mobile long-press drag from pool to itinerary day
  // On drop: item is added unscheduled, then time-picker opens (#2B flow)
  if (isMobile()) {
    attachPoolLongPressDrag(card, item);
  }

  return card;
}

// ── 1C: Long-press drag for pool cards (mobile only) ───
// Drops item into the target day as unscheduled, then immediately
// opens the time-picker sheet so the user can assign a time.
function attachPoolLongPressDrag(el, item) {
  let holdTimer   = null;
  let dragActive  = false;
  let touchDragEl = null;

  function cancelHold() { clearTimeout(holdTimer); holdTimer = null; }

  function startClone(touch) {
    touchDragEl = document.createElement('div');
    touchDragEl.className = 'touch-drag-clone';
    touchDragEl.textContent = item.name;
    touchDragEl.style.left = (touch.clientX - 80) + 'px';
    touchDragEl.style.top  = (touch.clientY - 20) + 'px';
    document.body.appendChild(touchDragEl);
  }
  function moveClone(touch) {
    if (!touchDragEl) return;
    touchDragEl.style.left = (touch.clientX - 80) + 'px';
    touchDragEl.style.top  = (touch.clientY - 20) + 'px';
  }
  function removeClone() {
    if (touchDragEl) { touchDragEl.remove(); touchDragEl = null; }
  }
  function findDayBodyUnder(x, y) {
    if (touchDragEl) touchDragEl.style.display = 'none';
    const found = document.elementFromPoint(x, y);
    if (touchDragEl) touchDragEl.style.display = '';
    return found ? found.closest('.day-body') : null;
  }

  el.addEventListener('touchstart', e => {
    dragActive = false;
    holdTimer = setTimeout(() => {
      dragActive = true;
      el.classList.add('long-press-active');
      document.querySelectorAll('.day-body').forEach(b => b.classList.add('touch-drop-target'));
      if (navigator.vibrate) navigator.vibrate(40);
      startClone(e.touches[0]);
    }, 400);
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (!dragActive) { cancelHold(); return; }
    e.preventDefault();
    const touch = e.touches[0];
    moveClone(touch);
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

    if (!dragActive) { removeClone(); return; }
    dragActive = false;

    const touch = e.changedTouches[0];
    removeClone();

    const targetBody = findDayBodyUnder(touch.clientX, touch.clientY);
    if (!targetBody) return;
    const toDay = parseInt(targetBody.dataset.day);
    if (!toDay) return;

    // Guard: already on this day
    if ((STATE.itinerary[toDay] || []).find(i => i.id === item.id)) {
      toast('Already on Day ' + toDay);
      return;
    }

    if (!STATE.itinerary[toDay]) STATE.itinerary[toDay] = [];
    STATE.itinerary[toDay].push({ ...item, hour: null });
    renderItinerary();
    toast(`${item.name} → Day ${toDay}`, 'success');

    // 2B: immediately open time-picker for this newly placed item
    showTimePicker(item, toDay);
  }, { passive: true });

  el.addEventListener('touchcancel', () => {
    cancelHold();
    dragActive = false;
    el.classList.remove('long-press-active');
    document.querySelectorAll('.day-body').forEach(b => {
      b.classList.remove('touch-drop-target', 'touch-drop-hover');
    });
    removeClone();
  }, { passive: true });
}

// ═══════════════════════════════════════════════════════
// ITINERARY
// ═══════════════════════════════════════════════════════
const SLOT_H    = 60;
const DAY_START = 6;
const DAY_HOURS = 24;

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
  if (STATE.hourMode) renderTimeline(body, day);
  else renderDayItems(body, day);

  return col;
}

// ── LIST MODE ────────────────────────────────────────────
function renderDayItems(body, day) {
  body.style.padding = '8px';
  const items = STATE.itinerary[day] || [];

  // Desktop drop targets
  body.addEventListener('dragover',  e => { e.preventDefault(); body.classList.add('drag-over'); });
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
  for (const item of items) body.appendChild(buildItineraryItem(item, day));
}

// ── TIMELINE MODE ────────────────────────────────────────
function renderTimeline(body, day) {
  body.style.padding = '0';
  const items = STATE.itinerary[day] || [];

  // Unscheduled bin — 4B: platform-aware label
  const unscheduled = items.filter(i => i.hour == null);
  if (unscheduled.length) {
    const bin = document.createElement('div');
    bin.className = 'unscheduled-block';

    bin.addEventListener('dragover',  e => { e.preventDefault(); bin.style.background = 'rgba(201,168,76,.06)'; });
    bin.addEventListener('dragleave', () => bin.style.background = '');
    bin.addEventListener('drop', e => { e.preventDefault(); bin.style.background = ''; handleDrop(e, day, null); });

    const labelText = isMobile()
      ? 'Unscheduled — hold & drag to move to another day'
      : 'Unscheduled — drag to timeline to schedule';
    bin.innerHTML = `<div class="unscheduled-label">${labelText}</div>`;
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
    if (!surface.contains(e.relatedTarget)) { surface.classList.remove('drag-active'); ghostLine.style.display = 'none'; }
  });
  surface.addEventListener('dragover', e => {
    e.preventDefault();
    const { hour, snapY } = hourFromY(e.offsetY);
    ghostLine.style.top = snapY + 'px';
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

  const scheduled = items.filter(i => i.hour != null);
  const columns   = resolveColumns(scheduled);
  for (const { item, col, totalCols } of columns) grid.appendChild(buildTimelineBlock(item, day, col, totalCols));

  if (day === 1) {
    const now  = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const offsetMins = (mins - DAY_START * 60 + 24 * 60) % (24 * 60);
    const nowLine = document.createElement('div');
    nowLine.className = 'timeline-now-line';
    nowLine.style.top = (offsetMins / 60 * SLOT_H) + 'px';
    grid.appendChild(nowLine);
  }
}

function hourFromY(offsetY) {
  const rawHour = offsetY / SLOT_H;
  const hour    = (Math.floor(rawHour) + DAY_START) % 24;
  const snapY   = Math.floor(rawHour) * SLOT_H;
  return { hour, snapY };
}

function resolveColumns(items) {
  const sorted = [...items].sort((a, b) => a.hour - b.hour);
  const result = [];
  for (const item of sorted) {
    const startH = item.hour, endH = startH + (item.duration || 1);
    let col = 0;
    const usedCols = result.filter(r => r.item.hour < endH && (r.item.hour + (r.item.duration || 1)) > startH).map(r => r.col);
    while (usedCols.includes(col)) col++;
    result.push({ item, col, totalCols: 1 });
  }
  for (const entry of result) {
    const startH = entry.item.hour, endH = startH + (entry.item.duration || 1);
    const concurrent = result.filter(r => r.item.hour < endH && (r.item.hour + (r.item.duration || 1)) > startH);
    entry.totalCols = Math.max(...concurrent.map(r => r.col)) + 1;
  }
  return result;
}

function buildTimelineBlock(item, day, col, totalCols) {
  const startH  = item.hour;
  const dur     = Math.max(item.duration || 1, 0.25);
  const topPx   = ((startH - DAY_START + 24) % 24) * SLOT_H;
  const hPx     = dur * SLOT_H;
  const isShort = hPx < 46;
  const colW    = 100 / totalCols;
  const leftPct = col * colW;

  const el = document.createElement('div');
  el.className  = 'timeline-block' + (item.custom ? ' custom-item' : '');
  el.dataset.id  = item.id;
  el.dataset.day = day;
  if (isShort) el.dataset.short = 'true';

  el.style.top    = topPx + 'px';
  el.style.height = hPx + 'px';
  el.style.left   = `calc(${leftPct}% + 2px)`;
  el.style.right  = 'auto';
  el.style.width  = `calc(${colW}% - 4px)`;

  const endH    = startH + dur;
  const endDisp = endH >= 24 ? endH - 24 : endH;
  el.innerHTML = `
    <div class="timeline-block-name">${item.name}</div>
    <div class="timeline-block-time">${formatHour(startH)} – ${formatHour(endDisp)} · $${item.price_usd || 0}</div>
    <button class="timeline-block-remove" title="Remove">✕</button>
  `;

  el.querySelector('.timeline-block-remove').addEventListener('click', e => {
    e.stopPropagation();
    removeFromItinerary(item.id, day);
  });

  // 5B: draggable only on desktop
  if (!isMobile()) {
    el.draggable = true;
    el.style.cursor = 'grab';
    el.addEventListener('dragstart', e => {
      const rect = el.getBoundingClientRect();
      const hourOffset = (e.clientY - rect.top) / SLOT_H;
      e.dataTransfer.setData('text/plain', JSON.stringify({ source: 'itinerary', id: item.id, fromDay: day, hourOffset }));
      setTimeout(() => el.classList.add('dragging'), 0);
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  }

  // Mobile long-press drag (itinerary → itinerary)
  if (isMobile()) attachItineraryLongPressDrag(el, item, day);

  return el;
}

function buildItineraryItem(item, day) {
  const el = document.createElement('div');
  el.className  = 'itinerary-item' + (item.custom ? ' custom-item' : '');
  el.dataset.id  = item.id;
  el.dataset.day = day;

  const dur = item.duration >= 24 ? `${Math.round(item.duration / 24)}d` : `${item.duration}h`;
  el.innerHTML = `
    <div class="itinerary-item-name">${item.name}</div>
    <div class="itinerary-item-meta">
      <span>$${item.price_usd || 0}</span><span>•</span><span>${dur}</span>
      ${item.hour != null ? `<span>• ${formatHour(item.hour)}</span>` : ''}
    </div>
    <button class="itinerary-item-remove" data-id="${item.id}" data-day="${day}">✕</button>
  `;

  el.querySelector('.itinerary-item-remove').addEventListener('click', e => {
    e.stopPropagation();
    removeFromItinerary(item.id, day);
  });

  // 5B: draggable only on desktop
  if (!isMobile()) {
    el.draggable = true;
    el.style.cursor = 'grab';
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ source: 'itinerary', id: item.id, fromDay: day, hourOffset: 0 }));
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  }

  // Mobile long-press drag (itinerary → itinerary)
  if (isMobile()) attachItineraryLongPressDrag(el, item, day);

  return el;
}

// ── Long-press drag: itinerary item → another day (mobile) ──
// After a successful drop, opens the time-picker sheet (2B).
function attachItineraryLongPressDrag(el, item, fromDay) {
  let holdTimer   = null;
  let dragActive  = false;
  let touchDragEl = null;

  function cancelHold() { clearTimeout(holdTimer); holdTimer = null; }

  function startClone(touch) {
    touchDragEl = document.createElement('div');
    touchDragEl.className = 'touch-drag-clone';
    touchDragEl.textContent = item.name;
    touchDragEl.style.left = (touch.clientX - 80) + 'px';
    touchDragEl.style.top  = (touch.clientY - 20) + 'px';
    document.body.appendChild(touchDragEl);
  }
  function moveClone(touch) {
    if (!touchDragEl) return;
    touchDragEl.style.left = (touch.clientX - 80) + 'px';
    touchDragEl.style.top  = (touch.clientY - 20) + 'px';
  }
  function removeClone() {
    if (touchDragEl) { touchDragEl.remove(); touchDragEl = null; }
  }
  function findDayBodyUnder(x, y) {
    if (touchDragEl) touchDragEl.style.display = 'none';
    const found = document.elementFromPoint(x, y);
    if (touchDragEl) touchDragEl.style.display = '';
    return found ? found.closest('.day-body') : null;
  }

  el.addEventListener('touchstart', e => {
    dragActive = false;
    holdTimer = setTimeout(() => {
      dragActive = true;
      el.classList.add('long-press-active');
      document.querySelectorAll('.day-body').forEach(b => b.classList.add('touch-drop-target'));
      if (navigator.vibrate) navigator.vibrate(40);
      startClone(e.touches[0]);
    }, 400);
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (!dragActive) { cancelHold(); return; }
    e.preventDefault();
    const touch = e.touches[0];
    moveClone(touch);
    document.querySelectorAll('.day-body').forEach(b => b.classList.remove('touch-drop-hover'));
    const target = findDayBodyUnder(touch.clientX, touch.clientY);
    if (target) target.classList.add('touch-drop-hover');
  }, { passive: false });

  el.addEventListener('touchend', e => {
    cancelHold();
    el.classList.remove('long-press-active');
    document.querySelectorAll('.day-body').forEach(b => b.classList.remove('touch-drop-target', 'touch-drop-hover'));

    if (!dragActive) { removeClone(); return; }
    dragActive = false;

    const touch = e.changedTouches[0];
    removeClone();

    const targetBody = findDayBodyUnder(touch.clientX, touch.clientY);
    if (!targetBody) return;
    const toDay = parseInt(targetBody.dataset.day);
    if (!toDay) return;

    // Move item between days
    const fromItems = STATE.itinerary[fromDay] || [];
    const idx = fromItems.findIndex(i => i.id === item.id);
    if (idx === -1) return;
    const [moved] = fromItems.splice(idx, 1);
    moved.hour = null;
    if (!STATE.itinerary[toDay]) STATE.itinerary[toDay] = [];
    STATE.itinerary[toDay].push(moved);

    renderItinerary();
    toast(`${item.name} → Day ${toDay}`, 'success');

    // 2B: open time-picker after drop
    showTimePicker(moved, toDay);
  }, { passive: true });

  el.addEventListener('touchcancel', () => {
    cancelHold();
    dragActive = false;
    el.classList.remove('long-press-active');
    document.querySelectorAll('.day-body').forEach(b => b.classList.remove('touch-drop-target', 'touch-drop-hover'));
    removeClone();
  }, { passive: true });
}

// ═══════════════════════════════════════════════════════
// 2B — MOBILE TIME PICKER
// Opens after any mobile drop. Shows 6 AM – 11 PM hourly
// buttons plus a "Leave Unscheduled" escape.
// ═══════════════════════════════════════════════════════
function showTimePicker(item, day) {
  const existing = document.getElementById('time-picker-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'tap-assign-overlay';
  overlay.id = 'time-picker-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'tap-assign-sheet';

  sheet.innerHTML = `
    <div class="tap-assign-title">Set a time for Day ${day}</div>
    <div class="tap-assign-sub">${item.name}</div>
    <div class="time-picker-grid" id="time-picker-hours"></div>
    <button class="tap-assign-cancel" id="time-picker-unscheduled">Leave Unscheduled</button>
  `;

  const hoursEl = sheet.querySelector('#time-picker-hours');

  // 6 AM (hour 6) through 11 PM (hour 23)
  for (let h = 6; h <= 23; h++) {
    const btn = document.createElement('button');
    btn.className = 'time-picker-hour-btn';
    btn.textContent = formatHour(h);
    btn.addEventListener('click', () => {
      // Find the item in STATE.itinerary[day] and set its hour
      const target = (STATE.itinerary[day] || []).find(i => i.id === item.id);
      if (target) target.hour = h;
      overlay.remove();
      renderItinerary();
      toast(`${item.name} scheduled at ${formatHour(h)}`, 'success');
    });
    hoursEl.appendChild(btn);
  }

  sheet.querySelector('#time-picker-unscheduled').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
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
      else toast('Already on this day');
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
// 3B — TAP-TO-ASSIGN / "ASSIGN TO DAY"
// Mobile: full-width bottom sheet (original behaviour).
// Desktop: small popover anchored to the trigger element.
// triggerEl may be null (mobile never needs it).
// ═══════════════════════════════════════════════════════
function showTapAssign(item, triggerEl) {
  const existing = document.getElementById('tap-assign-overlay');
  if (existing) existing.remove();

  if (!isMobile() && triggerEl) {
    showAssignPopover(item, triggerEl);
  } else {
    showAssignSheet(item);
  }
}

// ── Desktop: popover anchored to triggerEl ──────────────
function showAssignPopover(item, triggerEl) {
  // Dismiss any existing popover
  const existingPop = document.getElementById('assign-popover');
  if (existingPop) existingPop.remove();

  const popover = document.createElement('div');
  popover.className = 'assign-popover';
  popover.id = 'assign-popover';

  const title = document.createElement('div');
  title.className = 'assign-popover-title';
  title.textContent = 'Assign to day';
  popover.appendChild(title);

  const sub = document.createElement('div');
  sub.className = 'assign-popover-sub';
  sub.textContent = item.name;
  popover.appendChild(sub);

  const grid = document.createElement('div');
  grid.className = 'assign-popover-days';
  popover.appendChild(grid);

  for (let d = 1; d <= STATE.dayCount; d++) {
    const alreadyOnDay = (STATE.itinerary[d] || []).find(i => i.id === item.id);
    const btn = document.createElement('button');
    btn.className = 'assign-popover-day-btn' + (alreadyOnDay ? ' assigned' : '');
    btn.textContent = alreadyOnDay ? `Day ${d} ✓` : `Day ${d}`;
    btn.disabled = !!alreadyOnDay;
    btn.addEventListener('click', () => {
      if (!STATE.itinerary[d]) STATE.itinerary[d] = [];
      STATE.itinerary[d].push({ ...item });
      popover.remove();
      document.removeEventListener('click', outsideHandler, true);
      toast(`${item.name} → Day ${d}`, 'success');
      if (STATE.currentView === 'itinerary') renderItinerary();
    });
    grid.appendChild(btn);
  }

  document.body.appendChild(popover);

  // Position below the trigger button, aligned to its left edge
  const rect = triggerEl.getBoundingClientRect();
  const scrollY = window.scrollY || document.documentElement.scrollTop;
  const scrollX = window.scrollX || document.documentElement.scrollLeft;
  popover.style.top  = (rect.bottom + scrollY + 6) + 'px';
  popover.style.left = (rect.left  + scrollX) + 'px';

  // Flip up if too close to bottom of viewport
  requestAnimationFrame(() => {
    const popRect = popover.getBoundingClientRect();
    if (popRect.bottom > window.innerHeight - 16) {
      popover.style.top  = (rect.top + scrollY - popRect.height - 6) + 'px';
    }
    // Clamp to right edge
    if (popRect.right > window.innerWidth - 16) {
      popover.style.left = (window.innerWidth - popRect.width - 16 + scrollX) + 'px';
    }
  });

  // Dismiss on outside click
  function outsideHandler(e) {
    if (!popover.contains(e.target) && e.target !== triggerEl) {
      popover.remove();
      document.removeEventListener('click', outsideHandler, true);
    }
  }
  // Defer so the triggering click doesn't immediately close it
  setTimeout(() => document.addEventListener('click', outsideHandler, true), 0);
}

// ── Mobile: full-width bottom sheet ────────────────────
function showAssignSheet(item) {
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

  let hasItinerary = false, itinHtml = '';
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
        timeStr = ` — ${formatHour(item.hour)} – ${formatHour(item.hour + (item.duration || 0))}`;
      }
      itinHtml += `<div class="export-item"><span>${item.name}${timeStr}</span><span style="color:var(--text-dim)">$${item.price_usd || 0} · ${dur}</span></div>`;
    }
    itinHtml += '</div>';
  }
  if (hasItinerary) html += `<div class="export-section"><h3>Itinerary Schedule</h3>${itinHtml}</div>`;

  if (STATE.pool.length) {
    html += `<div class="export-section"><h3>All Selected Activities</h3>`;
    for (const item of STATE.pool) {
      const dur = item.duration >= 24 ? `${Math.round(item.duration / 24)} days` : `${item.duration} hrs`;
      html += `<div class="export-item"><span>${item.name} <span style="color:var(--text-muted);font-size:.7rem">— ${item.country || ''}</span></span><span style="color:var(--text-dim)">$${item.price_usd || 0} · ${dur}</span></div>`;
    }
    html += `<div class="export-total"><span>Total Estimated Cost</span><span style="color:var(--gold)">$${totalCost.toLocaleString()} ($${perPerson.toLocaleString()} / person)</span></div></div>`;
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
  const data = { name, saved: new Date().toISOString(), pool: STATE.pool, itinerary: STATE.itinerary, dayCount: STATE.dayCount, headcount: STATE.headcount };
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
function openCustomModal()  { document.getElementById('modal-custom').classList.add('open'); document.getElementById('custom-name').focus(); }
function closeCustomModal() { document.getElementById('modal-custom').classList.remove('open'); }
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
    custom: true, multi_day: false,
  };
  addToPool(item);
  closeCustomModal();
  ['custom-name','custom-location','custom-price','custom-duration','custom-notes'].forEach(id => {
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
  layout.style.height = `calc(100vh - ${header.offsetHeight + nav.offsetHeight}px)`;
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
  const badge = count > 0 ? `· ${count} item${count === 1 ? '' : 's'}` : '';
  bar.innerHTML = STATE.poolCollapsed
    ? `▼ Show Trip Pool <span style="color:var(--text-dim);margin-left:4px">${badge}</span>`
    : `▲ Hide Trip Pool <span style="color:var(--text-dim);margin-left:4px">${badge}</span>`;
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

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

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

  document.getElementById('headcount').addEventListener('input', e => {
    STATE.headcount = parseInt(e.target.value) || 1;
    renderPool();
  });
  document.getElementById('pool-clear-btn').addEventListener('click', () => {
    if (!STATE.pool.length) return;
    STATE.pool = [];
    for (const d of Object.keys(STATE.itinerary)) STATE.itinerary[d] = [];
    renderPool();
    refreshCardsAddedState();
    if (STATE.currentView === 'itinerary') renderItinerary();
    toast('Trip pool cleared');
  });

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

  document.getElementById('hour-mode-toggle').addEventListener('change', e => {
    STATE.hourMode = e.target.checked;
    renderItinerary();
  });
  document.getElementById('btn-clear-itinerary').addEventListener('click', () => {
    for (const d of Object.keys(STATE.itinerary)) STATE.itinerary[d] = [];
    renderItinerary();
    toast('Itinerary cleared');
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    document.getElementById('save-name').value = '';
    document.getElementById('modal-save').classList.add('open');
    document.getElementById('save-name').focus();
  });
  document.getElementById('save-cancel').addEventListener('click', () => document.getElementById('modal-save').classList.remove('open'));
  document.getElementById('save-confirm').addEventListener('click', () => {
    const name = document.getElementById('save-name').value.trim() || 'My Trip';
    saveTrip(name);
    document.getElementById('modal-save').classList.remove('open');
  });

  document.getElementById('btn-load').addEventListener('click', loadLastTrip);
  document.getElementById('btn-export').addEventListener('click', () => switchView('export'));
  document.getElementById('btn-custom-event').addEventListener('click', openCustomModal);
  document.getElementById('custom-cancel').addEventListener('click', closeCustomModal);
  document.getElementById('custom-save').addEventListener('click', saveCustomEvent);

  const mobileToggle = document.getElementById('pool-toggle-mobile');
  if (mobileToggle) mobileToggle.addEventListener('click', toggleMobilePool);

  const toggleBar = document.getElementById('pool-toggle-bar');
  if (toggleBar) toggleBar.addEventListener('click', toggleMobilePool);

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
      closeCountryPanel();
      closeMobilePanel();
      document.getElementById('assign-popover')?.remove();
    }
  });

  // Close country grid panels when clicking outside the nav
  document.addEventListener('click', e => {
    const panel       = document.getElementById('country-grid-panel');
    const mobilePanel = document.getElementById('mobile-country-panel');
    const navBar      = document.getElementById('nav-bar');
    const mobileNav   = document.getElementById('mobile-nav');
    if (panel && panel.classList.contains('open')) {
      if (!navBar || !navBar.contains(e.target)) closeCountryPanel();
    }
    if (mobilePanel && mobilePanel.classList.contains('open')) {
      if ((!mobileNav || !mobileNav.contains(e.target)) && !mobilePanel.contains(e.target)) closeMobilePanel();
    }
  });

  function checkMobile() {
    const mobile = window.innerWidth <= 900;
    if (mobileToggle) mobileToggle.style.display = mobile ? 'flex' : 'none';
    if (toggleBar)    toggleBar.style.display     = mobile ? 'flex' : 'none';
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
