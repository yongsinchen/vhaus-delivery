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

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";

// ── Auth Provider ─────────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [availableCompanies, setAvailableCompanies] = useState([]);
  const [activeCompanyId, setActiveCompanyId] = useState(() => localStorage.getItem("pulseActiveCompanyId") || null);
  const [activeRoleKey, setActiveRoleKey] = useState(null);
  const [permissions, setPermissions] = useState({});

  const getToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || "";
  };

  const authFetch = async (url, opts = {}) => {
    const token = await getToken();
    const headers = { ...opts.headers, Authorization: `Bearer ${token}` };
    if (activeCompanyId) headers["X-Company-ID"] = activeCompanyId;
    return fetch(url, { ...opts, headers });
  };

  const loadPermissions = async () => {
    try {
      const res = await authFetch(`${API}/permissions/effective`);
      if (res.ok) {
        const data = await res.json();
        setPermissions(data.permissions || {});
        if (data.activeCompanyId) setActiveCompanyId(data.activeCompanyId);
        if (data.roleKey) setActiveRoleKey(data.roleKey);
      }
    } catch (e) { console.error("loadPermissions error:", e); }
  };

  const loadUserProfile = async (authUser) => {
    if (!authUser) { setUser(null); setLoading(false); return; }
    try {
      const token = (await supabase.auth.getSession()).data?.session?.access_token || "";
      const headers = { Authorization: `Bearer ${token}` };
      if (activeCompanyId) headers["X-Company-ID"] = activeCompanyId;
      const res = await fetch(`${API}/auth/profile`, { headers });
      if (!res.ok) { console.error("Profile fetch failed:", res.status); setUser(null); setLoading(false); return; }
      const data = await res.json();
      setUser({ ...data, email: authUser.email });
      setAvailableCompanies(data.availableCompanies || []);
      if (data.activeCompanyId) {
        setActiveCompanyId(data.activeCompanyId);
        localStorage.setItem("pulseActiveCompanyId", data.activeCompanyId);
      }
      if (data.activeRoleKey) setActiveRoleKey(data.activeRoleKey);
      // Load permissions after profile
      setTimeout(loadPermissions, 100);
    } catch (e) {
      console.error("loadUserProfile error:", e);
      setUser(null);
    }
    setLoading(false);
  };

  const switchCompany = async (companyId) => {
    try {
      const res = await authFetch(`${API}/auth/switch-company`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || "Failed to switch"); return false; }
      const data = await res.json();
      setActiveCompanyId(data.activeCompanyId);
      setActiveRoleKey(data.activeRoleKey);
      setPermissions(data.permissions || {});
      localStorage.setItem("pulseActiveCompanyId", data.activeCompanyId);
      return true;
    } catch (e) { console.error("switchCompany error:", e); return false; }
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

  const canPerm = (actionKey) => {
    if (!user) return false;
    if (user.role === "master" || activeRoleKey === "MASTER") return true;
    const p = permissions[actionKey];
    if (p) return p.allowed === true;
    return can(user, actionKey);
  };

  return (
    <AuthContext.Provider value={{
      session, user, loading, signIn, signOut,
      can: (action) => can(user, action),
      canPerm,
      canSeeOrder: (order) => canSeeOrder(user, order),
      availableCompanies, activeCompanyId, activeRoleKey, permissions,
      switchCompany, authFetch,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);