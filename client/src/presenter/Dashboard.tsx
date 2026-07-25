import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Presentation } from "../lib/api";
import { useAuth } from "../auth";

export default function Dashboard() {
  const [items, setItems] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api.listPresentations().then((data) => {
      setItems(data);
      setLoading(false);
    });
  }, []);

  async function createNew() {
    const p = await api.createPresentation("Untitled presentation");
    navigate(`/edit/${p.id}`);
  }

  async function remove(id: string) {
    if (!confirm("Delete this presentation?")) return;
    await api.deletePresentation(id);
    setItems((items) => items.filter((i) => i.id !== id));
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">My presentations</h1>
          <p className="text-gray-500 text-sm">{user?.name}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={createNew}
            className="bg-brand text-white px-4 py-2 rounded-lg font-medium hover:bg-brand-dark transition"
          >
            + New
          </button>
          <button
            onClick={logout}
            className="text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 transition"
          >
            Log out
          </button>
        </div>
      </div>

      {loading && <p className="text-gray-500">Loading...</p>}
      {!loading && items.length === 0 && (
        <p className="text-gray-500">No presentations yet. Create one to get started.</p>
      )}

      <div className="flex flex-col gap-3">
        {items.map((p) => (
          <div
            key={p.id}
            className="bg-white rounded-lg shadow-sm p-4 flex justify-between items-center"
          >
            <Link to={`/edit/${p.id}`} className="flex-1">
              <p className="font-medium">{p.title}</p>
              <p className="text-sm text-gray-500">{p._count?.slides ?? 0} slide(s)</p>
            </Link>
            <div className="flex gap-2">
              <Link
                to={`/present/${p.id}`}
                className="text-brand text-sm font-medium px-3 py-1.5 rounded-md hover:bg-brand/5"
              >
                Present
              </Link>
              <button
                onClick={() => remove(p.id)}
                className="text-red-500 text-sm px-3 py-1.5 rounded-md hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
