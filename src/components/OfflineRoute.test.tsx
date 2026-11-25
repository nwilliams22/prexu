import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import OfflineRoute from "./OfflineRoute";

const auth = vi.hoisted(() => ({ serverUnreachable: false }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => auth }));

function App({ path = "/" }: { path?: string }) {
  return <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="*" element={<OfflineRoute>
        <Routes>
          <Route path="/" element={<p>Library home</p>} />
          <Route path="/downloads" element={<p>Local downloads</p>} />
          <Route path="/settings/*" element={<p>Preferences</p>} />
          <Route path="/item/:id" element={<p>Server metadata</p>} />
        </Routes>
      </OfflineRoute>} />
    </Routes>
  </MemoryRouter>;
}

beforeEach(() => { auth.serverUnreachable = false; });

it.each(["/", "/item/17"])("opens Downloads offline from %s", async (path) => {
  auth.serverUnreachable = true;
  render(<App path={path} />);
  expect(await screen.findByText("Local downloads")).toBeInTheDocument();
  expect(screen.queryByText("Server metadata")).not.toBeInTheDocument();
});

it("routes a running session offline and returns to browsing on recovery", async () => {
  const view = render(<App />);
  expect(screen.getByText("Library home")).toBeInTheDocument();
  auth.serverUnreachable = true;
  view.rerender(<App />);
  expect(await screen.findByText("Local downloads")).toBeInTheDocument();
  auth.serverUnreachable = false;
  view.rerender(<App />);
  expect(await screen.findByText("Library home")).toBeInTheDocument();
});

it("keeps settings available during an outage and recovery", () => {
  auth.serverUnreachable = true;
  const view = render(<App path="/settings/downloads" />);
  expect(screen.getByText("Preferences")).toBeInTheDocument();
  auth.serverUnreachable = false;
  view.rerender(<App path="/settings/downloads" />);
  expect(screen.getByText("Preferences")).toBeInTheDocument();
});

it("does not redirect a deliberate online visit to Downloads", () => {
  render(<App path="/downloads" />);
  expect(screen.getByText("Local downloads")).toBeInTheDocument();
});
