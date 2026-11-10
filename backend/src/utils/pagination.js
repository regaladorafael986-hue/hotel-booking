function getPagination(query, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(query.page_size || query.pageSize, 10) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
const paged = (items, total, { page, pageSize }) => ({
  items,
  pagination: { page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) },
});
module.exports = { getPagination, paged };
