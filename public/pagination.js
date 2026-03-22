/**
 * pagination.js
 * Generic Pagination class for the Session Memory MCP Dashboard.
 *
 * Replaces the 5× duplicated pagination state objects + goToXPage() /
 * changeXPageSize() / updateXPaginationUI() function groups with a single
 * reusable abstraction that is wired to DOM element IDs via a naming
 * convention: `{prefix}-first-page`, `{prefix}-prev-page`, etc.
 *
 * Usage:
 *   const ctxPager = new Pagination('contexts', loadContexts);
 *   ctxPager.update({ total: 120, hasMore: true });  // from API response
 *   ctxPager.goTo('next');
 *   ctxPager.changeSize('25');
 */
class Pagination {
    /**
     * @param {string}   prefix    - ID prefix used in the HTML (e.g. 'contexts')
     * @param {Function} loadFn    - Callback to re-load data when page changes
     * @param {number}   [pageSize=50]
     */
    constructor(prefix, loadFn, pageSize = 50) {
        this.prefix      = prefix;
        this.loadFn      = loadFn;
        this.currentPage = 0;
        this.pageSize    = pageSize;
        this.total       = 0;
        this._bindButtons();
    }

    /** Bind the four nav buttons declaratively */
    _bindButtons() {
        const bind = (id, action) => {
            const el = document.getElementById(`${this.prefix}-${id}`);
            if (el) el.addEventListener('click', () => this.goTo(action));
        };
        bind('first-page', 0);
        bind('prev-page',  'prev');
        bind('next-page',  'next');
        bind('last-page',  'last');

        const sizeEl = document.getElementById(`${this.prefix}-page-size`);
        if (sizeEl) sizeEl.addEventListener('change', e => this.changeSize(e.target.value));
    }

    /** Offset for the current page – pass to API calls */
    get offset() {
        return this.currentPage * this.pageSize;
    }

    /**
     * Update state from an API pagination object and refresh the UI.
     * @param {{ total: number, hasMore: boolean }} pagination
     */
    update(pagination) {
        if (!pagination) return;
        this.total = pagination.total ?? 0;
        this._renderUI(pagination.hasMore ?? false);
    }

    /**
     * Navigate to a page.
     * @param {number|'prev'|'next'|'last'|'first'} action
     */
    goTo(action) {
        const totalPages = Math.ceil(this.total / this.pageSize);
        switch (action) {
            case 0:
            case 'first':
                this.currentPage = 0; break;
            case 'prev':
                if (this.currentPage > 0) this.currentPage--; break;
            case 'next':
                if (this.currentPage < totalPages - 1) this.currentPage++; break;
            case 'last':
                this.currentPage = Math.max(0, totalPages - 1); break;
            default:
                if (typeof action === 'number' && action >= 0 && action < totalPages) {
                    this.currentPage = action;
                }
        }
        this.loadFn();
    }

    /**
     * Change page size and reset to first page.
     * @param {string|number} newSize
     */
    changeSize(newSize) {
        const size = parseInt(newSize);
        if (size > 0) {
            this.pageSize    = size;
            this.currentPage = 0;
            this.loadFn();
        }
    }

    /** Refresh the pagination DOM for this section */
    _renderUI(hasMore) {
        const p           = this.prefix;
        const totalPages  = Math.ceil(this.total / this.pageSize);
        const current     = this.currentPage;
        const start       = this.total === 0 ? 0 : current * this.pageSize + 1;
        const end         = Math.min((current + 1) * this.pageSize, this.total);
        const isFirst     = current === 0;
        const isLast      = !hasMore;

        // Showing X–Y of Z label variants
        _setPaginationText(p, 'showing-start',   String(start));
        _setPaginationText(p, 'showing-end',      String(end));
        _setPaginationText(p, 'total',            String(this.total));
        _setPaginationText(p, 'current-page',     `Page ${current + 1} of ${Math.max(1, totalPages)}`);

        // Simpler single-element variants (interactions section uses page-info)
        const pageInfo = document.getElementById(`${p}-page-info`);
        if (pageInfo) pageInfo.textContent = `Showing ${start} to ${end} of ${this.total}`;
        const curPage = document.getElementById(`${p}-current-page`);
        if (curPage) curPage.textContent = `Page ${current + 1} of ${Math.max(1, totalPages)}`;

        _setDisabled(p, 'first-page', isFirst);
        _setDisabled(p, 'prev-page',  isFirst);
        _setDisabled(p, 'next-page',  isLast);
        _setDisabled(p, 'last-page',  isLast);
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _setPaginationText(prefix, suffix, text) {
    const el = document.getElementById(`${prefix}-${suffix}`);
    if (el) el.textContent = text;
}

function _setDisabled(prefix, suffix, disabled) {
    const el = document.getElementById(`${prefix}-${suffix}`);
    if (el) el.disabled = disabled;
}
