let stream = null;
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const capturedImage = document.getElementById("capturedImage");
const retakeBtn = document.getElementById("retakeBtn");
const extractBtn = document.getElementById("extractBtn");
const stepIndicator = document.getElementById("stepIndicator");
const captureIndicator = document.getElementById("captureIndicator");
const instructionText = document.getElementById("instructionText");
const cropOverlay = document.getElementById("cropOverlay");
// const overlayHint = document.getElementById("overlayHint");

const notyf = new Notyf({
  position: { x: "right", y: "bottom" },
  ripple: true,
  dismissible: true,
  duration: 5000,
});

const steps = [
  { name: "Title", fields: ["title"] },
  { name: "Authors", fields: ["authors"] },
  {
    name: "Program/Course & Date Published",
    fields: ["program_course", "date_published"],
  },
  { name: "Abstract", fields: ["abstract"] },
  { name: "Keywords", fields: ["keywords"] },
];

const ocrEndpoints = [
  "/ocr/title/",
  "/ocr/authors/",
  "/ocr/program-date/",
  "/ocr/abstract/",
  "/ocr/keywords/",
];

let stepIndex = 0;
let capturedByStep = [[], [], [], [], []];

let cropStart = null;
let cropRect = null;

const token = localStorage.getItem("token");
if (!token) window.location.href = "./";

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("librarianId");
  window.location.href = "index.html";
}

// ---------------- Crop Handlers ----------------
function resetCrop() {
  if (cropRect) cropRect.remove();
  cropRect = null;
  cropStart = null;
}

cropOverlay.addEventListener("mousedown", (e) => {
  resetCrop();
  const rect = cropOverlay.getBoundingClientRect();
  cropStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };

  cropRect = document.createElement("div");
  cropRect.className = "crop-rect";
  cropOverlay.appendChild(cropRect);
});

cropOverlay.addEventListener("mousemove", (e) => {
  if (!cropStart || !cropRect) return;
  const rect = cropOverlay.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  cropRect.style.left = Math.min(x, cropStart.x) + "px";
  cropRect.style.top = Math.min(y, cropStart.y) + "px";
  cropRect.style.width = Math.abs(x - cropStart.x) + "px";
  cropRect.style.height = Math.abs(y - cropStart.y) + "px";
});

cropOverlay.addEventListener("mouseup", () => {
  cropStart = null;
  if (!cropRect) return;

  // overlayHint.style.display = "none"; // Hide hint

  // Take snapshot of video as captured image
  const ctx = canvas.getContext("2d");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg");

  capturedByStep[stepIndex].push(dataUrl);
  capturedImage.src = dataUrl;
  capturedImage.style.display = "block";
  video.style.display = "none";
  captureIndicator.style.display = "inline-block";

  // Show extract and retake buttons
  extractBtn.style.display = "inline-block";
  extractBtn.disabled = false;
  retakeBtn.style.display = "inline-block";

  instructionText.innerHTML = `
  1. Make sure you highlighted <b>${steps[stepIndex].name}</b>.<br>
  2. Click <b>Extract</b> to capture this field.<br>
  3. If needed, click <b>Retake</b> to redo the crop.
`;
});

// ---------------- Camera ----------------
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1920, height: 1080, facingMode: "environment" },
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    notyf.error("Cannot access camera: " + err.message);
  }
}

function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

// ---------------- UI ----------------
function updateStepUI() {
  stepIndicator.innerHTML = "";
  steps.forEach((step, index) => {
    const btn = document.createElement("button");
    btn.textContent = step.name;
    btn.className = "step-btn";
    if (index === stepIndex) {
      btn.style.fontWeight = "bold";
      btn.style.backgroundColor = "#0277bd";
      btn.style.color = "#fff";
    } else {
      btn.style.backgroundColor = "#57a6d1";
      btn.style.color = "#fff";
    }
    btn.addEventListener("click", () => jumpToStep(index));
    stepIndicator.appendChild(btn);
  });

  // overlayHint.style.display = "block";
  // overlayHint.innerText = `Highlight ${steps[stepIndex].name}`;

  capturedImage.style.display = "none";
  video.style.display = "block";
  extractBtn.style.display = "none";
  retakeBtn.style.display = "none";
  captureIndicator.style.display = "none";

  //  User-friendly instruction
  instructionText.innerHTML = `
    <b>Step ${stepIndex + 1}: Highlight ${
    steps[stepIndex].name
  }</b> by dragging the green box over it.
  `;
}

function jumpToStep(index) {
  stepIndex = index;
  resetCrop();
  updateStepUI();
}

// ---------------- Retake ----------------
retakeBtn.addEventListener("click", () => {
  resetCrop();
  capturedImage.style.display = "none";
  video.style.display = "block";
  retakeBtn.style.display = "none";
  extractBtn.style.display = "none";
  captureIndicator.style.display = "none";
  // overlayHint.style.display = "block";

  const lastImages = capturedByStep[stepIndex];
  if (lastImages.length > 0) lastImages.pop();
});

// ---------------- Cropped Image ----------------
async function getCroppedImage() {
  if (!cropRect) return null;

  const img = capturedImage;
  const rect = cropRect.getBoundingClientRect();
  const overlay = cropOverlay.getBoundingClientRect();
  const scaleX = img.naturalWidth / overlay.width;
  const scaleY = img.naturalHeight / overlay.height;
  const cropX = (rect.left - overlay.left) * scaleX;
  const cropY = (rect.top - overlay.top) * scaleY;
  const cropW = rect.width * scaleX;
  const cropH = rect.height * scaleY;

  const c = document.createElement("canvas");
  c.width = cropW;
  c.height = cropH;
  c.getContext("2d").drawImage(
    img,
    cropX,
    cropY,
    cropW,
    cropH,
    0,
    0,
    cropW,
    cropH
  );

  return await new Promise((resolve) => c.toBlob(resolve, "image/jpeg"));
}

// ---------------- OCR ----------------
async function submitStepOCR() {
  const stepImages = capturedByStep[stepIndex];
  if (!stepImages.length) return notyf.error("Please crop first!");

  extractBtn.disabled = true;
  extractBtn.innerHTML = `<span class="loader"></span> Extracting ${steps[stepIndex].name}...`;

  try {
    const formData = new FormData();
    const croppedBlob = await getCroppedImage();
    if (croppedBlob) formData.append("images", croppedBlob, "cropped.jpg");
    else formData.append("images", await (await fetch(stepImages[0])).blob());

    const endpoint = `http://127.0.0.1:8000${ocrEndpoints[stepIndex]}`;
    const response = await fetch(endpoint, { method: "POST", body: formData });
    if (!response.ok) throw new Error(await response.text());

    const result = await response.json();
    steps[stepIndex].fields.forEach((field) => {
      const input = document.querySelector(`[name="${field}"]`);
      if (input && result[field] !== undefined && result[field] !== null) {
        input.value = result[field];
      }
    });

    notyf.success(
      `${steps[stepIndex].name} OCR complete. Accuracy: ${result.accuracy}%`
    );
    capturedByStep[stepIndex].accuracy = result.accuracy;
  } catch (err) {
    console.error(err);
    notyf.error("OCR failed. Please try again.");
  } finally {
    extractBtn.disabled = false;
    extractBtn.innerHTML = "Extract";
    nextStep();
  }
}

extractBtn.addEventListener("click", submitStepOCR);

// ---------------- Step Navigation ----------------
function nextStep() {
  stepIndex++;
  if (stepIndex >= steps.length) {
    notyf.success(
      "All steps completed. You can now save the book information."
    );
    extractBtn.style.display = "none";
    retakeBtn.style.display = "none";
    captureIndicator.style.display = "none";
    return;
  }
  resetCrop();
  updateStepUI();
}

// ---------------- Form Handling ----------------
function convertMonthYearToDate(input) {
  const months = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };
  if (!input) return null;
  const parts = input.trim().split(/\s+/);
  if (parts.length !== 2) return input;
  const monthName = parts[0].toLowerCase();
  const year = parts[1];
  if (!months[monthName] || isNaN(year)) return input;
  return `${year}-${months[monthName]}-01`;
}

function resetForm() {
  document.getElementById("bookForm").reset();
  capturedByStep = [[], [], [], [], []];
  stepIndex = 0;
  resetCrop();
  updateStepUI();
  capturedImage.style.display = "none";
  video.style.display = "block";
  retakeBtn.style.display = "none";
  startCamera();
}

document.getElementById("bookForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  const thesisData = {
    title: formData.get("title"),
    authors: formData.get("authors"),
    program_course: formData.get("program_course"),
    date_published: convertMonthYearToDate(formData.get("date_published")),
    edition_version: formData.get("edition_version") || "1st",
    abstract: formData.get("abstract") || null,
    keywords: formData.get("keywords") || null,
  };

  try {
    const res = await fetch(
      "https://web-production-bfdc1d.up.railway.app/theses/add",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(thesisData),
      }
    );
    if (!res.ok) throw new Error("Save failed");

    const savedThesis = await res.json();
    const thesisId = savedThesis.id;
    const record = {
      thesis_id: thesisId,
      title: formData.get("title"),
      author: formData.get("authors"),
      program: formData.get("program_course"),
      date: formData.get("date_published"),
      abstract: formData.get("abstract"),
      keywords: formData.get("keywords"),
      accuracy: capturedByStep.map((step) => step.accuracy || "N/A"),
      scanned_at: new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    };

    const existing = JSON.parse(localStorage.getItem("ocr_scans") || "[]");
    existing.push(record);
    localStorage.setItem("ocr_scans", JSON.stringify(existing));

    notyf.success("Book information saved successfully!");
    resetForm();
  } catch (err) {
    console.error(err);
    notyf.error("Error saving. Please try again.");
  }
});

// ---------------- Initialize ----------------
window.onload = () => {
  updateStepUI();
  startCamera();
};
