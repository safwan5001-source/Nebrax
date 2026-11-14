/** TANKER-PR6B-5: مسارات مساحة عمل الدمج المخزني لسندات التعبئة (تستعملها القائمة والتفاصيل والتنقل). */
export const FILLS_HREF = '/fuel-stations/tanker-fills';
export const FILLS_PERMISSION = 'fuel.tanker.fill.inventory.view';
export const FILLS_GATE = 'tanker_fills_workspace';
export const fillHref = (id: string) => `${FILLS_HREF}/${id}`;
