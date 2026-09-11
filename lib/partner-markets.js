(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PartnerMarkets = factory();
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  // Partner Center public region enum and frontend/backend routing, inspected 2026-09-09:
  // https://lf16-oversea.goofy-cdn.com/obj/goofy-sg/gftar/i18n/ecom_alliance/partner_cmp/1.0.0.8953/index.js
  // Only markets with an explicit marketplace domain mapping; a code is NOT account permission.
  const codes = Object.freeze({GB:3,ID:4,TH:5,MY:6,VN:7,IT:8,PH:10,SG:13,ES:14,IE:15,BR:16,FR:17,DE:18,MX:19,JP:20,PL:21,BE:22,NL:23,AT:24,CZ:25,GR:26,PT:27,HU:28,US:100});
  const european = new Set(['GB','ES','IE','IT','FR','DE','PL','BE','NL','AT','CZ','GR','PT','HU']);
  function backend(region) {
    if (!Object.hasOwn(codes,region)) throw new Error('未适配的团长目标市场');
    return region === 'US' ? 'https://partner.us.tiktokshop.com' : european.has(region) ? 'https://partner.eu.tiktokshop.com' : 'https://api-partner-sg.tiktokshop.com';
  }
  return {codes,backend};
});
