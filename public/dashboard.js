/**
 * dashboard.js  –  Session Memory MCP Dashboard
 *
 * This file is the orchestration layer. All render helpers live in
 * ui-components.js, and pagination state/logic lives in pagination.js.
 * This file owns:
 *   - API fetch wrapper + auth modal
 *   - Data-load functions (loadContexts, loadPreferences, …)
 *   - Modal open/close + content population (via buildModalContent)
 *   - Edit/delete flows for every record type
 *   - Stats, health check, theme, animations, and init
 */

'use strict';

// ---------------------------------------------------------------------------
// API Configuration
// ---------------------------------------------------------------------------

const API_BASE = '';

// API auth token (sessionStorage for security — cleared on browser close)
let apiToken = sessionStorage.getItem('mcp_dashboard_token') || '';

// ---------------------------------------------------------------------------
// Pagination instances  (created after DOMContentLoaded in init)
// ---------------------------------------------------------------------------

let pagers = {};

// ---------------------------------------------------------------------------
// API fetch wrapper with auth
// ---------------------------------------------------------------------------

async function apiFetch(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401 || response.status === 403) {
        const data = await response.json().catch(() => ({}));
        showAuthModal(data.error || 'Authentication required');
        throw new Error(data.error || 'Authentication failed');
    }

    return response;
}

// ---------------------------------------------------------------------------
// Auth modal
// ---------------------------------------------------------------------------

function showAuthModal(message = 'API token required') {
    let modal = document.getElementById('auth-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'auth-modal';
        modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
        modal.innerHTML = `
            <div class="bg-card border border-border rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
                <h2 class="text-lg font-semibold text-foreground mb-2">Authentication Required</h2>
                <p id="auth-modal-message" class="text-muted-foreground text-sm mb-4">${escapeHtml(message)}</p>
                <div class="space-y-3">
                    <input type="password" id="auth-token-input" placeholder="Enter API token"
                        class="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground
                               placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"/>
                    <div class="flex items-center gap-2">
                        <input type="checkbox" id="auth-remember" class="rounded border-border" checked />
                        <label for="auth-remember" class="text-sm text-muted-foreground">Remember token</label>
                    </div>
                    <div class="flex gap-2">
                        <button id="auth-submit-btn"
                            class="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
                            Authenticate
                        </button>
                        <button id="auth-cancel-btn"
                            class="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors">
                            Cancel
                        </button>
                    </div>
                </div>
                <p class="text-xs text-muted-foreground mt-4">
                    Set MCP_DASHBOARD_TOKEN environment variable to enable authentication.
                </p>
            </div>`;
        document.body.appendChild(modal);

        document.getElementById('auth-submit-btn').addEventListener('click', handleAuthSubmit);
        document.getElementById('auth-cancel-btn').addEventListener('click', () => modal.remove());
        document.getElementById('auth-token-input').addEventListener('keypress', e => {
            if (e.key === 'Enter') handleAuthSubmit();
        });
    } else {
        document.getElementById('auth-modal-message').textContent = message;
        modal.classList.remove('hidden');
    }
}

function handleAuthSubmit() {
    const input   = document.getElementById('auth-token-input');
    const remember = document.getElementById('auth-remember');
    const token   = input.value.trim();

    if (!token) { showToast('Please enter an API token', 'warning'); return; }

    apiToken = token;
    if (remember.checked) sessionStorage.setItem('mcp_dashboard_token', token);

    document.getElementById('auth-modal').remove();
    showToast('Token saved, refreshing data…', 'success');
    loadStats();
    loadCurrentTabData();
}

function loadCurrentTabData() {
    Promise.all([loadContexts(), loadPreferences(), loadConventions(), loadInteractions(), loadTasks()]);
}

// ---------------------------------------------------------------------------
// Animation utilities
// ---------------------------------------------------------------------------

function animate(element, properties, duration = 300, easing = 'ease-in-out') {
    return new Promise(resolve => {
        element.style.transition = `all ${duration}ms ${easing}`;
        Object.assign(element.style, properties);
        setTimeout(() => { element.style.transition = ''; resolve(); }, duration);
    });
}

function fadeIn(element, duration = 300) {
    element.style.opacity = '0';
    element.classList.remove('hidden');
    return animate(element, { opacity: '1' }, duration);
}

function fadeOut(element, duration = 300) {
    return animate(element, { opacity: '0' }, duration).then(() => element.classList.add('hidden'));
}

// ---------------------------------------------------------------------------
// Global loading overlay
// ---------------------------------------------------------------------------

function showGlobalLoading(message = 'Loading…') {
    const loader = document.getElementById('global-loading');
    if (!loader) return;
    const text = loader.querySelector('.loading-text');
    if (text) text.textContent = message;
    loader.classList.add('active');
}

function hideGlobalLoading() {
    document.getElementById('global-loading')?.classList.remove('active');
}

// ---------------------------------------------------------------------------
// Global refresh
// ---------------------------------------------------------------------------

async function refreshAllData() {
    const refreshIcon = document.querySelector('[onclick="refreshAllData()"] [data-lucide="refresh-cw"]');
    try {
        refreshIcon?.classList.add('animate-spin');
        showToast('Refreshing all data…', 'info', 1500);
        await Promise.all([
            checkHealth(), loadStats(),
            loadContexts(), loadPreferences(), loadConventions(),
            loadInteractions(), loadTasks(),
        ]);
        updateTimestamp();
        showToast('All data refreshed successfully', 'success', 2000);
    } catch (err) {
        console.error('Error refreshing data:', err);
        showToast('Some data failed to refresh', 'warning', 3000);
    } finally {
        refreshIcon?.classList.remove('animate-spin');
    }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

async function checkHealth() {
    const indicator = document.getElementById('health-indicator');
    const text      = document.getElementById('health-text');
    if (!indicator || !text) return;

    indicator.className = 'status-dot';
    text.textContent = 'Checking…';

    try {
        const response = await fetch(`${API_BASE}/api/health`);
        const data = await response.json();
        if (data.status === 'healthy') {
            indicator.className = 'status-dot healthy';
            text.textContent = 'Connected';
            showToast('Server connection healthy', 'success', 2000);
        } else {
            indicator.className = 'status-dot warning';
            text.textContent = 'Degraded';
            showToast('Server connection degraded', 'warning', 3000);
        }
    } catch (err) {
        console.error('Health check failed:', err);
        indicator.className = 'status-dot error';
        text.textContent = 'Disconnected';
        showToast('Server connection failed', 'error', 5000);
    }
}

// ---------------------------------------------------------------------------
// Stats + chart
// ---------------------------------------------------------------------------

let statsChart = null;

async function loadStats() {
    const statMap = {
        'session-count':     'session_contexts',
        'preference-count':  'user_preferences',
        'convention-count':  'project_conventions',
        'interaction-count': 'interactions',
        'task-count':        'tasks',
    };
    const cardMap = {
        'session-count':     'sessions',
        'preference-count':  'preferences',
        'convention-count':  'conventions',
        'interaction-count': 'interactions',
        'task-count':        'tasks',
    };

    try {
        showGlobalLoading('Loading statistics…');
        const response = await apiFetch(`${API_BASE}/api/stats`);
        const data     = await response.json();
        const previous = JSON.parse(localStorage.getItem('stats_previous_values') || '{}');

        for (const [elemId, dataKey] of Object.entries(statMap)) {
            const elem   = document.getElementById(elemId);
            if (!elem) continue;
            const target = data.data[dataKey] || 0;
            const prev   = previous[dataKey] || target;
            await animateCounter(elem, parseInt(elem.textContent) || 0, target, 1000);
            updateTrendIndicator(elemId, target, prev, cardMap);
            document.querySelector(`[data-card="${cardMap[elemId]}"]`)?.removeAttribute('data-loading');
        }

        localStorage.setItem('stats_previous_values', JSON.stringify({
            session_contexts:   data.data.session_contexts   || 0,
            user_preferences:   data.data.user_preferences   || 0,
            project_conventions: data.data.project_conventions || 0,
            interactions:       data.data.interactions       || 0,
            tasks:              data.data.tasks              || 0,
        }));

        updateStatsChart(data.data);
        updateTimestamp();

        const announcements = document.getElementById('sr-announcements');
        if (announcements) announcements.textContent = 'Statistics updated successfully';
    } catch (err) {
        console.error('Error loading stats:', err);
        showToast('Failed to load statistics', 'error');
    } finally {
        hideGlobalLoading();
    }
}

function updateTrendIndicator(statElemId, current, previous, cardMap) {
    const card = document.querySelector(`[data-card="${cardMap[statElemId]}"]`);
    if (!card) return;
    const container = card.querySelector('.trend-indicator');
    if (!container) return;

    const change = current - previous;
    const pct    = previous > 0 ? ((change / previous) * 100) : 0;

    let cls  = 'trend-neutral';
    let icon = '—';
    let text = 'No change';
    if (change > 0) { cls = 'trend-up';   icon = '↑'; text = `+${Math.abs(pct).toFixed(1)}%`; }
    if (change < 0) { cls = 'trend-down'; icon = '↓'; text = `${pct.toFixed(1)}%`; }

    container.className = `trend-indicator ${cls}`;
    container.innerHTML = `<span class="trend-icon">${icon}</span><span class="trend-text">${text}</span>`;

    if (change !== 0) {
        container.style.display = 'flex';
        container.style.opacity = '0';
        container.style.transform = 'scale(0.8)';
        setTimeout(() => {
            container.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            container.style.opacity = '1';
            container.style.transform = 'scale(1)';
        }, 100);
    } else {
        container.style.display = 'none';
    }

    card.setAttribute('data-trend', change > 0 ? 'up' : change < 0 ? 'down' : 'neutral');
}

function toggleStatsView(viewType) {
    const cardsView = document.getElementById('stats-cards-view');
    const chartView = document.getElementById('stats-chart-view');
    const toggleContainer = document.querySelector('.chart-toggle');
    if (!toggleContainer || toggleContainer.classList.contains('transitioning')) return;
    toggleContainer.classList.add('transitioning');

    if (viewType === 'cards') {
        fadeOut(chartView, 200).then(() => fadeIn(cardsView, 200));
    } else {
        fadeOut(cardsView, 200).then(() => {
            fadeIn(chartView, 200);
            if (!statsChart) loadStats();
        });
    }

    toggleContainer.querySelectorAll('.chart-btn').forEach(btn => {
        const isActive = btn.getAttribute('data-chart') === viewType;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive);
    });

    showToast(`Switched to ${viewType} view`, 'info', 1000);
    setTimeout(() => toggleContainer.classList.remove('transitioning'), 300);
}

function updateStatsChart(data) {
    const ctx = document.getElementById('stats-chart');
    if (!ctx) return;

    const chartData = {
        labels: ['Sessions', 'Preferences', 'Conventions', 'Interactions', 'Tasks'],
        datasets: [{
            data: [
                data.session_contexts    || 0,
                data.user_preferences    || 0,
                data.project_conventions || 0,
                data.interactions        || 0,
                data.tasks               || 0,
            ],
            backgroundColor: ['var(--primary)', '#10b981', '#f59e0b', '#3b82f6', '#9333ea'],
            borderColor:     ['var(--primary)', '#10b981', '#f59e0b', '#3b82f6', '#9333ea'],
            borderWidth: 2,
            hoverOffset: 8,
        }],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'var(--bg-primary)',
                titleColor: 'var(--text-primary)',
                bodyColor: 'var(--text-secondary)',
                borderColor: 'var(--border-color)',
                borderWidth: 1,
                cornerRadius: 8,
                callbacks: {
                    label(ctx) {
                        const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                        const pct   = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
                        return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                    },
                },
            },
        },
        animation: { animateScale: true, animateRotate: true, duration: 1000, easing: 'easeInOutQuart' },
    };

    if (statsChart) {
        statsChart.data = chartData;
        statsChart.update('active');
    } else {
        statsChart = new Chart(ctx, { type: 'doughnut', data: chartData, options });
    }
}

async function animateCounter(element, start, end, duration = 1000) {
    const startTime  = performance.now();
    const difference = end - start;

    return new Promise(resolve => {
        function update(currentTime) {
            const elapsed  = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased    = 1 - Math.pow(1 - progress, 3); // ease-out cubic
            element.textContent = Math.round(start + difference * eased);
            if (progress < 1) requestAnimationFrame(update);
            else { element.textContent = end; resolve(); }
        }
        requestAnimationFrame(update);
    });
}

// ---------------------------------------------------------------------------
// Session Contexts
// ---------------------------------------------------------------------------

async function loadContexts() {
    const tbody      = document.getElementById('contexts-body');
    const searchTerm = document.getElementById('session-search')?.value.toLowerCase() ?? '';

    try {
        tbody.innerHTML = skeletonRows(5, ['120px', '80px', '100px', '200px', '80px', '60px']);

        const response = await apiFetch(`${API_BASE}/api/contexts?limit=${pagers.contexts.pageSize}&offset=${pagers.contexts.offset}`);
        const data     = await response.json();

        pagers.contexts.update(data.pagination);

        let rows = (data.data || []).filter(ctx =>
            !searchTerm ||
            (ctx.session_id  || '').toLowerCase().includes(searchTerm) ||
            (ctx.context_type|| '').toLowerCase().includes(searchTerm) ||
            (ctx.key         || '').toLowerCase().includes(searchTerm)
        );

        if (!rows.length) {
            tbody.innerHTML = emptyStateHtml('database', 'No session contexts found',
                'Session contexts will appear here once you start using the MCP server.', 6);
            lucide.createIcons();
            return;
        }

        tbody.innerHTML = '';
        rows.forEach((ctx, i) => {
            const row = document.createElement('tr');
            row.style.cssText = 'opacity:0;transform:translateY(10px);cursor:pointer';
            row.innerHTML = `
                <td>${escapeHtml(ctx.session_id || 'N/A')}</td>
                <td><span class="badge">${escapeHtml(ctx.context_type || 'N/A')}</span></td>
                <td><code>${escapeHtml(ctx.key || 'N/A')}</code></td>
                <td>${truncate(ctx.value, 80)}</td>
                <td>${formatDate(ctx.updated_at)}</td>
                <td class="actions-cell">
                    <button class="action-btn delete-btn"
                        onclick="event.stopPropagation(); confirmDelete('context', ${ctx.id}, '${escapeHtml(ctx.session_id)}')"
                        title="Delete Context" aria-label="Delete context">
                        <i data-lucide="trash-2" class="w-4 h-4" aria-hidden="true"></i>
                    </button>
                </td>`;
            row.addEventListener('click', () => openModal('context', ctx));
            tbody.appendChild(row);
            setTimeout(() => animate(row, { opacity: '1', transform: 'translateY(0)' }, 300), i * 50);
        });

        lucide.createIcons();
    } catch (err) {
        console.error('Error loading contexts:', err);
        tbody.innerHTML = errorStateHtml('Error loading session contexts', 6, 'loadContexts');
        lucide.createIcons();
        showToast('Failed to load session contexts', 'error');
    }
}

// ---------------------------------------------------------------------------
// User Preferences
// ---------------------------------------------------------------------------

async function loadPreferences() {
    const tbody          = document.getElementById('preferences-body');
    const searchTerm     = document.getElementById('preference-search')?.value.toLowerCase() ?? '';
    const categoryFilter = document.getElementById('category-filter')?.value ?? 'all';

    try {
        tbody.innerHTML = skeletonRows(5, ['80px', '90px', '100px', '150px', '60px', '80px', '40px']);

        const response = await apiFetch(`${API_BASE}/api/preferences?limit=${pagers.preferences.pageSize}&offset=${pagers.preferences.offset}`);
        const data     = await response.json();

        pagers.preferences.update(data.pagination);

        let rows = (data.data || [])
            .filter(p => categoryFilter === 'all' || (p.category || '').toLowerCase() === categoryFilter.toLowerCase())
            .filter(p =>
                !searchTerm ||
                (p.user_id         || '').toLowerCase().includes(searchTerm) ||
                (p.category        || '').toLowerCase().includes(searchTerm) ||
                (p.preference_key  || '').toLowerCase().includes(searchTerm) ||
                String(p.preference_value || '').toLowerCase().includes(searchTerm)
            );

        updateCategoryAnalytics(data.data || []);

        if (!rows.length) {
            tbody.innerHTML = emptyStateHtml('sliders', 'No user preferences found',
                'User preferences are learned automatically as you interact with the system.', 7);
            lucide.createIcons();
            return;
        }

        tbody.innerHTML = '';
        rows.forEach(pref => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.innerHTML = `
                <td>${escapeHtml(pref.user_id || 'N/A')}</td>
                <td><span class="badge">${escapeHtml(pref.category || 'N/A')}</span></td>
                <td>${escapeHtml(pref.preference_key || 'N/A')}</td>
                <td>${truncate(pref.preference_value, 60)}</td>
                <td>${confidenceBadge(pref.confidence)}</td>
                <td>${formatDate(pref.updated_at)}</td>
                <td class="actions-cell">
                    <button class="action-btn edit-btn"
                        onclick="event.stopPropagation(); openEditPreferenceModal('${JSON.stringify(pref).replace(/'/g, '&#39;')}')"
                        title="Edit Preference" aria-label="Edit preference">
                        <i data-lucide="edit-2" class="w-4 h-4" aria-hidden="true"></i>
                    </button>
                    <button class="action-btn delete-btn"
                        onclick="event.stopPropagation(); confirmDelete('preference', ${pref.id}, '${escapeHtml(pref.preference_key)}')"
                        title="Delete Preference" aria-label="Delete preference">
                        <i data-lucide="trash-2" class="w-4 h-4" aria-hidden="true"></i>
                    </button>
                </td>`;
            row.addEventListener('click', () => openModal('preference', pref));
            tbody.appendChild(row);
        });

        lucide.createIcons();
    } catch (err) {
        console.error('Error loading preferences:', err);
        tbody.innerHTML = errorStateHtml('Error loading preferences', 7, 'loadPreferences');
        lucide.createIcons();
    }
}

function updateCategoryAnalytics(preferences) {
    const container = document.getElementById('category-analytics');
    if (!container) return;
    const counts = {};
    preferences.forEach(p => { const c = p.category || 'uncategorized'; counts[c] = (counts[c] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) { container.innerHTML = '<p class="no-data">No category data available</p>'; return; }
    container.innerHTML = `<div class="category-stats">${
        sorted.map(([cat, count]) => `
            <div class="category-stat-item">
                <span class="badge">${escapeHtml(cat)}</span>
                <span class="stat-count">${count} (${((count / preferences.length) * 100).toFixed(1)}%)</span>
            </div>`).join('')
    }</div>`;
}

async function populateCategoryFilter() {
    const select = document.getElementById('category-filter');
    if (!select) return;
    try {
        const response = await apiFetch(`${API_BASE}/api/preferences?limit=1000`);
        const data = await response.json();
        const categories = [...new Set((data.data || []).map(p => p.category).filter(Boolean))].sort();
        select.innerHTML = '<option value="all">All Categories</option>';
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat; opt.textContent = cat;
            select.appendChild(opt);
        });
    } catch (err) { console.error('Error populating category filter:', err); }
}

// ---------------------------------------------------------------------------
// Project Conventions
// ---------------------------------------------------------------------------

async function loadConventions() {
    const tbody      = document.getElementById('conventions-body');
    const searchTerm = document.getElementById('convention-search')?.value.toLowerCase() ?? '';

    try {
        tbody.innerHTML = skeletonRows(5, ['100px', '80px', '90px', '150px', '120px', '80px', '40px']);

        const response = await apiFetch(`${API_BASE}/api/conventions?limit=${pagers.conventions.pageSize}&offset=${pagers.conventions.offset}`);
        const data     = await response.json();

        pagers.conventions.update(data.pagination);

        let rows = (data.data || []).filter(c =>
            !searchTerm ||
            (c.project_id     || '').toLowerCase().includes(searchTerm) ||
            (c.language       || '').toLowerCase().includes(searchTerm) ||
            (c.convention_type|| '').toLowerCase().includes(searchTerm) ||
            (c.pattern        || '').toLowerCase().includes(searchTerm) ||
            String(c.example  || '').toLowerCase().includes(searchTerm)
        );

        if (!rows.length) {
            tbody.innerHTML = emptyStateHtml('book-open', 'No project conventions found',
                'Project conventions are learned as you work with different codebases.', 7);
            lucide.createIcons();
            return;
        }

        tbody.innerHTML = '';
        rows.forEach(conv => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.innerHTML = `
                <td><span class="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">${escapeHtml(conv.project_id || 'N/A')}</span></td>
                <td><span class="badge language-${conv.language || 'unknown'}">${escapeHtml(conv.language || 'N/A')}</span></td>
                <td><span class="text-xs font-medium">${escapeHtml(conv.convention_type || 'N/A')}</span></td>
                <td title="${escapeHtml(conv.pattern || '')}"><code class="text-xs bg-gray-50 dark:bg-gray-800 px-1 rounded">${truncate(conv.pattern || '', 60)}</code></td>
                <td title="${escapeHtml(conv.example || '')}">${truncate(conv.example || '', 60)}</td>
                <td><span class="text-xs text-gray-500">${formatDate(conv.updated_at)}</span></td>
                <td class="actions-cell">
                    <button onclick="event.stopPropagation(); this.closest('tr').click()"
                        class="action-btn edit-btn" aria-label="View convention details" title="View Details">
                        <i data-lucide="eye" class="w-4 h-4" aria-hidden="true"></i>
                    </button>
                    <button onclick="event.stopPropagation(); confirmDelete('convention', ${conv.id}, '${escapeHtml(conv.convention_type)}')"
                        class="action-btn delete-btn" aria-label="Delete convention" title="Delete Convention">
                        <i data-lucide="trash-2" class="w-4 h-4" aria-hidden="true"></i>
                    </button>
                </td>`;
            row.addEventListener('click', () => openModal('convention', conv));
            tbody.appendChild(row);
        });

        lucide.createIcons();
    } catch (err) {
        console.error('Error loading conventions:', err);
        tbody.innerHTML = errorStateHtml('Error loading conventions', 7, 'loadConventions');
        lucide.createIcons();
    }
}

// ---------------------------------------------------------------------------
// Interaction History
// ---------------------------------------------------------------------------

async function loadInteractions() {
    const tbody      = document.getElementById('interactions-body');
    const searchTerm = document.getElementById('interaction-search')?.value.toLowerCase() ?? '';

    try {
        tbody.innerHTML = skeletonRows(5, ['100px', '70px', '180px', '100px', '80px', '40px']);

        const response = await apiFetch(`${API_BASE}/api/interactions?limit=${pagers.interactions.pageSize}&offset=${pagers.interactions.offset}`);
        const result   = await response.json();

        if (!result?.data) {
            tbody.innerHTML = errorStateHtml('Error loading interactions', 6, 'loadInteractions');
            lucide.createIcons();
            return;
        }

        pagers.interactions.update(result.pagination);

        let rows = result.data.filter(int =>
            !searchTerm ||
            (int.session_id || '').toLowerCase().includes(searchTerm) ||
            (int.role       || '').toLowerCase().includes(searchTerm) ||
            (int.content    || '').toLowerCase().includes(searchTerm) ||
            JSON.stringify(int.metadata || {}).toLowerCase().includes(searchTerm)
        );

        if (!rows.length) {
            tbody.innerHTML = emptyStateHtml('message-square', 'No interactions found',
                'Interaction history will appear here as you use the system.', 6);
            lucide.createIcons();
            return;
        }

        tbody.innerHTML = '';
        rows.forEach(int => {
            const metaStr = int.metadata ? JSON.stringify(int.metadata, null, 2) : '{}';
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.innerHTML = `
                <td><span class="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">${escapeHtml(int.session_id || 'N/A')}</span></td>
                <td><span class="badge role-${int.role || 'unknown'}">${escapeHtml(int.role || 'N/A')}</span></td>
                <td title="${escapeHtml(int.content || '')}"><div class="max-w-xs">${truncate(int.content || '', 100)}</div></td>
                <td title="${escapeHtml(metaStr)}"><code class="text-xs bg-gray-50 dark:bg-gray-800 px-1 rounded max-w-xs block truncate">${truncate(metaStr, 50)}</code></td>
                <td><span class="text-xs text-gray-500">${formatDate(int.created_at)}</span></td>
                <td class="actions-cell">
                    <button onclick="event.stopPropagation(); this.closest('tr').click()"
                        class="action-btn edit-btn" aria-label="View interaction details" title="View Details">
                        <i data-lucide="eye" class="w-4 h-4" aria-hidden="true"></i>
                    </button>
                    <button onclick="event.stopPropagation(); confirmDelete('interaction', ${int.id}, '${escapeHtml(int.session_id)}')"
                        class="action-btn delete-btn" aria-label="Delete interaction" title="Delete Interaction">
                        <i data-lucide="trash-2" class="w-4 h-4" aria-hidden="true"></i>
                    </button>
                </td>`;
            row.addEventListener('click', () => openModal('interaction', int));
            tbody.appendChild(row);
        });

        lucide.createIcons();
    } catch (err) {
        console.error('Error loading interactions:', err);
        tbody.innerHTML = errorStateHtml('Error loading interactions', 6, 'loadInteractions');
        lucide.createIcons();
    }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

async function loadTasks() {
    const tbody          = document.getElementById('tasks-body');
    const searchQuery    = document.getElementById('task-search')?.value.toLowerCase() ?? '';
    const stateFilter    = document.getElementById('task-state-filter')?.value ?? '';
    const workflowFilter = document.getElementById('task-workflow-filter')?.value ?? '';
    const agentFilter    = document.getElementById('task-agent-filter')?.value ?? '';

    try {
        if (tbody) tbody.innerHTML = skeletonRows(5, ['50px','180px','80px','60px','100px','120px','80px','100px']);

        const response = await apiFetch(`/api/tasks?limit=${pagers.tasks.pageSize}&offset=${pagers.tasks.offset}`);
        const data     = await response.json();

        if (!data.success) throw new Error(data.error || 'Failed to load tasks');

        pagers.tasks.update(data.pagination);

        let tasks = (data.data || []).filter(task => {
            const matchSearch   = !searchQuery   || task.title?.toLowerCase().includes(searchQuery) ||
                                                    task.workflow_id?.toLowerCase().includes(searchQuery) ||
                                                    task.agent_id?.toLowerCase().includes(searchQuery);
            const matchState    = !stateFilter    || task.state    === stateFilter;
            const matchWorkflow = !workflowFilter || task.workflow_id === workflowFilter;
            const matchAgent    = !agentFilter    || task.agent_id   === agentFilter;
            return matchSearch && matchState && matchWorkflow && matchAgent;
        });

        updateTaskFilters(data.data || []);

        if (!tbody) return;

        if (!tasks.length) {
            tbody.innerHTML = emptyStateHtml('list-todo', 'No tasks found',
                'Tasks created through the workflow system will appear here.', 8);
            lucide.createIcons();
            return;
        }

        tbody.innerHTML = tasks.map(task => `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer border-b border-gray-200 dark:border-gray-700"
                onclick="showTaskDetails('${escapeHtml(String(task.id))}')">
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 font-mono">
                        #${escapeHtml(String(task.id ?? 'N/A'))}
                    </span>
                </td>
                <td class="px-6 py-4">
                    <div class="flex flex-col">
                        <div class="text-sm font-medium text-gray-900 dark:text-gray-100" title="${escapeHtml(task.title ?? 'Untitled')}">
                            ${escapeHtml((task.title ?? 'Untitled').substring(0, 45))}${(task.title ?? '').length > 45 ? '…' : ''}
                        </div>
                        ${task.description ? `<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">${escapeHtml((task.description ?? '').substring(0, 60))}${(task.description ?? '').length > 60 ? '…' : ''}</div>` : ''}
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">${taskStateBadge(task.state)}</td>
                <td class="px-6 py-4 whitespace-nowrap">${priorityBadge(task.priority)}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="text-sm text-gray-800 dark:text-gray-300">${escapeHtml(task.agent_id ?? 'N/A')}</span>
                </td>
                <td class="px-6 py-4">
                    <span class="text-sm text-gray-800 dark:text-gray-300 font-mono" title="${escapeHtml(task.workflow_id ?? 'N/A')}">
                        ${escapeHtml((task.workflow_id ?? 'N/A').substring(0, 25))}${(task.workflow_id ?? '').length > 25 ? '…' : ''}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="text-sm text-gray-600 dark:text-gray-400">${formatTimestamp(task.created_at)}</span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div class="flex items-center justify-end space-x-2">
                        <button onclick="event.stopPropagation(); showTaskDetails('${escapeHtml(String(task.id))}')"
                            class="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded text-gray-800 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                            View
                        </button>
                        <button onclick="event.stopPropagation(); openEditTaskModal('${escapeHtml(String(task.id))}')"
                            class="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                            title="Edit Task" aria-label="Edit task">
                            <i data-lucide="edit-2" class="w-3.5 h-3.5" aria-hidden="true"></i>
                        </button>
                        <button onclick="event.stopPropagation(); confirmDeleteTask('${escapeHtml(String(task.id))}', '${escapeHtml(task.title)}')"
                            class="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
                            title="Delete Task" aria-label="Delete task">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5" aria-hidden="true"></i>
                        </button>
                    </div>
                </td>
            </tr>`).join('');

        lucide.createIcons();
    } catch (err) {
        console.error('Error loading tasks:', err);
        if (tbody) { tbody.innerHTML = errorStateHtml(`Error loading tasks: ${err.message}`, 8, 'loadTasks'); lucide.createIcons(); }
    }
}

function updateTaskFilters(tasks) {
    const workflowSel = document.getElementById('task-workflow-filter');
    const agentSel    = document.getElementById('task-agent-filter');
    if (!workflowSel || !agentSel) return;

    const workflows = [...new Set(tasks.map(t => t.workflow_id).filter(Boolean))].sort();
    const agents    = [...new Set(tasks.map(t => t.agent_id).filter(Boolean))].sort();

    const prevWorkflow = workflowSel.value;
    const prevAgent    = agentSel.value;

    workflowSel.innerHTML = '<option value="">All Workflows</option>' +
        workflows.map(w => `<option value="${escapeHtml(w)}">${escapeHtml(w)}</option>`).join('');
    agentSel.innerHTML = '<option value="">All Agents</option>' +
        agents.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');

    if (workflows.includes(prevWorkflow)) workflowSel.value = prevWorkflow;
    if (agents.includes(prevAgent))       agentSel.value    = prevAgent;
}

async function showTaskDetails(taskId) {
    try {
        const response = await apiFetch('/api/tasks?limit=100');
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to load task details');
        const task = (data.data || []).find(t => String(t.id) === String(taskId));
        if (!task) { showToast('Task not found', 'error', 3000); return; }
        openModal('task', task);
    } catch (err) {
        console.error('Error loading task details:', err);
        showToast(`Error: ${err.message}`, 'error', 5000);
    }
}

// ---------------------------------------------------------------------------
// Card view rendering
// ---------------------------------------------------------------------------

async function toggleView(sectionName, viewType) {
    const tableView = document.getElementById(`${sectionName}-table-view`);
    const cardView  = document.getElementById(`${sectionName}-card-view`);
    const toggle    = document.getElementById(`${sectionName}-view-toggle`);
    if (!toggle || toggle.classList.contains('transitioning')) return;
    toggle.classList.add('transitioning');

    try {
        if (viewType === 'table') {
            if (!cardView.classList.contains('hidden')) await fadeOut(cardView, 200);
            await fadeIn(tableView, 200);
        } else {
            if (!tableView.classList.contains('hidden')) await fadeOut(tableView, 200);
            if (!cardView.children.length) await renderCardsForSection(sectionName);
            await fadeIn(cardView, 200);
        }

        toggle.querySelectorAll('.view-btn').forEach(btn => {
            const active = btn.getAttribute('data-view') === viewType;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active);
        });

        showToast(`Switched to ${viewType} view`, 'info', 1000);
    } finally {
        setTimeout(() => toggle.classList.remove('transitioning'), 300);
    }
}

async function renderCardsForSection(sectionName) {
    const cardView = document.getElementById(`${sectionName}-card-view`);
    const renderers = {
        contexts:     ['/api/contexts',     renderContextCards],
        preferences:  ['/api/preferences',  renderPreferenceCards],
        conventions:  ['/api/conventions',  renderConventionCards],
        interactions: ['/api/interactions', renderInteractionCards],
    };
    const [endpoint, renderFn] = renderers[sectionName] ?? [];
    if (!renderFn) return;

    try {
        const response = await apiFetch(`${API_BASE}${endpoint}?limit=50`);
        const data = await response.json();
        renderFn(data.data || [], cardView);
    } catch (err) {
        console.error(`Error rendering ${sectionName} cards:`, err);
        cardView.innerHTML = '<div class="no-data">Error loading cards</div>';
    }
}

// ---------------------------------------------------------------------------
// Modal (shared detail/edit dialog)
// ---------------------------------------------------------------------------

function openModal(type, data) {
    const overlay = document.getElementById('modal-overlay');
    const title   = document.getElementById('modal-title');
    const body    = document.getElementById('modal-body');
    const action  = document.getElementById('modal-action');

    if (!overlay || !title || !body) return;

    title.textContent = _modalTitle(type, data);
    body.innerHTML    = buildModalContent(type, data);
    if (action) action.classList.add('hidden');

    overlay.classList.remove('hidden');
    lucide.createIcons();

    // Trap focus
    const focusable = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusable[0]?.focus();
}

function _modalTitle(type, data) {
    switch (type) {
        case 'context':     return `Session Context: ${data.session_id || 'N/A'}`;
        case 'preference':  return `User Preference: ${data.preference_key || 'N/A'}`;
        case 'convention':  return `Convention: ${data.convention_type || 'N/A'}`;
        case 'interaction': return `Interaction: ${data.session_id || 'N/A'}`;
        case 'task':        return 'Task Details';
        default:            return 'Details';
    }
}

function closeModal() {
    document.getElementById('modal-overlay')?.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Add Session modal
// ---------------------------------------------------------------------------

function openAddModal() {
    document.getElementById('add-modal-overlay')?.classList.remove('hidden');
}

function closeAddModal() {
    document.getElementById('add-modal-overlay')?.classList.add('hidden');
    document.getElementById('add-session-form')?.reset();
}

async function handleAddSession(event) {
    event.preventDefault();
    const sessionId    = document.getElementById('session-id-input').value.trim();
    const contextType  = document.getElementById('context-type-input').value;
    const contextKey   = document.getElementById('context-key-input').value.trim();
    const contextValue = document.getElementById('context-value-input').value.trim();

    if (!sessionId || !contextType || !contextKey || !contextValue) {
        showToast('All fields are required', 'error');
        return;
    }

    try {
        const response = await apiFetch(`${API_BASE}/api/contexts`, {
            method: 'POST',
            body: JSON.stringify({ session_id: sessionId, context_type: contextType, context_key: contextKey, context_value: contextValue }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        showToast('Session context added successfully!', 'success', 3000);
        closeAddModal();
        await loadContexts();
        await loadStats();
    } catch (err) {
        console.error('Error adding session:', err);
        showToast('Failed to add session context', 'error', 4000);
    }
}

// ---------------------------------------------------------------------------
// Edit Preference modal
// ---------------------------------------------------------------------------

 function openEditPreferenceModal(preferenceData) {
    if (typeof preferenceData === 'string') preferenceData = JSON.parse(preferenceData);
    const modal = document.getElementById('edit-preference-modal');
    if (!modal) return;
    modal._previousFocus = document.activeElement;

    document.getElementById('edit-pref-id').value      = preferenceData.id;
    document.getElementById('edit-pref-user-id').value = preferenceData.user_id || '';

    const catSelect = document.getElementById('edit-pref-category');
    const catValue  = preferenceData.category || '';
    if (catSelect && catValue) {
        if (![...catSelect.options].some(o => o.value === catValue)) {
            const opt = document.createElement('option');
            opt.value = opt.textContent = catValue;
            catSelect.appendChild(opt);
        }
        catSelect.value = catValue;
    }

    document.getElementById('edit-pref-key').value        = preferenceData.preference_key   || '';
    document.getElementById('edit-pref-value').value      = preferenceData.preference_value || '';
    document.getElementById('edit-pref-confidence').value = preferenceData.confidence       ?? 0.8;

    modal.classList.remove('hidden');
    document.getElementById('edit-pref-key')?.focus();
}

function closeEditPreferenceModal() {
    const modal = document.getElementById('edit-preference-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal._previousFocus?.focus();
}

async function handleEditPreference(event) {
    event.preventDefault();
    const id = document.getElementById('edit-pref-id').value;
    const formData = {
        user_id:          document.getElementById('edit-pref-user-id').value.trim(),
        category:         document.getElementById('edit-pref-category').value.trim(),
        preference_key:   document.getElementById('edit-pref-key').value.trim(),
        preference_value: document.getElementById('edit-pref-value').value.trim(),
        confidence:       parseFloat(document.getElementById('edit-pref-confidence').value),
    };

    if (!formData.user_id || !formData.category || !formData.preference_key || !formData.preference_value) {
        showToast('All fields are required', 'error', 3000); return;
    }
    if (formData.confidence < 0 || formData.confidence > 1) {
        showToast('Confidence must be between 0.0 and 1.0', 'error', 3000); return;
    }

    try {
        const response = await apiFetch(`/api/preferences/${id}`, {
            method: 'PUT',
            body: JSON.stringify(formData),
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to update preference');
        }
        showToast('Preference updated successfully!', 'success', 3000);
        closeEditPreferenceModal();
        await loadPreferences();
    } catch (err) {
        console.error('Error updating preference:', err);
        showToast(`Error: ${err.message}`, 'error', 5000);
    }
}

// ---------------------------------------------------------------------------
// Task edit modal (inline in shared modal)
// ---------------------------------------------------------------------------

async function openEditTaskModal(taskId) {
    try {
        const response = await apiFetch('/api/tasks?limit=100');
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to load task');
        const task = (data.data || []).find(t => String(t.id) === String(taskId));
        if (!task) { showToast('Task not found', 'error', 3000); return; }

        const modal = document.getElementById('modal-overlay');
        const title = document.getElementById('modal-title');
        const body  = document.getElementById('modal-body');

        title.textContent = 'Edit Task';
        body.innerHTML = `
            <form id="edit-task-form" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-800 dark:text-gray-300 mb-2">Title</label>
                    <input type="text" id="edit-task-title" value="${escapeHtml(task.title || '')}" required
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700
                               text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"/>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-800 dark:text-gray-300 mb-2">Description</label>
                    <textarea id="edit-task-description" rows="3"
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700
                               text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >${escapeHtml(task.description || '')}</textarea>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-800 dark:text-gray-300 mb-2">State</label>
                    <select id="edit-task-state"
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700
                               text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                        ${['queued','in_progress','done','failed','blocked'].map(s =>
                            `<option value="${s}" ${task.state === s ? 'selected' : ''}>${s.replace('_',' ').replace(/\b\w/g, l => l.toUpperCase())}</option>`
                        ).join('')}
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-800 dark:text-gray-300 mb-2">Priority (1-100)</label>
                    <input type="number" id="edit-task-priority" value="${task.priority || 50}" min="1" max="100"
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700
                               text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"/>
                </div>
                <div class="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <button type="button" onclick="closeModal()"
                        class="px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-300 bg-gray-100 dark:bg-gray-700
                               hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button type="submit"
                        class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
                        Save Changes
                    </button>
                </div>
            </form>`;

        modal.classList.remove('hidden');
        document.getElementById('edit-task-form').addEventListener('submit', async e => {
            e.preventDefault();
            await saveTaskEdit(taskId);
        });
        lucide.createIcons();
    } catch (err) {
        console.error('Error opening edit modal:', err);
        showToast(`Error: ${err.message}`, 'error', 5000);
    }
}

async function saveTaskEdit(taskId) {
    try {
        const response = await apiFetch(`/api/tasks/${taskId}`, {
            method: 'PUT',
            body: JSON.stringify({
                title:       document.getElementById('edit-task-title').value,
                description: document.getElementById('edit-task-description').value,
                state:       document.getElementById('edit-task-state').value,
                priority:    parseInt(document.getElementById('edit-task-priority').value),
            }),
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to update task');
        showToast('Task updated successfully', 'success', 3000);
        closeModal();
        await loadTasks();
    } catch (err) {
        console.error('Error saving task:', err);
        showToast(`Error: ${err.message}`, 'error', 5000);
    }
}

// ---------------------------------------------------------------------------
// Generic delete (unified confirm + API call)
// ---------------------------------------------------------------------------

const DELETE_CONFIG = {
    context: {
        confirmMsg: (id, label) => `Delete this context?\n\nSession ID: ${label}\nContext ID: ${id}\n\nThis cannot be undone.`,
        endpoint:   id => `/api/contexts/${id}`,
        successMsg: 'Context deleted successfully',
        reload:     () => Promise.all([loadContexts(), loadStats()]),
    },
    preference: {
        confirmMsg: (id, label) => `Delete preference "${label}"?\n\nPreference ID: ${id}\n\nThis cannot be undone.`,
        endpoint:   id => `/api/preferences/${id}`,
        successMsg: 'Preference deleted successfully',
        reload:     () => Promise.all([loadPreferences(), loadStats()]),
    },
    convention: {
        confirmMsg: (id, label) => `Delete "${label}" convention?\n\nConvention ID: ${id}\n\nThis cannot be undone.`,
        endpoint:   id => `/api/conventions/${id}`,
        successMsg: 'Convention deleted successfully',
        reload:     () => Promise.all([loadConventions(), loadStats()]),
    },
    interaction: {
        confirmMsg: (id, label) => `Delete this interaction?\n\nSession ID: ${label}\nInteraction ID: ${id}\n\nThis cannot be undone.`,
        endpoint:   id => `/api/interactions/${id}`,
        successMsg: 'Interaction deleted successfully',
        reload:     () => Promise.all([loadInteractions(), loadStats()]),
    },
};

function confirmDelete(type, id, label) {
    const cfg = DELETE_CONFIG[type];
    if (!cfg) return;
    if (!confirm(cfg.confirmMsg(id, label))) return;
    _deleteRecord(type, id);
}

async function _deleteRecord(type, id) {
    const cfg = DELETE_CONFIG[type];
    try {
        const response = await apiFetch(`${API_BASE}${cfg.endpoint(id)}`, { method: 'DELETE' });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || `Failed to delete ${type}`);
        showToast(cfg.successMsg, 'success', 3000);
        await cfg.reload();
    } catch (err) {
        console.error(`Error deleting ${type}:`, err);
        showToast(`Error: ${err.message}`, 'error', 5000);
    }
}

// Keep backward-compatible aliases for any remaining inline onclick references
function confirmDeleteContext(id, label)     { confirmDelete('context',     id, label); }
function confirmDeletePreference(id, label)  { confirmDelete('preference',  id, label); }
function confirmDeleteConvention(id, label)  { confirmDelete('convention',  id, label); }
function confirmDeleteInteraction(id, label) { confirmDelete('interaction', id, label); }

async function confirmDeleteTask(taskId, taskTitle) {
    if (!confirm(`Delete task "${taskTitle}"?\n\nThis cannot be undone.`)) return;
    try {
        const response = await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to delete task');
        showToast('Task deleted successfully', 'success', 3000);
        await loadTasks();
    } catch (err) {
        console.error('Error deleting task:', err);
        showToast(`Error: ${err.message}`, 'error', 5000);
    }
}

// ---------------------------------------------------------------------------
// Theme management
// ---------------------------------------------------------------------------

function initTheme() {
    const saved = localStorage.getItem('theme');
    const theme = saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(theme);
    updateThemeToggleUI(theme);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (!localStorage.getItem('theme')) toggleTheme(e.matches ? 'dark' : 'light');
    });
}

function applyTheme(theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
}

function toggleTheme(theme) {
    applyTheme(theme);
    localStorage.setItem('theme', theme);
    updateThemeToggleUI(theme);
}

function updateThemeToggleUI(activeTheme) {
    document.querySelectorAll('#theme-toggle, [role="group"][aria-label="Theme selection"]').forEach(group => {
        group.querySelectorAll('.theme-btn').forEach(btn => {
            const isActive = btn.getAttribute('data-theme') === activeTheme;
            btn.setAttribute('data-active', String(isActive));
            btn.setAttribute('aria-pressed', String(isActive));
            if (isActive) { btn.classList.add('scale-105'); setTimeout(() => btn.classList.remove('scale-105'), 300); }
        });
    });
}

// ---------------------------------------------------------------------------
// Misc utilities
// ---------------------------------------------------------------------------

function updateTimestamp() {
    const el = document.getElementById('last-update');
    if (el) { el.textContent = new Date().toLocaleString(); el.setAttribute('datetime', new Date().toISOString()); }
}

function debounce(fn, wait) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// ---------------------------------------------------------------------------
// DOMContentLoaded – wiring & init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    console.log('🧠 MCP Dashboard initializing…');

    // Instantiate pagers now that DOM is ready
    pagers.contexts     = new Pagination('contexts',     loadContexts);
    pagers.preferences  = new Pagination('preferences',  loadPreferences);
    pagers.conventions  = new Pagination('conventions',  loadConventions);
    pagers.interactions = new Pagination('interactions', loadInteractions);
    pagers.tasks        = new Pagination('tasks',        loadTasks);

    // Theme
    initTheme();

    // Theme toggle buttons
    document.querySelectorAll('#theme-toggle, [role="group"][aria-label="Theme selection"]').forEach(group => {
        group.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                toggleTheme(btn.getAttribute('data-theme'));
                if (window.navigator?.vibrate) navigator.vibrate(5);
            });
        });
    });

    // Stats chart toggle
    document.querySelector('.chart-toggle')?.querySelectorAll('.chart-btn').forEach(btn => {
        btn.addEventListener('click', () => toggleStatsView(btn.getAttribute('data-chart')));
    });

    // Section view toggles (table / card)
    ['contexts', 'preferences', 'conventions', 'interactions'].forEach(section => {
        document.getElementById(`${section}-view-toggle`)?.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => toggleView(section, btn.getAttribute('data-view')));
        });
    });

    // Modal close
    const bindClose = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
    bindClose('modal-close',  closeModal);
    bindClose('modal-cancel', closeModal);
    document.getElementById('modal-overlay')?.addEventListener('click', e => { if (e.target.id === 'modal-overlay') closeModal(); });

    // Edit preference modal
    bindClose('edit-preference-close',  closeEditPreferenceModal);
    bindClose('edit-preference-cancel', closeEditPreferenceModal);
    document.getElementById('edit-preference-modal')?.addEventListener('click', e => {
        if (e.target.id === 'edit-preference-modal') closeEditPreferenceModal();
    });

    // Add session modal backdrop
    document.getElementById('add-modal-overlay')?.addEventListener('click', e => {
        if (e.target.id === 'add-modal-overlay') closeAddModal();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (!document.getElementById('modal-overlay')?.classList.contains('hidden'))          closeModal();
            else if (!document.getElementById('add-modal-overlay')?.classList.contains('hidden')) closeAddModal();
            else if (!document.getElementById('edit-preference-modal')?.classList.contains('hidden')) closeEditPreferenceModal();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            document.activeElement.closest('.data-section')?.querySelector('.search-input')?.focus();
        }
    });

    // Debounced search inputs
    const debounced = {
        'session-search':     debounce(loadContexts,     300),
        'preference-search':  debounce(loadPreferences,  300),
        'convention-search':  debounce(loadConventions,  300),
        'interaction-search': debounce(loadInteractions, 300),
        'task-search':        debounce(loadTasks,        300),
    };
    Object.entries(debounced).forEach(([id, fn]) => document.getElementById(id)?.addEventListener('input', fn));

    // Task filters
    ['task-state-filter', 'task-workflow-filter', 'task-agent-filter'].forEach(id =>
        document.getElementById(id)?.addEventListener('change', loadTasks));
    document.getElementById('task-refresh')?.addEventListener('click', loadTasks);

    // Initial load sequence
    (async () => {
        try {
            await checkHealth();
            await loadStats();
            await Promise.all([loadContexts(), loadPreferences(), loadConventions(), loadInteractions(), loadTasks(), populateCategoryFilter()]);
            updateTimestamp();
            setTimeout(() => showToast('Dashboard loaded successfully!', 'success', 2000), 1000);
        } catch (err) {
            console.error('Error during initialization:', err);
            showToast('Some data failed to load. Please refresh.', 'warning', 5000);
        }
    })();

    // Auto-refresh every 30 s
    setInterval(async () => {
        try {
            await checkHealth();
            await loadStats();
            const lu = document.getElementById('last-update');
            if (lu) { lu.style.transform = 'scale(1.05)'; setTimeout(() => { lu.style.transform = 'scale(1)'; }, 200); }
        } catch { /* silent */ }
    }, 30000);

    console.log('✅ MCP Dashboard initialized');
});
