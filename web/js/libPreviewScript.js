let stream = null;
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const capturedImage = document.getElementById("capturedImage");
const captureBtn = document.getElementById("captureBtn");
const retakeBtn = document.getElementById("retakeBtn");
const scannedImagesContainer = document.getElementById(
  "scannedImagesContainer"
);
const stepIndicator = document.getElementById("stepIndicator");
const extractBtn = document.getElementById("extractBtn");
const captureIndicator = document.getElementById("captureIndicator");
const instructionText = document.getElementById("instructionText");
const notyf = new Notyf({
  position: { x: "right", y: "bottom" },
  ripple: true,
  dismissible: true,
  duration: 5000,
});

const steps = [
  { name: "Title & Authors", multiple: false, fields: ["title", "authors"] },
  {
    name: "Program/Course & Date Published",
    multiple: false,
    fields: ["program_course", "date_published"],
  },
  { name: "Abstract", multiple: true, fields: ["abstract"] },
  { name: "Keywords", multiple: false, fields: ["keywords"] },
];

// Map stepIndex to OCR endpoint
const ocrEndpoints = [
  "/ocr/title-authors/", // Step 0
  "/ocr/program-date/", // Step 1
  "/ocr/abstract/", // Step 2
  "/ocr/keywords/", // Step 3
];

let stepIndex = 0;
let capturedByStep = [[], [], [], []]; // images per step

const token = localStorage.getItem("token");

if (!token) {
  window.location.href = "./";
}

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("librarianId");
  window.location.href = "index.html"; // send back to role selection
}

function resizeImage(dataUrl, maxWidth = 800) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = maxWidth / img.width;
      const canvas = document.createElement("canvas");
      canvas.width = maxWidth;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8)); // compress to 80% quality
    };
    img.src = dataUrl;
  });
}

// --- Camera Setup ---
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 }, // smaller width
        height: { ideal: 720 }, // adjust height proportionally
        aspectRatio: { ideal: 1 / 1.414 }, // keep A4 shape
        facingMode: { ideal: "environment" },
      },
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

function updateStepUI() {
  stepIndicator.innerHTML = ""; // clear old content

  steps.forEach((step, index) => {
    const btn = document.createElement("button");
    btn.textContent = step.name;
    btn.className = "step-btn";
    if (index === stepIndex) {
      btn.style.fontWeight = "bold";
      btn.style.backgroundColor = "#0277bd"; // dark background for active step
      btn.style.color = "#ffffff";
    } else {
      btn.style.fontWeight = "normal";
      btn.style.backgroundColor = "#57a6d1"; // lighter shade
      btn.style.color = "#ffffff";
    }

    btn.addEventListener("click", () => {
      jumpToStep(index);
    });
    stepIndicator.appendChild(btn);
  });

  // Hide Extract initially
  extractBtn.style.display = "none";

  instructionText.innerHTML =
    `Capture <b>${steps[stepIndex].name}</b> and click <b>Extract</b>.<br>` +
    `You can <b>Retake</b> if wrong.`;
}

function jumpToStep(index) {
  stepIndex = index;

  // Reset UI for that step
  capturedImage.style.display = "none";
  video.style.display = "block";
  captureBtn.style.display = "inline-block";
  retakeBtn.style.display = "none";
  extractBtn.style.display = "inline-block";

  // Remove the checkmark
  captureIndicator.style.display = "none";

  updateStepUI();
}

// --- Capture ---
captureBtn.addEventListener("click", async () => {
  const ctx = canvas.getContext("2d");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg");

  const resizedDataUrl = await resizeImage(dataUrl);
  capturedByStep[stepIndex].push(resizedDataUrl);

  capturedImage.src = dataUrl;
  capturedImage.style.display = "block";
  video.style.display = "none";

  // Show the checkmark indicator
  captureIndicator.style.display = "inline-block";

  // Hide capture, show retake & extract
  captureBtn.style.display = "none";
  retakeBtn.style.display = "inline-block";

  //  Show Extract now that we have a capture
  extractBtn.style.display = "inline-block";
});

// --- Retake ---
retakeBtn.addEventListener("click", async () => {
  capturedImage.style.display = "none";
  video.style.display = "block";
  captureBtn.style.display = "inline-block";
  retakeBtn.style.display = "none";

  // Hide Extract because capture is gone
  extractBtn.style.display = "none";

  captureIndicator.style.display = "none";

  if (!stream) {
    await startCamera();
  } else {
    video.srcObject = stream;
    await video.play();
  }

  // Remove last captured image
  const lastImages = capturedByStep[stepIndex];
  if (lastImages.length > 0) lastImages.pop();
});

extractBtn.addEventListener("click", async () => {
  // Hide Retake during extraction
  retakeBtn.style.display = "none";

  await submitStepOCR();

  retakeBtn.style.display = "none";
  extractBtn.style.display = "none";
});

async function submitStepOCR() {
  const stepImages = capturedByStep[stepIndex];
  if (!stepImages.length) return;

  const formData = new FormData();
  for (let i = 0; i < stepImages.length; i++) {
    const blob = await (await fetch(stepImages[i])).blob();
    formData.append("images", blob, `step${stepIndex + 1}_page${i + 1}.jpg`);
  }

  extractBtn.disabled = true;
  extractBtn.innerHTML = `<span class="loader"></span> Extracting ${steps[stepIndex].name}...`;

  try {
    const endpoint = `https://web-production-bfdc1d.up.railway.app${ocrEndpoints[stepIndex]}`;
    const response = await fetch(endpoint, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OCR failed: ${errText}`);
    }

    const result = await response.json();

    // Fill form fields
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

    // Auto move to next step
    nextStep();
  }
}

// --- Move to next step ---
function nextStep() {
  stepIndex++;
  if (stepIndex >= steps.length) {
    notyf.success(
      "All steps completed. You can now save the book information."
    );
    captureBtn.style.display = "none";
    retakeBtn.style.display = "none";
    extractBtn.style.display = "none";
    captureIndicator.style.display = "none"; // hide checkmark
    return;
  }
  updateStepUI();
  capturedImage.style.display = "none";
  video.style.display = "block";
  captureBtn.style.display = "inline-block";
  retakeBtn.style.display = "none";
  extractBtn.style.display = "inline-block";
  captureIndicator.style.display = "none"; // hide checkmark
}

// --- Reset form ---
function resetForm() {
  document.getElementById("bookForm").reset();
  capturedByStep = [[], [], [], []];
  stepIndex = 0;
  updateStepUI();
  capturedImage.style.display = "none";
  video.style.display = "block";
  captureBtn.style.display = "inline-block";
  retakeBtn.style.display = "none";
  startCamera();
}

function convertMonthYearToDate(input) {
  // Example: "January 2025"
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
  if (parts.length !== 2) return input; // fallback: return as is

  const monthName = parts[0].toLowerCase();
  const year = parts[1];

  if (!months[monthName] || isNaN(year)) return input;

  return `${year}-${months[monthName]}-01`;
}

// --- Form submission ---
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
    // 1️ Save thesis to backend
    const res = await fetch(
      "https://web-production-bfdc1d.up.railway.app/theses/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(thesisData),
      }
    );

    if (!res.ok) throw new Error("Save failed");

    // 2️ Get the new thesis ID from the response
    const savedThesis = await res.json();
    const thesisId = savedThesis.id;

    // 3️ Build OCR record including the new thesis ID
    const record = {
      thesis_id: thesisId, // ← store backend ID here
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

    // 4️ Save OCR record to localStorage
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

// --- Start camera ---
window.onload = () => {
  updateStepUI();
  startCamera();
};
