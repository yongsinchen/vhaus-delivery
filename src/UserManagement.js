import { useState, useEffect } from "react";
import { supabase, useAuth, ROLES, roleLabel } from "./AuthContext";

const EMPTY_USER = { name: "", email: "", role: "salesman", telegram_id: "", salesman_name: "", company_id: "", is_active: true };

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_USER });
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");

  const isMaster = currentUser?.role === "master";

  // Available roles based on who's managing
  const availableRoles = isMaster
    ? [ROLES.MASTER, ROLES.MANAGER, ROLES.COMPANY_ADMIN, ROLES.SALESMAN, ROLES.FINANCE]
    : [ROLES.COMPANY_ADMIN, ROLES.SALESMAN, ROLES.FINANCE];

  useEffect(() => {
    loadData();
  }, []); // eslint-disable-line

  const loadData = async () => {
    setLoading(true);
    // Load companies
    const { data: comps } = await supabase.from("companies").select("*").order("name");
    setCompanies(comps || []);

    // Load users — master sees all, manager sees only their company
    let query = supabase.from("users").select("*, companies(name, code)").order("name");
    if (!isMaster) query = query.eq("company_id", currentUser.company_id);
    const { data: usrs } = await query;
    setUsers(usrs || []);
    setLoading(false);
  };

  const openCreate = () => {
    setForm({
      ...EMPTY_USER,
      company_id: isMaster ? "" : currentUser.company_id,
    });
    setPassword("");
    setEditId(null);
    setError("");
    setShowForm(true);
  };

  const openEdit = (u) => {
    setForm({
      name: u.name,
      email: u.email,
      role: u.role,
      telegram_id: u.telegram_id || "",
      salesman_name: u.salesman_name || "",
      company_id: u.company_id || "",
      is_active: u.is_active,
    });
    setPassword("");
    setEditId(u.id);
    setError("");
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.email || !form.role) return setError("Name, email and role are required.");
    if (!editId && !password) return setError("Password is required for new users.");
    if (!isMaster && !form.company_id) form.company_id = currentUser.company_id;
    if (!form.company_id && form.role !== "master") return setError("Please select a company.");

    setSaving(true);
    setError("");

    if (editId) {
      // Update existing user profile
      const { error: err } = await supabase.from("users").update({
        name: form.name,
        role: form.role,
        telegram_id: form.telegram_id || null,
        salesman_name: form.salesman_name || null,
        company_id: form.company_id || null,
        is_active: form.is_active,
      }).eq("id", editId);
      if (err) { setError(err.message); setSaving(false); return; }
      if (password) {
        // Update password via admin API — requires backend call
        const res = await fetch(`${process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app"}/admin/users/${editId}/password`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (!data.success) { setError("Profile saved but password update failed: " + data.error); setSaving(false); return; }
      }
    } else {
      // Create new user via backend (needs admin Supabase key)
      const res = await fetch(`${process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app"}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, password }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || "Failed to create user."); setSaving(false); return; }
    }

    setSaving(false);
    setShowForm(false);
    loadData();
  };

  const toggleActive = async (u) => {
    await supabase.from("users").update({ is_active: !u.is_active }).eq("id", u.id);
    loadData();
  };

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-base font-bold text-gray-700">👥 User Management</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {isMaster ? "Manage all users across all companies." : "Manage users in your company."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-3 py-1 rounded-full">{users.length} users</span>
          <button onClick={loadData} className="text-xs bg-white border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50">🔄 Refresh</button>
          <button onClick={openCreate} className="text-xs bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700">+ Add User</button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
      ) : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className={`bg-white border rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap ${!u.is_active ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-800">{u.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      u.role === "master" ? "bg-red-100 text-red-700" :
                      u.role === "manager" ? "bg-purple-100 text-purple-700" :
                      u.role === "company_admin" ? "bg-blue-100 text-blue-700" :
                      u.role === "salesman" ? "bg-green-100 text-green-700" :
                      "bg-orange-100 text-orange-700"
                    }`}>{roleLabel(u.role)}</span>
                    {!u.is_active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {u.email}
                    {u.companies?.name && <span className="ml-2 text-gray-300">· {u.companies.name}</span>}
                    {u.telegram_id && <span className="ml-2 text-blue-400">· TG: {u.telegram_id}</span>}
                    {u.salesman_name && <span className="ml-2 text-green-500">· {u.salesman_name}</span>}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => toggleActive(u)} className={`text-xs px-3 py-1.5 rounded-lg border ${u.is_active ? "border-gray-300 text-gray-600 hover:bg-gray-50" : "border-green-300 text-green-600 hover:bg-green-50"}`}>
                  {u.is_active ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => openEdit(u)} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">✏️ Edit</button>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <div className="text-4xl mb-2">👥</div>
              <p>No users yet. Add one to get started.</p>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4 overflow-y-auto py-10">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-bold text-gray-800">{editId ? "Edit User" : "Add New User"}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {[
                { k: "name", l: "Full Name", req: true },
                { k: "email", l: "Email", t: "email", req: true, disabled: !!editId },
                { k: "salesman_name", l: "Salesman Name (as it appears on orders)" },
                { k: "telegram_id", l: "Telegram ID (number only)" },
              ].map(({ k, l, t, req, disabled }) => (
                <div key={k}>
                  <label className="text-xs font-medium text-gray-600 block mb-1">{l}{req && <span className="text-red-500"> *</span>}</label>
                  <input
                    type={t || "text"}
                    value={form[k]}
                    onChange={e => setForm(p => ({ ...p, [k]: e.target.value }))}
                    disabled={disabled}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </div>
              ))}

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Password{!editId && <span className="text-red-500"> *</span>}{editId && <span className="text-gray-400"> (leave blank to keep current)</span>}</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={editId ? "Leave blank to keep current" : "Min 6 characters"} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Role <span className="text-red-500">*</span></label>
                <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                  {availableRoles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </select>
              </div>

              {(isMaster || form.role !== "master") && (
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Company{form.role !== "master" && <span className="text-red-500"> *</span>}</label>
                  <select value={form.company_id} onChange={e => setForm(p => ({ ...p, company_id: e.target.value }))} disabled={!isMaster} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50">
                    <option value="">-- Select company --</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              {editId && (
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="rounded" />
                  <label htmlFor="is_active" className="text-sm text-gray-600">Active account</label>
                </div>
              )}

              {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">{error}</div>}
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving..." : editId ? "Update User" : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}