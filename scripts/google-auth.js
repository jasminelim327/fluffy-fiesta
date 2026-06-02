const fs = require('fs');
const path = require('path');
const GoogleCalendarSync = require('../google-calendar');

const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH
  ? path.resolve(process.cwd(), process.env.GOOGLE_CREDENTIALS_PATH)
  : path.resolve(__dirname, '../credentials.json');

const tokenPath = process.env.GOOGLE_TOKEN_PATH
  ? path.resolve(process.cwd(), process.env.GOOGLE_TOKEN_PATH)
  : path.resolve(__dirname, '../google-token.json');

if (!fs.existsSync(credentialsPath)) {
  console.error(`❌ Could not find credentials file at ${credentialsPath}`);
  console.error('Create OAuth credentials in Google Cloud Console and save the JSON as credentials.json.');
  process.exit(1);
}

const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
const google = new GoogleCalendarSync({ credentials, tokenPath });

async function run() {
  const codeArgIndex = process.argv.indexOf('--code');
  if (codeArgIndex >= 0) {
    const code = process.argv[codeArgIndex + 1];
    if (!code) {
      console.error('❌ Missing authorization code after --code');
      process.exit(1);
    }

    const initialized = await google.initialize();
    if (!initialized) {
      console.warn('Proceeding with auth flow even though no token was found.');
    }

    const success = await google.setAuthCode(code.trim());
    if (success) {
      console.log('✅ Google Calendar OAuth setup complete.');
    } else {
      process.exit(1);
    }
    return;
  }

  const initialized = await google.initialize();
  if (!initialized) {
    console.log('⚠️ No existing token found. Generating a new authorization URL.');
  }

  const authUrl = google.generateAuthUrl();
  if (!authUrl) {
    console.error('❌ Failed to generate authorization URL. Make sure credentials.json is valid.');
    process.exit(1);
  }

  console.log('\n1. Visit this URL and authorize your Google account:\n');
  console.log(authUrl);
  console.log('\n2. Copy the code from the redirect URL.');
  console.log('3. Run: npm run google-auth -- --code YOUR_CODE\n');
}

run().catch((err) => {
  console.error('Unexpected error:', err.message || err);
  process.exit(1);
});
