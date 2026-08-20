import { createContext, useContext, useState, useEffect, useRef } from "react";
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
  master: "Master", super_admin: "Super Admin",
  director: "Director", manager: "Manager",
  sales_manager: "Sales Manager", operation_manager: "Operation Manager",
  company_admin: "Company Admin",
  salesman: "Salesman", part_time: "Part-time",
  short_term_part_time: "Short-Term Part-time", finance: "Finance",
  warehouse: "Warehouse", operation: "Warehouse",
  driver: "Driver", viewer: "Viewer",
}[r] || r);

export const can = (user, action) => {
  if (!user) return false;
  // Part-time is a salesman-equivalent role — treat it as salesman for every
  // permission/UI decision (the stored role stays 'part_time' for labeling).
  const role = user.role === "part_time" ? "salesman" : user.role;

  // Manager was split into Sales Manager (revenue side) and Operation Manager
  // (fulfilment side). Legacy "manager" keeps full access on both sides.
  const salesSide = ["master", "manager", "sales_manager"];       // orders / commission / payments / services
  const opsSide   = ["master", "manager", "operation_manager"];   // deliveries / warehouse / catalogue / DO review
  // short_term_part_time can CREATE/EDIT orders (like a salesman) but nothing
  // else — no payment recording, no delete, no other tabs. It is intentionally
  // NOT aliased to salesman above; App.js narrows its nav to Orders + Commission.
  const orderCapable = [...salesSide, "company_admin", "salesman", "short_term_part_time"];

  const rules = {
    // Tab visibility
    viewSummary:          true,
    viewMonthly:          role !== "finance",
    viewService:          role !== "finance",
    viewDaily:            role !== "finance",
    viewSchedule:         true,
    viewFlagged:          role !== "finance",
    viewServicePending:   salesSide.includes(role),
    viewDoReview:         opsSide.includes(role),
    viewAddOrder:         orderCapable.includes(role),
    viewFinance:          [...salesSide, "salesman", "finance"].includes(role),

    // Schedule edit (fulfilment side + company admin)
    editSchedule:         [...opsSide, "company_admin"].includes(role),

    // Order actions (revenue side + company admin + salesman)
    addOrder:             orderCapable.includes(role),
    editOrder:            orderCapable.includes(role),
    deleteOrder:          salesSide.includes(role),
    recordPayment:        [...salesSide, "salesman"].includes(role),

    // User management — Master only (the two new managers cannot; legacy
    // manager retained until existing managers are reassigned).
    manageUsers:          ["master", "manager"].includes(role),
    manageCompanies:      role === "master",

    // Service pending (revenue side) / DO review (fulfilment side)
    convertServicePending: salesSide.includes(role),
    resolveDoReview:      opsSide.includes(role),
  };

  return rules[action] ?? false;
};

// Can this user see this order?
export const canSeeOrder = (user, order) => {
  if (!user) return false;
  if (["master","manager","company_admin","finance"].includes(user.role)) return true;
  if (["salesman", "part_time", "short_term_part_time"].includes(user.role)) {
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

  const userRef = useRef(null);
  useEffect(() => { userRef.current = user; }, [user]);

  // Auth user id we last loaded a profile for. Used to ignore spurious
  // onAuthStateChange re-fires (token refresh / tab focus) that would otherwise
  // re-render the whole app and close any open native picker mid-interaction.
  const loadedUserIdRef = useRef(null);

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
        // permissions may be an array of strings or an object — normalize to Set-like lookup
        const permsArr = Array.isArray(data.permissions) ? data.permissions : Object.keys(data.permissions || {});
        setPermissions(new Set(permsArr));
        if (data.activeCompanyId) setActiveCompanyId(data.activeCompanyId);
        if (data.roleKey) setActiveRoleKey(data.roleKey);
      }
    } catch (e) { console.error("loadPermissions error:", e); }
  };

  const loadUserProfile = async (authUser) => {
    loadedUserIdRef.current = authUser?.id ?? null;
    if (!authUser) { setUser(null); setLoading(false); return; }
    // First sign-in / initial boot: flip loading back on so the app shows the
    // boot screen instead of a frozen login page. Skip on token refresh
    // (user already loaded) to avoid flashing the loader mid-session.
    if (!userRef.current) setLoading(true);
    try {
      const token = (await supabase.auth.getSession()).data?.session?.access_token || "";
      const headers = { Authorization: `Bearer ${token}` };
      if (activeCompanyId) headers["X-Company-ID"] = activeCompanyId;
      const res = await fetch(`${API}/auth/profile`, { headers });
      if (!res.ok) {
        console.error("Profile fetch failed:", res.status);
        if (res.status === 403 && activeCompanyId) {
          // Stale company in localStorage — clear and retry without header
          console.warn("Clearing stale company ID and retrying profile");
          localStorage.removeItem("pulseActiveCompanyId");
          setActiveCompanyId(null);
          const retry = await fetch(`${API}/auth/profile`, { headers: { Authorization: `Bearer ${token}` } });
          if (retry.ok) { const d = await retry.json(); setUser({ ...d, email: authUser.email }); setAvailableCompanies(d.availableCompanies || []); if (d.activeCompanyId) { setActiveCompanyId(d.activeCompanyId); localStorage.setItem("pulseActiveCompanyId", d.activeCompanyId); } if (d.effectiveRole) setActiveRoleKey(d.effectiveRole); if (d.effectivePermissions?.length > 0) setPermissions(new Set(d.effectivePermissions)); setLoading(false); return; }
        }
        setUser(null); setLoading(false); return;
      }
      const data = await res.json();
      setUser({ ...data, email: authUser.email });
      setAvailableCompanies(data.availableCompanies || []);
      if (data.activeCompanyId) {
        setActiveCompanyId(data.activeCompanyId);
        localStorage.setItem("pulseActiveCompanyId", data.activeCompanyId);
      }
      if (data.effectiveRole) setActiveRoleKey(data.effectiveRole);
      else if (data.activeRoleKey) setActiveRoleKey(data.activeRoleKey);
      // Store effectivePermissions from profile (array of action key strings)
      if (data.effectivePermissions && data.effectivePermissions.length > 0) {
        setPermissions(new Set(data.effectivePermissions));
      } else {
        setTimeout(loadPermissions, 100);
      }
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
      setActiveRoleKey(data.effectiveRole || data.activeRoleKey);
      const permsArr = Array.isArray(data.effectivePermissions) ? data.effectivePermissions : [];
      setPermissions(new Set(permsArr));
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
      // TOKEN_REFRESHED (auto token rotation) and SIGNED_IN re-fires on tab focus
      // don't change who is logged in, but the session object is a new reference
      // each time. Calling setSession / reloading the profile on them re-renders the
      // whole app and closes any open native picker (e.g. the arrival-date calendar
      // commits today's date mid-selection). Bail out before touching any state.
      // Components read the live token via supabase.auth.getSession(), not this
      // context's `session`, so skipping the update here is safe.
      const newUserId = session?.user?.id ?? null;
      if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && newUserId && newUserId === loadedUserIdRef.current) {
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

  // Backward-compat alias: old can() action names → permission engine action keys
  const PERM_ALIASES = {
    viewSummary: null, viewMonthly: "DASHBOARD_VIEW", viewService: "SERVICE_VIEW",
    viewDaily: "DASHBOARD_VIEW", viewSchedule: "DELIVERY_VIEW", viewFlagged: "DASHBOARD_VIEW",
    viewServicePending: "SERVICE_VIEW", viewDoReview: "SUPPLIER_DO_REVIEW",
    viewAddOrder: "ORDERS_CREATE", viewFinance: "FINANCE_VIEW",
    editSchedule: "DELIVERY_EDIT", addOrder: "ORDERS_CREATE",
    editOrder: "ORDERS_EDIT", deleteOrder: "ORDERS_DELETE",
    recordPayment: "FINANCE_RECORD_PAYMENT", manageUsers: "SYSTEM_MANAGE_USERS",
    manageCompanies: "SYSTEM_MANAGE_COMPANIES",
    convertServicePending: "SERVICE_CREATE", resolveDoReview: "SUPPLIER_DO_REVIEW",
  };

  const canPerm = (actionKey) => {
    if (!user) return false;
    // super_admin / master bypass
    if (user.role === "master" || activeRoleKey === "master") return true;
    // Check permissions Set directly (for engine action keys like ORDERS_VIEW)
    if (permissions instanceof Set && permissions.size > 0) {
      // Direct key check (ORDERS_VIEW)
      if (permissions.has(actionKey)) return true;
      // Alias lookup (editOrder → ORDERS_EDIT)
      const aliased = PERM_ALIASES[actionKey];
      if (aliased === null) return true; // null = always allowed (viewSummary)
      if (aliased && permissions.has(aliased)) return true;
      // If we have permissions loaded and key not found, deny
      return false;
    }
    // Fallback to old hardcoded can() when permissions not loaded yet
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