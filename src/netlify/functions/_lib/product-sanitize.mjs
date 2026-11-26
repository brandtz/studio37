// Normalizes a product record to the fields the storefront stores. Shared by
// admin product CRUD and the Back Office catalog import.
export function sanitizeProduct(p) {
  const allowed = [
    'id', 'name', 'subtitle', 'price', 'description', 'category',
    'images', 'status', 'by_request', 'shipping', 'weight_oz',
    'sku', 'dimensions', 'materials', 'lead_time_days',
    'created_at', 'updated_at',
  ];
  const out = {};
  for (const k of allowed) if (k in p) out[k] = p[k];
  // Coerce types defensively
  if (typeof out.price === 'string') out.price = parseInt(out.price, 10) || null;
  if (typeof out.weight_oz === 'string') out.weight_oz = parseInt(out.weight_oz, 10) || 0;
  if (typeof out.lead_time_days === 'string') out.lead_time_days = parseInt(out.lead_time_days, 10) || null;
  if (typeof out.sku === 'string') out.sku = out.sku.trim().slice(0, 40);
  if (typeof out.dimensions === 'string') out.dimensions = out.dimensions.trim().slice(0, 120);
  if (typeof out.materials === 'string') out.materials = out.materials.trim().slice(0, 240);
  // Image URL validation: only http(s), cap at 8, sane length.
  out.images = Array.isArray(out.images)
    ? out.images
        .filter((u) => typeof u === 'string' && u.length <= 1000 && /^https?:\/\//i.test(u))
        .slice(0, 8)
    : [];
  out.status = ['available', 'out_of_stock', 'by_request', 'archived'].includes(out.status)
    ? out.status
    : 'available';
  return out;
}
