import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, parseConfig, type PresentationWithSlides, type Slide, type SlideType } from "../lib/api";

const TYPE_LABELS: Record<SlideType, string> = {
  MULTIPLE_CHOICE: "Multiple choice",
  WORD_CLOUD: "Word cloud",
  SCALE: "Scale / rating",
  OPEN_ENDED: "Open ended (Q&A)",
};

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const [pres, setPres] = useState<PresentationWithSlides | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigate();

  async function load() {
    if (!id) return;
    const data = await api.getPresentation(id);
    setPres(data);
    if (!selectedId && data.slides.length > 0) setSelectedId(data.slides[0].id);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function addSlide(type: SlideType) {
    if (!id) return;
    const defaults: Record<SlideType, any> = {
      MULTIPLE_CHOICE: {
        options: ["Option 1", "Option 2"],
        isQuiz: false,
        correctIndex: 0,
        timeLimitSec: 20,
      },
      SCALE: { scaleMin: 1, scaleMax: 5 },
      WORD_CLOUD: { maxWords: 3 },
      OPEN_ENDED: {},
    };
    const slide = await api.addSlide(id, type, "New question", defaults[type]);
    await load();
    setSelectedId(slide.id);
  }

  async function deleteSlide(slideId: string) {
    if (!id || !pres) return;
    if (!confirm("Delete this slide?")) return;
    await api.deleteSlide(id, slideId);
    if (selectedId === slideId) setSelectedId(null);
    await load();
  }

  async function renameTitle(title: string) {
    if (!id) return;
    setPres((p) => (p ? { ...p, title } : p));
    await api.updatePresentation(id, title);
  }

  const selected = pres?.slides.find((s) => s.id === selectedId) ?? null;

  if (!pres) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="text-gray-400 hover:text-gray-700">
            ←
          </Link>
          <input
            className="font-semibold text-lg outline-none"
            value={pres.title}
            onChange={(e) => renameTitle(e.target.value)}
          />
        </div>
        <button
          onClick={() => navigate(`/present/${id}`)}
          disabled={pres.slides.length === 0}
          className="bg-brand text-white px-4 py-2 rounded-lg font-medium hover:bg-brand-dark transition disabled:opacity-40"
        >
          Present ▶
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Slide list */}
        <aside className="w-64 border-r bg-white overflow-y-auto p-3 flex flex-col gap-2">
          {pres.slides.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`text-left px-3 py-2 rounded-lg border ${
                selectedId === s.id ? "border-brand bg-brand/5" : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <p className="text-xs text-gray-400">
                {i + 1} · {TYPE_LABELS[s.type]}
              </p>
              <p className="text-sm font-medium truncate">{s.question || "Untitled"}</p>
            </button>
          ))}

          <div className="mt-2 border-t pt-2 flex flex-col gap-1">
            <p className="text-xs text-gray-400 px-1 mb-1">Add slide</p>
            {(Object.keys(TYPE_LABELS) as SlideType[]).map((t) => (
              <button
                key={t}
                onClick={() => addSlide(t)}
                className="text-left px-3 py-1.5 rounded-md text-sm text-gray-600 hover:bg-gray-100"
              >
                + {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </aside>

        {/* Slide editor panel */}
        <main className="flex-1 overflow-y-auto p-8">
          {selected ? (
            <SlideForm
              key={selected.id}
              presentationId={id!}
              slide={selected}
              onChanged={load}
              onDelete={() => deleteSlide(selected.id)}
            />
          ) : (
            <p className="text-gray-400">Select or add a slide to edit it.</p>
          )}
        </main>
      </div>
    </div>
  );
}

function SlideForm({
  presentationId,
  slide,
  onChanged,
  onDelete,
}: {
  presentationId: string;
  slide: Slide;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const initialConfig = parseConfig(slide);
  const [question, setQuestion] = useState(slide.question);
  const [config, setConfig] = useState<any>(initialConfig);

  async function save(newQuestion = question, newConfig = config) {
    await api.updateSlide(presentationId, slide.id, {
      question: newQuestion,
      config: newConfig,
    });
    onChanged();
  }

  function updateOptions(options: string[]) {
    const newConfig = { ...config, options };
    setConfig(newConfig);
    save(question, newConfig);
  }

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <div className="flex justify-between items-start">
        <p className="text-sm text-gray-400">{TYPE_LABELS[slide.type]}</p>
        <button onClick={onDelete} className="text-red-500 text-sm hover:underline">
          Delete slide
        </button>
      </div>

      <div>
        <label className="text-sm text-gray-500 mb-1 block">Question</label>
        <input
          className="border rounded-lg px-4 py-2 w-full text-lg"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onBlur={() => save()}
        />
      </div>

      {slide.type === "MULTIPLE_CHOICE" && (
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-sm text-gray-500 block">Options</label>
            {config.isQuiz && (
              <span className="text-xs text-gray-400">Tap 🏆 to mark the correct answer</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {(config.options ?? []).map((opt: string, i: number) => (
              <div key={i} className="flex gap-2 items-center">
                {config.isQuiz && (
                  <button
                    type="button"
                    onClick={() => {
                      const c = { ...config, correctIndex: i };
                      setConfig(c);
                      save(question, c);
                    }}
                    title="Mark as correct answer"
                    className={`text-xl px-1 ${config.correctIndex === i ? "" : "grayscale opacity-30"}`}
                  >
                    🏆
                  </button>
                )}
                <input
                  className="border rounded-lg px-3 py-1.5 flex-1"
                  value={opt}
                  onChange={(e) => {
                    const options = [...config.options];
                    options[i] = e.target.value;
                    setConfig({ ...config, options });
                  }}
                  onBlur={() => save()}
                />
                <button
                  onClick={() => updateOptions(config.options.filter((_: any, j: number) => j !== i))}
                  className="text-gray-400 hover:text-red-500 px-2"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() => updateOptions([...(config.options ?? []), `Option ${(config.options?.length ?? 0) + 1}`])}
              className="text-brand text-sm text-left mt-1 hover:underline"
            >
              + Add option
            </button>
          </div>

          <div className="mt-5 border-t pt-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!config.isQuiz}
                onChange={(e) => {
                  const c = { ...config, isQuiz: e.target.checked };
                  if (c.isQuiz && typeof c.correctIndex !== "number") c.correctIndex = 0;
                  if (c.isQuiz && !c.timeLimitSec) c.timeLimitSec = 20;
                  setConfig(c);
                  save(question, c);
                }}
                className="w-4 h-4 accent-brand"
              />
              <span className="font-medium">🏆 Quiz mode</span>
              <span className="text-sm text-gray-400">— points for correct + speed, live leaderboard</span>
            </label>

            {config.isQuiz && (
              <div className="mt-3 flex items-center gap-2">
                <label className="text-sm text-gray-500">Time limit (seconds)</label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  className="border rounded-lg px-3 py-1.5 w-20"
                  value={config.timeLimitSec ?? 20}
                  onChange={(e) => {
                    const c = { ...config, timeLimitSec: Number(e.target.value) };
                    setConfig(c);
                    save(question, c);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {slide.type === "SCALE" && (
        <div className="flex gap-4">
          <div>
            <label className="text-sm text-gray-500 mb-1 block">Min</label>
            <input
              type="number"
              className="border rounded-lg px-3 py-1.5 w-24"
              value={config.scaleMin ?? 1}
              onChange={(e) => {
                const c = { ...config, scaleMin: Number(e.target.value) };
                setConfig(c);
                save(question, c);
              }}
            />
          </div>
          <div>
            <label className="text-sm text-gray-500 mb-1 block">Max</label>
            <input
              type="number"
              className="border rounded-lg px-3 py-1.5 w-24"
              value={config.scaleMax ?? 5}
              onChange={(e) => {
                const c = { ...config, scaleMax: Number(e.target.value) };
                setConfig(c);
                save(question, c);
              }}
            />
          </div>
        </div>
      )}

      {slide.type === "WORD_CLOUD" && (
        <div>
          <label className="text-sm text-gray-500 mb-1 block">Max words per participant</label>
          <input
            type="number"
            className="border rounded-lg px-3 py-1.5 w-24"
            value={config.maxWords ?? 3}
            onChange={(e) => {
              const c = { ...config, maxWords: Number(e.target.value) };
              setConfig(c);
              save(question, c);
            }}
          />
        </div>
      )}

      {slide.type === "OPEN_ENDED" && (
        <p className="text-sm text-gray-400">
          Participants will see a free-text box and their answers appear as a feed.
        </p>
      )}
    </div>
  );
}
