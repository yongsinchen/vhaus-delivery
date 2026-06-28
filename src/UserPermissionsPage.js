import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";

const API = "https://vhaus-bot-production.up.railway.app";

export default function UserPermissionsPage() {
  const { authFetch } = useAuth();
  const [users, setUsers] = useState([]);
  const [modules, setModules] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userPerms, setUserPerms] = useState(null);
  const [overrideKeys, setOverrideKeys] = useState(new Set());
  const [changes, setChanges] = useState({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [expandedModules, setExpandedModules] = useState(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, modulesRes, rolesRes] = await Promise.all([
        authFetch(`${API}/permissions/users`),
        authFetch(`${API}/permissions/modules`),
        authFetch(`${API}/permissions/roles`),
      ]);
      const [usersData, modulesData, rolesData] = await Promise.all([
        usersRes.json(), modulesRes.json(), rolesRes.json(),
      ]);
      setUsers(usersData.users || []);
      setModules(modulesData.modules || []);
      setRoles(rolesData.roles || []);
    } catch (e) { console.error("loadData error:", e); }
    setLoading(false);
  }, [authFetch]);

  useEffect(() => { loadData(); }, [loadData]);

  const selectUser = async (u) => {
    setSelectedUser(u);
    setChanges({});
    try {
      const res = await authFetch(`${API}/permissions/users/${u.userId}`);
      const data = await res.json();
      setUserPerms(data.permissions || {});
      setOverrideKeys(new Set(data.overrideKeys || []));
      setExpandedModules(new Set(modules.filter(m => m.category === "BUSINESS").slice(0, 3).map(m => m.module_key)));
    } catch (e) { console.error(e); }
  };

  const togglePerm = (actionKey, currentAllowed) => {
    setChanges(prev => {
      const next = { ...prev };
      if (next[actionKey]?.allowed === !currentAllowed) {
        delete next[actionKey];
      } else {
        next[actionKey] = { action_key: actionKey, allowed: !currentAllowed };
      }
      return next;
    });
  };

  const resetToRole = (actionKey) => {
    setChanges(prev => {
      const next = { ...prev };
      next[actionKey] = { action_key: actionKey, allowed: null };
      return next;
    });
  };

  const saveChanges = async () => {
    if (!selectedUser || Object.keys(changes).length === 0) return;
    setSaving(true);
    try {
      const res = await authFetch(`${API}/permissions/users/${selectedUser.userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: Object.values(changes) }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || "Failed"); setSaving(false); return; }
      const data = await res.json();
      setUserPerms(data.permissions || {});
      setChanges({});
      await selectUser(selectedUser);
    } catch (e) { alert("Error: " + e.message); }
    setSaving(false);
  };

  const resetAll = async () => {
    if (!selectedUser || !window.confirm("Reset all custom permissions to role defaults?")) return;
    setSaving(true);
    const allOverrides = [...overrideKeys].map(key => ({ action_key: key, allowed: null }));
    try {
      await authFetch(`${API}/permissions/users/${selectedUser.userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: allOverrides }),
      });
      await selectUser(selectedUser);
    } catch (e) { alert("Error: " + e.message); }
    setSaving(false);
  };

  const getEffective = (actionKey) => {
    if (changes[actionKey] !== undefined) {
      if (changes[actionKey].allowed === null) {
        const role = userPerms?.[actionKey];
        return { allowed: role?.source === "role" ? role.allowed : false, source: "role", pending: true };
      }
      return { allowed: changes[actionKey].allowed, source: "pending", pending: true };
    }
    const p = userPerms?.[actionKey];
    return p || { allowed: false, source: "default" };
  };

  const filteredUsers = users.filter(u => {
    if (search && !u.name?.toLowerCase().includes(search.toLowerCase()) && !u.email?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterRole && u.roleKey !== filterRole) return false;
    return true;
  });

  const systemModules = modules.filter(m => m.category === "SYSTEM");
  const businessModules = modules.filter(m => m.category === "BUSINESS");

  if (loading) return <div className="p-6 text-center text-gray-400">Loading permissions...</div>;

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">User Permissions</h1>
          <p className="text-sm text-gray-500">{users.length} user{users.length !== 1 ? "s" : ""} in this company</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4" style={{ minHeight: "70vh" }}>
        {/* User list */}
        <div className={`${selectedUser ? "hidden lg:block" : ""} lg:w-80 shrink-0 space-y-3`}>
          <div className="flex gap-2 max-w-full">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              className="min-w-0 flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
              className="w-24 shrink-0 px-2 py-2 rounded-xl border border-gray-200 text-sm bg-white truncate">
              <option value="">All</option>
              {roles.map(r => <option key={r.id} value={r.role_key}>{r.role_name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            {filteredUsers.map(u => (
              <button key={u.userId} onClick={() => selectUser(u)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all ${selectedUser?.userId === u.userId ? "bg-violet-600 text-white" : "bg-white border border-gray-100 hover:border-violet-300"}`}>
                <p className={`font-medium truncate ${selectedUser?.userId === u.userId ? "text-white" : "text-gray-900"}`}>{u.name}</p>
                <p className={`text-xs truncate ${selectedUser?.userId === u.userId ? "text-violet-200" : "text-gray-400"}`}>{u.roleName} · {u.email}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Permission editor */}
        <div className={`${selectedUser ? "" : "hidden lg:block"} flex-1 min-w-0 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden`}>
          {!selectedUser ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Select a user to manage permissions
            </div>
          ) : !userPerms ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading...</div>
          ) : (
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="sticky top-0 bg-white border-b px-4 sm:px-5 py-3 z-10">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button onClick={() => { setSelectedUser(null); setUserPerms(null); setChanges({}); }} className="lg:hidden w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 shrink-0">←</button>
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900 truncate">{selectedUser.name}</p>
                      <p className="text-xs text-gray-500 truncate">{selectedUser.roleName} · {selectedUser.email}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {overrideKeys.size > 0 && (
                      <button onClick={resetAll} disabled={saving}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">Reset All to Default</button>
                    )}
                    {Object.keys(changes).length > 0 && (
                      <button onClick={saveChanges} disabled={saving}
                        className="text-xs px-4 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 font-medium">
                        {saving ? "Saving..." : `Save ${Object.keys(changes).length} change${Object.keys(changes).length !== 1 ? "s" : ""}`}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Permission matrix */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                {/* System permissions */}
                {systemModules.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">System</p>
                    {systemModules.map(mod => (
                      <ModuleSection key={mod.id} mod={mod} expanded={expandedModules.has(mod.module_key)}
                        onToggle={() => setExpandedModules(prev => { const n = new Set(prev); n.has(mod.module_key) ? n.delete(mod.module_key) : n.add(mod.module_key); return n; })}
                        getEffective={getEffective} togglePerm={togglePerm} resetToRole={resetToRole} overrideKeys={overrideKeys} />
                    ))}
                  </div>
                )}
                {/* Business permissions */}
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Business</p>
                {businessModules.map(mod => (
                  <ModuleSection key={mod.id} mod={mod} expanded={expandedModules.has(mod.module_key)}
                    onToggle={() => setExpandedModules(prev => { const n = new Set(prev); n.has(mod.module_key) ? n.delete(mod.module_key) : n.add(mod.module_key); return n; })}
                    getEffective={getEffective} togglePerm={togglePerm} resetToRole={resetToRole} overrideKeys={overrideKeys} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModuleSection({ mod, expanded, onToggle, getEffective, togglePerm, resetToRole, overrideKeys }) {
  const actions = mod.permission_actions || [];
  const allowedCount = actions.filter(a => getEffective(a.action_key).allowed).length;

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden mb-1">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-400">{expanded ? "▼" : "▶"}</span>
          <span className="text-sm font-semibold text-gray-800">{mod.module_name}</span>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${allowedCount === actions.length ? "bg-emerald-100 text-emerald-700" : allowedCount > 0 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>
          {allowedCount}/{actions.length}
        </span>
      </button>
      {expanded && (
        <div className="px-4 py-2 space-y-1">
          {actions.sort((a, b) => a.sort_order - b.sort_order).map(act => {
            const eff = getEffective(act.action_key);
            const isOverride = overrideKeys.has(act.action_key);
            const isPending = eff.pending;
            return (
              <div key={act.id} className="flex items-center justify-between py-1.5 group">
                <div className="flex items-center gap-3">
                  <button onClick={() => togglePerm(act.action_key, eff.allowed)}
                    className={`w-5 h-5 rounded flex items-center justify-center text-xs transition-all border ${
                      eff.allowed
                        ? isPending ? "bg-violet-400 border-violet-400 text-white" : "bg-emerald-500 border-emerald-500 text-white"
                        : isPending ? "bg-red-100 border-red-300" : "bg-gray-100 border-gray-300"
                    }`}>
                    {eff.allowed ? "✓" : ""}
                  </button>
                  <span className={`text-sm ${eff.allowed ? "text-gray-800" : "text-gray-400"}`}>{act.action_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {act.supports_scope && eff.scope && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-mono">{eff.scope}</span>
                  )}
                  {isOverride && !isPending ? (
                    <button onClick={() => resetToRole(act.action_key)}
                      className="text-xs text-amber-600 hover:text-amber-800 opacity-0 group-hover:opacity-100 transition-opacity">
                      custom — reset
                    </button>
                  ) : isPending ? (
                    <span className="text-xs text-violet-500 font-medium">unsaved</span>
                  ) : (
                    <span className="text-xs text-gray-300">from role</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
