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
  ScanningStoreProvider,
  CompletionCounterStoreProvider,
} from "../hooks/useServerActivity";
import { QueueProvider } from "./QueueContext";
import { PlayerProvider } from "./PlayerContext";
import {
  useDownloadsState,
  DownloadsProvider,
} from "../hooks/useDownloads";
import { useToastState, ToastProvider } from "../hooks/useToast";
import ToastContainer from "../components/Toast";
import {
  useParentalControlsState,
  ParentalControlsProvider,
} from "../hooks/useParentalControls";

interface AppProvidersProps {
  children: React.ReactNode;
}

/**
 * Must be rendered inside `<AuthProvider>` so `useAuth()` is available
 * for hooks that depend on auth state.
 */
export default function AppProviders({ children }: AppProvidersProps) {
  const auth = useAuth();
  const toastState = useToastState();
  const homeUsersState = useHomeUsersState();
  const inviteState = useInviteState(auth.authToken, auth.server?.uri ?? null);
  const contentRequestState = useContentRequestState(
    auth.authToken,
    auth.activeUser,
  );
  const prefsState = usePreferencesState(auth.activeUser?.id ?? null);
  const parentalState = useParentalControlsState(auth.activeUser?.id ?? null);
  const downloadsState = useDownloadsState(auth.server ?? null);
  const activityState = useServerActivityState();

  return (
    <ToastProvider value={toastState}>
      <HomeUsersProvider value={homeUsersState}>
        <PreferencesProvider value={prefsState}>
          <ParentalControlsProvider value={parentalState}>
            <ScanningStoreProvider value={activityState.scanningStore}>
            <CompletionCounterStoreProvider value={activityState.completionCounterStore}>
            <ServerActivityProvider value={activityState}>
            <InviteProvider value={inviteState}>
              <ContentRequestProvider value={contentRequestState}>
                <DownloadsProvider value={downloadsState}>
                  <QueueProvider>
                    <PlayerProvider>
                      {children}
                    </PlayerProvider>
                  </QueueProvider>
                </DownloadsProvider>
              </ContentRequestProvider>
            </InviteProvider>
            </ServerActivityProvider>
            </CompletionCounterStoreProvider>
            </ScanningStoreProvider>
          </ParentalControlsProvider>
        </PreferencesProvider>
      </HomeUsersProvider>
      <ToastContainer />
    </ToastProvider>
  );
}
