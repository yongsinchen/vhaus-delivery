import { createContext, useContext, useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lrfyjcupucpdqmbqqbbk.supabase.co";
const SUPABASE_KEY = "sb_publishable_eAA_n21UDdPrecDlwfa8xQ_3PmFAMkm";
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const AuthContext = createContext(null);

// ── Role helpers ──────────────────────────────────────────────────
export const ROLES = {
  MASTER: "master",
  MANAGER: "manager",
  COMPANY_ADMIN: "company_admin",
  SALESMAN: "salesman",
  FINANCE: "finance",
};

export const roleLabel = r => ({
  master: "Master",
  manager: "Manager",
  company_admin: "Company Admin",
  salesman: "Salesman",
  finance: "Finance",
}[r] || r);

export const can = (user, action) => {
  if (!user) return false;
  const role = user.role;

  const rules = {
    // Tab visibility
    viewSummary:          true,
    viewMonthly:          role !== "finance",
    viewService:          true,
    viewDaily:            role !== "finance",
    viewSchedule:         true,
    viewFlagged:          role !== "finance",
    viewServicePending:   ["master","manager"].includes(role),
    viewDoReview:         ["master","manager"].includes(role),
    viewAddOrder:         role !== "finance",
    viewFinance:          ["master","manager","salesman","finance"].includes(role),

    // Schedule edit
    editSchedule:         ["master","manager","company_admin"].includes(role),

    // Order actions
    addOrder:             role !== "finance",
    editOrder:            ["master","manager","company_admin","salesman"].includes(role),
    deleteOrder:          ["master","manager"].includes(role),
    recordPayment:        ["master","manager","salesman"].includes(role),

    // User management
    manageUsers:          ["master","manager"].includes(role),
    manageCompanies:      role === "master",

    // Service pending
    convertServicePending: ["master","manager"].includes(role),

    // DO Review
    resolveDoReview:      ["master","manager"].includes(role),
  };

  return rules[action] ?? false;
};

// Can this user see this order?
export const canSeeOrder = (user, order) => {
  if (!user) return false;
  if (["master","manager","company_admin","finance"].includes(user.role)) return true;
  if (user.role === "salesman") {
    const salesmen = (order.salesman || order.salesman_name || "")
      .split("/").map(s => s.trim().toLowerCase());
    return salesmen.includes((user.salesman_name || "").toLowerCase());
  }
  return false;
};

// ── Auth Provider ─────────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null); // full user profile from users table
  const [loading, setLoading] = useState(true);

  const loadUserProfile = async (authUser) => {
    if (!authUser) { setUser(null); setLoading(false); return; }
    try {
      // Use backend API with service role key to bypass RLS recursion
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || "";
      const res = await fetch(`${process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app"}/auth/profile`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { console.error("Profile fetch failed:", res.status); setUser(null); setLoading(false); return; }
      const data = await res.json();
      setUser({ ...data, email: authUser.email });
    } catch (e) {
      console.error("loadUserProfile error:", e);
      setUser(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      loadUserProfile(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        // Redirect to password reset page
        window.location.href = "/reset-password";
        return;
      }
      setSession(session);
      loadUserProfile(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line

  const signIn = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, signIn, signOut, can: (action) => can(user, action), canSeeOrder: (order) => canSeeOrder(user, order) }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);