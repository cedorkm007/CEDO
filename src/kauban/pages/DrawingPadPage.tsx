import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Trash2, Download } from "lucide-react";
import { KaubanPageHeader } from "../components/KaubanPageHeader";

const COLORS = ["#1E1B3A", "#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899"];

/** Freehand canvas for drawing instead of speaking/signing — pure
 *  client-side, nothing persisted anywhere (matches the original app's
 *  own DrawingPadController, which just returned a view with no storage
 *  behind it). "Save" downloads the drawing as a PNG. */
export function DrawingPadPage({ onBack }: { onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [brushSize, setBrushSize] = useState(6);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const point = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
    lastPointRef.current = point;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const last = lastPointRef.current;
    if (!ctx || !last) return;
    const point = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  }

  function handlePointerUp() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "kauban-drawing.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="min-h-screen bg-[#FAF9FC] px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <KaubanPageHeader title="Drawing Pad" subtitle="Draw to communicate when words aren't enough." onBack={onBack} />

        <canvas
          ref={canvasRef}
          className="h-[400px] w-full touch-none rounded-2xl border-2 border-[#4F46E5]/15 bg-white shadow-sm"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex gap-1.5">
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full border-2 ${color === c ? "border-[#4F46E5]" : "border-slate-200"}`}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
              />
            ))}
            <input
              type="color" value={color} onChange={e => setColor(e.target.value)}
              className="h-8 w-8 cursor-pointer rounded-full border-2 border-slate-200"
              aria-label="Custom color"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            Brush
            <input type="range" min={2} max={30} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} className="w-24" />
          </label>

          <div className="ml-auto flex gap-2">
            <button onClick={handleClear} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-400 hover:text-slate-600">
              <Trash2 size={15} /> Clear
            </button>
            <button onClick={handleSave} className="flex items-center gap-1.5 rounded-lg bg-[#4F46E5] px-3 py-2 text-sm font-bold text-white hover:opacity-90">
              <Download size={15} /> Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
