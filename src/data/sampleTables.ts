import { RestaurantTable, TableZone } from '../types/restaurant';

export function generate50Tables(restaurantId: string = 'rest-merar'): RestaurantTable[] {
  const tables: RestaurantTable[] = [];

  for (let i = 1; i <= 50; i++) {
    const tableNumStr = i < 10 ? `0${i}` : `${i}`;
    const id = `TABLE-${tableNumStr}`;
    
    let zone: TableZone = 'MAIN_HALL';
    let capacity = 4;

    if (i <= 20) {
      zone = 'MAIN_HALL';
      capacity = i % 3 === 0 ? 6 : (i % 2 === 0 ? 4 : 2);
    } else if (i <= 32) {
      zone = 'TERRACE';
      capacity = i % 2 === 0 ? 4 : 2;
    } else if (i <= 42) {
      zone = 'VIP_LOUNGE';
      capacity = 8;
    } else {
      zone = 'GARDEN';
      capacity = i % 2 === 0 ? 4 : 6;
    }

    let status: RestaurantTable['status'] = 'AVAILABLE';
    const activeOrderIds: string[] = [];
    let hasWaiterCall = false;

    if (i === 12) {
      status = 'OCCUPIED';
      activeOrderIds.push('#1024', '#1025');
    } else if (i === 8) {
      status = 'OCCUPIED';
      activeOrderIds.push('#1026');
    } else if (i === 21) {
      status = 'OCCUPIED';
      hasWaiterCall = true;
    } else if (i === 5) {
      status = 'OCCUPIED';
      activeOrderIds.push('#1022');
    } else if (i === 34) {
      status = 'OCCUPIED';
      activeOrderIds.push('#1020', '#1021');
    }

    tables.push({
      id,
      restaurantId,
      qrToken: `${restaurantId.toLowerCase()}-qr-${tableNumStr}-demo-token`,
      tableNumber: i,
      capacity,
      zone,
      status,
      activeOrderIds,
      hasWaiterCall,
      lastActivityAt: activeOrderIds.length > 0 ? new Date(Date.now() - (i * 120000)).toISOString() : undefined,
    });
  }

  return tables;
}

export const INITIAL_TABLES: RestaurantTable[] = generate50Tables('rest-merar');
