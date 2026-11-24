// Read filtering only: never archive/delete stored products or historical leads.
export function isUnavailableOffering(record) {
  return [record?.id, record?.category, record?.name]
    .some((value) => typeof value === 'string' && /\bsaunas?\b/i.test(value));
}

export function isPublicProduct(product) {
  return !!product && product.status !== 'archived' && !isUnavailableOffering(product);
}
