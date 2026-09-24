// Generates a bcrypt hash for the admin password, to put in ADMIN_PASSWORD_HASH.
// Usage: npm run hash-password -- 'your-password-here'
import bcrypt from 'bcryptjs';

const pw = process.argv[2];
if (!pw) {
  console.error("Usage: npm run hash-password -- 'your-password'");
  process.exit(1);
}
const hash = bcrypt.hashSync(pw, 10);
console.log('\nADMIN_PASSWORD_HASH=' + hash + '\n');
console.log('Put that line in your .env / Vercel env vars, and remove ADMIN_PASSWORD.\n');
