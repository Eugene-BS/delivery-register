import { useState, useRef, useEffect } from "react";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const STORAGE_KEY = "delivery-register-v1";

async function loadEntries() {
  try {
    const r = await window.storage.get(STORAGE_KEY, false);
    return r ? JSON.parse(r.value) : [];
  } catch { return []; }
}

async function saveEntries(entries) {
  try {
    await window.storage.set(STORAGE_KEY, JSON.stringify(entries), false);
  } catch (e) { console.error("Storage error", e); }
}

async function extractFromImage(base64Image) {
  const systemPrompt = [
    "You are an expert OCR system reading a printed DELIVERY SLIP form that has been filled in by hand.",
    "",
    "THE SLIP HAS THESE PRINTED LABELS IN ORDER FROM TOP TO BOTTOM:",
    "1. DATE",
    "2. TIME IN",
    "3. SUPPLIER / COMPANY NAME",
    "4. DRIVER NAME",
    "5. VEHICLE REGISTRATION",
    "6. DELIVERY NOTE / PO NO.",
    "",
    "Each label is printed in small capital letters. Below or next to each label is a horizontal line where the person wrote their answer by hand in pen.",
    "",
    "YOUR TASK:",
    "Read the handwritten text on each line and return it exactly as written.",
    "The handwriting may be in cursive, print, or mixed. It may be in pen (blue, black or green).",
    "Even if you are only 60% sure, give your best reading - do not say illegible.",
    "For vehicle registrations: South African format is 2 letters + 3 digits + 3 digits e.g. CY 236 861 or CA 123-456.",
    "For dates: may be written as 29 MAY 26 or 29/05/26 or similar.",
    "For times: may be written as 2:49 or 14:30 or 08h00.",
    "",
    "Return ONLY this exact JSON with no extra text, no markdown, no code fences:",
    '{"date":"...","timeIn":"...","supplierName":"...","driverName":"...","vehicleReg":"...","deliveryNoPO":"..."}'
  ].join("\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { 
  "Content-Type": "application/json",
  "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true"
},
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Image } },
        { type: "text", text: "Read every handwritten field on this delivery slip. Return only the JSON object." }
      ]}]
    })
  });
  const data = await response.json();
  const text = data.content?.map(b => b.text || "").join("") || "{}";
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); }
  catch { return {}; }
}


function QRCode({ url, size = 160 }) {
  return (
    <img
      src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&color=1a1a2e&bgcolor=ffffff`}
      alt="QR Code" width={size} height={size} style={{ display: "block" }}
    />
  );
}

function SlipTemplate({ captureUrl }) {
  return (
    <div style={{ fontFamily: "'Courier New', monospace", background: "#fff", color: "#111", width: 420, padding: "24px 28px", border: "2px solid #111", borderRadius: 4, boxSizing: "border-box" }}>
      <div style={{ textAlign: "center", borderBottom: "2px solid #111", paddingBottom: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: "#555", marginBottom: 4 }}>Supplier Delivery Register</div>
        <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>DELIVERY SLIP</div>
        <div style={{ fontSize: 11, color: "#888", marginTop: 4, fontWeight: 700 }}>Complete all fields clearly in BLOCK LETTERS</div>
      </div>
      {["Date", "Time In", "Supplier / Company Name", "Driver Name", "Vehicle Registration", "Delivery Note / PO No."].map(label => (
        <div key={label} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#666", marginBottom: 4, fontWeight: 900 }}>{label}</div>
          <div style={{ borderBottom: "1px solid #333", height: 24 }} />
        </div>
      ))}
      <div style={{ marginTop: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#666", marginBottom: 2 }}>Driver Signature</div>
        <div style={{ borderBottom: "1px solid #333", height: 28 }} />
      </div>
      <div style={{ borderTop: "2px dashed #aaa", paddingTop: 14, display: "flex", alignItems: "center", gap: 16 }}>
        <QRCode url={captureUrl} size={80} />
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Scan to Register Delivery</div>
          <div style={{ fontSize: 8, color: "#555", lineHeight: 1.5 }}>Gate / warehouse staff must scan<br />this code and photograph the slip<br />to complete the delivery record.</div>
        </div>
      </div>
    </div>
  );
}

function CapturePage({ onSave, onBack }) {
  const [step, setStep] = useState("capture");
  const [imageBase64, setImageBase64] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [editFields, setEditFields] = useState({});
  const [error, setError] = useState("");
  const cameraRef = useRef();
  const galleryRef = useRef();

  const FIELDS = [
    { key: "date", label: "Date" },
    { key: "timeIn", label: "Time In" },
    { key: "supplierName", label: "Supplier / Company Name" },
    { key: "driverName", label: "Driver Name" },
    { key: "vehicleReg", label: "Vehicle Registration" },
    { key: "deliveryNoPO", label: "Delivery Note / PO No." },
  ];

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      setImagePreview(dataUrl);
      setImageBase64(dataUrl.split(",")[1]);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleExtract = async () => {
    if (!imageBase64) { setError("Please take or upload a photo first."); return; }
    setStep("extracting");
    setError("");
    try {
      const data = await extractFromImage(imageBase64);
      setEditFields(data);
      setStep("review");
    } catch {
      setError("Could not read slip. Please try again.");
      setStep("capture");
    }
  };

  const handleSave = async () => {
    setStep("saving");
    await onSave({ id: uid(), timestamp: new Date().toISOString(), imagePreview, ...editFields });
    setStep("done");
  };

  const backBtn = (label, action) => (
    <button onClick={action} style={{ background: "transparent", border: "1px solid #1e3a5f", borderRadius: 6, color: "#8892a4", fontSize: 13, fontFamily: "'Courier New', monospace", padding: "8px 16px", cursor: "pointer", letterSpacing: 1, marginBottom: 24 }}>
      {label}
    </button>
  );

  if (step === "done") return (
    <div style={{ minHeight: "100dvh", background: "#0d1117", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#00c853", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, marginBottom: 20 }}>✓</div>
      <div style={{ color: "#fff", fontSize: 22, fontWeight: 700, fontFamily: "'Courier New', monospace", letterSpacing: 2, marginBottom: 8 }}>LOGGED</div>
      <div style={{ color: "#8892a4", fontSize: 13, textAlign: "center", marginBottom: 24 }}>Delivery has been recorded in the register.</div>
      <button onClick={onBack} style={{ background: "#1e3a5f", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontFamily: "'Courier New', monospace", padding: "10px 20px", cursor: "pointer" }}>← Back to Home</button>
    </div>
  );

  if (step === "extracting" || step === "saving") return (
    <div style={{ minHeight: "100dvh", background: "#0d1117", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: 48, height: 48, border: "4px solid #1e3a5f", borderTopColor: "#4f8ef7", borderRadius: "50%", animation: "spin 0.8s linear infinite", marginBottom: 20 }} />
      <div style={{ color: "#8892a4", fontSize: 14, fontFamily: "'Courier New', monospace" }}>
        {step === "extracting" ? "Reading handwriting..." : "Saving to register..."}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (step === "review") return (
    <div style={{ minHeight: "100dvh", background: "#0d1117", padding: "20px 16px 40px", fontFamily: "'Courier New', monospace" }}>
      {backBtn("← Back", () => setStep("capture"))}
      <div style={{ color: "#4f8ef7", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", marginBottom: 4, fontWeight: 900 }}>Step 2 of 2</div>
      <div style={{ color: "#fff", fontSize: 20, fontWeight: 900, letterSpacing: 1, marginBottom: 4 }}>Review & Confirm</div>
      <div style={{ color: "#8892a4", fontSize: 13, marginBottom: 20, fontWeight: 700 }}>AI extracted the fields below. Correct anything that's wrong.</div>
      {imagePreview && <img src={imagePreview} alt="Slip" style={{ width: "100%", borderRadius: 8, marginBottom: 20, border: "1px solid #1e3a5f", maxHeight: 200, objectFit: "cover" }} />}
      {FIELDS.map(({ key, label }) => (
        <div key={key} style={{ marginBottom: 14 }}>
          <div style={{ color: "#4f8ef7", fontSize: 12, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4, fontWeight: 900 }}>{label}</div>
          <input value={editFields[key] || ""} onChange={e => setEditFields(prev => ({ ...prev, [key]: e.target.value }))}
            style={{ width: "100%", boxSizing: "border-box", background: "#131b27", border: "1px solid #1e3a5f", borderRadius: 6, padding: "12px 14px", color: "#fff", fontSize: 17, fontFamily: "'Courier New', monospace", outline: "none" }} />
        </div>
      ))}
      <button onClick={handleSave} style={{ width: "100%", padding: "16px", marginTop: 8, background: "#00c853", border: "none", borderRadius: 8, color: "#0d1117", fontWeight: 900, fontSize: 16, fontFamily: "'Courier New', monospace", letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>
        SAVE TO REGISTER
      </button>
    </div>
  );

  // ── CAPTURE SCREEN ───────────────────────
  return (
    <div style={{ minHeight: "100dvh", background: "#0d1117", padding: "20px 20px 40px", fontFamily: "'Courier New', monospace", display: "flex", flexDirection: "column", alignItems: "center" }}>
      {backBtn("← Back", onBack)}
      <div style={{ color: "#4f8ef7", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", marginBottom: 4, fontWeight: 900 }}>Step 1 of 2</div>
      <div style={{ color: "#fff", fontSize: 22, fontWeight: 900, letterSpacing: 1, marginBottom: 8, textAlign: "center" }}>PHOTOGRAPH THE SLIP</div>
      <div style={{ color: "#8892a4", fontSize: 13, textAlign: "center", marginBottom: 24, maxWidth: 280 }}>
        Take a photo or choose from your gallery.
      </div>

      {/* Photo preview box */}
      <div
        onClick={() => cameraRef.current.click()}
        style={{ width: "100%", maxWidth: 340, aspectRatio: "3/4", border: "2px dashed #1e3a5f", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden", marginBottom: 12, background: imagePreview ? "transparent" : "#131b27" }}
      >
        {imagePreview
          ? <img src={imagePreview} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
              <div style={{ color: "#4f8ef7", fontSize: 13, letterSpacing: 1 }}>Tap to take photo</div>
            </>
        }
      </div>

      {/* Camera input (opens camera) */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: "none" }} />
      {/* Gallery input (opens gallery/files) */}
      <input ref={galleryRef} type="file" accept="image/*" onChange={handlePhoto} style={{ display: "none" }} />

      {/* Gallery button */}
      <button
        onClick={() => galleryRef.current.click()}
        style={{ width: "100%", maxWidth: 340, padding: "12px", background: "transparent", border: "1px solid #1e3a5f", borderRadius: 8, color: "#8892a4", fontSize: 13, fontFamily: "'Courier New', monospace", letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", marginBottom: 16 }}
      >
        🖼 &nbsp;CHOOSE FROM GALLERY
      </button>

      {error && <div style={{ color: "#ff5252", fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <button onClick={handleExtract} disabled={!imageBase64}
        style={{ width: "100%", maxWidth: 340, padding: "16px", background: imageBase64 ? "#4f8ef7" : "#1e3a5f", border: "none", borderRadius: 8, color: imageBase64 ? "#fff" : "#8892a4", fontWeight: 900, fontSize: 15, fontFamily: "'Courier New', monospace", letterSpacing: 2, textTransform: "uppercase", cursor: imageBase64 ? "pointer" : "not-allowed", transition: "all 0.2s" }}>
        READ SLIP →
      </button>
    </div>
  );
}

function AdminRegister({ entries }) {
  const [selected, setSelected] = useState(null);
  const FIELDS = [
    { key: "date", label: "Date" }, { key: "timeIn", label: "Time In" },
    { key: "supplierName", label: "Supplier" }, { key: "driverName", label: "Driver" },
    { key: "vehicleReg", label: "Reg" }, { key: "deliveryNoPO", label: "PO/DN" },
  ];
  return (
    <div style={{ minHeight: "100vh", background: "#070b12", fontFamily: "'Courier New', monospace", color: "#fff" }}>
      <div style={{ padding: "24px 24px 20px", borderBottom: "1px solid #1a2540" }}>
        <div style={{ fontSize: 9, letterSpacing: 4, color: "#4f8ef7", textTransform: "uppercase", marginBottom: 4, fontWeight: 900 }}>Internal Admin</div>
        <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 2 }}>DELIVERY REGISTER</div>
        <div style={{ color: "#8892a4", fontSize: 12, marginTop: 4 }}>{entries.length} record{entries.length !== 1 ? "s" : ""} logged</div>
      </div>
      {entries.length === 0
        ? <div style={{ padding: 40, textAlign: "center", color: "#8892a4", fontSize: 13 }}>No deliveries recorded yet.<br />Scan the QR code to log the first one.</div>
        : <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#0d1117" }}>
                  <th style={{ padding: "10px 12px", textAlign: "left", color: "#4f8ef7", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", whiteSpace: "nowrap" }}>#</th>
                  {FIELDS.map(f => <th key={f.key} style={{ padding: "10px 12px", textAlign: "left", color: "#4f8ef7", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", whiteSpace: "nowrap" }}>{f.label}</th>)}
                  <th style={{ padding: "10px 12px", color: "#4f8ef7", fontSize: 9, letterSpacing: 2, textTransform: "uppercase" }}>IMG</th>
                </tr>
              </thead>
              <tbody>
                {[...entries].reverse().map((e, i) => (
                  <tr key={e.id} style={{ borderBottom: "1px solid #1a2540", background: i % 2 === 0 ? "#0d1117" : "transparent" }}>
                    <td style={{ padding: "10px 12px", color: "#8892a4", fontSize: 11 }}>{entries.length - i}</td>
                    {FIELDS.map(f => <td key={f.key} style={{ padding: "10px 12px", color: "#e2e8f0", whiteSpace: "nowrap", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>{e[f.key] || <span style={{ color: "#3a4a60" }}>—</span>}</td>)}
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      {e.imagePreview ? <img onClick={() => setSelected(e)} src={e.imagePreview} alt="slip" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4, cursor: "pointer", border: "1px solid #1e3a5f" }} /> : <span style={{ color: "#3a4a60" }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }
      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <img src={selected.imagePreview} alt="slip" style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 8, border: "1px solid #1e3a5f" }} />
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("home");
  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const CAPTURE_URL = typeof window !== "undefined"
    ? window.location.href.split("?")[0] + "?capture=1"
    : "https://yourdeliveryregister.com/capture";

  useEffect(() => {
    loadEntries().then(data => { setEntries(data); setLoaded(true); });
    if (typeof window !== "undefined" && window.location.search.includes("capture=1")) {
      setView("capture");
    }
  }, []);

  const handleSave = async (entry) => {
    const updated = [...entries, entry];
    setEntries(updated);
    await saveEntries(updated);
  };

  if (!loaded) return (
    <div style={{ minHeight: "100vh", background: "#070b12", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#4f8ef7", fontFamily: "monospace", fontSize: 13, letterSpacing: 2 }}>LOADING...</div>
    </div>
  );

  if (view === "capture") return <CapturePage onSave={handleSave} onBack={() => setView("home")} />;

  if (view === "slip") return (
    <div style={{ minHeight: "100vh", background: "#f0f0e8", display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 16px" }}>
      <div className="no-print" style={{ marginBottom: 20, display: "flex", gap: 12 }}>
        <button onClick={() => setView("home")} style={navBtn}>← Back</button>
        <button onClick={() => window.print()} style={{ ...navBtn, background: "#1a1a2e", color: "#fff" }}>🖨 Print 2 per A4</button>
      </div>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4 landscape; margin: 6mm; }
          body { margin: 0; background: white; }
          .print-page {
            width: 285mm;
            height: 197mm;
            display: flex;
            flex-direction: row;
            align-items: flex-start;
            justify-content: center;
            gap: 6mm;
            box-sizing: border-box;
            background: white;
          }
          .print-page > div {
            transform: scale(0.88);
            transform-origin: top left;
          }
        }
        @media screen {
          .print-page { display: flex; flex-direction: row; align-items: flex-start; gap: 24px; flex-wrap: wrap; justify-content: center; }
        }
      `}</style>
      <div className="print-page">
        <SlipTemplate captureUrl={CAPTURE_URL} />
        <SlipTemplate captureUrl={CAPTURE_URL} />
      </div>
      <div className="no-print" style={{ marginTop: 16, fontSize: 11, color: "#888", fontFamily: "monospace", textAlign: "center", maxWidth: 420 }}>
        Prints 2 slips per A4 page. Distribute to drivers.
      </div>
    </div>
  );

  if (view === "admin") return (
    <div>
      <div style={{ padding: "12px 20px", background: "#0d1117", display: "flex", gap: 12, borderBottom: "1px solid #1a2540" }}>
        <button onClick={() => setView("home")} style={navBtn}>← Home</button>
      </div>
      <AdminRegister entries={entries} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#070b12", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, fontFamily: "'Courier New', monospace" }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", backgroundImage: "linear-gradient(rgba(79,142,247,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(79,142,247,0.04) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
      <div style={{ position: "relative", textAlign: "center", maxWidth: 380 }}>
        <div style={{ fontSize: 10, letterSpacing: 5, color: "#4f8ef7", textTransform: "uppercase", marginBottom: 12 }}>Delivery Management System</div>
        <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: 3, color: "#fff", textTransform: "uppercase", lineHeight: 1.1, marginBottom: 8 }}>SUPPLIER<br />DELIVERY<br />REGISTER</div>
        <div style={{ color: "#8892a4", fontSize: 13, marginBottom: 48, lineHeight: 1.6, fontWeight: 700 }}>Scan. Photograph. Log. Done.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <button onClick={() => setView("capture")} style={{ padding: "18px 24px", background: "#4f8ef7", border: "none", borderRadius: 8, color: "#fff", fontWeight: 900, fontSize: 14, fontFamily: "'Courier New', monospace", letterSpacing: 3, textTransform: "uppercase", cursor: "pointer" }}>📷 &nbsp;LOG A DELIVERY</button>
          <button onClick={() => setView("slip")} style={{ padding: "16px 24px", background: "transparent", border: "1px solid #1e3a5f", borderRadius: 8, color: "#8892a4", fontWeight: 700, fontSize: 13, fontFamily: "'Courier New', monospace", letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>🖨 &nbsp;PRINT SLIP TEMPLATE</button>
          <button onClick={() => setView("admin")} style={{ padding: "16px 24px", background: "transparent", border: "1px solid #1e3a5f", borderRadius: 8, color: "#8892a4", fontWeight: 700, fontSize: 13, fontFamily: "'Courier New', monospace", letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>📋 &nbsp;VIEW REGISTER ({entries.length})</button>
        </div>
        <div style={{ marginTop: 40 }}>
          <div style={{ fontSize: 10, color: "#3a4a60", marginBottom: 12, letterSpacing: 2 }}>QR CODE PREVIEW</div>
          <div style={{ display: "inline-block", background: "#fff", padding: 10, borderRadius: 8 }}>
            <QRCode url={CAPTURE_URL} size={120} />
          </div>
          <div style={{ fontSize: 9, color: "#3a4a60", marginTop: 8, letterSpacing: 1 }}>This QR links to the capture form.<br />Print it on your slip template.</div>
        </div>
      </div>
    </div>
  );
}

const navBtn = { padding: "8px 16px", background: "#131b27", border: "1px solid #1e3a5f", borderRadius: 6, color: "#8892a4", fontSize: 12, fontFamily: "'Courier New', monospace", cursor: "pointer", letterSpacing: 1 };
