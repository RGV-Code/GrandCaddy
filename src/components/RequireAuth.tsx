import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;

    async function checkSession() {
      const { data: { user } } = await supabase.auth.getUser();
      if (active) {
        setSignedIn(!!user);
        setChecking(false);
      }
    }

    void checkSession();
    return () => {
      active = false;
    };
  }, []);

  if (checking) {
    return <main className="min-h-screen bg-[#F8F9FC]" />;
  }

  if (!signedIn) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }

  return children;
}