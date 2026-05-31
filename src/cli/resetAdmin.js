// Reset the admin credentials. Usage:
//   node src/cli/resetAdmin.js [username] [password]
// If omitted, a random username/password is generated and printed.

import crypto from 'node:crypto';
import { getDb } from '../lib/db.js';
import { setAdminCredentials } from '../services/admin.js';

function strongPassword(len = 18) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#%+=?';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

getDb();

const user = process.argv[2] || 'admin_' + crypto.randomBytes(3).toString('hex');
const pass = process.argv[3] || strongPassword(18);

setAdminCredentials(user, pass);

// eslint-disable-next-line no-console
console.log(
  [
    '',
    '  Admin credentials updated:',
    `    username : ${user}`,
    `    password : ${pass}`,
    '',
  ].join('\n')
);
