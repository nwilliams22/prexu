/**
 * Composite provider that wraps all application context providers.
 * Reduces the nesting pyramid in App.tsx to a single component.
 */

import { useAuth } from "../hooks/useAuth";
import { useInviteState, InviteProvider } from "../hooks/useInvites";
import {
  useContentRequestState,
  ContentRequestProvider,
} from "../hooks/useContentRequests";
import {
  usePreferencesState,
  PreferencesProvider,
} from "../hooks/usePreferences";
import {
  useHomeUsersState,
  HomeUsersProvider,
} from "../hooks/useHomeUsers";
import {
  useServerActivityState,
  ServerActivityProvider,
} from "../hooks/useServerActivity";

interface AppProvidersProps {
  children: React.ReactNode;
}

/**
 * Must be rendered inside `<AuthProvider>` so `useAuth()` is available
 * for hooks that depend on auth state.
 */
export default function AppProviders({ children }: AppProvidersProps) {
  const auth = useAuth();
  const homeUsersState = useHomeUsersState();
  const inviteState = useInviteState(auth.authToken, auth.server?.uri ?? null);
  const contentRequestState = useContentRequestState(
    auth.authToken,
    auth.activeUser,
  );
  const prefsState = usePreferencesState(auth.activeUser?.id ?? null);
  const activityState = useServerActivityState();

  return (
    <HomeUsersProvider value={homeUsersState}>
      <PreferencesProvider value={prefsState}>
        <ServerActivityProvider value={activityState}>
          <InviteProvider value={inviteState}>
            <ContentRequestProvider value={contentRequestState}>
              {children}
            </ContentRequestProvider>
          </InviteProvider>
        </ServerActivityProvider>
      </PreferencesProvider>
    </HomeUsersProvider>
  );
}
