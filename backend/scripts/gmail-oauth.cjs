// One-time Gmail API OAuth flow — prints a refresh token for Railway envs.
// Usage:  node scripts/gmail-oauth.cjs <CLIENT_ID> <CLIENT_SECRET>
// Steps:  1) console.cloud.google.com -> create project -> enable Gmail API
//         2) OAuth consent screen (External) -> add your Gmail as a test user
//         3) Credentials -> OAuth client ID -> Application type: Desktop app
//         4) run this script with those two values, approve in the browser
const http = require('http')
const { spawn } = require('child_process')

const clientId = process.argv[2] || process.env.GMAIL_CLIENT_ID
const clientSecret = process.argv[3] || process.env.GMAIL_CLIENT_SECRET

if (!clientId || !clientSecret || !clientId.includes('apps.googleusercontent.com')) {
  console.error('Usage: node scripts/gmail-oauth.cjs <CLIENT_ID> <CLIENT_SECRET>')
  process.exit(1)
}

const port = 45678
const redirect = `http://localhost:${port}`
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent',
  })

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore' }).unref()
    }
  } catch {
    console.log(`\nIf the browser did not open, paste this URL:\n${authUrl}\n`)
  }
}

async function exchange(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(body))
  return body
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, redirect)
  if (u.pathname !== '/' || !u.search) {
    res.writeHead(200)
    res.end('ok')
    return
  }
  const error = u.searchParams.get('error')
  if (error) {
    res.end(`<h3>Authorization failed: ${error}</h3><p>Close this tab and try again.</p>`)
    console.error('Authorization error:', error)
    server.close()
    process.exit(1)
  }
  const code = u.searchParams.get('code')
  if (!code) {
    res.writeHead(200)
    res.end('No code received')
    return
  }
  try {
    const t = await exchange(code)
    res.end('<h3>Success — you can close this tab.</h3>')
    console.log('\n==================== RESULT ====================')
    console.log('ACCESS TOKEN (short-lived, only for testing):')
    console.log(t.access_token)
    console.log('\nREFRESH TOKEN  ->  Railway env GMAIL_REFRESH_TOKEN:')
    console.log(t.refresh_token)
    console.log('\nSet these 4 env vars on Railway service "kluciie":')
    console.log(`GMAIL_CLIENT_ID      = ${clientId}`)
    console.log(`GMAIL_CLIENT_SECRET  = ${clientSecret}`)
    console.log(`GMAIL_REFRESH_TOKEN  = ${t.refresh_token}`)
    console.log('GMAIL_SENDER          = the Gmail account you just approved with')
    console.log('=================================================');
  } catch (e) {
    res.end('Token exchange failed: ' + e.message)
    console.error('Token exchange failed:', e.message)
  }
  server.close()
})

server.listen(port, () => {
  console.log('Listening on http://localhost:' + port)
  console.log('Opening the Google consent screen...')
  openBrowser(authUrl)
  console.log('\nSign in with the Gmail account you want to send FROM, then approve.')
})