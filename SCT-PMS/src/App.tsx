import { RouterProvider } from "react-router-dom";
import { router } from "@/app/router";
import { SessionProvider } from "@/lib/session";

export default function App() {
  return (
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  );
}
