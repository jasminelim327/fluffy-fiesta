const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const readline = require('readline');

const tokenPath = path.resolve(__dirname, '../google-token-desktop.json');

async function run() {
  console.log('🔐 Desktop Google OAuth Setup\n');
  console.log('This helper uses a simpler auth flow that does NOT require a deployed web server.\n');

  // Create readline interface for user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const askQuestion = (query) =>
    new Promise((resolve) => rl.question(query, resolve));

  // Ask user for client_id and client_secret
  const clientId = await askQuestion(
    'Enter your Google Desktop OAuth Client ID:\n> '
  );
  const clientSecret = await askQuestion(
    'Enter your Google Desktop OAuth Client Secret:\n> '
  );

  if (!clientId || !clientSecret) {
    console.error('❌ Client ID and secret are required.');
    rl.close();
    process.exit(1);
  }

  // Create OAuth2 client with localhost redirect_uri (default for Desktop)
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'urn:ietf:wg:oauth:2.0:oob' // Out-of-band flow for desktop apps
  );

  // Generate auth URL
  const scopes = ['https://www.googleapis.com/auth/calendar'];
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent' // Force consent to ensure refresh_token
  });

  console.log('\n✅ Visit this URL to authorize:\n');
  console.log(authUrl);
  console.log('\n');

  // Ask for authorization code
  const code = await askQuestion(
    'Paste the authorization code from the redirect URL:\n> '
  );

  if (!code) {
    console.error('❌ Authorization code is required.');
    rl.close();
    process.exit(1);
  }

  // Exchange code for tokens
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log('\n✅ Successfully exchanged code for token!');
    console.log('\nToken details:');
    console.log(`  - access_token: ${tokens.access_token.slice(0, 20)}...`);
    console.log(
      `  - refresh_token: ${
        tokens.refresh_token
          ? tokens.refresh_token.slice(0, 20) + '...'
          : '❌ MISSING (auth failed)'
      }`
    );
    console.log(`  - expiry_date: ${tokens.expiry_date}`);

    if (!tokens.refresh_token) {
      console.error(
        '\n⚠️ WARNING: No refresh_token received. Make sure you:'
      );
      console.error('  1. Clicked "Allow" on the consent screen');
      console.error('  2. The authorization URL includes prompt=consent');
      console.error('  3. Your OAuth app has "Desktop application" type');
    }

    // Save token
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
    console.log(`\n✅ Token saved to ${tokenPath}`);
    console.log('\nCopy the entire token JSON into your Render GOOGLE_TOKEN_JSON secret:');
    console.log(JSON.stringify(tokens, null, 2));
  } catch (error) {
    console.error('❌ Failed to exchange code:', error.message);
    rl.close();
    process.exit(1);
  }

  rl.close();
}

run();
