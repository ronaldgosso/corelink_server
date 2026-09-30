# Prompt: Integrate CoreLink LinkedIn OAuth in a Web Frontend

You are integrating a React web frontend with the CoreLink backend's LinkedIn OAuth authentication.

## Backend OAuth Contract

The backend exposes these routes:

- `POST /api/auth/linkedin`
  - Web frontend flow.
  - Accepts `{ code, redirectUri }` in JSON.
  - Exchanges the temporary LinkedIn authorization code server-side.
  - Returns a CoreLink JWT and the authenticated profile.

- `GET /api/auth/linkedin/callback`
  - Mobile flow only.
  - Returns HTML and redirects to the `corelink://auth` deep link.
  - Do not use this route as the React web callback.

The frontend must call CoreLink only. It must not call LinkedIn's token endpoint, Supabase directly, or any other private backend service.

## Required OAuth Flow

Implement the following flow:

1. The user clicks a "Sign in with LinkedIn" button.
2. The frontend redirects the user to LinkedIn's authorization URL.
3. LinkedIn redirects the browser to a frontend route such as `/auth/callback` with a temporary `code` query parameter.
4. The frontend reads the code.
5. The frontend sends the code to `POST /api/auth/linkedin`.
6. The backend exchanges the code with LinkedIn and returns a CoreLink JWT.
7. Store the CoreLink JWT and use it as `Authorization: Bearer <token>` for protected API requests.
8. Request `/api/auth/me` to hydrate the authenticated user.

## Redirect URI Requirement

Use the exact same redirect URI in all three places:

- LinkedIn Developer Portal
- The LinkedIn authorization URL
- The `redirectUri` field sent to CoreLink

For a Vite frontend, configure:

```env
VITE_API_URL=https://corelink-server.vercel.app/api
VITE_LINKEDIN_CLIENT_ID=your_linkedin_client_id
```

For local development, the API URL may be:

```env
VITE_API_URL=http://localhost:5000/api
```

The redirect URI can be constructed as:

```js
const redirectUri = `${window.location.origin}/auth/callback`;
```

Never expose `LINKEDIN_CLIENT_SECRET` in frontend code.

## Start Login

Implement a function like this:

```js
export function signInWithLinkedIn() {
  const redirectUri = `${window.location.origin}/auth/callback`;
  const clientId = import.meta.env.VITE_LINKEDIN_CLIENT_ID;
  const scope = "openid profile email w_member_social";

  const authorizationUrl = new URL(
    "https://www.linkedin.com/oauth/v2/authorization",
  );

  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
  }).toString();

  window.location.assign(authorizationUrl.toString());
}
```

## Handle `/auth/callback`

On the React route that renders at `/auth/callback`, read the authorization code and exchange it with CoreLink:

```js
export async function completeLinkedInLogin() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const oauthError = params.get("error");

  if (oauthError) {
    throw new Error(
      params.get("error_description") ||
        `LinkedIn authorization failed: ${oauthError}`,
    );
  }

  if (!code) {
    throw new Error("LinkedIn authorization code was not provided");
  }

  const redirectUri = `${window.location.origin}/auth/callback`;
  const apiUrl = import.meta.env.VITE_API_URL;

  const response = await fetch(`${apiUrl}/auth/linkedin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
      redirectUri,
    }),
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error || result.message || "LinkedIn login failed");
  }

  localStorage.setItem("corelink_token", result.token);

  return result.profile || result.user;
}
```

## Protected API Requests

Use the returned CoreLink JWT, not a Supabase token:

```js
export async function getCurrentUser() {
  const token = localStorage.getItem("corelink_token");
  const apiUrl = import.meta.env.VITE_API_URL;

  if (!token) {
    throw new Error("User is not authenticated");
  }

  const response = await fetch(`${apiUrl}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error || result.message || "Failed to load user");
  }

  return result.profile || result.user;
}
```

## API Helper

Create a shared request helper so protected requests consistently include the bearer token:

```js
export async function apiFetch(path, options = {}) {
  const apiUrl = import.meta.env.VITE_API_URL;
  const token = localStorage.getItem("corelink_token");

  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers,
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      body?.error ||
        body?.message ||
        `Request failed with status ${response.status}`,
    );
  }

  return body;
}
```

## Important Rules

- The callback URL only delivers the temporary authorization code; it does not finish the web login by itself.
- The React frontend must call `POST /api/auth/linkedin` after receiving the code.
- The `redirectUri` must match exactly during authorization and code exchange.
- Do not send the LinkedIn client secret to the browser.
- Do not call LinkedIn's `/oauth/v2/accessToken` endpoint from the frontend.
- Do not use `GET /api/auth/linkedin/callback` for the React web flow.
- Do not use a Supabase access token as the CoreLink token.
- Authorization codes are temporary and generally single-use.
- Ensure the frontend origin is allowed by the backend's `CORS_ORIGIN` configuration.

## Expected Result

Produce a complete React implementation with:

1. A LinkedIn sign-in button.
2. A `/auth/callback` route.
3. Loading and error states during code exchange.
4. CoreLink JWT storage.
5. A protected `/auth/me` request after successful login.
6. Redirect behavior for authenticated and unauthenticated users.
7. No LinkedIn client secret in frontend code.
