import { accounts, api } from './api.js';
for (const account of accounts) {
  try { await api('/auth/register', { method: 'POST', body: JSON.stringify(account) }); }
  catch (error) { if (!(error instanceof Error) || !error.message.startsWith('409 ')) throw error; }
  console.log(`Seed: ${account.email}`);
}
console.log('Driver profile/location do TV3 khoi tao qua API; script khong truy cap DB cua service khac.');
