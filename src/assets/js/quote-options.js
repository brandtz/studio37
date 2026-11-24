/* Shared quote options for the intake form, lead notifications, and admin. */
(() => {
  const serviceGroups = [
    { label: 'Live Edge', options: [
      ['live-edge-dining-table', 'Live Edge Dining Table'],
      ['live-edge-bench', 'Live Edge Bench'],
      ['live-edge-coffee-side-table', 'Live Edge Coffee or Side Table'],
      ['live-edge-desk', 'Live Edge Desk'],
      ['live-edge-conference-table', 'Live Edge Conference Table'],
      ['live-edge-reception-desk', 'Live Edge Reception Desk'],
      ['live-edge-hanging-door', 'Live Edge Hanging Door'],
      ['live-edge-custom-piece', 'Live Edge Custom Piece'],
      ['live-edge-art', 'Live Edge Art'],
      ['live-edge-frames', 'Live Edge Frames'],
      ['live-edge-center-piece', 'Live Edge Center Piece'],
    ] },
    { label: 'Custom Orders', options: [
      ['hardwood-flattening', 'Custom Orders: Timber - Hardwood Flattening'],
      ['countertop-or-bar', 'Custom Orders: Countertop or Bar'],
      ['shelves-built-ins', 'Custom Orders: Shelves & Built-ins'],
    ] },
    { label: 'Custom Handcrafted Home Goods & Gifts', homeGoods: true, options: [
      ['cutting-board', 'Cutting Board'],
      ['charcuterie-board', 'Charcuterie Board'],
      ['coasters', 'Coasters'],
      ['flight-boards', 'Restaurant or Bar Flight Boards'],
      ['chess-board', 'Chess Board'],
      ['wooden-bowl', 'Wooden Bowl'],
      ['essential-oil-holder', 'Essential Oil Holder'],
      ['clip-boards', 'Clip Boards'],
      ['custom-signs', 'Custom Signs'],
      ['custom-garden-arch', 'Custom Garden Arch'],
    ] },
  ];
  const customerTypes = {
    'new-private': 'New Customer: Private Party for Personal Residence',
    'new-commercial': 'New Customer: Commercial Business or Organization',
    'repeat-private': 'Established Repeat Customer: Private Party - Personal Residence',
    'repeat-commercial': 'Established Repeat Customer: Commercial Business or Organization',
    other: 'Other',
  };
  const serviceLabels = {
    cabinetry: 'Custom Cabinetry',
    slab: 'Slab Flattening',
    'cnc-laser': 'CNC & Laser Engraving',
    furniture: 'Custom Furniture',
    'small-goods': 'Small Goods / Gifts',
    gc: 'GC Work',
    saunas: 'Saunas',
    'outdoor-sauna': 'Outdoor Sauna',
    other: 'Other',
  };
  serviceGroups.forEach((group) => group.options.forEach(([value, label]) => {
    serviceLabels[value] = label;
  }));
  const homeGoods = serviceGroups.find((group) => group.homeGoods).options.map(([value]) => value);
  const options = { serviceGroups, customerTypes, serviceLabels, homeGoods };
  if (typeof module !== 'undefined' && module.exports) module.exports = options;
  else window.Studio37QuoteOptions = options;
})();
