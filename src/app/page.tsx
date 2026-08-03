"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { useCallback, useState } from "react";
import { ExportPanel, type ApiCall } from "@/src/components/ExportPanel";
import { AUTH_DISABLED } from "./providers";

// Two modes:
//  - NEXT_PUBLIC_DISABLE_AUTH=true  → no login, API routes called unauthenticated
//    (pair with DISABLE_AUTH=true on the server; local/internal use only)
//  - otherwise                      → Sitecore Cloud SSO, user token sent to the
//    API routes and verified there

function Header() {
  return (
    <>
      <h1>Sitecore Content Export</h1>
      <p className="hint">
        Browse the XM Cloud content tree, pick the pages you need, and download
        their fields and component data as structured XML.
      </p>
    </>
  );
}

function UnauthenticatedApp() {
  const callApi = useCallback<ApiCall>(
    (path, init = {}) =>
      fetch(path, {
        ...init,
        headers: {
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      }),
    [],
  );

  return (
    <main>
      <Header />
      <p className="hint">
        Authentication is disabled (<code>DISABLE_AUTH=true</code>). Do not run
        this way in production.
      </p>
      <ExportPanel callApi={callApi} />
    </main>
  );
}

function AuthenticatedApp() {
  const {
    isLoading,
    isAuthenticated,
    loginWithPopup,
    getAccessTokenSilently,
    error: authError,
  } = useAuth0();
  const [tokenInvalid, setTokenInvalid] = useState(false);

  const callApi = useCallback<ApiCall>(
    async (path, init = {}) => {
      let token: string;
      try {
        token = await getAccessTokenSilently();
      } catch {
        // The session is gone (refresh expired or revoked) — send the user back
        // to the sign-in screen rather than failing every request silently.
        setTokenInvalid(true);
        throw new Error("Your Sitecore session has expired — sign in again.");
      }
      const response = await fetch(path, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
      if (response.status === 401 || response.status === 403) {
        setTokenInvalid(true);
      }
      return response;
    },
    [getAccessTokenSilently],
  );

  if (isLoading) {
    return <main>Checking your Sitecore session…</main>;
  }

  if (!isAuthenticated || tokenInvalid) {
    return (
      <main>
        <Header />
        <div className="panel">
          <p className="hint">
            Sign in with your Sitecore account to continue — access is limited to
            Organization Admins and Owners.
          </p>
          {tokenInvalid && isAuthenticated && (
            <p className="error">
              Your Sitecore session has expired or is no longer valid. Please
              sign in again.
            </p>
          )}
          {authError && <p className="error">{authError.message}</p>}
          <button
            type="button"
            onClick={() => {
              setTokenInvalid(false);
              void loginWithPopup();
            }}
          >
            Sign in with Sitecore
          </button>
        </div>
      </main>
    );
  }

  return (
    <main>
      <Header />
      <ExportPanel callApi={callApi} />
    </main>
  );
}

export default function Home() {
  return AUTH_DISABLED ? <UnauthenticatedApp /> : <AuthenticatedApp />;
}
