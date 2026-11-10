// Generic server-paginated data table with loading / empty / error states, sorting and pagination.
import { $, esc, loadingState, emptyState, errorState, num } from '/assets/js/ui.js';

/**
 * @param {HTMLElement} container
 * @param {{
 *   columns: Array<{ key: string, label: string, render?: (row) => string, cls?: string, sortable?: boolean }>,
 *   fetch: (state: {page:number, sort?:string, order?:string}) => Promise<{ items: any[], pagination?: {page,total,total_pages} }>,
 *   onRowClick?: (row) => void, empty?: object, pageSize?: number, rowAttrs?: (row) => string,
 * }} opts
 */
export function dataTable(container, opts) {
  const state = { page: 1, sort: opts.defaultSort, order: opts.defaultOrder || 'desc', rows: [] };
  container.innerHTML = '<div class="table-wrap"></div><div class="pagination hidden"></div>';
  const wrap = $('.table-wrap', container);
  const pager = $('.pagination', container);

  function headHtml() {
    return `<thead><tr>${opts.columns.map((c) => {
      const sortable = c.sortable && opts.sortable !== false;
      const ind = state.sort === c.key ? (state.order === 'asc' ? '▲' : '▼') : '';
      return `<th class="${c.cls || ''} ${sortable ? 'sortable' : ''}" ${sortable ? `data-sort="${c.key}" tabindex="0" aria-sort="${state.sort === c.key ? (state.order === 'asc' ? 'ascending' : 'descending') : 'none'}"` : ''}>${esc(c.label)}${ind ? `<span class="sort-ind">${ind}</span>` : ''}</th>`;
    }).join('')}</tr></thead>`;
  }

  async function load(page = state.page) {
    state.page = page;
    wrap.innerHTML = loadingState();
    pager.classList.add('hidden');
    try {
      const r = await opts.fetch({ page: state.page, sort: state.sort, order: state.order, page_size: opts.pageSize });
      state.rows = r.items;
      if (!r.items.length) {
        wrap.innerHTML = emptyState(opts.empty || { title: 'No records found', text: 'Try changing the filters.' });
        return r;
      }
      wrap.innerHTML = `<table class="table">${headHtml()}<tbody>${r.items.map((row, i) => `<tr data-i="${i}" ${opts.onRowClick ? 'class="clickable"' : ''} ${opts.rowAttrs ? opts.rowAttrs(row) : ''}>${opts.columns.map((c) => `<td class="${c.cls || ''}">${c.render ? c.render(row) : esc(row[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      const p = r.pagination;
      if (p && p.total_pages > 1) {
        pager.classList.remove('hidden');
        const from = (p.page - 1) * p.page_size + 1;
        pager.innerHTML = `<span>Showing ${num(from)}–${num(Math.min(p.total, from + r.items.length - 1))} of ${num(p.total)}</span>
          <div class="pages"><button class="btn btn-outline btn-sm" data-page="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''}>Previous</button>
          <span class="btn btn-ghost btn-sm" aria-current="page">Page ${p.page} of ${p.total_pages}</span>
          <button class="btn btn-outline btn-sm" data-page="${p.page + 1}" ${p.page >= p.total_pages ? 'disabled' : ''}>Next</button></div>`;
      } else if (p) {
        pager.classList.remove('hidden');
        pager.innerHTML = `<span>${num(p.total)} record${p.total === 1 ? '' : 's'}</span>`;
      }
      return r;
    } catch (err) {
      wrap.innerHTML = errorState(err);
      wrap.querySelector('[data-retry]')?.addEventListener('click', () => load());
      return null;
    }
  }

  container.addEventListener('click', (e) => {
    const pb = e.target.closest('[data-page]');
    if (pb && !pb.disabled) { load(Number(pb.dataset.page)); container.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const th = e.target.closest('th[data-sort]');
    if (th) {
      state.order = state.sort === th.dataset.sort && state.order === 'desc' ? 'asc' : 'desc';
      state.sort = th.dataset.sort;
      load(1);
      return;
    }
    if (e.target.closest('a, button, input, select, label')) return;
    const tr = e.target.closest('tbody tr[data-i]');
    if (tr && opts.onRowClick) opts.onRowClick(state.rows[Number(tr.dataset.i)]);
  });
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('th[data-sort]')) e.target.click();
  });

  return { reload: (page) => load(page ?? state.page), reset: () => load(1), state };
}
