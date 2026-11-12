import { api, base } from './demo/api.js';

interface SimulatedDriver {
  email: string;
  name: string;
  token?: string;
  id?: string;
  lat: number;
  lng: number;
  interval?: NodeJS.Timeout;
}

export class DriverSimulator {
  private drivers: SimulatedDriver[] = [];
  private running = false;

  constructor(count = 5, private apiUrl = base) {
    const centerLat = 10.7769;
    const centerLng = 106.7009;

    for (let i = 1; i <= count; i++) {
      this.drivers.push({
        email: `driver_sim_${i}@demo.local`,
        name: `Simulated Driver ${i}`,
        lat: centerLat + (Math.random() - 0.5) * 0.05,
        lng: centerLng + (Math.random() - 0.5) * 0.05
      });
    }
  }

  async start() {
    this.running = true;
    console.log(`Starting simulator with ${this.drivers.length} drivers...`);

    for (const driver of this.drivers) {
      // 1. Register / login
      try {
        await api('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email: driver.email,
            name: driver.name,
            password: 'DemoPass123!',
            role: 'DRIVER'
          })
        });
      } catch {}

      try {
        const loginRes = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: driver.email,
            password: 'DemoPass123!'
          })
        });
        driver.token = loginRes.accessToken;
        driver.id = loginRes.user.userId;
      } catch (err: any) {
        console.warn(`Failed to login ${driver.email}:`, err.message);
        continue;
      }

      // 2. Set AVAILABLE & initial location
      try {
        await api('/drivers/me/location', {
          method: 'PUT',
          body: JSON.stringify({ lat: driver.lat, lng: driver.lng })
        }, driver.token);

        await api('/drivers/me/status', {
          method: 'PUT',
          body: JSON.stringify({ status: 'AVAILABLE' })
        }, driver.token);

        console.log(`Driver ${driver.name} is now AVAILABLE at (${driver.lat.toFixed(4)}, ${driver.lng.toFixed(4)})`);
      } catch (err: any) {
        console.warn(`Failed to set status for ${driver.email}:`, err.message);
      }

      // 3. Heartbeat loop (every 5s)
      driver.interval = setInterval(async () => {
        if (!this.running || !driver.token) return;
        try {
          // slight random jitter
          driver.lat += (Math.random() - 0.5) * 0.001;
          driver.lng += (Math.random() - 0.5) * 0.001;
          await api('/drivers/me/location', {
            method: 'PUT',
            body: JSON.stringify({ lat: driver.lat, lng: driver.lng })
          }, driver.token);
        } catch {}
      }, 5000);
    }
  }

  stop() {
    this.running = false;
    for (const driver of this.drivers) {
      if (driver.interval) clearInterval(driver.interval);
    }
    console.log('Driver simulator stopped.');
  }
}

// Allow direct CLI execution
if (process.argv[1]?.endsWith('simulator.ts') || process.argv[1]?.endsWith('simulator.js')) {
  const count = Number(process.argv[2] ?? 5);
  const sim = new DriverSimulator(count);
  void sim.start();

  process.on('SIGINT', () => {
    sim.stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    sim.stop();
    process.exit(0);
  });
}

