import { Response } from 'express';

interface Client {
  id: string;
  restaurantId: string;
  tableId?: string;
  res: Response;
}

class RealtimeService {
  private clients: Client[] = [];

  public addClient(client: Client) {
    this.clients.push(client);
    client.res.on('close', () => {
      this.removeClient(client.id);
    });
  }

  public removeClient(id: string) {
    this.clients = this.clients.filter((c) => c.id !== id);
  }

  public broadcastToRestaurant(restaurantId: string, event: string, data: any) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.clients
      .filter((c) => c.restaurantId === restaurantId)
      .forEach((c) => {
        try {
          c.res.write(payload);
        } catch (e) {
          this.removeClient(c.id);
        }
      });
  }

  public broadcastToTable(restaurantId: string, tableId: string, event: string, data: any) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.clients
      .filter((c) => c.restaurantId === restaurantId && (!c.tableId || c.tableId === tableId))
      .forEach((c) => {
        try {
          c.res.write(payload);
        } catch (e) {
          this.removeClient(c.id);
        }
      });
  }
}

export const realtimeService = new RealtimeService();
